import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, Money, currency as makeCurrency } from '@pf/shared-kernel';
import {
  CreditCard,
  validMaterialization,
  validPolicy,
  type CardAccountState,
  type CardEdit,
  type CardPaymentPlanState,
  type CreditCardState,
} from '../domain/index.js';
import { CardEngine, type CardClock } from './card-engine.js';
import type { CardDeps } from './card-ports.js';
import { CARD_AGGREGATE } from './card-engine.js';
import { cardView, type CreditCardView } from './card-views.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `credit card ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

export interface PaymentPlanRequest {
  readonly sourceAccountId: string;
  readonly policy?: unknown;
  readonly materialization?: {
    readonly mode?: unknown;
    readonly autoCreateStatus?: unknown;
    readonly leadDays?: unknown;
  } | null;
}

export interface RegisterCardCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: unknown;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly creditLimit?: { readonly amount?: unknown } | string | null;
    readonly minimumRule: unknown;
    readonly paymentPlan?: PaymentPlanRequest | null;
  }[];
  readonly limitMode?: unknown;
  readonly sharedLimit?: { readonly amount: unknown; readonly currency: unknown } | null;
  readonly statementDay: unknown;
  readonly dueDay: unknown;
  readonly dueWeekendAdjustment?: unknown;
  readonly annualRate?: unknown;
  readonly utilizationThresholds?: unknown;
  readonly reminderDays?: unknown;
}

export interface UpdateCardCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly cardId: string;
  readonly expectedVersion: number;
  readonly edit: Omit<CardEdit, 'accounts'> & {
    readonly accounts?: readonly {
      readonly accountId: string;
      readonly creditLimit?: { readonly amount?: unknown } | string | null;
      readonly minimumRule?: unknown;
    }[];
  };
}

/** Los límites llegan como `Money` del contrato (`{amount, currency}`); el dominio trabaja con el monto en texto. */
const amountOf = (value: unknown): unknown =>
  value !== null && typeof value === 'object' ? (value as { amount?: unknown }).amount : value;

const jsonText = (value: unknown): string => JSON.stringify(value);

function cardChanges(before: CreditCardState | null, after: CreditCardState): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ field, before: before === null ? null : b, after: a });
    }
  };
  const bt = before?.terms.at(-1);
  const at = after.terms.at(-1);
  diff('name', before?.name, after.name);
  diff('status', before?.status, after.status);
  diff('statementDay', bt?.statementDay, at?.statementDay);
  diff('dueDay', bt?.dueDay, at?.dueDay);
  diff('dueWeekendAdjustment', bt?.dueWeekendAdjustment, at?.dueWeekendAdjustment);
  diff('annualRate', before?.annualRate, after.annualRate);
  diff('limitMode', before?.limitMode, after.limitMode);
  diff(
    'sharedLimit',
    before?.sharedLimit && { amount: before.sharedLimit.amount, currency: before.sharedLimit.currency },
    after.sharedLimit && { amount: after.sharedLimit.amount, currency: after.sharedLimit.currency },
  );
  diff(
    'utilizationThresholds',
    before && jsonText(before.utilizationThresholds),
    jsonText(after.utilizationThresholds),
  );
  diff('reminderDays', before?.reminderDays, after.reminderDays);
  // Una cuenta por moneda: los campos por cuenta llevan el sufijo `.<MONEDA>` (la auditoría no admite campos repetidos
  // y la política de campos permitidos los reconoce por prefijo, `creditLimit.*`).
  for (const a of after.accounts) {
    const b = before?.accounts.find((x) => x.id === a.id);
    const at = (field: string) => `${field}.${a.currency}`;
    if (before === null || b?.accountId !== a.accountId) diff(at('accountId'), undefined, a.accountId);
    diff(
      at('creditLimit'),
      b?.creditLimit !== undefined && b.creditLimit !== null
        ? { amount: b.creditLimit, currency: a.currency }
        : b
          ? null
          : undefined,
      a.creditLimit === null ? null : { amount: a.creditLimit, currency: a.currency },
    );
    diff(at('minimumRule'), b && jsonText(b.minimumRule), jsonText(a.minimumRule));
    diff(
      at('paymentPlanSourceAccountId'),
      b?.paymentPlan?.sourceAccountId ?? (b ? null : undefined),
      a.paymentPlan?.sourceAccountId ?? null,
    );
    diff(
      at('paymentPlanPolicy'),
      b?.paymentPlan?.policy ?? (b ? null : undefined),
      a.paymentPlan?.policy ?? null,
    );
    diff(
      at('paymentPlanMaterialization'),
      b?.paymentPlan ? jsonText(b.paymentPlan.materialization) : b ? null : undefined,
      a.paymentPlan ? jsonText(a.paymentPlan.materialization) : null,
    );
    diff(
      at('paymentPlanDefinitionId'),
      b?.paymentPlan?.definitionId ?? (b ? null : undefined),
      a.paymentPlan?.definitionId ?? null,
    );
  }
  return out.filter((c) => c.before !== undefined || c.after !== undefined);
}

/**
 * Casos de uso de DEBT sobre tarjetas de crédito (openspec add-credit-cards, decisiones 1, 2, 7, 15 y 16): registrar,
 * editar, archivar, activar/desactivar el plan de pago administrado y registrar los montos del banco. Cada comando corre
 * en UNA unidad de trabajo con su auditoría y sus hechos de outbox (INV-029). Debt no escribe asientos: el plan de pago
 * crea una definición `CARD_PAYMENT` en COMMITMENTS por su puerto público.
 */
export class CardsService {
  readonly engine: CardEngine;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
  }

  private async load(workspaceId: string, id: string): Promise<CreditCard> {
    const card = await this.deps.cards.findById(workspaceId, id, { lock: 'update' });
    if (!card) throw notFound(id);
    return card;
  }

  private async save(card: CreditCard, by: string): Promise<void> {
    if (!(await this.deps.cards.save(card, by))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the credit card was modified concurrently');
    }
    card.markPersisted();
  }

  private async view(
    card: CreditCard,
    clock: CardClock,
    conflicts?: CreditCardView['paymentPlanConflicts'],
  ): Promise<CreditCardView> {
    const views = await this.engine.loadViews(card, clock);
    const scopes = await this.engine.utilizationScopes(card, views, clock);
    return cardView(card.snapshot, views, scopes, conflicts);
  }

  // ───────────────────────────────────────────────────────────── registrar

  async register(
    cmd: RegisterCardCommand,
  ): Promise<{ readonly id: string; readonly conflicts: CreditCardView['paymentPlanConflicts'] }> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      if (!Array.isArray(cmd.accounts) || cmd.accounts.length === 0) {
        throw new DomainError('VALIDATION_FAILED', 'at least one account is required').at('/accounts');
      }
      const ids = cmd.accounts.map((a) => a.accountId);
      const found = new Map(
        (await deps.accounts.find(cmd.workspaceId, ids)).map((a) => [a.accountId, a] as const),
      );
      for (const [i, a] of cmd.accounts.entries()) {
        const info = found.get(a.accountId);
        if (!info || info.type !== 'CREDIT_CARD' || info.status !== 'ACTIVE') {
          throw new DomainError(
            'CREDIT_CARD_ACCOUNT_INVALID',
            'the account must be an active credit card account',
          ).at(`/accounts/${i}/accountId`);
        }
      }
      const inUse = await deps.cards.activeCardsOfAccounts(cmd.workspaceId, ids);
      if (inUse.length > 0) {
        throw new DomainError(
          'CREDIT_CARD_ACCOUNT_IN_USE',
          'the account already belongs to another credit card',
        ).at('/accounts');
      }
      const scales = new Map<string, number>();
      for (const info of found.values()) {
        const scale = await deps.currencies.scaleOf(info.currency);
        if (scale === null)
          throw new DomainError('VALIDATION_FAILED', `currency ${info.currency} is not available`);
        scales.set(info.currency, scale);
      }
      const cardId = deps.ids.next();
      const card = CreditCard.register({
        id: cardId,
        workspaceId: cmd.workspaceId,
        name: cmd.name,
        accounts: cmd.accounts.map((a) => {
          const info = found.get(a.accountId) as NonNullable<ReturnType<typeof found.get>>;
          return {
            id: deps.ids.next(),
            accountId: a.accountId,
            currency: info.currency,
            scale: scales.get(info.currency) as number,
            creditLimit: amountOf(a.creditLimit) as string | null | undefined,
            minimumRule: a.minimumRule,
          };
        }),
        limitMode: cmd.limitMode,
        sharedLimit: cmd.sharedLimit ?? null,
        statementDay: cmd.statementDay,
        dueDay: cmd.dueDay,
        dueWeekendAdjustment: cmd.dueWeekendAdjustment,
        annualRate: cmd.annualRate,
        utilizationThresholds: cmd.utilizationThresholds,
        reminderDays: cmd.reminderDays,
        scaleOf: (code) => (code in Object.fromEntries(scales) ? (scales.get(code) as number) : null),
        at: clock.at,
        by: cmd.userId,
      });
      // Cuentas con monedas fuera del catálogo del límite compartido: se resuelve la escala si falta.
      await deps.cards.insert(card, cmd.userId);
      card.markPersisted();
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.credit_card.created',
        aggregateType: CARD_AGGREGATE,
        aggregateId: cardId,
        aggregateVersion: card.version,
        changes: cardChanges(null, card.snapshot),
      });
      // Estado inicial de los umbrales: sin disparar (la tarjeta se registra con su utilización actual).
      let views = await this.engine.loadViews(card, clock);
      await this.engine.evaluateUtilization(card, views, clock, { silent: true });
      // Decisión 5: se emite el último ciclo cerrado de cada cuenta si su vencimiento no pasó.
      for (const v of views) {
        const lastClosed = [...v.cycles].reverse().find((c) => !c.open);
        if (lastClosed && lastClosed.cycle.dueDate.compare(clock.today) >= 0) {
          await this.engine.issueCycle(card, v, lastClosed, clock);
        }
      }
      // Planes de pago pedidos: un conflicto no impide registrar la tarjeta (D166).
      const conflicts: NonNullable<CreditCardView['paymentPlanConflicts']> extends readonly (infer C)[]
        ? C[]
        : never = [];
      for (const [i, a] of cmd.accounts.entries()) {
        if (!a.paymentPlan) continue;
        const state = card.snapshot.accounts[i] as CardAccountState;
        try {
          await this.enableInternal(card, state.accountId, a.paymentPlan, cmd.userId, clock);
        } catch (err) {
          if (err instanceof DomainError && err.code === 'CARD_PAYMENT_PLAN_CONFLICT') {
            conflicts.push({
              accountId: state.accountId,
              conflictingDefinitions: (err.details?.['conflictingDefinitions'] ?? []) as {
                definitionId: string;
                name: string;
              }[],
            });
            continue;
          }
          throw err;
        }
      }
      views = await this.engine.loadViews(card, clock);
      for (const v of views) await this.engine.syncPlan(card, v, clock, cmd.userId);
      await this.save(card, cmd.userId);
      return { id: cardId, conflicts };
    });
  }

  // ───────────────────────────────────────────────────────────── plan de pago

  /** Fecha nominal de la primera ocurrencia del plan: el próximo vencimiento nominal >= hoy. */
  private firstNominalDue(card: CreditCard, today: LocalDate): LocalDate {
    const calendar = card.calendar;
    const lastClosed = calendar.lastClosedCycle(today);
    if (lastClosed.nominalDue.compare(today) >= 0) return lastClosed.nominalDue;
    return calendar.openCycle(today).nominalDue;
  }

  private planName(card: CreditCard, account: CardAccountState): string {
    const state = card.snapshot;
    return state.accounts.length > 1
      ? `Pago de tarjeta · ${state.name} (${account.currency})`
      : `Pago de tarjeta · ${state.name}`;
  }

  /** Activa o reemplaza el plan de una cuenta dentro de la unidad de trabajo del llamador (card ya bloqueada). */
  private async enableInternal(
    card: CreditCard,
    accountId: string,
    request: PaymentPlanRequest,
    userId: string,
    clock: CardClock,
  ): Promise<void> {
    const { deps } = this;
    card.assertActive();
    const account = card.account(accountId);
    const policy = validPolicy(request.policy);
    const materialization = validMaterialization(request.materialization ?? null);
    if (typeof request.sourceAccountId !== 'string') {
      throw new DomainError('VALIDATION_FAILED', 'sourceAccountId is required').at('/sourceAccountId');
    }
    const source = (await deps.accounts.find(card.workspaceId, [request.sourceAccountId]))[0];
    if (!source)
      throw new DomainError('REFERENCE_NOT_FOUND', 'source account not found').at('/sourceAccountId');
    if (source.nature !== 'ASSET') {
      throw new DomainError('VALIDATION_FAILED', 'the source account must be an asset account').at(
        '/sourceAccountId',
      );
    }
    await deps.accounts.assertCanPost(card.workspaceId, [
      { accountId: request.sourceAccountId, currency: account.currency },
    ]);
    const existing = account.paymentPlan;
    const state = card.snapshot;
    const terms = card.currentTerms;
    let definitionId: string;
    if (existing) {
      definitionId = existing.definitionId;
      await deps.recurring.revise({
        workspaceId: card.workspaceId,
        userId,
        definitionId,
        accountId: request.sourceAccountId,
        materialization: {
          mode: materialization.mode,
          ...(materialization.autoCreateStatus ? { autoCreateStatus: materialization.autoCreateStatus } : {}),
          ...(materialization.leadDays !== null ? { leadDays: materialization.leadDays } : {}),
        },
        effectiveFrom: clock.today.toString(),
      });
    } else {
      // El plan no puede convivir con una transferencia recurrente del usuario hacia la tarjeta (D166).
      const conflicts = await deps.recurringQuery.listActiveTransfersTo({
        workspaceId: card.workspaceId,
        accountId: account.accountId,
      });
      if (conflicts.length > 0) {
        throw new DomainError(
          'CARD_PAYMENT_PLAN_CONFLICT',
          'an active recurring transfer to the card exists; end it before enabling the payment plan',
          {
            details: {
              conflictingDefinitions: conflicts.map((c) => ({ definitionId: c.definitionId, name: c.name })),
            },
          },
        );
      }
      const created = await deps.recurring.createManaged({
        workspaceId: card.workspaceId,
        userId,
        managedBy: 'DEBT',
        managedRef: account.id,
        name: this.planName(card, account),
        kind: 'CARD_PAYMENT',
        accountId: request.sourceAccountId,
        toAccountId: account.accountId,
        currency: account.currency,
        monthlyRule: {
          monthDays: [terms.dueDay],
          startDate: this.firstNominalDue(card, clock.today).toString(),
          weekendAdjustment: terms.dueWeekendAdjustment,
        },
        materialization: {
          mode: materialization.mode,
          ...(materialization.autoCreateStatus ? { autoCreateStatus: materialization.autoCreateStatus } : {}),
          ...(materialization.leadDays !== null ? { leadDays: materialization.leadDays } : {}),
        },
      });
      definitionId = created.definitionId;
    }
    const plan: CardPaymentPlanState = {
      sourceAccountId: request.sourceAccountId,
      policy,
      materialization,
      definitionId,
      enabledAt: existing?.enabledAt ?? clock.at,
    };
    card.setPaymentPlan(account.accountId, plan, clock.at);
    void state;
  }

  async enablePlan(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly accountId: string;
    readonly expectedVersion: number;
    readonly request: PaymentPlanRequest;
  }): Promise<CreditCardView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.load(cmd.workspaceId, cmd.cardId);
      if (card.version !== cmd.expectedVersion) throw preconditionFailed(card.version);
      const before = card.snapshot;
      await this.enableInternal(card, cmd.accountId, cmd.request, cmd.userId, clock);
      const views = await this.engine.loadViews(card, clock);
      for (const v of views) await this.engine.syncPlan(card, v, clock, cmd.userId);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.credit_card.payment_plan_enabled',
        aggregateType: CARD_AGGREGATE,
        aggregateId: card.id,
        aggregateVersion: card.version,
        changes: cardChanges(before, card.snapshot),
      });
      await this.save(card, cmd.userId);
      return this.view(card, clock);
    });
  }

  async disablePlan(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly accountId: string;
    readonly expectedVersion: number;
  }): Promise<CreditCardView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.load(cmd.workspaceId, cmd.cardId);
      if (card.version !== cmd.expectedVersion) throw preconditionFailed(card.version);
      const before = card.snapshot;
      const account = card.account(cmd.accountId);
      if (account.paymentPlan) {
        await deps.recurring.end({
          workspaceId: cmd.workspaceId,
          userId: cmd.userId,
          definitionId: account.paymentPlan.definitionId,
          from: clock.today.toString(),
        });
        card.setPaymentPlan(account.accountId, null, clock.at);
        await deps.audit.append({
          workspaceId: cmd.workspaceId,
          action: 'debt.credit_card.payment_plan_disabled',
          aggregateType: CARD_AGGREGATE,
          aggregateId: card.id,
          aggregateVersion: card.version,
          changes: cardChanges(before, card.snapshot),
        });
        await this.save(card, cmd.userId);
      }
      return this.view(card, clock);
    });
  }

  // ───────────────────────────────────────────────────────────── editar y archivar

  async update(cmd: UpdateCardCommand): Promise<CreditCardView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.load(cmd.workspaceId, cmd.cardId);
      if (card.version !== cmd.expectedVersion) throw preconditionFailed(card.version);
      const before = card.snapshot;
      const records = await deps.statements.listForAccounts(
        cmd.workspaceId,
        before.accounts.map((a) => a.id),
      );
      const lastIssued = records
        .map((r) => r.closingDate)
        .sort()
        .at(-1);
      const edit: CardEdit = {
        ...cmd.edit,
        ...(cmd.edit.accounts
          ? {
              accounts: cmd.edit.accounts.map((a) => ({
                accountId: a.accountId,
                ...(a.creditLimit !== undefined ? { creditLimit: amountOf(a.creditLimit) } : {}),
                ...(a.minimumRule !== undefined ? { minimumRule: a.minimumRule } : {}),
              })),
            }
          : {}),
      };
      card.update(edit, {
        at: clock.at,
        today: clock.today,
        lastIssuedClosing: lastIssued ? LocalDate.parse(lastIssued) : null,
      });
      if (card.version === before.version) return this.view(card, clock);
      const after = card.snapshot;
      // El calendario cambió: se revisan los planes de pago y se reasignan las cuotas no facturadas.
      if (card.termsChanged) {
        const terms = card.currentTerms;
        for (const a of after.accounts) {
          if (a.paymentPlan) {
            await deps.recurring.revise({
              workspaceId: cmd.workspaceId,
              userId: cmd.userId,
              definitionId: a.paymentPlan.definitionId,
              effectiveFrom: clock.today.toString(),
              monthDays: [terms.dueDay],
              weekendAdjustment: terms.dueWeekendAdjustment,
            });
          }
          const plans = await deps.plans.listForCardAccounts(cmd.workspaceId, [a.id]);
          const own = a.id;
          for (const plan of plans) {
            if (plan.snapshot.cardAccountId !== own) continue;
            if (plan.reassign(card.calendar, lastIssued ? LocalDate.parse(lastIssued) : null, clock.at)) {
              await deps.plans.save(plan);
            }
          }
        }
      }
      const changes = cardChanges(before, after);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.credit_card.updated',
        aggregateType: CARD_AGGREGATE,
        aggregateId: card.id,
        aggregateVersion: card.version,
        changes,
      });
      const views = await this.engine.loadViews(card, clock);
      // Límites y umbrales: evaluación síncrona.
      await this.engine.evaluateUtilization(card, views, clock);
      for (const v of views) await this.engine.syncPlan(card, v, clock, cmd.userId);
      await this.save(card, cmd.userId);
      return this.view(card, clock);
    });
  }

  async archive(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly expectedVersion: number;
  }): Promise<CreditCardView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.load(cmd.workspaceId, cmd.cardId);
      if (card.version !== cmd.expectedVersion) throw preconditionFailed(card.version);
      const before = card.snapshot;
      for (const a of before.accounts) {
        if (a.paymentPlan) {
          await deps.recurring.end({
            workspaceId: cmd.workspaceId,
            userId: cmd.userId,
            definitionId: a.paymentPlan.definitionId,
            from: clock.today.toString(),
          });
        }
      }
      card.archive(clock.at);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.credit_card.archived',
        aggregateType: CARD_AGGREGATE,
        aggregateId: card.id,
        aggregateVersion: card.version,
        changes: cardChanges(before, card.snapshot),
      });
      await this.save(card, cmd.userId);
      return this.view(card, clock);
    });
  }

  // ───────────────────────────────────────────────────────────── montos del banco

  async recordReported(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly statementId: string;
    readonly expectedVersion: number;
    readonly reportedBilledBalance?: unknown;
    readonly reportedMinimumDue?: unknown;
  }): Promise<void> {
    const { deps } = this;
    await deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.load(cmd.workspaceId, cmd.cardId);
      const record = await deps.statements.find(cmd.workspaceId, cmd.statementId);
      const account = record ? card.snapshot.accounts.find((a) => a.id === record.cardAccountId) : undefined;
      if (!record || !account) throw new DomainError('RESOURCE_NOT_FOUND', 'statement not found');
      if (record.version !== cmd.expectedVersion) throw preconditionFailed(record.version);
      const cur = makeCurrency(account.currency, account.scale);
      const parse = (v: unknown, pointer: string): string | null | undefined => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const amount = amountOf(v);
        if (typeof amount !== 'string')
          throw new DomainError('VALIDATION_FAILED', 'must be a Money').at(pointer);
        const money = Money.parse(amount, cur);
        if (money.isNegative() && pointer.endsWith('reportedMinimumDue')) {
          throw new DomainError('AMOUNT_NOT_POSITIVE', 'must not be negative').at(pointer);
        }
        return money.toFixed();
      };
      const billed = parse(cmd.reportedBilledBalance, '/reportedBilledBalance');
      const minimum = parse(cmd.reportedMinimumDue, '/reportedMinimumDue');
      const nextBilled = billed === undefined ? record.reportedBilledBalance : billed;
      const nextMin = minimum === undefined ? record.reportedMinimumDue : minimum;
      if (nextBilled === record.reportedBilledBalance && nextMin === record.reportedMinimumDue) return;
      const ok = await deps.statements.setReported(cmd.workspaceId, record.id, {
        billed: nextBilled,
        minimum: nextMin,
        expectedVersion: record.version,
      });
      if (!ok) throw new DomainError('CONCURRENCY_CONFLICT', 'the statement was modified concurrently');
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.card_statement.reported_updated',
        aggregateType: 'CardStatement',
        aggregateId: record.id,
        aggregateVersion: record.version + 1,
        changes: [
          {
            field: 'reportedBilledBalance',
            before:
              record.reportedBilledBalance === null
                ? null
                : { amount: record.reportedBilledBalance, currency: cur.code },
            after: nextBilled === null ? null : { amount: nextBilled, currency: cur.code },
          },
          {
            field: 'reportedMinimumDue',
            before:
              record.reportedMinimumDue === null
                ? null
                : { amount: record.reportedMinimumDue, currency: cur.code },
            after: nextMin === null ? null : { amount: nextMin, currency: cur.code },
          },
        ],
      });
      // Los montos del banco prevalecen: el monto esperado del plan sigue lo que falta.
      const views = await this.engine.loadViews(card, clock);
      for (const v of views) await this.engine.syncPlan(card, v, clock, cmd.userId);
    });
  }
}
