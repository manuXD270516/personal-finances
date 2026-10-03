import type { AuditEntry, AuditPort } from '@pf/audit/contracts';
import { currency, DomainError, FixedClock, Instant, type Currency } from '@pf/shared-kernel';
import {
  LedgerAccount,
  type JournalEntry,
  type PeriodLock,
  type SourceRef,
  type SystemKind,
  type YearMonth,
} from '../../domain/index.js';
import type { LedgerDeps } from '../ports/index.js';

const CATALOG: Record<string, number> = { BOB: 2, USD: 2, USDT: 6, BTC: 8, ETH: 18 };

/**
 * Ledger en memoria para tests de aplicación: misma semántica observable que la implementación PostgreSQL
 * (append-only, idempotencia por origen, reversa única, bloqueo mensual) y "transacción" con rollback por copia.
 */
export class InMemoryLedger {
  accounts: LedgerAccount[] = [];
  entries: JournalEntry[] = [];
  reversals = new Map<string, string>();
  locks = new Map<string, PeriodLock>();
  events: {
    eventType: string;
    payload: Record<string, unknown>;
    workspaceId: string;
    correlationId?: string;
  }[] = [];
  audits: AuditEntry[] = [];
  actor: string | null = '0190a000-0000-7000-8000-0000000000b1';
  correlation: string | null = '0190a000-0000-7000-8000-0000000000c1';
  readonly clock = new FixedClock(Instant.parse('2026-03-10T15:00:00Z'));
  private seq = 0;
  private idSeq = 0;

  readonly auditPort: AuditPort = {
    append: async (entry) => {
      this.audits.push(entry);
    },
  };

  deps(): LedgerDeps {
    return {
      uow: {
        run: async <T>(_ws: string, fn: () => Promise<T>): Promise<T> => {
          const snapshot = {
            accounts: [...this.accounts],
            entries: [...this.entries],
            reversals: new Map(this.reversals),
            locks: new Map(this.locks),
            events: [...this.events],
            audits: [...this.audits],
          };
          try {
            return await fn();
          } catch (err) {
            Object.assign(this, snapshot);
            throw err;
          }
        },
      },
      currencies: {
        currencyOf: async (code: string): Promise<Currency> => {
          const scale = CATALOG[code];
          if (scale === undefined) throw new DomainError('REFERENCE_NOT_FOUND', `currency ${code} not found`);
          return currency(code, scale);
        },
      },
      accounts: {
        getOrCreateForUserAccount: async (input) => {
          const found = this.accounts.find(
            (a) => a.workspaceId === input.workspaceId && a.sourceAccountId === input.sourceAccountId,
          );
          if (found) return found;
          const created = LedgerAccount.forUserAccount({ id: this.newId(), ...input });
          this.accounts.push(created);
          return created;
        },
        getOrCreateSystem: async (input: { workspaceId: string; kind: SystemKind; currency: Currency }) => {
          const found = this.accounts.find(
            (a) =>
              a.workspaceId === input.workspaceId &&
              a.systemKind === input.kind &&
              a.currency.code === input.currency.code,
          );
          if (found) return found;
          const created = LedgerAccount.system({ id: this.newId(), ...input });
          this.accounts.push(created);
          return created;
        },
        findById: async (ws, id) => this.accounts.find((a) => a.workspaceId === ws && a.id === id) ?? null,
      },
      entries: {
        append: async (entry) => {
          if (this.locks.has(`${entry.workspaceId}|${entry.entryDate.toString().slice(0, 7)}`)) {
            throw new DomainError('PERIOD_CLOSED', 'PF004');
          }
          this.seq += 1;
          const saved = entry.withSequence(String(this.seq));
          this.entries.push(saved);
          return saved;
        },
        findById: async (ws, id) => this.entries.find((e) => e.workspaceId === ws && e.id === id) ?? null,
        findBySource: async (ws, source: SourceRef, type) =>
          this.entries.find(
            (e) =>
              e.workspaceId === ws &&
              e.entryType === type &&
              e.sourceRef.id === source.id &&
              e.sourceRef.type === source.type &&
              e.sourceRef.revision === source.revision,
          ) ?? null,
        isReversed: async (_ws, id) => this.reversals.has(id),
        recordReversal: async (_ws, original, reversal) => {
          if (this.reversals.has(original)) {
            throw new DomainError('LEDGER_ENTRY_ALREADY_REVERSED', `entry ${original} was already reversed`);
          }
          this.reversals.set(original, reversal);
        },
      },
      periods: {
        isLocked: async (ws, ym: YearMonth) => this.locks.has(`${ws}|${ym.value}`),
        lock: async (lock) => {
          const key = `${lock.workspaceId}|${lock.yearMonth.value}`;
          if (this.locks.has(key)) return false;
          this.locks.set(key, lock);
          return true;
        },
        unlock: async (ws, ym) => this.locks.delete(`${ws}|${ym.value}`),
      },
      outbox: {
        append: async (draft) => {
          this.events.push({
            eventType: draft.eventType,
            payload: JSON.parse(JSON.stringify(draft.payload)) as Record<string, unknown>,
            workspaceId: draft.workspaceId,
            ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
          });
        },
      },
      ids: { newId: () => this.newId() },
      clock: this.clock,
      context: { actorUserId: () => this.actor, correlationId: () => this.correlation },
    };
  }

  newId(): string {
    this.idSeq += 1;
    return `0190b000-0000-7000-8000-${this.idSeq.toString(16).padStart(12, '0')}`;
  }
}
