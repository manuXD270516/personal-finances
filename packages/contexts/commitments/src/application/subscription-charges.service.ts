import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate, Money, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import type { MoneyDto } from '../contracts/index.js';
import { PriceChangeDetector, type Subscription, type SubscriptionCharge } from '../domain/index.js';
import { proposePriceChange } from './subscription-detection.js';
import { subscriptionEntry, subscriptionSteps } from './subscription-recorder.js';
import type { SubscriptionsDeps } from './ports/subscriptions.js';

/** Hecho de vinculación (`RecurringOccurrenceMaterialized.v1`) tal como lo necesita el consumidor. */
export interface MaterializedFact {
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly occurrenceDate: string;
  readonly managedBy: string;
  readonly transactionId: string;
  readonly amount: MoneyDto;
}

/** Hecho de cambio de ocurrencia (`RecurringOccurrenceChanged.v1`). */
export interface OccurrenceChangedFact {
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly managedBy: string;
  readonly transition: string;
}

/**
 * Consumidor `commitments.subscription-charges` (openspec add-subscriptions, decisión 8): convierte los hechos del
 * motor sobre ocurrencias de definiciones administradas por una suscripción en cargos (`subscription_charge`) y
 * evalúa la detección de cambio de precio. Idempotente: el inbox de la plataforma deduplica por evento y el único
 * parcial `(suscripción, ocurrencia) WHERE outcome <> 'VOIDED'` deduplica por negocio (INV-028). Todo ocurre en la
 * unidad de trabajo del consumidor, con la suscripción bloqueada (`FOR UPDATE`).
 */
export class SubscriptionChargesService {
  constructor(private readonly deps: SubscriptionsDeps) {}

  private async currencyOf(workspaceId: string, code: string): Promise<Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const found = catalog.find((c) => c.code === code);
    if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
    return makeCurrency(found.code, found.scale);
  }

  private async todayOf(workspaceId: string): Promise<LocalDate> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), calendar.timeZone);
  }

  /** Refresca la proyección de la próxima renovación (no versiona la suscripción). */
  private async refreshNextRenewal(sub: Subscription, today: LocalDate): Promise<void> {
    const next =
      sub.status === 'CANCELLED' || sub.status === 'PAUSED'
        ? null
        : await this.deps.managed.nextRenewal({
            workspaceId: sub.workspaceId,
            definitionId: sub.snapshot.definitionId,
            today: today.toString(),
          });
    await this.deps.subscriptions.updateNextRenewal(sub.workspaceId, sub.id, next);
  }

  /** Cargo vinculado a una transacción (al aprobar, crear automáticamente o emparejar): evalúa el cambio de precio. */
  onOccurrenceMaterialized(fact: MaterializedFact): Promise<void> {
    const { deps } = this;
    if (fact.managedBy !== 'SUBSCRIPTION') return Promise.resolve();
    return deps.uow.run(fact.workspaceId, async () => {
      const sub = await deps.subscriptions.findByDefinition(fact.workspaceId, fact.definitionId, {
        lock: 'update',
      });
      if (!sub) return;
      const today = await this.todayOf(fact.workspaceId);
      const at = deps.clock.now().toString();
      const existing = await deps.charges.findActiveByOccurrence(fact.workspaceId, sub.id, fact.occurrenceId);
      if (existing) {
        await this.refreshNextRenewal(sub, today);
        return;
      }
      const expectedEntry = sub.history.at(fact.occurrenceDate) ?? sub.history.active[0];
      if (!expectedEntry) return;
      const charged = Money.parse(
        fact.amount.amount,
        await this.currencyOf(fact.workspaceId, fact.amount.currency),
      );
      const evaluation = PriceChangeDetector.evaluate({
        expected: expectedEntry.price,
        charged,
        tolerancePercent: sub.snapshot.tolerancePercent,
      });
      const charge: SubscriptionCharge = {
        id: deps.ids.next(),
        subscriptionId: sub.id,
        occurrenceId: fact.occurrenceId,
        occurrenceDate: fact.occurrenceDate,
        transactionId: fact.transactionId,
        charged,
        priceCurrencyAmount: null,
        expectedPrice: expectedEntry.price,
        impliedRate: evaluation.impliedRate,
        deviationPercent: evaluation.deviationPercent,
        outcome: evaluation.outcome,
      };
      if (!(await deps.charges.insertIfAbsent(charge))) return;
      if (evaluation.outcome === 'PRICE_CHANGE_DETECTED' && evaluation.deviationPercent !== null) {
        await proposePriceChange(deps, sub, {
          charge,
          observed: charged,
          changePercentage: evaluation.deviationPercent,
          at,
          by: null,
        });
      }
      await this.refreshNextRenewal(sub, today);
    });
  }

  /**
   * Cambios de la ocurrencia: la liberación (`RELEASE`, la transacción se anuló) deja el cargo en `VOIDED` y retira su
   * propuesta pendiente (`WITHDRAWN`, sin hecho). Cualquier otro cambio (omitir, cancelar, atrasar) solo refresca la
   * próxima renovación.
   */
  onOccurrenceChanged(fact: OccurrenceChangedFact): Promise<void> {
    const { deps } = this;
    if (fact.managedBy !== 'SUBSCRIPTION') return Promise.resolve();
    return deps.uow.run(fact.workspaceId, async () => {
      const sub = await deps.subscriptions.findByDefinition(fact.workspaceId, fact.definitionId, {
        lock: 'update',
      });
      if (!sub) return;
      const today = await this.todayOf(fact.workspaceId);
      if (fact.transition === 'RELEASE') {
        const charge = await deps.charges.findActiveByOccurrence(fact.workspaceId, sub.id, fact.occurrenceId);
        if (charge) {
          await deps.charges.update(fact.workspaceId, { ...charge, outcome: 'VOIDED' });
          const proposals = await deps.proposals.listForSubscription(fact.workspaceId, sub.id);
          const own = proposals.find((p) => p.chargeId === charge.id && p.status === 'PENDING');
          if (own) await deps.proposals.update(fact.workspaceId, { ...own, status: 'WITHDRAWN' });
        }
      }
      await this.refreshNextRenewal(sub, today);
    });
  }

  /**
   * `RecordChargeOriginalAmount`: el EDITOR indica el monto cobrado en la moneda del precio (el del extracto de la
   * tarjeta) de un cargo registrado en otra moneda; con ese dato se aplica la detección con la tolerancia de la
   * suscripción (docs/35 D137).
   */
  recordOriginalAmount(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly subscriptionId: string;
    readonly chargeId: string;
    readonly amount: MoneyDto;
    /** Versión de la suscripción (`If-Match`): el cargo no tiene versión propia. */
    readonly expectedVersion: number;
  }): Promise<SubscriptionCharge> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const sub = await deps.subscriptions.findById(cmd.workspaceId, cmd.subscriptionId, { lock: 'update' });
      if (!sub) throw new DomainError('RESOURCE_NOT_FOUND', `subscription ${cmd.subscriptionId} not found`);
      if (sub.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: sub.version },
        });
      }
      const charge = await deps.charges.findById(cmd.workspaceId, sub.id, cmd.chargeId);
      if (!charge || charge.outcome === 'VOIDED') {
        throw new DomainError('RESOURCE_NOT_FOUND', `charge ${cmd.chargeId} not found`);
      }
      if (cmd.amount.currency !== sub.snapshot.priceCurrency) {
        throw new DomainError(
          'CURRENCY_MISMATCH',
          `the original amount must be in the price currency ${sub.snapshot.priceCurrency}`,
        ).at('/priceCurrencyAmount/currency');
      }
      if (charge.charged.currency.code === sub.snapshot.priceCurrency) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the charge is already in the price currency; there is no original amount to record',
        ).at('/priceCurrencyAmount');
      }
      const observed = Money.parse(cmd.amount.amount, charge.expectedPrice.currency);
      if (!observed.isPositive()) {
        throw new DomainError('AMOUNT_NOT_POSITIVE', 'the original amount must be positive').at(
          '/priceCurrencyAmount/amount',
        );
      }
      const evaluation = PriceChangeDetector.evaluate({
        expected: charge.expectedPrice,
        charged: observed,
        tolerancePercent: sub.snapshot.tolerancePercent,
      });
      const at = deps.clock.now().toString();
      const updated: SubscriptionCharge = {
        ...charge,
        priceCurrencyAmount: observed,
        deviationPercent: evaluation.deviationPercent,
        outcome: evaluation.outcome,
      };
      await deps.charges.update(cmd.workspaceId, updated);
      const proposal =
        evaluation.outcome === 'PRICE_CHANGE_DETECTED' && evaluation.deviationPercent !== null
          ? await proposePriceChange(deps, sub, {
              charge: updated,
              observed,
              changePercentage: evaluation.deviationPercent,
              at,
              by: cmd.userId,
            })
          : null;
      if (proposal === null) {
        // Registrar el monto del extracto también es un cambio auditable aunque no haya propuesta.
        sub.touch(['priceCurrencyAmount'], at, cmd.userId);
        if (!(await deps.subscriptions.save(sub))) {
          throw new DomainError('CONCURRENCY_CONFLICT', `subscription ${sub.id} changed concurrently`);
        }
        const changes: AuditChangeInput[] = [
          { field: 'chargeId', before: null, after: charge.id },
          {
            field: 'priceCurrencyAmount',
            before: null,
            after: { amount: observed.toFixed(), currency: observed.currency.code },
          },
        ];
        await deps.lifecycle.record(
          subscriptionEntry(sub, 'charge_original_amount_recorded', changes),
          subscriptionSteps(sub, [], { changedFields: ['priceCurrencyAmount'] }),
        );
      }
      return updated;
    });
  }
}
