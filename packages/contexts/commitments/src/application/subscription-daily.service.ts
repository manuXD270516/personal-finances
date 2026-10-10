import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type MoneyDto,
  type SubscriptionCancelledV1,
  type SubscriptionRenewalUpcomingV1,
  type SubscriptionTrialEndingV1,
} from '../contracts/index.js';
import { RenewalReminderPolicy, type Subscription } from '../domain/index.js';
import { accountNames } from './subscription-assembler.js';
import type { SubscriptionsDeps } from './ports/subscriptions.js';
import {
  publishSubscriptionEvent,
  subscriptionChanges,
  subscriptionEntry,
  subscriptionSteps,
} from './subscription-recorder.js';

export interface SubscriptionDailyResult {
  readonly subscriptions: number;
  readonly trialsEnded: number;
  readonly cancelled: number;
  readonly reminders: number;
  /** Suscripciones cuyo procesamiento falló (se reintentan en la próxima ejecución). */
  readonly failed: readonly { readonly subscriptionId: string; readonly error: string }[];
}

interface TickResult {
  trialEnded: boolean;
  cancelled: boolean;
  reminders: number;
}

const moneyDto = (m: { toFixed(): string; currency: { code: string } }): MoneyDto => ({
  amount: m.toFixed(),
  currency: m.currency.code,
});

/**
 * Job `commitments.subscription-daily` (openspec add-subscriptions, decisión 12), por workspace con "hoy" en su zona
 * horaria: (a) fin de trial vencido ⇒ `ACTIVE`; (b) cancelación programada vencida ⇒ `CANCELLED` (+ definición
 * finalizada + `SubscriptionCancelled.v1`); (c) refresca la próxima renovación; (d) recordatorios de renovación y fin
 * de trial con `subscription_reminder` (PK = suscripción, tipo y fecha) + outbox en la misma transacción: a lo sumo uno
 * por fecha aunque el job corra varias veces o en paralelo. Cada suscripción corre en su unidad de trabajo con
 * `FOR UPDATE`; una que falla no detiene a las demás.
 */
export class SubscriptionDailyService {
  constructor(private readonly deps: SubscriptionsDeps) {}

  async runWorkspace(workspaceId: string): Promise<SubscriptionDailyResult> {
    const { deps } = this;
    const calendar = await deps.calendar.calendarOf(workspaceId);
    const today = LocalDate.ofInstant(deps.clock.now(), calendar.timeZone);
    const ids = await deps.uow.run(workspaceId, () => deps.subscriptions.idsOpen(workspaceId));
    let trialsEnded = 0;
    let cancelled = 0;
    let reminders = 0;
    const failed: { subscriptionId: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const tick = await this.tick(workspaceId, id, today);
        if (tick.trialEnded) trialsEnded += 1;
        if (tick.cancelled) cancelled += 1;
        reminders += tick.reminders;
      } catch (err) {
        failed.push({ subscriptionId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { subscriptions: ids.length, trialsEnded, cancelled, reminders, failed };
  }

  private save(sub: Subscription): Promise<boolean> {
    return this.deps.subscriptions.save(sub);
  }

  private tick(workspaceId: string, subscriptionId: string, today: LocalDate): Promise<TickResult> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async (): Promise<TickResult> => {
      const result: TickResult = { trialEnded: false, cancelled: false, reminders: 0 };
      const sub = await deps.subscriptions.findById(workspaceId, subscriptionId, { lock: 'update' });
      if (!sub || sub.status === 'CANCELLED') return result;
      const at = deps.clock.now().toString();

      // (a) fin de trial
      const trialEndsOn = sub.snapshot.trialEndsOn;
      if (
        sub.status === 'TRIAL' &&
        trialEndsOn !== null &&
        LocalDate.parse(trialEndsOn).compare(today) <= 0
      ) {
        const before = sub.snapshot;
        sub.endTrial(today, at, null);
        if (!(await this.save(sub))) return result;
        await deps.lifecycle.record(
          subscriptionEntry(sub, 'trial_ended', subscriptionChanges(before, sub.snapshot)),
          subscriptionSteps(sub, []),
        );
        result.trialEnded = true;
      }

      // (b) cancelación programada vencida
      const scheduled = sub.snapshot.scheduledCancellationOn;
      if (scheduled !== null && LocalDate.parse(scheduled).compare(today) <= 0) {
        const before = sub.snapshot;
        sub.cancel({ on: scheduled, today }, at, null);
        await deps.managed.end({
          workspaceId,
          userId: null,
          definitionId: before.definitionId,
          endDate: LocalDate.parse(scheduled).plusDays(-1).toString(),
          deferClose: false,
        });
        if (!(await this.save(sub))) {
          throw new DomainError('CONCURRENCY_CONFLICT', `subscription ${sub.id} changed concurrently`);
        }
        const payload: SubscriptionCancelledV1 = {
          workspaceId,
          subscriptionId: sub.id,
          definitionId: before.definitionId,
          counterpartyId: before.counterpartyId,
          cancelledOn: scheduled,
          scheduled: true,
          reason: sub.snapshot.cancellationReason,
        };
        const event = await publishSubscriptionEvent(
          deps,
          sub,
          COMMITMENTS_EVENTS.subscriptionCancelled,
          payload,
        );
        await deps.lifecycle.record(
          subscriptionEntry(sub, 'cancelled', subscriptionChanges(before, sub.snapshot)),
          subscriptionSteps(sub, [event]),
        );
        result.cancelled = true;
        return result;
      }

      // (c) próxima renovación
      const next =
        sub.status === 'PAUSED'
          ? null
          : await deps.managed.nextRenewal({
              workspaceId,
              definitionId: sub.snapshot.definitionId,
              today: today.toString(),
            });
      await deps.subscriptions.updateNextRenewal(workspaceId, sub.id, next);
      sub.setNextRenewal(next);

      // (d) recordatorios
      const reminder = sub.snapshot.reminder;
      if (reminder.enabled) {
        if (sub.status === 'ACTIVE' && next !== null) {
          if (RenewalReminderPolicy.isDue({ today, targetDate: next, daysBefore: reminder.daysBefore })) {
            result.reminders += await this.remind(sub, 'RENEWAL', next, today, at);
          }
        }
        const trialEnd = sub.snapshot.trialEndsOn;
        if (sub.status === 'TRIAL' && trialEnd !== null) {
          if (RenewalReminderPolicy.isDue({ today, targetDate: trialEnd, daysBefore: reminder.daysBefore })) {
            result.reminders += await this.remind(sub, 'TRIAL_END', trialEnd, today, at);
          }
        }
      }
      return result;
    });
  }

  /** Inserta el recordatorio (primera vez para la fecha) y publica el hecho; devuelve 1 si lo emitió. */
  private async remind(
    sub: Subscription,
    kind: 'RENEWAL' | 'TRIAL_END',
    targetDate: string,
    today: LocalDate,
    at: string,
  ): Promise<number> {
    const { deps } = this;
    const workspaceId = sub.workspaceId;
    const eventId = deps.ids.next();
    // Reserva la clave antes de publicar: `ON CONFLICT DO NOTHING` ⇒ a lo sumo uno por (suscripción, tipo, fecha).
    const first = await deps.reminders.insertIfAbsent({
      workspaceId,
      subscriptionId: sub.id,
      kind,
      targetDate,
      eventId,
      emittedAt: at,
    });
    if (!first) return 0;
    const info = await deps.managed.info(workspaceId, sub.snapshot.definitionId);
    const [names, accounts] = await Promise.all([
      deps.counterpartyNames.namesOf({ workspaceId, counterpartyIds: [sub.snapshot.counterpartyId] }),
      accountNames(deps, workspaceId),
    ]);
    const providerName = names.get(sub.snapshot.counterpartyId) ?? sub.snapshot.name;
    const paymentAccountName = accounts.get(info.accountId) ?? '';
    const price = sub.history.at(targetDate) ?? sub.history.active[0];
    if (!price) return 0;
    sub.touch(['reminder'], at, null);
    if (!(await this.save(sub))) {
      throw new DomainError('CONCURRENCY_CONFLICT', `subscription ${sub.id} changed concurrently`);
    }
    const reminder = sub.snapshot.reminder;
    let payload: SubscriptionRenewalUpcomingV1 | SubscriptionTrialEndingV1;
    let eventKind:
      | typeof COMMITMENTS_EVENTS.subscriptionRenewalUpcoming
      | typeof COMMITMENTS_EVENTS.subscriptionTrialEnding;
    if (kind === 'RENEWAL') {
      const occurrence = await deps.managed.occurrenceOn({
        workspaceId,
        definitionId: sub.snapshot.definitionId,
        occurrenceDate: targetDate,
      });
      eventKind = COMMITMENTS_EVENTS.subscriptionRenewalUpcoming;
      payload = {
        workspaceId,
        subscriptionId: sub.id,
        definitionId: sub.snapshot.definitionId,
        providerName,
        planName: sub.snapshot.planName,
        renewalDate: targetDate,
        daysBefore: reminder.daysBefore,
        expectedPrice: moneyDto(price.price),
        expectedCharge: occurrence?.projected ?? (info.indexed ? null : moneyDto(price.price)),
        paymentAccountId: info.accountId,
        paymentAccountName,
        requiresApproval: info.materialization.mode === 'PENDING_APPROVAL',
      };
    } else {
      eventKind = COMMITMENTS_EVENTS.subscriptionTrialEnding;
      payload = {
        workspaceId,
        subscriptionId: sub.id,
        definitionId: sub.snapshot.definitionId,
        providerName,
        trialEndsOn: targetDate,
        daysBefore: reminder.daysBefore,
        firstChargePrice: moneyDto((sub.history.active[0] ?? price).price),
        paymentAccountId: info.accountId,
        paymentAccountName,
      };
    }
    const event = await publishSubscriptionEvent(deps, sub, eventKind, payload);
    const changes: AuditChangeInput[] = [{ field: 'effectiveFrom', before: null, after: targetDate }];
    await deps.lifecycle.record(
      subscriptionEntry(
        sub,
        kind === 'RENEWAL' ? 'renewal_reminder_emitted' : 'trial_reminder_emitted',
        changes,
      ),
      subscriptionSteps(sub, [event], { changedFields: ['reminder'] }),
    );
    void today;
    return 1;
  }
}
