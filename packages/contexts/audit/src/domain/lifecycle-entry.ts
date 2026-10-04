import type { Instant } from '@pf/shared-kernel';
import { isUuid, type AuditActor } from './audit-actor.js';
import { isAggregateType } from './audit-action.js';
import { AuditError } from './audit-error.js';
import type { AuditOrigin } from './audit-origin.js';

export type LifecycleEntryKind = 'TRANSITION' | 'ANNOTATION';

export interface LifecycleJournalEntries {
  readonly reversed: string | null;
  readonly reversal: string | null;
  readonly posted: string | null;
}

/**
 * Fila inmutable de `audit.lifecycle_transition` (openspec add-lifecycle-timeline, decisión 5): un paso del flujo de
 * un agregado (transición de estado) o una anotación (cambio descriptivo). Sin montos ni texto libre salvo `reason`
 * (los montos se leen de la revisión enlazada; PII baja). `derived = true` si se reconstruyó desde `audit.audit_log`.
 */
export interface LifecycleEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Monotónica por agregado, desde 1 (UNIQUE por workspace + agregado). */
  readonly sequence: number;
  readonly kind: LifecycleEntryKind;
  /** `null` en anotaciones. */
  readonly transition: string | null;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly machineVersion: number | null;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly aggregateVersion: number | null;
  readonly occurredAt: Instant;
  readonly actor: AuditActor;
  readonly origin: AuditOrigin;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly auditLogId: string | null;
  readonly eventIds: readonly string[];
  /** `<context>.<EventName>.v<N>`, en el mismo orden que `eventIds`. */
  readonly eventTypes: readonly string[];
  readonly journalEntries: LifecycleJournalEntries;
  readonly detailRefs: Readonly<Record<string, string | number>>;
  readonly changedFields: readonly string[];
  readonly derived: boolean;
}

const CODE = /^[A-Z][A-Z0-9_]*$/;
const EVENT = /^[a-z]+\.[A-Z][A-Za-z0-9]*\.v[1-9][0-9]*$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/;
const REF = /^[a-z][a-zA-Z0-9]{0,63}$/;

const invalid = (msg: string) => new AuditError('AUDIT_INVALID_RECORD', `lifecycle: ${msg}`);
const optUuid = (v: string | null, what: string) => {
  if (v !== null && !isUuid(v)) throw invalid(`${what} must be a UUID`);
};

/** Valida las invariantes de una fila (lo mismo que verifican los CHECK de la tabla) y la congela. */
export function lifecycleEntry(e: LifecycleEntry): LifecycleEntry {
  if (!isUuid(e.id) || !isUuid(e.workspaceId) || !isUuid(e.aggregateId)) throw invalid('ids must be UUIDs');
  if (!isAggregateType(e.aggregateType)) throw invalid('invalid aggregateType');
  if (!Number.isSafeInteger(e.sequence) || e.sequence < 1) throw invalid('sequence must be ≥ 1');
  if (e.kind === 'TRANSITION') {
    if (e.transition === null || !CODE.test(e.transition)) throw invalid('transition code required');
    if (e.toState === null || !CODE.test(e.toState)) throw invalid('toState required');
    if (e.fromState !== null && !CODE.test(e.fromState)) throw invalid('invalid fromState');
    if (e.machineVersion === null || !Number.isSafeInteger(e.machineVersion) || e.machineVersion < 1) {
      throw invalid('machineVersion required');
    }
    if (e.changedFields.length > 0) throw invalid('a transition has no changedFields');
  } else {
    if (e.transition !== null || e.fromState !== null || e.toState !== null || e.machineVersion !== null) {
      throw invalid('an annotation carries no state change');
    }
    if (e.reason !== null) throw invalid('an annotation carries no reason');
  }
  for (const f of e.changedFields) if (!FIELD.test(f)) throw invalid(`invalid field ${f}`);
  for (const r of [e.revisionFrom, e.revisionTo, e.aggregateVersion]) {
    if (r !== null && (!Number.isSafeInteger(r) || r < 1)) throw invalid('revisions/versions must be ≥ 1');
  }
  if (e.revisionFrom !== null && (e.revisionTo === null || e.revisionTo <= e.revisionFrom)) {
    throw invalid('revisionTo must follow revisionFrom');
  }
  if (e.reason !== null && e.reason.length > 500) throw invalid('reason too long');
  if (e.eventIds.length !== e.eventTypes.length) throw invalid('eventIds/eventTypes mismatch');
  for (const id of e.eventIds) if (!isUuid(id)) throw invalid('eventIds must be UUIDs');
  for (const t of e.eventTypes) if (!EVENT.test(t)) throw invalid(`invalid event type ${t}`);
  optUuid(e.auditLogId, 'auditLogId');
  optUuid(e.journalEntries.reversed, 'journalEntries.reversed');
  optUuid(e.journalEntries.reversal, 'journalEntries.reversal');
  optUuid(e.journalEntries.posted, 'journalEntries.posted');
  for (const [k, v] of Object.entries(e.detailRefs)) {
    if (!REF.test(k)) throw invalid(`invalid detail ref ${k}`);
    if (typeof v === 'number' ? !Number.isSafeInteger(v) : !isUuid(v)) {
      throw invalid(`detail ref ${k} must be a UUID or an integer`);
    }
  }
  return Object.freeze({
    ...e,
    eventIds: Object.freeze([...e.eventIds]),
    eventTypes: Object.freeze([...e.eventTypes]),
    changedFields: Object.freeze([...e.changedFields]),
    journalEntries: Object.freeze({ ...e.journalEntries }),
    detailRefs: Object.freeze({ ...e.detailRefs }),
  });
}

/**
 * Orden del recorrido: instante y, a igual instante, `sequence`. Las filas vivas siempre siguen el orden de `sequence`;
 * las derivadas por el backfill pueden tener `sequence` mayor que filas vivas posteriores (se agregan después), pero
 * su instante es el del registro de auditoría que las respalda.
 */
export function compareLifecycleEntries(a: LifecycleEntry, b: LifecycleEntry): number {
  return a.occurredAt.epochMillis - b.occurredAt.epochMillis || a.sequence - b.sequence;
}

/** Camino de estados visitados (destino de cada transición, en orden del recorrido). */
export function lifecyclePath(entries: readonly LifecycleEntry[]): string[] {
  return [...entries]
    .sort(compareLifecycleEntries)
    .filter((e) => e.kind === 'TRANSITION' && e.toState !== null)
    .map((e) => e.toState as string);
}

/** El recorrido es completo si su primera transición es una creación (∅ → estado). */
export function historyComplete(entries: readonly LifecycleEntry[]): boolean {
  const first = [...entries].sort(compareLifecycleEntries).find((e) => e.kind === 'TRANSITION');
  return first !== undefined && first.fromState === null;
}
