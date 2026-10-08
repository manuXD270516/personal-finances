import type { AuditEntry, AuditLogEntryDto, LifecycleStepInput } from '@pf/audit/contracts';
import type { PostingEligibilityDto } from '@pf/accounts/contracts';
import type { CurrencyInfoDto, ReferenceRateDto } from '@pf/fx/contracts';
import type { PostJournalEntryCommand, ReverseJournalEntryCommand } from '@pf/ledger/contracts';
import { currency, DomainError, FixedClock, Instant, Money, Rate } from '@pf/shared-kernel';
import {
  RECONCILIATION_LIFECYCLE,
  Reconciliation,
  systemFlagsOf,
  TRANSACTION_LIFECYCLE,
  Transaction,
  type ConversionDetail,
  type LegRole,
  type ReconciliationState,
  type TransactionState,
} from '../../domain/index.js';
import type { ReconciliationItem, TransactionsDeps } from '../ports/index.js';

/** Igual que `AuditPort` real: solo valores planos (string/boolean/entero/null) o `Money` (`AUDIT_INVALID_VALUE`). */
const auditable = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isSafeInteger(v)) ||
  v instanceof Money ||
  (typeof v === 'object' &&
    Object.keys(v).length === 2 &&
    typeof (v as { amount?: unknown }).amount === 'string' &&
    typeof (v as { currency?: unknown }).currency === 'string');

/** Catálogo FX de prueba (tipo y escala canónica). */
const CATALOG: Record<string, CurrencyInfoDto> = Object.fromEntries(
  (
    [
      ['BOB', 'FIAT', 2],
      ['USD', 'FIAT', 2],
      ['USDT', 'CRYPTO', 6],
      ['USDC', 'CRYPTO', 6],
      ['TRX', 'CRYPTO', 6],
      ['BTC', 'CRYPTO', 8],
      ['ETH', 'CRYPTO', 18],
    ] as const
  ).map(([code, kind, scale]) => [code, { code, kind, scale }]),
);
const scaleOf = (code: string): number => {
  const c = CATALOG[code];
  if (!c) throw new Error(`unknown currency ${code}`);
  return c.scale;
};
const parseIn = (amount: string, code: string) => Money.parse(amount, code, scaleOf(code));

/** Definición de custom field de prueba (CLASSIFICATION en memoria; la validación real vive en ese contexto). */
export interface FakeCustomField {
  readonly fieldId: string;
  readonly key: string;
  readonly dataType: 'TEXT' | 'NUMBER' | 'DECIMAL' | 'DATE' | 'BOOLEAN' | 'SELECT';
  readonly target: 'TRANSACTION' | 'ACCOUNT';
  readonly required?: boolean;
  readonly archived?: boolean;
  readonly options?: readonly string[];
}

/** Tasa de referencia de prueba (FX en memoria: append-only con supersede). */
export interface FakeRate {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  readonly value: string;
  readonly rateType: 'OFFICIAL' | 'PARALLEL' | 'P2P' | 'BANK' | 'CUSTOM';
  readonly asOf: string;
  readonly supersedes?: string | null;
}
const WINDOW_MS = 7 * 86_400_000;

interface Entry {
  readonly id: string;
  readonly command: PostJournalEntryCommand | null;
  readonly reverses: string | null;
  /** Fecha de la reversa (solo en reversas). */
  readonly reverseDate?: string;
  readonly postings: readonly { readonly key: string; readonly amount: string; readonly currency: string }[];
}

/** Fila del recorrido registrada por el doble de `LifecyclePort`. */
export type LifecycleRow = LifecycleStepInput & {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly action: string;
  readonly reason: string | null;
};

/**
 * Dobles en memoria para los tests de aplicación. La unidad de trabajo toma una copia de TODO el estado y la restaura
 * si el callback falla: emula el rollback de la transacción PG (TC-TRANSACTIONS-POSTING-001).
 */
export function inMemoryTransactionsDeps(options: { readonly accounts?: PostingEligibilityDto[] } = {}) {
  let seq = 0;
  const ids = { next: () => `0192f3c4-0000-7000-9000-${(++seq).toString(16).padStart(12, '0')}` };
  const state = {
    txs: new Map<string, TransactionState>(),
    links: [] as { transactionId: string; revision: number; journalEntryId: string; linkType: string }[],
    entries: [] as Entry[],
    outbox: [] as { eventType: string; aggregateId: string; payload: Record<string, unknown> }[],
    audit: [] as AuditEntry[],
    lifecycle: [] as LifecycleRow[],
    legHistory: new Map<string, Map<number, { accountId: string; role: LegRole; amount: Money }[]>>(),
    accounts: new Map((options.accounts ?? []).map((a) => [a.accountId, a])),
    details: new Map<string, { detail: ConversionDetail; createdAt: string }[]>(),
    rates: [] as FakeRate[],
    /** Meses cerrados (`YYYY-MM`, INV-015) para `assertPeriodOpen`. */
    closedMonths: new Set<string>(),
    /** Definiciones de custom fields disponibles para `validateCustomFieldValues`. */
    customFields: [] as FakeCustomField[],
    /** Sesiones de reconciliación (add-reconciliation) e ítems reconciliados/cotejados. */
    reconciliations: new Map<string, ReconciliationState>(),
    reconciliationItems: [] as ReconciliationItem[],
    /** Saldos iniciales por cuenta (asiento de apertura, signo contable). */
    openings: new Map<string, { amount: string; currency: string }>(),
    /** Fecha de hoy en la zona del workspace; `null` ⇒ la del reloj fijo. */
    today: null as string | null,
  };
  const faults: { ledger?: Error; audit?: Error; lifecycle?: Error } = {};
  let depth = 0;

  const snapshot = () => ({
    txs: new Map(state.txs),
    links: [...state.links],
    entries: [...state.entries],
    outbox: [...state.outbox],
    audit: [...state.audit],
    lifecycle: [...state.lifecycle],
    legHistory: new Map([...state.legHistory].map(([k, v]) => [k, new Map(v)])),
    details: new Map([...state.details].map(([k, v]) => [k, [...v]])),
    rates: [...state.rates],
    reconciliations: new Map(state.reconciliations),
    reconciliationItems: state.reconciliationItems.map((i) => ({ ...i })),
  });
  const keepDetail = (s: TransactionState) => {
    if (!s.conversion) return;
    const list = state.details.get(s.id) ?? [];
    if (!list.some((d) => d.detail.revision === s.conversion?.revision)) {
      list.push({ detail: s.conversion, createdAt: '2026-10-01T12:00:00.000Z' });
      state.details.set(s.id, list);
    }
  };
  /** Legs por revisión (la revisión vigente se reescribe in situ al editar un PENDING, como `txn.transaction_leg`). */
  const keepLegs = (s: TransactionState) => {
    const byRevision = state.legHistory.get(s.id) ?? new Map();
    byRevision.set(
      s.revision,
      s.legs.map((l) => ({ accountId: l.accountId, role: l.role, amount: l.amount })),
    );
    state.legHistory.set(s.id, byRevision);
  };
  const supersededBy = (id: string) => state.rates.find((r) => r.supersedes === id)?.id ?? null;
  const toReference = (r: FakeRate): ReferenceRateDto => ({
    fxRateId: r.id,
    rate: { base: r.base, quote: r.quote, value: r.value },
    rateType: r.rateType,
    source: 'MANUAL',
    sourceLabel: null,
    asOf: r.asOf,
  });
  /** Directa o inversa, no reemplazada, `asOf ≤ at` dentro de 7 días; la más reciente (nunca cruzada). */
  const resolve = (a: string, b: string, at: string): FakeRate | null => {
    const t = Date.parse(at);
    const live = state.rates.filter(
      (r) =>
        supersededBy(r.id) === null &&
        Date.parse(r.asOf) <= t &&
        Date.parse(r.asOf) >= t - WINDOW_MS &&
        ((r.base === a && r.quote === b) || (r.base === b && r.quote === a)),
    );
    return live.sort((x, y) => Date.parse(y.asOf) - Date.parse(x.asOf))[0] ?? null;
  };
  const rateOf = (r: { base: string; quote: string; value: string }) =>
    Rate.of(currency(r.base, scaleOf(r.base)), currency(r.quote, scaleOf(r.quote)), r.value);

  const deps: TransactionsDeps = {
    uow: {
      async run(_ws, fn) {
        const saved = depth === 0 ? snapshot() : null;
        depth++;
        try {
          return await fn();
        } catch (err) {
          if (saved) Object.assign(state, saved);
          throw err;
        } finally {
          depth--;
        }
      },
    },
    transactions: {
      async insert(tx) {
        state.txs.set(tx.id, tx.snapshot);
        keepLegs(tx.snapshot);
        keepDetail(tx.snapshot);
      },
      async update(tx) {
        const current = state.txs.get(tx.id);
        if (!current || current.version !== tx.persistedVersion) return false;
        state.txs.set(tx.id, tx.snapshot);
        keepLegs(tx.snapshot);
        keepDetail(tx.snapshot);
        return true;
      },
      async updateStatus(tx) {
        const current = state.txs.get(tx.id);
        if (!current || current.version !== tx.persistedVersion) return false;
        state.txs.set(tx.id, tx.snapshot);
        return true;
      },
      async findById(_ws, id) {
        const s = state.txs.get(id);
        return s ? Transaction.rehydrate(s) : null;
      },
      async list(_ws, filter, page) {
        return [...state.txs.values()]
          .filter((s) => !filter.accountIds || filter.accountIds.includes(s.accountId))
          .filter((s) => !filter.systemFlags || filter.systemFlags.every((f) => systemFlagsOf(s).includes(f)))
          .filter((s) => !filter.statuses || filter.statuses.includes(s.status))
          .filter((s) => !filter.kinds || filter.kinds.includes(s.kind))
          .filter((s) => !filter.currency || s.amount.currency.code === filter.currency)
          .filter(
            (s) =>
              !filter.targetCurrency ||
              s.legs.some((l) => l.role === 'TARGET' && l.amount.currency.code === filter.targetCurrency),
          )
          .filter(
            (s) => !filter.categoryIds || s.splits.some((x) => filter.categoryIds?.includes(x.categoryId)),
          )
          .slice(page.offset, page.offset + page.limit)
          .map((s) => Transaction.rehydrate(s));
      },
      async duplicateCandidates(_ws, probe) {
        return [...state.txs.values()].filter(
          (s) =>
            s.accountId === probe.accountId &&
            s.amount.equals(probe.amount) &&
            s.businessDate >= probe.from &&
            s.businessDate <= probe.to,
        );
      },
      async refundedTotal(_ws, originalId) {
        const refunds = [...state.txs.values()].filter(
          (s) => s.refundOfTransactionId === originalId && s.status !== 'VOIDED',
        );
        const ccy = state.txs.get(originalId)?.amount.currency;
        if (!ccy) return '0';
        return Money.sum(
          refunds.map((r) => r.amount),
          ccy,
        ).toFixed();
      },
      async linkEntry(input) {
        state.links.push(input);
      },
      async linkedEntries(_ws, transactionId) {
        return state.links.filter((l) => l.transactionId === transactionId).map((l) => l.journalEntryId);
      },
      async revisionLegs(_ws, transactionId) {
        return new Map(state.legHistory.get(transactionId) ?? []);
      },
      async postedEntriesByRevision(_ws, transactionId) {
        return new Map(
          state.links
            .filter((l) => l.transactionId === transactionId && l.linkType === 'POSTED')
            .map((l) => [l.revision, l.journalEntryId]),
        );
      },
      async conversionRevisions(_ws, transactionId) {
        return [...(state.details.get(transactionId) ?? [])].sort(
          (a, b) => a.detail.revision - b.detail.revision,
        );
      },
    },
    reconciliations: {
      async insert(r) {
        state.reconciliations.set(r.id, r.snapshot);
      },
      async update(r) {
        const current = state.reconciliations.get(r.id);
        if (!current || current.version !== r.persistedVersion) return false;
        state.reconciliations.set(r.id, r.snapshot);
        return true;
      },
      async findById(_ws, id) {
        const s = state.reconciliations.get(id);
        return s ? Reconciliation.rehydrate(s) : null;
      },
      async findInProgress(_ws, accountId) {
        const s = [...state.reconciliations.values()].find(
          (x) => x.accountId === accountId && x.status === 'IN_PROGRESS',
        );
        return s ? Reconciliation.rehydrate(s) : null;
      },
      async lastCompleted(_ws, accountId) {
        const s = [...state.reconciliations.values()]
          .filter((x) => x.accountId === accountId && x.status === 'COMPLETED')
          .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1))[0];
        return s ? Reconciliation.rehydrate(s) : null;
      },
      async list(_ws, filter, page) {
        return [...state.reconciliations.values()]
          .filter((x) => !filter.accountId || x.accountId === filter.accountId)
          .filter((x) => !filter.status || x.status === filter.status)
          .sort((a, b) =>
            a.statementDate === b.statementDate
              ? a.id < b.id
                ? 1
                : -1
              : a.statementDate < b.statementDate
                ? 1
                : -1,
          )
          .slice(page.offset, page.offset + page.limit)
          .map((x) => Reconciliation.rehydrate(x));
      },
      async findByIds(_ws, ids) {
        return ids.flatMap((id) => {
          const s = state.reconciliations.get(id);
          return s ? [Reconciliation.rehydrate(s)] : [];
        });
      },
      async confirmedLegsTotal({ accountId, currency: code, through, statuses }) {
        const ccy = currency(code, scaleOf(code));
        const included = [...state.txs.values()].filter(
          (s) =>
            (statuses as readonly string[]).includes(s.status) &&
            s.businessDate <= through &&
            s.legs.some((l) => l.accountId === accountId),
        );
        return {
          total: Money.sum(
            included.flatMap((s) => s.legs.filter((l) => l.accountId === accountId).map((l) => l.amount)),
            ccy,
          ),
          count: included.length,
        };
      },
      async lockClearedThrough(_ws, accountId, through) {
        return [...state.txs.values()]
          .filter(
            (s) =>
              s.status === 'CLEARED' &&
              s.businessDate <= through &&
              s.legs.some((l) => l.accountId === accountId),
          )
          .sort((a, b) => (a.businessDate + a.id < b.businessDate + b.id ? -1 : 1))
          .map((s) => Transaction.rehydrate(s));
      },
      async lockWithoutStatementThrough(_ws, accountId, through) {
        return [...state.txs.values()]
          .filter(
            (s) =>
              s.status === 'RECONCILED' &&
              s.reconciliationMode === 'WITHOUT_STATEMENT' &&
              s.businessDate <= through &&
              s.legs.some((l) => l.accountId === accountId),
          )
          .sort((a, b) => (a.businessDate + a.id < b.businessDate + b.id ? -1 : 1))
          .map((s) => Transaction.rehydrate(s));
      },
      async insertItems(_ws, items) {
        for (const i of items) {
          state.reconciliationItems.push({
            reconciliationId: i.reconciliationId,
            transactionId: i.transactionId,
            reconciledAt: '2026-10-01T12:00:00.000Z',
            verifiedWithoutStatement: i.verifiedWithoutStatement,
            unreconciledAt: null,
            unreconciledBy: null,
            unreconcileReason: null,
          });
        }
      },
      async itemsOf(_ws, reconciliationId) {
        return state.reconciliationItems.filter((i) => i.reconciliationId === reconciliationId);
      },
      async markUnreconciled({ transactionId, reason }) {
        const item = [...state.reconciliationItems]
          .reverse()
          .find((i) => i.transactionId === transactionId && i.unreconciledAt === null);
        if (!item) return null;
        const idx = state.reconciliationItems.indexOf(item);
        state.reconciliationItems[idx] = {
          ...item,
          unreconciledAt: '2026-10-01T12:00:00.000Z',
          unreconciledBy: 'user',
          unreconcileReason: reason,
        };
        return { reconciliationId: item.reconciliationId };
      },
      async coverageCounts({ accountId, from, through, afterDate }) {
        const mine = [...state.txs.values()].filter(
          (s) => s.businessDate <= through && s.legs.some((l) => l.accountId === accountId),
        );
        const without = mine.filter(
          (s) => s.status === 'RECONCILED' && s.reconciliationMode === 'WITHOUT_STATEMENT',
        );
        return {
          unreconciledPostedCount: mine.filter((s) => s.status === 'POSTED').length,
          unreconciledClearedCount: mine.filter((s) => s.status === 'CLEARED').length,
          withoutStatementInRange: without.filter((s) => from === null || s.businessDate >= from).length,
          withoutStatementAfterLastStatement: without.some(
            (s) => afterDate === null || s.businessDate > afterDate,
          ),
        };
      },
    },
    openingBalances: {
      async openingBalance({ accountId }) {
        return state.openings.get(accountId) ?? null;
      },
    },
    calendar: { today: async () => state.today ?? '2026-10-01' },
    currencies: { scaleOf: async (code) => CATALOG[code]?.scale ?? null },
    accounts: {
      async getPostingEligibility({ accountIds }) {
        return accountIds.flatMap((id) => state.accounts.get(id) ?? []);
      },
      async assertCanPost({ accounts }) {
        return accounts.map((t) => {
          const a = state.accounts.get(t.accountId);
          if (!a) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
          if (a.status === 'ARCHIVED') throw new DomainError('ACCOUNT_ARCHIVED', 'archived');
          if (a.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', 'closed');
          if (t.currency !== undefined && t.currency !== a.currency) {
            throw new DomainError('CURRENCY_MISMATCH', 'currency');
          }
          return a;
        });
      },
    },
    ledger: {
      async postJournalEntry(command) {
        if (faults.ledger) throw faults.ledger;
        // INV-004: Σ por moneda = 0 (el ledger real valida lo mismo).
        const sums = new Map<string, Money>();
        for (const p of command.postings) {
          const m = parseIn(p.amount.amount, p.amount.currency);
          sums.set(m.currency.code, (sums.get(m.currency.code) ?? Money.zero(m.currency)).add(m));
        }
        if ([...sums.values()].some((v) => !v.isZero())) {
          throw new DomainError('LEDGER_UNBALANCED_ENTRY', 'unbalanced');
        }
        const id = ids.next();
        state.entries.push({
          id,
          command,
          reverses: null,
          postings: command.postings.map((p) => ({
            key:
              p.target.kind === 'USER_ACCOUNT'
                ? p.target.accountId
                : p.target.kind === 'SYSTEM'
                  ? p.target.systemKind
                  : p.target.ledgerAccountId,
            amount: p.amount.amount,
            currency: p.amount.currency,
          })),
        });
        return { journalEntryId: id, sequence: String(state.entries.length), created: true };
      },
      async reverseJournalEntry(command: ReverseJournalEntryCommand) {
        const original = state.entries.find((e) => e.id === command.journalEntryId);
        if (!original) throw new DomainError('REFERENCE_NOT_FOUND', 'entry');
        if (state.entries.some((e) => e.reverses === original.id)) {
          throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', 'reversed');
        }
        if (state.closedMonths.has(command.reverseDate.slice(0, 7))) {
          throw new DomainError('PERIOD_CLOSED', `${command.reverseDate} is in a closed period`);
        }
        const id = ids.next();
        state.entries.push({
          id,
          command: null,
          reverses: original.id,
          reverseDate: command.reverseDate,
          postings: original.postings.map((p) => ({
            key: p.key,
            amount: parseIn(p.amount, p.currency).negate().toFixed(),
            currency: p.currency,
          })),
        });
        return { journalEntryId: id, sequence: String(state.entries.length), created: true };
      },
      async ledgerAccountForUserAccount() {
        throw new Error('not used');
      },
      async assertPeriodOpen(input) {
        if (state.closedMonths.has(input.date.slice(0, 7))) {
          throw new DomainError('PERIOD_CLOSED', `${input.date} is in a closed period`);
        }
      },
      /** Doble simple: la primera fecha cuyo mes (`YYYY-MM`) no está cerrado. */
      async firstOpenDateOnOrAfter(input) {
        let [y, m] = [Number(input.date.slice(0, 4)), Number(input.date.slice(5, 7))];
        let date = input.date;
        while (state.closedMonths.has(date.slice(0, 7))) {
          m += 1;
          if (m > 12) {
            m = 1;
            y += 1;
          }
          date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
        }
        return date;
      },
    },
    classification: {
      async validate(input) {
        for (const [i, c] of (input.categoryIds ?? []).entries()) {
          if (c.categoryId === 'archived') {
            throw new DomainError('CATEGORY_ARCHIVED', 'archived').at(`/splits/${i}/categoryId`);
          }
        }
      },
      /** Réplica mínima del contrato `ValidateCustomFieldValues` (la lógica real se prueba en CLASSIFICATION). */
      async validateCustomFieldValues(input) {
        const active = state.customFields.filter((f) => f.target === input.target && !f.archived);
        return input.items.map((item) => {
          const set: {
            fieldId: string;
            key: string;
            valueType: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';
            value: string | boolean;
          }[] = [];
          const removeFieldIds: string[] = [];
          for (const [i, v] of item.values.entries()) {
            const ptr = `${item.pointer}/${i}`;
            const def = state.customFields.find((f) =>
              v.fieldId ? f.fieldId === v.fieldId : f.key === v.key,
            );
            if (!def) throw new DomainError('REFERENCE_NOT_FOUND', 'custom field not found').at(ptr);
            if (def.target !== input.target) {
              throw new DomainError('CUSTOM_FIELD_TARGET_MISMATCH', 'wrong target').at(ptr);
            }
            if (def.archived) throw new DomainError('CUSTOM_FIELD_ARCHIVED', 'archived').at(ptr);
            if (v.value === null) {
              removeFieldIds.push(def.fieldId);
              continue;
            }
            const okType =
              def.dataType === 'BOOLEAN'
                ? typeof v.value === 'boolean'
                : typeof v.value === 'string' &&
                  (def.dataType === 'NUMBER'
                    ? /^-?\d+$/u.test(v.value)
                    : def.dataType === 'DECIMAL'
                      ? /^-?\d+(\.\d{1,18})?$/u.test(v.value)
                      : def.dataType === 'DATE'
                        ? /^\d{4}-\d{2}-\d{2}$/u.test(v.value)
                        : def.dataType === 'SELECT'
                          ? (def.options ?? []).includes(v.value)
                          : v.value.length > 0);
            if (!okType) {
              throw new DomainError('CUSTOM_FIELD_VALUE_INVALID', 'invalid value').at(`${ptr}/value`);
            }
            const valueType =
              def.dataType === 'NUMBER' || def.dataType === 'DECIMAL'
                ? 'NUMBER'
                : def.dataType === 'DATE'
                  ? 'DATE'
                  : def.dataType === 'BOOLEAN'
                    ? 'BOOLEAN'
                    : 'TEXT';
            set.push({
              fieldId: def.fieldId,
              key: def.key,
              valueType,
              value:
                typeof v.value === 'string' && valueType === 'NUMBER' && v.value.includes('.')
                  ? v.value.replace(/\.?0+$/u, '')
                  : v.value,
            });
          }
          if (input.requireMandatory) {
            const final = new Set(item.existingFieldIds ?? []);
            for (const v of set) final.add(v.fieldId);
            for (const id of removeFieldIds) final.delete(id);
            const missing = active.find((f) => f.required && !final.has(f.fieldId));
            if (missing) throw new DomainError('CUSTOM_FIELD_REQUIRED', 'required').at(item.pointer);
          }
          return { set, removeFieldIds };
        });
      },
    },
    categories: {
      uncategorized: async (_ws, kind) =>
        kind === 'INCOME' ? 'cat-uncategorized-income' : 'cat-uncategorized',
      fees: async () => 'cat-fees',
      withDescendants: async (_ws, ids_) => [...ids_, ...ids_.map((i) => `${i}-child`)],
    },
    outbox: {
      async append(event) {
        state.outbox.push({
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payload: event.payload as Record<string, unknown>,
        });
      },
    },
    audit: {
      async append(entry) {
        if (faults.audit) throw faults.audit;
        for (const c of entry.changes ?? []) {
          if (!auditable(c.before) || !auditable(c.after)) {
            throw new Error(`AUDIT_INVALID_VALUE: ${entry.action}.${c.field}`);
          }
        }
        state.audit.push(entry);
      },
    },
    // Doble de `LifecyclePort`: valida como el adaptador real (auditoría + pasos con sequence 1..n por agregado,
    // estados en código de máquina y eventos `<ctx>.<Name>.vN`) y comparte el rollback de la unidad de trabajo.
    lifecycle: {
      async record(entry, steps) {
        await deps.audit.append(entry);
        if (faults.lifecycle) throw faults.lifecycle;
        for (const step of steps) {
          const aggregateId = step.aggregateId ?? entry.aggregateId;
          const own = state.lifecycle.filter((l) => l.aggregateId === aggregateId);
          if (step.kind === 'TRANSITION' && !/^[A-Z][A-Z0-9_]*$/.test(step.toState)) {
            throw new Error(`invalid toState ${step.toState}`);
          }
          for (const e of step.events ?? []) {
            if (!/^[a-z]+\.[A-Z][A-Za-z0-9]*\.v[1-9]\d*$/.test(e.eventType)) {
              throw new Error(`invalid event type ${e.eventType}`);
            }
          }
          state.lifecycle.push({
            ...step,
            aggregateType: step.aggregateType ?? entry.aggregateType,
            aggregateId,
            sequence: own.length + 1,
            action: entry.action,
            reason: step.kind === 'TRANSITION' ? (step.reason ?? entry.reason ?? null) : null,
          });
        }
      },
    },
    lifecycleQuery: {
      machineOf: (type) => ({
        ...(type === 'Reconciliation' ? RECONCILIATION_LIFECYCLE : TRANSACTION_LIFECYCLE).definition,
      }),
      async lifecycleOf(input) {
        const own = state.lifecycle.filter((l) => l.aggregateId === input.aggregateId);
        const items = own.map((l) =>
          l.kind === 'TRANSITION'
            ? {
                sequence: l.sequence,
                kind: 'TRANSITION' as const,
                transition: l.transition,
                fromState: l.fromState,
                toState: l.toState,
                machineVersion: l.machineVersion,
                occurredAt: '2026-10-01T12:00:00.000Z',
                actor: { type: 'USER' as const, id: input.userId, displayName: null },
                origin: 'api' as const,
                reason: l.reason,
                revisionFrom: l.revisionFrom ?? null,
                revisionTo: l.revisionTo ?? null,
                aggregateVersion: null,
                journalEntries: {
                  reversed: l.journalEntries?.reversed ?? null,
                  reversal: l.journalEntries?.reversal ?? null,
                  posted: l.journalEntries?.posted ?? null,
                },
                detailRefs: l.detailRefs ?? {},
                events: (l.events ?? []).map((e) => e.eventType),
                auditLogId: null,
                derived: false,
              }
            : {
                sequence: l.sequence,
                kind: 'ANNOTATION' as const,
                occurredAt: '2026-10-01T12:00:00.000Z',
                actor: { type: 'USER' as const, id: input.userId, displayName: null },
                origin: 'api' as const,
                changedFields: [...l.changedFields],
                detailRefs: l.detailRefs ?? {},
                revisionFrom: l.revisionFrom ?? null,
                revisionTo: l.revisionTo ?? null,
                aggregateVersion: null,
                events: (l.events ?? []).map((e) => e.eventType),
                auditLogId: null,
                derived: false,
              },
        );
        const path = own.flatMap((l) => (l.kind === 'TRANSITION' ? [l.toState] : []));
        return {
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          currentState: input.currentState,
          path,
          historyComplete: own.find((l) => l.kind === 'TRANSITION')?.fromState === null,
          machine: {
            ...(input.aggregateType === 'Reconciliation' ? RECONCILIATION_LIFECYCLE : TRANSACTION_LIFECYCLE)
              .definition,
          },
          items,
        };
      },
    },
    history: {
      async historyOf(input): Promise<AuditLogEntryDto[]> {
        const wanted = new Set(input.entities.map((e) => e.aggregateId));
        return state.audit
          .filter((a) => wanted.has(a.aggregateId))
          .map((a, i) => ({
            id: String(i),
            occurredAt: '2026-10-01T00:00:00.000Z',
            actor: { type: 'USER', userId: input.userId, process: null },
            action: a.action,
            aggregateType: a.aggregateType,
            aggregateId: a.aggregateId,
            aggregateVersion: a.aggregateVersion ?? null,
            changes: a.changes ?? [],
            reason: a.reason ?? null,
            correlationId: 'c',
            origin: 'api',
            userAgent: null,
          }));
      },
    },
    fx: {
      async currency(code) {
        return CATALOG[code] ?? null;
      },
      async referenceForConversion({ base, quote, executedAt, fxRateId }) {
        if (fxRateId) {
          const r = state.rates.find((x) => x.id === fxRateId);
          if (!r) throw new DomainError('REFERENCE_NOT_FOUND', 'fx rate').at('/referenceFxRateId');
          return toReference(r);
        }
        const r = resolve(base, quote, executedAt);
        return r ? toReference(r) : null;
      },
      async conversionCost({ executedAt, components, reference }) {
        const reporting = currency('BOB', 2);
        const missing: Money[] = [];
        let exactSum = Money.zero(reporting).toDecimal();
        for (const c of components) {
          const m = parseIn(c.amount, c.currency);
          if (c.currency === 'BOB') {
            exactSum = exactSum.plus(m.toDecimal());
            continue;
          }
          const ref =
            reference &&
            [reference.rate.base, reference.rate.quote].includes(c.currency) &&
            [reference.rate.base, reference.rate.quote].includes('BOB')
              ? reference.rate
              : resolve(c.currency, 'BOB', executedAt);
          if (!ref) {
            missing.push(m);
            continue;
          }
          const r = rateOf(ref);
          exactSum = exactSum.plus(
            r.base.code === c.currency ? m.toDecimal().times(r.value) : m.toDecimal().div(r.value),
          );
        }
        return {
          amount: Money.roundToScale(exactSum, reporting, 'HALF_EVEN').toJSON(),
          complete: missing.length === 0,
          missingValuations: missing.map((x) => x.toJSON()),
        };
      },
    },
    ids,
    clock: new FixedClock(Instant.parse('2026-10-01T12:00:00Z')),
  };

  /**
   * Saldo contable de una cuenta (Σ postings de todos los asientos). Las cuentas de sistema se identifican por su
   * `systemKind`; con `ccy` se filtra por moneda (FX_TRADING/EXPENSE existen por moneda).
   */
  const balanceOf = (key: string, ccy?: string): string => {
    const postings = state.entries.flatMap((e) =>
      e.postings.filter((p) => p.key === key && (ccy === undefined || p.currency === ccy)),
    );
    const code = ccy ?? postings[0]?.currency ?? 'BOB';
    if (postings.some((p) => p.currency !== code)) throw new Error(`${key} has several currencies`);
    return Money.sum(
      postings.map((p) => parseIn(p.amount, code)),
      currency(code, scaleOf(code)),
    ).toFixed();
  };

  /** Registra una tasa de referencia (append-only); `supersedes` crea una versión que reemplaza a otra. */
  const addRate = (r: FakeRate): void => {
    if (r.supersedes && supersededBy(r.supersedes)) throw new DomainError('FX_RATE_ALREADY_SUPERSEDED', 'x');
    state.rates.push(r);
  };

  return { deps, state, faults, balanceOf, addRate };
}
