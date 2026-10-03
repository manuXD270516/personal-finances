import type { AuditEntry, AuditLogEntryDto } from '@pf/audit/contracts';
import type { PostingEligibilityDto } from '@pf/accounts/contracts';
import type { CurrencyInfoDto, ReferenceRateDto } from '@pf/fx/contracts';
import type { PostJournalEntryCommand, ReverseJournalEntryCommand } from '@pf/ledger/contracts';
import { currency, DomainError, FixedClock, Instant, Money, Rate } from '@pf/shared-kernel';
import { Transaction, type ConversionDetail, type TransactionState } from '../../domain/index.js';
import type { TransactionsDeps } from '../ports/index.js';

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
  readonly postings: readonly { readonly key: string; readonly amount: string; readonly currency: string }[];
}

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
    accounts: new Map((options.accounts ?? []).map((a) => [a.accountId, a])),
    details: new Map<string, { detail: ConversionDetail; createdAt: string }[]>(),
    rates: [] as FakeRate[],
  };
  const faults: { ledger?: Error; audit?: Error } = {};
  let depth = 0;

  const snapshot = () => ({
    txs: new Map(state.txs),
    links: [...state.links],
    entries: [...state.entries],
    outbox: [...state.outbox],
    audit: [...state.audit],
    details: new Map([...state.details].map(([k, v]) => [k, [...v]])),
    rates: [...state.rates],
  });
  const keepDetail = (s: TransactionState) => {
    if (!s.conversion) return;
    const list = state.details.get(s.id) ?? [];
    if (!list.some((d) => d.detail.revision === s.conversion?.revision)) {
      list.push({ detail: s.conversion, createdAt: '2026-10-01T12:00:00.000Z' });
      state.details.set(s.id, list);
    }
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
        keepDetail(tx.snapshot);
      },
      async update(tx) {
        const current = state.txs.get(tx.id);
        if (!current || current.version !== tx.persistedVersion) return false;
        state.txs.set(tx.id, tx.snapshot);
        keepDetail(tx.snapshot);
        return true;
      },
      async findById(_ws, id) {
        const s = state.txs.get(id);
        return s ? Transaction.rehydrate(s) : null;
      },
      async list(_ws, filter, page) {
        return [...state.txs.values()]
          .filter((s) => !filter.accountIds || filter.accountIds.includes(s.accountId))
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
        const id = ids.next();
        state.entries.push({
          id,
          command: null,
          reverses: original.id,
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
    },
    classification: {
      async validate(input) {
        for (const [i, c] of (input.categoryIds ?? []).entries()) {
          if (c.categoryId === 'archived') {
            throw new DomainError('CATEGORY_ARCHIVED', 'archived').at(`/splits/${i}/categoryId`);
          }
        }
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
