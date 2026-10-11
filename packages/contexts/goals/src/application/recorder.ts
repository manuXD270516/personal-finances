import type {
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { GOAL_LIFECYCLE, type GoalState, type SavingsGoal } from '../domain/index.js';
import type { GoalsDeps } from './ports/index.js';

export const GOAL_AGGREGATE = 'SavingsGoal';
export const ACCOUNT_AGGREGATE = 'Account';
export const SUGGESTION_AGGREGATE = 'ContributionSuggestion';
export const RESERVATION_AGGREGATE = 'AccountReservation';

/** Actor de proceso (UUID nulo) para los movimientos que crean consumidores y jobs, sin usuario. */
export const PROCESS_USER = '00000000-0000-0000-0000-000000000000';

interface EventKind {
  readonly eventType: string;
  readonly eventVersion: number;
}

/** Escribe un hecho en el outbox (misma unidad de trabajo) y devuelve su referencia para el recorrido. */
export async function publishEvent(
  deps: GoalsDeps,
  aggregate: {
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
  },
  kind: EventKind,
  payload: object,
): Promise<LifecycleEventRefDto> {
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
    eventType: kind.eventType,
    eventVersion: kind.eventVersion,
    occurredAt: deps.clock.now().toString(),
    ...aggregate,
    payload,
  });
  return { eventId, eventType: `${kind.eventType}.v${kind.eventVersion}` };
}

export const goalAggregate = (goal: SavingsGoal) => ({
  workspaceId: goal.workspaceId,
  aggregateType: GOAL_AGGREGATE,
  aggregateId: goal.id,
  aggregateVersion: goal.version,
});

const FIELD_ORDER: readonly (keyof GoalState)[] = [
  'name',
  'type',
  'startDate',
  'targetDate',
  'priority',
  'icon',
  'color',
  'notes',
  'tolerancePercent',
  'pacePeriods',
  'status',
  'achievedOn',
  'closedOn',
  'cancelledOn',
  'archivedAt',
];

/** Cambios de auditoría de la cabecera (alta: `before = null`). Los valores compuestos van como texto JSON. */
export function goalChanges(before: GoalState | null, after: GoalState): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ field, before: before === null ? null : b, after: a });
    }
  };
  for (const k of FIELD_ORDER) diff(k, before?.[k], after[k]);
  diff('target', before && { amount: before.targetAmount, currency: before.currency }, {
    amount: after.targetAmount,
    currency: after.currency,
  });
  diff(
    'linkedAccountIds',
    before && JSON.stringify(before.linkedAccountIds),
    JSON.stringify(after.linkedAccountIds),
  );
  diff('reason', before?.cancelReason, after.cancelReason);
  return out;
}

export function goalEntry(
  goal: SavingsGoal,
  action: string,
  changes: readonly AuditChangeInput[],
  reason?: string | null,
): AuditEntry {
  return {
    workspaceId: goal.workspaceId,
    action: `goals.goal.${action}`,
    aggregateType: GOAL_AGGREGATE,
    aggregateId: goal.id,
    aggregateVersion: goal.version,
    changes,
    ...(reason ? { reason } : {}),
  };
}

/** Pasos del recorrido: la transición aplicada o una anotación con los campos cambiados. */
export function goalSteps(
  goal: SavingsGoal,
  events: readonly LifecycleEventRefDto[],
  extra: {
    readonly changedFields?: readonly string[];
    readonly detailRefs?: Record<string, string | number>;
    readonly reason?: string | null;
  } = {},
): LifecycleStepInput[] {
  const t = goal.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: GOAL_LIFECYCLE.version,
        events,
        ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...(extra.changedFields ?? goal.changedFields)],
      events,
      ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
    },
  ];
}
