import type {
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { SUBSCRIPTION_LIFECYCLE, type Subscription, type SubscriptionState } from '../domain/index.js';
import { publishEvent } from './recorder.js';
import type { CommitmentsDeps } from './ports/index.js';

export const SUBSCRIPTION_AGGREGATE = 'Subscription';

interface EventKind {
  readonly eventType: string;
  readonly eventVersion: number;
}

/** Hecho de la suscripción en el outbox (misma unidad de trabajo); usa la versión ACTUAL del agregado. */
export function publishSubscriptionEvent(
  deps: CommitmentsDeps,
  sub: Subscription,
  kind: EventKind,
  payload: object,
): Promise<LifecycleEventRefDto> {
  return publishEvent(
    deps,
    {
      workspaceId: sub.workspaceId,
      aggregateType: SUBSCRIPTION_AGGREGATE,
      aggregateId: sub.id,
      aggregateVersion: sub.version,
    },
    kind,
    payload,
  );
}

const plain = (field: string, before: unknown, after: unknown): AuditChangeInput => ({
  field,
  before,
  after,
});

/** Cambios de auditoría de la cabecera (creación: `before = null`). Los valores compuestos van como texto JSON. */
export function subscriptionChanges(
  before: SubscriptionState | null,
  after: SubscriptionState,
): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || b !== a) out.push(plain(field, before === null ? null : b, a));
  };
  if (before === null) {
    out.push(plain('counterpartyId', null, after.counterpartyId));
    out.push(plain('definitionId', null, after.definitionId));
    out.push(plain('priceCurrency', null, after.priceCurrency));
  }
  diff('name', before?.name, after.name);
  diff('planName', before?.planName, after.planName);
  diff('status', before?.status, after.status);
  diff('trialEndsOn', before?.trialEndsOn, after.trialEndsOn);
  diff('scheduledCancellationOn', before?.scheduledCancellationOn, after.scheduledCancellationOn);
  diff('cancelledOn', before?.cancelledOn, after.cancelledOn);
  diff('cancellationReason', before?.cancellationReason, after.cancellationReason);
  diff('cancellationUrl', before?.cancellationUrl, after.cancellationUrl);
  diff('reminderEnabled', before?.reminder.enabled, after.reminder.enabled);
  diff('reminderDaysBefore', before?.reminder.daysBefore, after.reminder.daysBefore);
  diff('tolerancePercent', before?.tolerancePercent, after.tolerancePercent);
  return out;
}

export function subscriptionEntry(
  sub: Subscription,
  action: string,
  changes: readonly AuditChangeInput[],
  reason?: string | null,
): AuditEntry {
  return {
    workspaceId: sub.workspaceId,
    action: `commitments.subscription.${action}`,
    aggregateType: SUBSCRIPTION_AGGREGATE,
    aggregateId: sub.id,
    aggregateVersion: sub.version,
    changes,
    ...(reason ? { reason } : {}),
  };
}

/** Pasos del recorrido: la transición aplicada o una anotación con los campos cambiados. */
export function subscriptionSteps(
  sub: Subscription,
  events: readonly LifecycleEventRefDto[],
  extra: {
    readonly changedFields?: readonly string[];
    readonly detailRefs?: Record<string, string | number>;
    readonly reason?: string | null;
  } = {},
): LifecycleStepInput[] {
  const t = sub.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: SUBSCRIPTION_LIFECYCLE.version,
        events,
        ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...(extra.changedFields ?? sub.changedFields)],
      events,
      ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
    },
  ];
}
