import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, Money, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type MoneyDto,
  type SubscriptionCancelledV1,
  type SubscriptionPriceChangedV1,
} from '../contracts/index.js';
import {
  changePercent,
  formatSignedPercent,
  assertPending,
  type MaterializationInput,
  type PriceChangeProposal,
  type PriceEntry,
  type ReminderSettings,
  type ScheduleInput,
  Subscription,
} from '../domain/index.js';
import type { SubscriptionsDeps } from './ports/subscriptions.js';
import type { AmountInput, ApiTemplate } from './template-resolver.js';
import type { TemplateChanges } from './definitions.service.js';
import { assembleDetail } from './subscription-assembler.js';
import {
  publishSubscriptionEvent,
  subscriptionChanges,
  subscriptionEntry,
  subscriptionSteps,
} from './subscription-recorder.js';
import type { SubscriptionDto } from './subscription-views.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `subscription ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export interface BillingCycleInput {
  readonly cadence: string;
  readonly interval?: number | undefined;
  readonly monthDays?: readonly number[] | undefined;
  readonly rrule?: string | null | undefined;
}

export interface CreateSubscriptionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly counterpartyId: string;
  readonly name: string;
  readonly planName?: string | null | undefined;
  readonly price: MoneyDto;
  readonly billingCycle: BillingCycleInput;
  readonly firstRenewalOn: string;
  readonly paymentAccountId: string;
  readonly materialization?: MaterializationInput | undefined;
  readonly categoryId?: string | null | undefined;
  readonly trialEndsOn?: string | null | undefined;
  readonly reminder?: Partial<ReminderSettings> | undefined;
  readonly priceTolerancePercent?: string | undefined;
  readonly cancellationUrl?: string | null | undefined;
}

export interface UpdateSubscriptionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly subscriptionId: string;
  readonly expectedVersion: number;
  readonly name?: string | undefined;
  readonly planName?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly materialization?: MaterializationInput | undefined;
  readonly reminder?: Partial<ReminderSettings> | undefined;
  readonly priceTolerancePercent?: string | undefined;
  readonly cancellationUrl?: string | null | undefined;
  readonly paymentAccountId?: string | undefined;
  readonly billingCycle?: BillingCycleInput | undefined;
  /** Fecha de efecto del cambio de cuenta o de ciclo (obligatoria con ellos). */
  readonly effectiveFrom?: string | undefined;
}

interface Command {
  readonly workspaceId: string;
  readonly userId: string;
  readonly subscriptionId: string;
  readonly expectedVersion: number;
}

/** Precio como monto del esperado de la definición: en la moneda de la cuenta (fijo) o indexado a otra moneda. */
function amountInputFor(price: Money, accountCurrency: string): AmountInput {
  const money: MoneyDto = { amount: price.toFixed(), currency: price.currency.code };
  return price.currency.code === accountCurrency
    ? { type: 'FIXED', amount: money }
    : { type: 'ESTIMATED', indexedTo: money };
}

const moneyDto = (m: Money): MoneyDto => ({ amount: m.toFixed(), currency: m.currency.code });

/**
 * Casos de uso de la suscripción (openspec add-subscriptions decisiones 1–7 y 15). Cada comando corre en UNA unidad de
 * trabajo con `SELECT … FOR UPDATE` de la suscripción y deja auditoría + recorrido + outbox en esa misma transacción
 * (INV-029). La suscripción NO escribe tablas del motor: opera su definición con `ManagedDefinitionPort`.
 */
export class SubscriptionsService {
  constructor(private readonly deps: SubscriptionsDeps) {}

  private async clockOf(workspaceId: string): Promise<{ today: LocalDate; at: string }> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, calendar.timeZone), at: now.toString() };
  }

  private async load(workspaceId: string, id: string, expectedVersion: number): Promise<Subscription> {
    const sub = await this.deps.subscriptions.findById(workspaceId, id, { lock: 'update' });
    if (!sub) throw notFound(id);
    if (sub.version !== expectedVersion) throw preconditionFailed(sub.version);
    return sub;
  }

  private async persist(sub: Subscription): Promise<void> {
    if (!(await this.deps.subscriptions.save(sub))) {
      throw preconditionFailed((await this.deps.subscriptions.findById(sub.workspaceId, sub.id))?.version);
    }
  }

  private async currencyOf(workspaceId: string, code: string): Promise<Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const found = catalog.find((c) => c.code === code && c.enabled);
    if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`);
    return makeCurrency(found.code, found.scale);
  }

  private async moneyOf(workspaceId: string, dto: MoneyDto, pointer: string): Promise<Money> {
    const currency = await this.currencyOf(workspaceId, dto.currency);
    try {
      return Money.parse(dto.amount, currency);
    } catch (err) {
      if (err instanceof DomainError) throw new DomainError(err.code, err.message).at(pointer);
      throw err;
    }
  }

  private async refreshNextRenewal(sub: Subscription, today: LocalDate): Promise<void> {
    const status = sub.status;
    const next =
      status === 'CANCELLED' || status === 'PAUSED'
        ? null
        : await this.deps.managed.nextRenewal({
            workspaceId: sub.workspaceId,
            definitionId: sub.snapshot.definitionId,
            today: today.toString(),
          });
    sub.setNextRenewal(next);
  }

  private async providerName(sub: Subscription): Promise<string> {
    const names = await this.deps.counterpartyNames.namesOf({
      workspaceId: sub.workspaceId,
      counterpartyIds: [sub.snapshot.counterpartyId],
    });
    return names.get(sub.snapshot.counterpartyId) ?? sub.snapshot.name;
  }

  // ───────────────────────────────────────────────────────────── alta

  /** `CreateSubscription`: valida y crea la suscripción con su definición recurrente y su primer precio. */
  async create(cmd: CreateSubscriptionCommand): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      await deps.classification.validate({
        userId: cmd.userId,
        workspaceId,
        counterpartyId: cmd.counterpartyId,
      });
      const price = await this.moneyOf(workspaceId, cmd.price, '/price/amount');
      if (!price.isPositive()) {
        throw new DomainError('AMOUNT_NOT_POSITIVE', 'the price must be positive').at('/price/amount');
      }
      const eligibility = await deps.accounts.assertCanPost({
        workspaceId,
        accounts: [{ accountId: cmd.paymentAccountId }],
      });
      const account = eligibility.find((e) => e.accountId === cmd.paymentAccountId);
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/paymentAccountId');
      const subscriptionId = deps.ids.next();
      const template: ApiTemplate = {
        accountId: cmd.paymentAccountId,
        amount: amountInputFor(price, account.currency),
        categoryId: cmd.categoryId ?? null,
        counterpartyId: cmd.counterpartyId,
        schedule: {
          cadence: cmd.billingCycle.cadence,
          ...(cmd.billingCycle.interval !== undefined ? { interval: cmd.billingCycle.interval } : {}),
          ...(cmd.billingCycle.monthDays ? { monthDays: cmd.billingCycle.monthDays } : {}),
          ...(cmd.billingCycle.rrule ? { rrule: cmd.billingCycle.rrule } : {}),
          startDate: cmd.firstRenewalOn,
        } satisfies ScheduleInput,
        ...(cmd.materialization ? { materialization: cmd.materialization } : {}),
      };
      // Valida el alta (trial vs primera renovación, ajustes) antes de tocar el motor.
      const planName = cmd.planName?.trim() ? cmd.planName.trim() : null;
      const definition = await deps.managed.create({
        workspaceId,
        userId: cmd.userId,
        subscriptionId,
        name: cmd.name,
        description: planName,
        template,
      });
      const sub = Subscription.create({
        id: subscriptionId,
        workspaceId,
        definitionId: definition.id,
        counterpartyId: cmd.counterpartyId,
        name: cmd.name,
        planName,
        price,
        priceEntryId: deps.ids.next(),
        firstRenewalOn: cmd.firstRenewalOn,
        trialEndsOn: cmd.trialEndsOn ?? null,
        reminder: cmd.reminder,
        tolerancePercent: cmd.priceTolerancePercent,
        cancellationUrl: cmd.cancellationUrl ?? null,
        at,
        by: cmd.userId,
      });
      await this.refreshNextRenewal(sub, today);
      await deps.subscriptions.insert(sub);
      const info = await deps.managed.info(workspaceId, definition.id);
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'created', [
          ...subscriptionChanges(null, sub.snapshot),
          { field: 'price', before: null, after: moneyDto(price) },
          { field: 'effectiveFrom', before: null, after: cmd.firstRenewalOn },
          { field: 'paymentAccountId', before: null, after: info.accountId },
          { field: 'cadence', before: null, after: info.cadence },
          { field: 'interval', before: null, after: info.interval },
          { field: 'categoryId', before: null, after: info.categoryId },
          { field: 'materializationMode', before: null, after: info.materialization.mode },
        ]),
        subscriptionSteps(sub, []),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  // ───────────────────────────────────────────────────────────── definición ↔ precios

  /**
   * Aplica a la definición una revisión "esta y las siguientes" desde `requestedFrom` (ajustada a una fecha que el
   * motor acepta) con los `changes` indicados y el precio vigente a esa fecha, y vuelve a aplicar cada precio
   * posterior del historial: una revisión nueva reemplaza las versiones futuras que la definición tuviera.
   */
  private async reviseDefinition(
    sub: Subscription,
    userId: string,
    requestedFrom: string,
    changes: TemplateChanges,
  ): Promise<void> {
    const { deps } = this;
    const workspaceId = sub.workspaceId;
    const definitionId = sub.snapshot.definitionId;
    const info = await deps.managed.info(workspaceId, definitionId);
    if (info.status === 'ENDED') return;
    const accountCurrency = changes.accountId
      ? await this.accountCurrency(workspaceId, changes.accountId)
      : info.accountCurrency;
    const from = await deps.managed.revisionFrom({ workspaceId, definitionId, requested: requestedFrom });
    const history = sub.history;
    const first: PriceEntry | undefined = history.at(from) ?? history.active[0];
    if (!first) return;
    await deps.managed.revise({
      workspaceId,
      userId,
      definitionId,
      effectiveFrom: from,
      changes: { ...changes, amount: amountInputFor(first.price, accountCurrency) },
    });
    for (const entry of history.active.filter((e) => e.effectiveFrom > from)) {
      await deps.managed.revise({
        workspaceId,
        userId,
        definitionId,
        effectiveFrom: entry.effectiveFrom,
        changes: { amount: amountInputFor(entry.price, accountCurrency) },
      });
    }
  }

  private async accountCurrency(workspaceId: string, accountId: string): Promise<string> {
    const eligibility = await this.deps.accounts.assertCanPost({ workspaceId, accounts: [{ accountId }] });
    const account = eligibility.find((e) => e.accountId === accountId);
    if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/paymentAccountId');
    return account.currency;
  }

  // ───────────────────────────────────────────────────────────── editar

  /** `UpdateSubscription`: datos simples y, con fecha de efecto, cuenta de pago o ciclo (cambio a futuro del motor). */
  async update(cmd: UpdateSubscriptionCommand): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      if (sub.isCancelled) {
        throw new DomainError('INVALID_STATUS_TRANSITION', 'a cancelled subscription cannot be changed');
      }
      const before = sub.snapshot;
      const info = await deps.managed.info(workspaceId, before.definitionId);
      const changes: TemplateChanges = {
        ...(cmd.categoryId !== undefined ? { categoryId: cmd.categoryId } : {}),
        ...(cmd.materialization ? { materialization: cmd.materialization } : {}),
        ...(cmd.paymentAccountId ? { accountId: cmd.paymentAccountId } : {}),
        ...(cmd.billingCycle
          ? {
              schedule: {
                cadence: cmd.billingCycle.cadence,
                ...(cmd.billingCycle.interval !== undefined ? { interval: cmd.billingCycle.interval } : {}),
                monthDays: cmd.billingCycle.monthDays ? [...cmd.billingCycle.monthDays] : [],
                rrule: cmd.billingCycle.rrule ?? null,
              },
            }
          : {}),
      };
      const needsEffect = cmd.paymentAccountId !== undefined || cmd.billingCycle !== undefined;
      if (needsEffect && !cmd.effectiveFrom) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'effectiveFrom is required to change the payment account or the billing cycle',
        ).at('/effectiveFrom');
      }
      const defFields = [
        ...(cmd.categoryId !== undefined ? ['categoryId'] : []),
        ...(cmd.materialization ? ['materializationMode'] : []),
        ...(cmd.paymentAccountId ? ['paymentAccountId'] : []),
        ...(cmd.billingCycle ? ['cadence'] : []),
      ];
      sub.annotate(
        {
          name: cmd.name,
          planName: cmd.planName,
          reminder: cmd.reminder,
          tolerancePercent: cmd.priceTolerancePercent,
          cancellationUrl: cmd.cancellationUrl,
        },
        at,
        cmd.userId,
        defFields,
      );
      if (sub.version === before.version) return assembleDetail(deps, sub, today);

      if (cmd.name !== undefined || cmd.planName !== undefined) {
        await deps.managed.rename({
          workspaceId,
          userId: cmd.userId,
          definitionId: before.definitionId,
          ...(cmd.name !== undefined ? { name: sub.snapshot.name } : {}),
          ...(cmd.planName !== undefined ? { description: sub.snapshot.planName } : {}),
        });
      }
      if (Object.keys(changes).length > 0) {
        await this.reviseDefinition(sub, cmd.userId, cmd.effectiveFrom ?? today.toString(), changes);
      }
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      const after = await deps.managed.info(workspaceId, before.definitionId);
      const extra: AuditChangeInput[] = [];
      const diff = (field: string, b: unknown, a: unknown) => {
        if (b !== a) extra.push({ field, before: b, after: a });
      };
      diff('paymentAccountId', info.accountId, after.accountId);
      diff('cadence', info.cadence, after.cadence);
      diff('interval', info.interval, after.interval);
      diff('categoryId', info.categoryId, after.categoryId);
      diff('materializationMode', info.materialization.mode, after.materialization.mode);
      if (extra.length > 0 && cmd.effectiveFrom)
        extra.push({ field: 'effectiveFrom', before: null, after: cmd.effectiveFrom });
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'updated', [...subscriptionChanges(before, sub.snapshot), ...extra]),
        subscriptionSteps(sub, []),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  // ───────────────────────────────────────────────────────────── precios

  private priceChanged(
    sub: Subscription,
    input: {
      readonly previous: Money;
      readonly next: Money;
      readonly effectiveFrom: string;
      readonly origin: SubscriptionPriceChangedV1['origin'];
      readonly providerName: string;
    },
  ): SubscriptionPriceChangedV1 {
    return {
      workspaceId: sub.workspaceId,
      subscriptionId: sub.id,
      definitionId: sub.snapshot.definitionId,
      counterpartyId: sub.snapshot.counterpartyId,
      providerName: input.providerName,
      previousPrice: moneyDto(input.previous),
      newPrice: moneyDto(input.next),
      effectiveFrom: input.effectiveFrom,
      changePercentage: formatSignedPercent(changePercent(input.previous.amount, input.next.amount)),
      origin: input.origin,
      proposalId: null,
      chargeId: null,
      transactionId: null,
    };
  }

  /** `ChangeSubscriptionPrice`: precio nuevo con vigencia posterior a la última; aplica solo a cargos futuros. */
  async changePrice(
    cmd: Command & { readonly price: MoneyDto; readonly effectiveFrom: string },
  ): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const price = await this.moneyOf(workspaceId, cmd.price, '/price/amount');
      const previous = sub.history.latest?.price ?? price;
      const entry = sub.changePrice(
        { entryId: deps.ids.next(), effectiveFrom: cmd.effectiveFrom, price, origin: 'MANUAL' },
        at,
        cmd.userId,
      );
      await this.reviseDefinition(sub, cmd.userId, entry.effectiveFrom, {});
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      const event = await publishSubscriptionEvent(
        deps,
        sub,
        COMMITMENTS_EVENTS.subscriptionPriceChanged,
        this.priceChanged(sub, {
          previous,
          next: price,
          effectiveFrom: entry.effectiveFrom,
          origin: 'MANUAL',
          providerName: await this.providerName(sub),
        }),
      );
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'price_changed', [
          { field: 'previousPrice', before: null, after: moneyDto(previous) },
          { field: 'price', before: null, after: moneyDto(price) },
          { field: 'effectiveFrom', before: null, after: entry.effectiveFrom },
          { field: 'priceOrigin', before: null, after: 'MANUAL' },
        ]),
        subscriptionSteps(sub, [event], { changedFields: ['price'] }),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  /** `SupersedeSubscriptionPrice`: corrige una entrada registrada por error con un reemplazo de la misma vigencia. */
  async supersedePrice(
    cmd: Command & {
      readonly priceId: string;
      readonly price: MoneyDto;
      readonly reason?: string | undefined;
    },
  ): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const price = await this.moneyOf(workspaceId, cmd.price, '/price/amount');
      const target = sub.history.entries.find((e) => e.id === cmd.priceId);
      if (!target) throw new DomainError('RESOURCE_NOT_FOUND', `price entry ${cmd.priceId} not found`);
      const refDate = target.effectiveFrom > today.toString() ? target.effectiveFrom : today.toString();
      const beforeAtRef = sub.history.at(refDate)?.price ?? null;
      const { entry, superseded } = sub.supersedePrice(
        { entryId: deps.ids.next(), supersedesId: cmd.priceId, price },
        at,
        cmd.userId,
      );
      await this.reviseDefinition(sub, cmd.userId, entry.effectiveFrom, {});
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      const afterAtRef = sub.history.at(refDate)?.price ?? null;
      const events = [];
      // No se publica el hecho si el precio vigente resultante hacia adelante no cambia (decisión 7).
      if (beforeAtRef === null || afterAtRef === null || !beforeAtRef.equals(afterAtRef)) {
        events.push(
          await publishSubscriptionEvent(
            deps,
            sub,
            COMMITMENTS_EVENTS.subscriptionPriceChanged,
            this.priceChanged(sub, {
              previous: superseded.price,
              next: price,
              effectiveFrom: entry.effectiveFrom,
              origin: 'CORRECTION',
              providerName: await this.providerName(sub),
            }),
          ),
        );
      }
      await deps.lifecycle.record(
        subscriptionEntry(
          sub,
          'price_superseded',
          [
            { field: 'previousPrice', before: null, after: moneyDto(superseded.price) },
            { field: 'price', before: null, after: moneyDto(price) },
            { field: 'effectiveFrom', before: null, after: entry.effectiveFrom },
            { field: 'priceOrigin', before: null, after: 'CORRECTION' },
          ],
          cmd.reason,
        ),
        subscriptionSteps(sub, events, { changedFields: ['price'] }),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  private async loadProposal(sub: Subscription, proposalId: string): Promise<PriceChangeProposal> {
    const proposal = await this.deps.proposals.findById(sub.workspaceId, sub.id, proposalId, {
      lock: 'update',
    });
    if (!proposal) throw new DomainError('RESOURCE_NOT_FOUND', `price proposal ${proposalId} not found`);
    assertPending(proposal);
    return proposal;
  }

  /** `AcceptPriceProposal`: agrega el precio al historial (`PROPOSAL`) sin volver a publicar el hecho. */
  async acceptProposal(
    cmd: Command & { readonly proposalId: string; readonly effectiveFrom?: string | undefined },
  ): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const proposal = await this.loadProposal(sub, cmd.proposalId);
      const entry = sub.changePrice(
        {
          entryId: deps.ids.next(),
          effectiveFrom: cmd.effectiveFrom ?? proposal.effectiveFrom,
          price: proposal.proposedPrice,
          origin: 'PROPOSAL',
          proposalId: proposal.id,
        },
        at,
        cmd.userId,
      );
      await this.reviseDefinition(sub, cmd.userId, entry.effectiveFrom, {});
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      await deps.proposals.update(workspaceId, {
        ...proposal,
        status: 'ACCEPTED',
        decidedAt: at,
        decidedBy: cmd.userId,
      });
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'price_proposal_accepted', [
          { field: 'proposalId', before: null, after: proposal.id },
          { field: 'proposalStatus', before: 'PENDING', after: 'ACCEPTED' },
          { field: 'price', before: null, after: moneyDto(proposal.proposedPrice) },
          { field: 'effectiveFrom', before: null, after: entry.effectiveFrom },
          { field: 'priceOrigin', before: null, after: 'PROPOSAL' },
        ]),
        subscriptionSteps(sub, [], { changedFields: ['price'], detailRefs: {} }),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  /** `RejectPriceProposal`: el historial no cambia. */
  async rejectProposal(cmd: Command & { readonly proposalId: string }): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const proposal = await this.loadProposal(sub, cmd.proposalId);
      sub.touch(['priceProposal'], at, cmd.userId);
      await this.persist(sub);
      await deps.proposals.update(workspaceId, {
        ...proposal,
        status: 'REJECTED',
        decidedAt: at,
        decidedBy: cmd.userId,
      });
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'price_proposal_rejected', [
          { field: 'proposalId', before: null, after: proposal.id },
          { field: 'proposalStatus', before: 'PENDING', after: 'REJECTED' },
        ]),
        subscriptionSteps(sub, [], { changedFields: ['priceProposal'] }),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  // ───────────────────────────────────────────────────────────── estados

  /** `PauseSubscription`: pausa la definición (sin cargos esperados pendientes mientras dure). */
  async pause(cmd: Command): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const before = sub.snapshot;
      sub.pause(at, cmd.userId);
      await deps.managed.pause({ workspaceId, userId: cmd.userId, definitionId: before.definitionId });
      sub.setNextRenewal(null);
      await this.persist(sub);
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'paused', subscriptionChanges(before, sub.snapshot)),
        subscriptionSteps(sub, []),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  /** `ResumeSubscription`: reanuda sin generar las fechas transcurridas durante la pausa. */
  async resume(cmd: Command): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const before = sub.snapshot;
      sub.resume(at, cmd.userId);
      await deps.managed.resume({ workspaceId, userId: cmd.userId, definitionId: before.definitionId });
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'resumed', subscriptionChanges(before, sub.snapshot)),
        subscriptionSteps(sub, []),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  private cancelledEvent(sub: Subscription, scheduled: boolean): SubscriptionCancelledV1 {
    const s = sub.snapshot;
    return {
      workspaceId: sub.workspaceId,
      subscriptionId: sub.id,
      definitionId: s.definitionId,
      counterpartyId: s.counterpartyId,
      cancelledOn: s.cancelledOn as string,
      scheduled,
      reason: s.cancellationReason,
    };
  }

  /**
   * `CancelSubscription`: con fecha efectiva de hoy o anterior cancela y finaliza la definición (los cargos esperados
   * desde esa fecha quedan cancelados); con una fecha futura programa la cancelación al fin del ciclo pagado
   * (atributo, sin estado nuevo; D139).
   */
  async cancel(
    cmd: Command & { readonly effectiveOn?: string | undefined; readonly reason?: string | undefined },
  ): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const before = sub.snapshot;
      const effectiveOn = cmd.effectiveOn ?? today.toString();
      let parsed: LocalDate;
      try {
        parsed = LocalDate.parse(effectiveOn);
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'effectiveOn must be YYYY-MM-DD').at('/effectiveOn');
      }
      if (parsed.compare(today) > 0) return this.schedule(sub, cmd, parsed, today, at);
      sub.cancel({ on: effectiveOn, reason: cmd.reason, today }, at, cmd.userId);
      await deps.managed.end({
        workspaceId,
        userId: cmd.userId,
        definitionId: before.definitionId,
        endDate: parsed.plusDays(-1).toString(),
        deferClose: false,
      });
      await this.persist(sub);
      const event = await publishSubscriptionEvent(
        deps,
        sub,
        COMMITMENTS_EVENTS.subscriptionCancelled,
        this.cancelledEvent(sub, false),
      );
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'cancelled', subscriptionChanges(before, sub.snapshot), cmd.reason),
        subscriptionSteps(sub, [event], { reason: cmd.reason ?? null }),
      );
      return assembleDetail(deps, sub, today);
    });
  }

  private async schedule(
    sub: Subscription,
    cmd: Command & { readonly reason?: string | undefined },
    on: LocalDate,
    today: LocalDate,
    at: string,
  ): Promise<SubscriptionDto> {
    const { deps } = this;
    const before = sub.snapshot;
    const definitionId = before.definitionId;
    if (before.scheduledCancellationOn !== null) {
      // Reprogramar: deshace la fecha anterior (reinstaura los cargos) antes de fijar la nueva.
      await deps.managed.unscheduleEnd({ workspaceId: sub.workspaceId, userId: cmd.userId, definitionId });
    }
    sub.scheduleCancellation({ on: on.toString(), reason: cmd.reason, today }, at, cmd.userId);
    await deps.managed.end({
      workspaceId: sub.workspaceId,
      userId: cmd.userId,
      definitionId,
      endDate: on.plusDays(-1).toString(),
      deferClose: true,
    });
    await this.refreshNextRenewal(sub, today);
    await this.persist(sub);
    await deps.lifecycle.record(
      subscriptionEntry(sub, 'cancellation_scheduled', subscriptionChanges(before, sub.snapshot), cmd.reason),
      subscriptionSteps(sub, [], { reason: cmd.reason ?? null }),
    );
    return assembleDetail(deps, sub, today);
  }

  /** `UndoScheduledCancellation`: reinstaura los cargos esperados y quita la programación. */
  async undoScheduledCancellation(cmd: Command): Promise<SubscriptionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const sub = await this.load(workspaceId, cmd.subscriptionId, cmd.expectedVersion);
      const before = sub.snapshot;
      sub.undoScheduledCancellation(at, cmd.userId);
      await deps.managed.unscheduleEnd({
        workspaceId,
        userId: cmd.userId,
        definitionId: before.definitionId,
      });
      await this.refreshNextRenewal(sub, today);
      await this.persist(sub);
      await deps.lifecycle.record(
        subscriptionEntry(sub, 'cancellation_unscheduled', subscriptionChanges(before, sub.snapshot)),
        subscriptionSteps(sub, []),
      );
      return assembleDetail(deps, sub, today);
    });
  }
}
