import type { AuditRecord } from './audit-record.js';
import type { LifecycleJournalEntries } from './lifecycle-entry.js';

/**
 * Paso reconstruido desde la auditoría (add-lifecycle-timeline decisión 8, FR-AUDIT-012). `aggregateId` permite que
 * un registro mueva OTRO agregado (la corrección de una tasa reemplaza la tasa original).
 */
export interface DerivedStep {
  readonly auditLogId: string;
  readonly aggregateId: string;
  readonly kind: 'TRANSITION' | 'ANNOTATION';
  readonly transition: string | null;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly journalEntries: LifecycleJournalEntries;
  readonly detailRefs: Readonly<Record<string, string | number>>;
  readonly changedFields: readonly string[];
  readonly reason: string | null;
}

type Change = { readonly field: string; readonly before: unknown; readonly after: unknown };
const changeOf = (r: AuditRecord, field: string): Change | undefined =>
  r.changes.find((c) => c.field === field);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const NO_ENTRIES: LifecycleJournalEntries = { reversed: null, reversal: null, posted: null };

/** Acción de auditoría → transición declarada (lo que no está aquí se reconstruye como anotación). */
const STATUS_ACTIONS: Readonly<Record<string, { readonly transition: string; readonly to?: string }>> = {
  'transactions.transaction.posted': { transition: 'POST', to: 'POSTED' },
  'transactions.transaction.cleared': { transition: 'CLEAR', to: 'CLEARED' },
  'transactions.transaction.uncleared': { transition: 'UNCLEAR', to: 'POSTED' },
  'transactions.transaction.reconciled': { transition: 'RECONCILE', to: 'RECONCILED' },
  'transactions.transaction.unreconciled': { transition: 'UNRECONCILE', to: 'CLEARED' },
  'transactions.transaction.voided': { transition: 'VOID', to: 'VOIDED' },
  'accounts.account.archived': { transition: 'ARCHIVE', to: 'ARCHIVED' },
  'accounts.account.closed': { transition: 'CLOSE', to: 'CLOSED' },
  'accounts.account.reactivated': { transition: 'REACTIVATE', to: 'ACTIVE' },
  // docs/31 D52: catálogos de CLASSIFICATION (sin eliminación, solo archivado).
  'classification.category.archived': { transition: 'ARCHIVE', to: 'ARCHIVED' },
  'classification.category.unarchived': { transition: 'UNARCHIVE', to: 'ACTIVE' },
  'classification.counterparty.archived': { transition: 'ARCHIVE', to: 'ARCHIVED' },
  'classification.counterparty.unarchived': { transition: 'UNARCHIVE', to: 'ACTIVE' },
};
const CREATIONS: Readonly<Record<string, { readonly transition: string; readonly to?: string }>> = {
  'transactions.transaction.created': { transition: 'RECORD' },
  'transactions.transfer.created': { transition: 'RECORD' },
  'transactions.conversion.created': { transition: 'RECORD' },
  'accounts.account.opened': { transition: 'OPEN', to: 'ACTIVE' },
  'fx.exchange_rate.recorded': { transition: 'RECORD', to: 'RECORDED' },
  'fx.exchange_rate.superseded': { transition: 'RECORD', to: 'RECORDED' },
  'classification.category.created': { transition: 'CREATE', to: 'ACTIVE' },
  'classification.counterparty.created': { transition: 'CREATE', to: 'ACTIVE' },
};
const REVISIONS = new Set(['transactions.transaction.updated', 'transactions.conversion.amended']);

/** Tipos de agregado que reconstruye el job. */
export const DERIVABLE_AGGREGATE_TYPES = [
  'Transaction',
  'Account',
  'ExchangeRate',
  'Category',
  'Counterparty',
] as const;

/**
 * Reconstruye los pasos de UN agregado a partir de su auditoría cronológica (decisión 8). Solo deriva los registros
 * que aún no respaldan ninguna fila (`covered`), pero recorre todos para conocer el estado vigente. Nunca inventa: si
 * el estado de origen es desconocido (la historia no empieza en una creación), un cambio se registra como anotación.
 */
export function deriveLifecycleSteps(
  records: readonly AuditRecord[],
  covered: ReadonlyMap<string, string | null>,
): DerivedStep[] {
  const out: DerivedStep[] = [];
  let state: string | null = null;
  let known = false;
  for (const r of records) {
    if (covered.has(r.id)) {
      // Registro ya respaldado por una fila (viva o derivada): solo avanza el estado conocido.
      const to = covered.get(r.id) ?? null;
      if (to !== null) {
        state = to;
        known = true;
      }
      continue;
    }
    const status = changeOf(r, 'status');
    const journal = changeOf(r, 'journalEntryId');
    const creation = CREATIONS[r.action];
    if (creation && (!known || state === null)) {
      const to = creation.to ?? str(status?.after);
      if (to !== null) {
        out.push(
          transition(r, r.aggregateId, creation.transition, null, to, {
            revisionTo: r.aggregateType === 'Transaction' ? 1 : null,
            journal: { ...NO_ENTRIES, posted: str(journal?.after) },
          }),
        );
        state = to;
        known = true;
        const supersedes =
          r.action === 'fx.exchange_rate.superseded' ? changeOf(r, 'supersedesRateId') : null;
        const original = str(supersedes?.after);
        if (original) {
          out.push(
            transition(r, original, 'SUPERSEDE', 'RECORDED', 'SUPERSEDED', {
              refs: { supersededByRateId: r.aggregateId },
            }),
          );
        }
        continue;
      }
    }
    const mapped = STATUS_ACTIONS[r.action];
    if (mapped && known) {
      const from = str(status?.before) ?? state;
      const to = mapped.to ?? str(status?.after);
      if (from !== null && to !== null) {
        const voided = mapped.transition === 'VOID';
        out.push(
          transition(r, r.aggregateId, mapped.transition, from, to, {
            journal: voided
              ? { reversed: str(journal?.before), reversal: str(journal?.after), posted: null }
              : { ...NO_ENTRIES, posted: str(journal?.after) },
          }),
        );
        state = to;
        continue;
      }
    }
    const revision = changeOf(r, 'revision');
    if (REVISIONS.has(r.action) && known && state !== null && revision && journal) {
      const to = str(status?.after) ?? (state === 'CLEARED' ? 'POSTED' : state);
      out.push(
        transition(r, r.aggregateId, 'REVISE', state, to, {
          revisionFrom: int(revision.before),
          revisionTo: int(revision.after),
          journal: { reversed: str(journal.before), reversal: null, posted: str(journal.after) },
        }),
      );
      state = to;
      continue;
    }
    if (status && known && str(status.after) !== null) state = str(status.after);
    out.push({
      auditLogId: r.id,
      aggregateId: r.aggregateId,
      kind: 'ANNOTATION',
      transition: null,
      fromState: null,
      toState: null,
      revisionFrom: null,
      revisionTo: null,
      journalEntries: NO_ENTRIES,
      detailRefs: {},
      changedFields: [...new Set(r.changes.map((c) => c.field))],
      reason: null,
    });
  }
  return out;
}

function transition(
  r: AuditRecord,
  aggregateId: string,
  code: string,
  from: string | null,
  to: string,
  extra: {
    readonly revisionFrom?: number | null;
    readonly revisionTo?: number | null;
    readonly journal?: LifecycleJournalEntries;
    readonly refs?: Readonly<Record<string, string | number>>;
  } = {},
): DerivedStep {
  return {
    auditLogId: r.id,
    aggregateId,
    kind: 'TRANSITION',
    transition: code,
    fromState: from,
    toState: to,
    revisionFrom: extra.revisionFrom ?? null,
    revisionTo: extra.revisionTo ?? null,
    journalEntries: extra.journal ?? NO_ENTRIES,
    detailRefs: extra.refs ?? {},
    changedFields: [],
    reason: r.reason,
  };
}
