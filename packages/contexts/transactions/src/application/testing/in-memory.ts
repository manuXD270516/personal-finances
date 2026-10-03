import type { AuditEntry, AuditLogEntryDto } from '@pf/audit/contracts';
import type { PostingEligibilityDto } from '@pf/accounts/contracts';
import type { PostJournalEntryCommand, ReverseJournalEntryCommand } from '@pf/ledger/contracts';
import { DomainError, FixedClock, Instant, Money } from '@pf/shared-kernel';
import { Transaction, type TransactionState } from '../../domain/index.js';
import type { TransactionsDeps } from '../ports/index.js';

interface Entry {
  readonly id: string;
  readonly command: PostJournalEntryCommand | null;
  readonly reverses: string | null;
  readonly postings: readonly { readonly key: string; readonly amount: string }[];
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
  };
  const faults: { ledger?: Error; audit?: Error } = {};
  let depth = 0;

  const snapshot = () => ({
    txs: new Map(state.txs),
    links: [...state.links],
    entries: [...state.entries],
    outbox: [...state.outbox],
    audit: [...state.audit],
  });

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
      },
      async update(tx) {
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
          .filter((s) => !filter.statuses || filter.statuses.includes(s.status))
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
    },
    currencies: { scaleOf: async (code) => (code === 'BOB' || code === 'USD' ? 2 : null) },
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
        const sum = command.postings.reduce(
          (acc, p) => acc.add(Money.parse(p.amount.amount, 'BOB', 2)),
          Money.parse('0', 'BOB', 2),
        );
        if (!sum.isZero()) throw new DomainError('LEDGER_UNBALANCED_ENTRY', 'unbalanced');
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
            amount: Money.parse(p.amount, 'BOB', 2).negate().toFixed(),
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
    ids,
    clock: new FixedClock(Instant.parse('2026-10-01T12:00:00Z')),
  };

  /** Saldo contable de una cuenta (Σ postings de todos los asientos). */
  const balanceOf = (key: string): string =>
    Money.sum(
      state.entries.flatMap((e) =>
        e.postings.filter((p) => p.key === key).map((p) => Money.parse(p.amount, 'BOB', 2)),
      ),
      Money.parse('0', 'BOB', 2).currency,
    ).toFixed();

  return { deps, state, faults, balanceOf };
}
