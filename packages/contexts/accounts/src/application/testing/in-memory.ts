import type {
  AuditEntry,
  AuditPort,
  LifecyclePort,
  LifecycleQuery,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import type { AccountOpeningBalancePort, MoneyDto } from '../../contracts/index.js';
import { ACCOUNT_LIFECYCLE, Account, Institution } from '../../domain/index.js';
import type {
  AccountListFilter,
  AccountRepository,
  AccountsDeps,
  CurrencyInfo,
  InstitutionListFilter,
  InstitutionRepository,
  LedgerAccountBalance,
  OutboxPort,
} from '../ports/index.js';

type Event = Parameters<OutboxPort['append']>[0];

/**
 * Dobles en memoria para los tests de aplicación. La "transacción" se simula con snapshots: si el caso de uso lanza,
 * se restauran cuentas, instituciones, eventos, auditoría y asientos (atomicidad de la unidad de trabajo).
 */
export class InMemoryAccounts {
  readonly accounts = new Map<string, Account>();
  readonly institutions = new Map<string, Institution>();
  readonly events: Event[] = [];
  readonly audits: AuditEntry[] = [];
  /** Pasos del recorrido registrados por `LifecyclePort` (en orden; con su acción de auditoría). */
  readonly lifecycleSteps: (LifecycleStepInput & {
    aggregateId: string;
    action: string;
    reason: string | null;
  })[] = [];
  /** Saldo contable (Σ postings) por cuenta; presencia = la cuenta tiene ledger account / movimientos. */
  readonly ledger = new Map<string, MoneyDto & { nature: 'ASSET' | 'LIABILITY' }>();
  readonly openingEntries: { accountId: string; amount: MoneyDto; nature: string; date: string }[] = [];
  readonly clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
  private seq = 0;
  failOpening: DomainError | null = null;
  readonly currencies = new Map<string, CurrencyInfo>([
    ['BOB', { code: 'BOB', kind: 'FIAT', scale: 2, active: true }],
    ['USD', { code: 'USD', kind: 'FIAT', scale: 2, active: true }],
    ['USDT', { code: 'USDT', kind: 'CRYPTO', scale: 6, active: true }],
    ['BTC', { code: 'BTC', kind: 'CRYPTO', scale: 8, active: true }],
    ['EUR', { code: 'EUR', kind: 'FIAT', scale: 2, active: false }],
  ]);

  readonly audit: AuditPort = { append: async (e) => void this.audits.push(e) };

  /** Doble de `LifecyclePort`: auditoría + pasos (comparten el rollback de la unidad de trabajo). */
  readonly lifecycle: LifecyclePort = {
    record: async (entry, steps) => {
      await this.audit.append(entry);
      for (const step of steps) {
        this.lifecycleSteps.push({
          ...step,
          aggregateId: step.aggregateId ?? entry.aggregateId,
          action: entry.action,
          reason: step.kind === 'TRANSITION' ? (step.reason ?? entry.reason ?? null) : null,
        });
      }
    },
  };

  /** Doble de `LifecycleQuery` sobre los pasos registrados. */
  readonly lifecycleQuery: LifecycleQuery = {
    machineOf: () => ACCOUNT_LIFECYCLE.definition,
    lifecycleOf: async (input) => {
      const own = this.lifecycleSteps.filter((s) => s.aggregateId === input.aggregateId);
      return {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        currentState: input.currentState,
        path: own.flatMap((s) => (s.kind === 'TRANSITION' ? [s.toState] : [])),
        historyComplete: own.find((s) => s.kind === 'TRANSITION')?.fromState === null,
        machine: ACCOUNT_LIFECYCLE.definition,
        items: own.map((s, i) =>
          s.kind === 'TRANSITION'
            ? {
                sequence: i + 1,
                kind: 'TRANSITION' as const,
                transition: s.transition,
                fromState: s.fromState,
                toState: s.toState,
                machineVersion: s.machineVersion,
                occurredAt: '2026-03-15T14:00:00.000Z',
                actor: { type: 'USER' as const, id: input.userId, displayName: null },
                origin: 'api' as const,
                reason: s.reason,
                revisionFrom: null,
                revisionTo: null,
                aggregateVersion: null,
                journalEntries: {
                  reversed: null,
                  reversal: null,
                  posted: s.journalEntries?.posted ?? null,
                },
                detailRefs: {},
                events: (s.events ?? []).map((e) => e.eventType),
                auditLogId: null,
                derived: false,
              }
            : {
                sequence: i + 1,
                kind: 'ANNOTATION' as const,
                occurredAt: '2026-03-15T14:00:00.000Z',
                actor: { type: 'USER' as const, id: input.userId, displayName: null },
                origin: 'api' as const,
                changedFields: [...s.changedFields],
                revisionFrom: null,
                revisionTo: null,
                aggregateVersion: null,
                events: (s.events ?? []).map((e) => e.eventType),
                auditLogId: null,
                derived: false,
              },
        ),
      };
    },
  };

  deps(): AccountsDeps {
    const accounts = this.accountRepo();
    const institutions = this.institutionRepo();
    const opening: AccountOpeningBalancePort = {
      recordOpeningBalance: async (input) => {
        if (this.failOpening) throw this.failOpening;
        const signed =
          input.nature === 'LIABILITY'
            ? { ...input.amount, amount: negate(input.amount.amount) }
            : input.amount;
        this.ledger.set(input.accountId, { ...signed, nature: input.nature });
        this.openingEntries.push({ ...input });
        return { journalEntryId: `je-${input.accountId}` };
      },
    };
    return {
      uow: {
        run: async (_ws, fn) => {
          const snap = this.snapshot();
          try {
            return await fn();
          } catch (err) {
            this.restore(snap);
            throw err;
          }
        },
      },
      accounts,
      institutions,
      currencies: { find: async (code) => this.currencies.get(code) ?? null },
      balances: {
        balancesOf: async (_ws, ids) => {
          const out = new Map<string, LedgerAccountBalance>();
          for (const id of ids) {
            const b = this.ledger.get(id);
            if (!b) continue;
            const balance = { amount: b.amount, currency: b.currency };
            out.set(id, {
              balance,
              presented: b.nature === 'LIABILITY' ? { ...balance, amount: negate(b.amount) } : balance,
            });
          }
          return out;
        },
      },
      tags: { assertAssignable: async () => undefined },
      openingBalance: opening,
      outbox: { append: async (e) => void this.events.push(e) },
      audit: this.audit,
      lifecycle: this.lifecycle,
      lifecycleQuery: this.lifecycleQuery,
      ids: { next: () => `00000000-0000-7000-8000-${String(++this.seq).padStart(12, '0')}` },
      clock: this.clock,
      calendar: { today: async () => '2026-03-15' },
    };
  }

  private snapshot() {
    return {
      accounts: new Map([...this.accounts].map(([k, v]) => [k, Account.restore(v.snapshot)])),
      institutions: new Map([...this.institutions].map(([k, v]) => [k, Institution.restore(v.snapshot)])),
      events: this.events.length,
      audits: this.audits.length,
      ledger: new Map(this.ledger),
      opening: this.openingEntries.length,
    };
  }

  private restore(s: ReturnType<InMemoryAccounts['snapshot']>): void {
    this.accounts.clear();
    for (const [k, v] of s.accounts) this.accounts.set(k, v);
    this.institutions.clear();
    for (const [k, v] of s.institutions) this.institutions.set(k, v);
    this.events.length = s.events;
    this.audits.length = s.audits;
    this.ledger.clear();
    for (const [k, v] of s.ledger) this.ledger.set(k, v);
    this.openingEntries.length = s.opening;
  }

  private accountRepo(): AccountRepository {
    const nameTaken = (a: Account) =>
      [...this.accounts.values()].some(
        (o) =>
          o.id !== a.id &&
          o.workspaceId === a.workspaceId &&
          o.status !== 'ARCHIVED' &&
          a.status !== 'ARCHIVED' &&
          o.snapshot.name.toLowerCase() === a.snapshot.name.toLowerCase(),
      );
    const fresh = (a: Account) => Account.restore(a.snapshot);
    return {
      insert: async (a) => {
        if (nameTaken(a)) throw new DomainError('ACCOUNT_NAME_TAKEN', 'name taken').at('/name');
        this.accounts.set(a.id, fresh(a));
      },
      update: async (a) => {
        const cur = this.accounts.get(a.id);
        if (!cur || cur.version !== a.persistedVersion) return false;
        if (nameTaken(a)) throw new DomainError('ACCOUNT_NAME_TAKEN', 'name taken').at('/name');
        this.accounts.set(a.id, fresh(a));
        return true;
      },
      findById: async (ws, id) => {
        const a = this.accounts.get(id);
        return a && a.workspaceId === ws ? fresh(a) : null;
      },
      list: async (ws, f: AccountListFilter) =>
        [...this.accounts.values()]
          .filter(
            (a) =>
              a.workspaceId === ws &&
              f.statuses.includes(a.status) &&
              (!f.types || f.types.includes(a.type)) &&
              (!f.currencies || f.currencies.includes(a.currency)) &&
              (!f.institutionId || a.snapshot.institutionId === f.institutionId) &&
              (!f.tagId || a.snapshot.tagIds.includes(f.tagId)) &&
              (!f.liquidities || f.liquidities.includes(a.snapshot.liquidity)),
          )
          .map(fresh),
      listAllForUpdate: async (ws) =>
        [...this.accounts.values()]
          .filter((a) => a.workspaceId === ws)
          .sort((x, y) => x.snapshot.displayOrder - y.snapshot.displayOrder)
          .map(fresh),
      nextDisplayOrder: async (ws) => [...this.accounts.values()].filter((a) => a.workspaceId === ws).length,
      lockForPosting: async (ws, ids) =>
        ids.flatMap((id) => {
          const a = this.accounts.get(id);
          return a && a.workspaceId === ws ? [fresh(a)] : [];
        }),
    };
  }

  private institutionRepo(): InstitutionRepository {
    const taken = (i: Institution) =>
      [...this.institutions.values()].some(
        (o) =>
          o.id !== i.id &&
          o.snapshot.workspaceId === i.snapshot.workspaceId &&
          !o.isArchived &&
          !i.isArchived &&
          o.snapshot.name.toLowerCase() === i.snapshot.name.toLowerCase(),
      );
    const fresh = (i: Institution) => Institution.restore(i.snapshot);
    return {
      insert: async (i) => {
        if (taken(i)) throw new DomainError('NAME_TAKEN', 'name taken').at('/name');
        this.institutions.set(i.id, fresh(i));
      },
      update: async (i) => {
        const cur = this.institutions.get(i.id);
        if (!cur || cur.version !== i.persistedVersion) return false;
        if (taken(i)) throw new DomainError('NAME_TAKEN', 'name taken').at('/name');
        this.institutions.set(i.id, fresh(i));
        return true;
      },
      findById: async (ws, id) => {
        const i = this.institutions.get(id);
        return i && i.snapshot.workspaceId === ws ? fresh(i) : null;
      },
      list: async (ws, f: InstitutionListFilter) =>
        [...this.institutions.values()]
          .filter(
            (i) =>
              i.snapshot.workspaceId === ws &&
              (f.includeArchived || !i.isArchived) &&
              (!f.kinds || f.kinds.includes(i.snapshot.kind)) &&
              (!f.query || i.snapshot.name.toLowerCase().includes(f.query.toLowerCase())),
          )
          .map(fresh),
    };
  }
}

function negate(amount: string): string {
  if (/^-?0(\.0*)?$/.test(amount)) return amount.replace('-', '');
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}
