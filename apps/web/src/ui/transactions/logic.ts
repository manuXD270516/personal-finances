import { isZeroAmount, sumAmounts } from '../common/money';
import {
  customFieldParams,
  EMPTY_CUSTOM_FIELD_FILTER,
  type CustomFieldDefinition,
  type CustomFieldFilter,
} from '../custom-fields/logic';
import type {
  AuditLogEntry,
  Money,
  PaymentMethod,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from '../common/types';

/**
 * Monto de una transacción visto desde una cuenta (Σ de sus patas en esa cuenta, ya firmadas por la API: salida
 * negativa). Sin cuenta: la pata principal; transferencias y conversiones no tienen signo (mueven entre cuentas).
 */
export function amountFor(
  tx: Transaction,
  accountId?: string,
): { money: Money; direction: 'in' | 'out' | 'neutral' } {
  const legs = accountId ? tx.legs.filter((l) => l.accountId === accountId) : [];
  if (legs.length > 0) {
    const currency = legs[0]!.amount.currency;
    const scale = (legs[0]!.amount.amount.split('.')[1] ?? '').length;
    const total = sumAmounts(
      legs.map((l) => l.amount.amount),
      currency,
      scale,
    );
    return {
      money: { amount: total.replace(/^-/, ''), currency },
      direction: isZeroAmount(total) ? 'neutral' : total.startsWith('-') ? 'out' : 'in',
    };
  }
  if (tx.kind === 'TRANSFER' || tx.kind === 'CONVERSION') return { money: tx.amount, direction: 'neutral' };
  const main = tx.legs.find((l) => l.role === 'MAIN') ?? tx.legs[0];
  if (!main) return { money: tx.amount, direction: 'neutral' };
  return {
    money: { amount: main.amount.amount.replace(/^-/, ''), currency: main.amount.currency },
    direction: main.amount.amount.startsWith('-') ? 'out' : 'in',
  };
}

export interface TransactionFilters {
  readonly q: string;
  readonly accountId: string;
  readonly kind: TransactionKind | '';
  readonly status: TransactionStatus | '';
  readonly paymentMethod: PaymentMethod | '';
  readonly categoryId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  /** Filtro por valor de custom field de los splits (`customField[<clave>]`, add-custom-fields). */
  readonly customField: CustomFieldFilter;
}

export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {
  q: '',
  accountId: '',
  kind: '',
  status: '',
  paymentMethod: '',
  categoryId: '',
  dateFrom: '',
  dateTo: '',
  customField: EMPTY_CUSTOM_FIELD_FILTER,
};

/**
 * Query de `listTransactions` a partir de los filtros de la pantalla (vacíos se omiten). El filtro por custom field
 * necesita la definición elegida (tipo) y el locale de formato (lo escrito se normaliza al punto decimal).
 */
export function transactionsQuery(
  f: TransactionFilters,
  cursor?: string | null,
  custom?: { readonly definition: CustomFieldDefinition | undefined; readonly locale: string },
): URLSearchParams {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set('q', f.q.trim());
  if (f.accountId) q.append('accountId', f.accountId);
  if (f.kind) q.append('kind', f.kind);
  if (f.status) q.append('status', f.status);
  if (f.paymentMethod) q.set('paymentMethod', f.paymentMethod);
  if (f.categoryId) q.append('categoryId', f.categoryId);
  if (f.dateFrom) q.set('dateFrom', f.dateFrom);
  if (f.dateTo) q.set('dateTo', f.dateTo);
  if (custom)
    for (const [k, v] of customFieldParams(custom.definition, f.customField, custom.locale)) q.set(k, v);
  q.set('limit', '50');
  if (cursor) q.set('cursor', cursor);
  return q;
}

/** Acciones de estado disponibles (máquina de estados de FR-TRANSACTIONS-006; la API valida igual). */
export function availableActions(tx: Transaction) {
  const s = tx.status;
  return {
    edit: s !== 'VOIDED',
    financialEdit: s !== 'VOIDED' && s !== 'RECONCILED',
    post: s === 'PENDING',
    clear: s === 'POSTED',
    unclear: s === 'CLEARED',
    reconcile: s === 'CLEARED',
    unreconcile: s === 'RECONCILED',
    void: s !== 'VOIDED' && s !== 'RECONCILED',
    duplicate: tx.kind === 'INCOME' || tx.kind === 'EXPENSE' || tx.kind === 'REFUND',
  };
}

/** Un evento del ciclo de vida de la transacción presentado como transición de estado. */
export interface TimelineItem {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly actor: AuditLogEntry['actor'];
  /** Estado anterior → nuevo (null si la entrada no cambió el estado). `from` null = creación. */
  readonly transition: { readonly from: string | null; readonly to: string } | null;
  /** Revisión contable anterior → nueva (edición financiera = reversa + nuevo asiento). */
  readonly revision: { readonly from: unknown; readonly to: unknown } | null;
  readonly reason: string | null;
  readonly changes: AuditLogEntry['changes'];
  /** Efectos contables del mismo comando (asiento registrado, reversa…), agrupados por `correlationId`. */
  readonly related: readonly { readonly id: string; readonly action: string }[];
}

/** Campos técnicos que no se listan como cambios (se expresan como transición o revisión). */
const TECHNICAL_FIELDS = new Set(['status', 'revision', 'journalEntryId', 'bulkOperationId']);

/**
 * Línea de tiempo del ciclo de vida (decisión del owner 2026-10-03): cada entrada del historial
 * (`GET …/transactions/{id}/history`) como "estado → estado", con quién, cuándo y por qué, más el diff de los
 * campos de negocio. Las entradas sin cambio de estado conservan el estado vigente (p. ej. una edición).
 */
export function buildTimeline(entries: readonly AuditLogEntry[]): TimelineItem[] {
  const sorted = [...entries].sort((a, b) =>
    a.occurredAt === b.occurredAt ? a.id.localeCompare(b.id) : a.occurredAt.localeCompare(b.occurredAt),
  );
  // El historial incluye las entradas del asiento vinculado (p. ej. `ledger.journal_entry.posted`): no son estados de
  // la transacción, se muestran como efecto contable de la entrada de la transacción con la misma correlación.
  const isTransaction = (e: AuditLogEntry) => e.aggregateType === 'Transaction';
  const owners = new Map<string, string>();
  for (const e of sorted) if (isTransaction(e) && e.correlationId) owners.set(e.correlationId, e.id);
  const related = new Map<string, { id: string; action: string }[]>();
  const standalone = new Set<string>();
  for (const e of sorted) {
    if (isTransaction(e)) continue;
    const owner = e.correlationId ? owners.get(e.correlationId) : undefined;
    if (owner) related.set(owner, [...(related.get(owner) ?? []), { id: e.id, action: e.action }]);
    else standalone.add(e.id);
  }
  return sorted
    .filter((e) => isTransaction(e) || standalone.has(e.id))
    .map((e) => {
      const status = e.changes.find((c) => c.field === 'status');
      const revision = e.changes.find((c) => c.field === 'revision');
      return {
        id: e.id,
        at: e.occurredAt,
        action: e.action,
        actor: e.actor,
        transition: status
          ? { from: typeof status.before === 'string' ? status.before : null, to: String(status.after) }
          : null,
        revision: revision ? { from: revision.before, to: revision.after } : null,
        reason: e.reason,
        changes: e.changes.filter((c) => !TECHNICAL_FIELDS.has(c.field)),
        related: related.get(e.id) ?? [],
      };
    });
}

/** Estado vigente tras cada entrada (para mostrar "sigue en …" cuando la entrada no cambia el estado). */
export function statusAfterEach(items: readonly TimelineItem[]): (string | null)[] {
  let current: string | null = null;
  return items.map((i) => {
    if (i.transition) current = i.transition.to;
    return current;
  });
}
