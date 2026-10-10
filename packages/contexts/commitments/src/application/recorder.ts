import type {
  AuditActorDto,
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import {
  RECURRING_DEFINITION_LIFECYCLE,
  RECURRING_OCCURRENCE_LIFECYCLE,
  type DefinitionVersion,
  type OccurrenceState,
  type RecurringDefinition,
  type RecurringOccurrence,
} from '../domain/index.js';
import { money } from './views.js';
import type { CommitmentsDeps } from './ports/index.js';

export const DEFINITION_AGGREGATE = 'RecurringDefinition';
export const OCCURRENCE_AGGREGATE = 'RecurringOccurrence';

interface EventKind {
  readonly eventType: string;
  readonly eventVersion: number;
}

/** Escribe un hecho en el outbox (misma unidad de trabajo) y devuelve su referencia para el recorrido. */
export async function publishEvent(
  deps: CommitmentsDeps,
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

const plain = (field: string, before: unknown, after: unknown): AuditChangeInput => ({
  field,
  before,
  after,
});

/** Valores compuestos de auditoría como texto JSON (docs/31 D19). */
export const json = (value: unknown): string => JSON.stringify(value);

function moneyChange(
  field: string,
  before: string | null,
  after: string | null,
  currency: string,
): AuditChangeInput {
  return {
    field,
    before: before === null ? null : money(before, currency),
    after: after === null ? null : money(after, currency),
  };
}

/** Cambios de auditoría de una versión de plantilla (creación: `before = null`; revisión: contra la anterior). */
export function versionChanges(
  before: DefinitionVersion | null,
  after: DefinitionVersion,
): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || json(b) !== json(a)) out.push(plain(field, before === null ? null : b, a));
  };
  diff('versionNo', before?.versionNo, after.versionNo);
  diff('effectiveFrom', before?.effectiveFrom, after.effectiveFrom);
  diff('accountId', before?.accountId, after.accountId);
  diff('toAccountId', before?.toAccountId, after.toAccountId);
  diff('amountType', before?.amount.type, after.amount.type);
  for (const [field, key] of [
    ['amount', 'amount'],
    ['amountMin', 'min'],
    ['amountMax', 'max'],
  ] as const) {
    const b = before?.amount[key] ?? null;
    const a = after.amount[key];
    if (before === null ? a !== null : b !== a) out.push(moneyChange(field, b, a, after.currency));
  }
  diff('categoryId', before?.categoryId, after.categoryId);
  diff('counterpartyId', before?.counterpartyId, after.counterpartyId);
  diff('tagIds', json(before?.tagIds ?? []), json(after.tagIds));
  diff('paymentMethod', before?.paymentMethod, after.paymentMethod);
  diff('cadence', before?.schedule.cadence, after.schedule.cadence);
  diff('interval', before?.schedule.interval, after.schedule.interval);
  diff('monthDays', json(before?.schedule.monthDays ?? []), json(after.schedule.monthDays));
  diff('rrule', before?.schedule.rrule, after.schedule.rrule);
  diff('startDate', before?.schedule.startDate, after.schedule.startDate);
  diff('maxOccurrences', before?.schedule.maxOccurrences, after.schedule.maxOccurrences);
  diff('weekendAdjustment', before?.schedule.weekendAdjustment, after.schedule.weekendAdjustment);
  diff('materializationMode', before?.materialization.mode, after.materialization.mode);
  diff('autoCreateStatus', before?.materialization.autoCreateStatus, after.materialization.autoCreateStatus);
  diff('leadDays', before?.materialization.leadDays, after.materialization.leadDays);
  return out;
}

export function definitionEntry(
  d: RecurringDefinition,
  action: string,
  changes: readonly AuditChangeInput[],
  reason?: string | null,
): AuditEntry {
  const s = d.snapshot;
  return {
    workspaceId: s.workspaceId,
    action: `commitments.recurring_definition.${action}`,
    aggregateType: DEFINITION_AGGREGATE,
    aggregateId: s.id,
    aggregateVersion: s.version,
    changes,
    ...(reason ? { reason } : {}),
  };
}

/** Pasos del recorrido de una definición: la transición aplicada o una anotación con los campos cambiados. */
export function definitionSteps(
  d: RecurringDefinition,
  events: readonly LifecycleEventRefDto[],
  extra: {
    readonly detailRefs?: Record<string, string | number>;
    readonly revisionFrom?: number;
    readonly revisionTo?: number;
    readonly reason?: string;
  } = {},
): LifecycleStepInput[] {
  const { detailRefs } = extra;
  const t = d.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: RECURRING_DEFINITION_LIFECYCLE.version,
        events,
        ...(detailRefs ? { detailRefs } : {}),
        ...(extra.revisionFrom !== undefined ? { revisionFrom: extra.revisionFrom } : {}),
        ...(extra.revisionTo !== undefined ? { revisionTo: extra.revisionTo } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [{ kind: 'ANNOTATION', changedFields: [...d.changedFields], events }];
}

/** Cambios de auditoría de una ocurrencia (estado, fechas y monto esperado). */
export function occurrenceChanges(
  before: OccurrenceState | null,
  after: OccurrenceState,
): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  const diff = (field: string, b: unknown, a: unknown) => {
    if (before === null || b !== a) out.push(plain(field, before === null ? null : b, a));
  };
  if (before === null) {
    out.push(plain('definitionId', null, after.definitionId));
    out.push(plain('definitionVersionNo', null, after.definitionVersionNo));
    out.push(plain('occurrenceDate', null, after.occurrenceDate));
  }
  diff('dueDate', before?.dueDate, after.dueDate);
  diff('status', before?.status, after.status);
  diff('amountType', before?.expected.type, after.expected.type);
  for (const [field, key] of [
    ['expectedAmount', 'amount'],
    ['expectedMin', 'min'],
    ['expectedMax', 'max'],
  ] as const) {
    const b = before?.expected[key] ?? null;
    const a = after.expected[key];
    if (before === null ? a !== null : b !== a) out.push(moneyChange(field, b, a, after.currency));
  }
  diff('transactionId', before?.transactionId ?? null, after.transactionId);
  diff('resolution', before?.resolution ?? null, after.resolution);
  diff('matchedBy', before?.matchedBy ?? null, after.matchedBy);
  diff('skipReason', before?.skipReason ?? null, after.skipReason);
  diff('cancelReason', before?.cancelReason ?? null, after.cancelReason);
  diff('lastAutoCreateError', before?.lastAutoCreateError ?? null, after.lastAutoCreateError);
  return out;
}

export function occurrenceEntry(
  o: RecurringOccurrence,
  action: string,
  changes: readonly AuditChangeInput[],
  options: { readonly reason?: string | null; readonly actor?: AuditActorDto } = {},
): AuditEntry {
  const s = o.snapshot;
  return {
    workspaceId: s.workspaceId,
    action: `commitments.recurring_occurrence.${action}`,
    aggregateType: OCCURRENCE_AGGREGATE,
    aggregateId: s.id,
    aggregateVersion: s.version,
    changes,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
  };
}

export function occurrenceSteps(
  o: RecurringOccurrence,
  events: readonly LifecycleEventRefDto[],
  options: { readonly detailRefs?: Record<string, string | number>; readonly reason?: string | null } = {},
): LifecycleStepInput[] {
  const t = o.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: RECURRING_OCCURRENCE_LIFECYCLE.version,
        events,
        ...(options.detailRefs ? { detailRefs: options.detailRefs } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...o.changedFields],
      events,
      ...(options.detailRefs ? { detailRefs: options.detailRefs } : {}),
    },
  ];
}

/** Auditoría + recorrido de varias ocurrencias a la vez (`recordMany` en lotes; volumen ~25 000 filas/año). */
export async function recordOccurrences(
  deps: CommitmentsDeps,
  items: readonly { readonly entry: AuditEntry; readonly steps: readonly LifecycleStepInput[] }[],
): Promise<void> {
  if (items.length === 0) return;
  if (deps.lifecycle.recordMany) {
    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) await deps.lifecycle.recordMany(items.slice(i, i + CHUNK));
    return;
  }
  for (const item of items) await deps.lifecycle.record(item.entry, item.steps);
}
