import type {
  ManagedOccurrenceDto,
  RecurringDefinitionPort,
  RecurringDefinitionQuery,
} from '@pf/commitments/contracts';
import { FixedClock, Instant, LocalDate, WeekendAdjustment, dec } from '@pf/shared-kernel';
import type {
  AccountMovementRowDto,
  PendingFlowRowDto,
  TransactionLinkDto,
} from '@pf/transactions/contracts';
import { CardInstallmentPlan, CreditCard, type ThresholdState } from '../../domain/index.js';
import type {
  CardBalancePort,
  CardDeps,
  CardRepository,
  InstallmentPlanRepository,
  ReminderRepository,
  StatementRecord,
  StatementRepository,
  UtilizationRepository,
} from '../card-ports.js';
import type { AccountInfo } from '../ports/index.js';

export interface Entry {
  readonly accountId: string;
  readonly date: string;
  readonly cls: 'PURCHASE' | 'REFUND' | 'PAYMENT' | 'OTHER';
  /** Efecto firmado sobre lo adeudado. */
  readonly amount: string;
  readonly transactionId?: string;
}

export interface FakeOccurrence {
  key: string;
  status: ManagedOccurrenceDto['status'];
  expected: { type: string; amount: string | null };
  editedByUser: boolean;
  skipReason: string | null;
}

export interface FakeDefinition {
  id: string;
  managedRef: string;
  accountId: string;
  toAccountId: string;
  monthDays: number[];
  weekendAdjustment: 'NONE' | 'PREVIOUS' | 'NEXT';
  startDate: string;
  ended: boolean;
  occurrences: Map<string, FakeOccurrence>;
}

const SCALES: Record<string, number> = { BOB: 2, USD: 2 };
let counter = 0;

/**
 * Mundo en memoria para las pruebas de aplicación de tarjetas: un ledger mínimo (movimientos firmados por cuenta),
 * repositorios en memoria y un doble del puerto de definiciones recurrentes que registra las expectativas fijadas.
 */
export class CardWorld {
  readonly clock: FixedClock;
  readonly workspaceId = 'ws-1';
  readonly timeZone = 'America/La_Paz';
  readonly entries: Entry[] = [];
  readonly pending: PendingFlowRowDto[] = [];
  readonly outbox: { eventType: string; aggregateVersion: number; payload: Record<string, unknown> }[] = [];
  readonly audit: {
    action: string;
    changes: readonly { field: string; before: unknown; after: unknown }[];
  }[] = [];
  readonly rates = new Map<string, string>();
  readonly definitions = new Map<string, FakeDefinition>();
  readonly userTransfers: { definitionId: string; name: string; accountId: string }[] = [];
  readonly transactions = new Map<string, TransactionLinkDto>();
  readonly accounts: AccountInfo[] = [];
  readonly cardStore = new Map<string, CreditCard>();
  readonly statementStore: StatementRecord[] = [];
  readonly planStore = new Map<string, CardInstallmentPlan>();
  readonly stateStore: (ThresholdState & { scopeKey: string; cardId: string })[] = [];
  readonly reminderStore = new Set<string>();
  readonly calls: { method: string; input: unknown }[] = [];
  readonly deps: CardDeps;

  constructor(now = '2026-10-20T14:00:00.000Z') {
    this.clock = new FixedClock(Instant.parse(now));
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- los dobles de los repositorios leen el mundo
    const world = this;
    const ids = { next: () => `id-${(counter += 1)}` };

    const cards: CardRepository = {
      findById: async (_ws, id) => {
        const found = world.cardStore.get(id);
        return found ? CreditCard.restore(found.snapshot) : null;
      },
      insert: async (card) => {
        world.cardStore.set(card.id, CreditCard.restore(card.snapshot));
      },
      save: async (card) => {
        const current = world.cardStore.get(card.id);
        if (!current || current.version !== card.persistedVersion) return false;
        world.cardStore.set(card.id, CreditCard.restore(card.snapshot));
        return true;
      },
      list: async (_ws, filter) =>
        [...world.cardStore.values()]
          .filter((c) => !filter.status || c.status === filter.status)
          .map((c) => CreditCard.restore(c.snapshot)),
      activeCardsOfAccounts: async (_ws, accountIds) =>
        [...world.cardStore.values()]
          .filter((c) => c.status === 'ACTIVE')
          .flatMap((c) =>
            c.snapshot.accounts
              .filter((a) => accountIds.includes(a.accountId))
              .map((a) => ({ accountId: a.accountId, cardId: c.id })),
          ),
      activeAccountIndex: async () =>
        new Map(
          [...world.cardStore.values()]
            .filter((c) => c.status === 'ACTIVE')
            .flatMap((c) => c.snapshot.accounts.map((a) => [a.accountId, c.id] as const)),
        ),
      cardIdOfCardAccount: async (_ws, id) =>
        [...world.cardStore.values()].find((c) => c.snapshot.accounts.some((a) => a.id === id))?.id ?? null,
      activeCardIds: async () =>
        [...world.cardStore.values()].filter((c) => c.status === 'ACTIVE').map((c) => c.id),
    };

    const statements: StatementRepository = {
      insertIfAbsent: async (r) => {
        if (
          world.statementStore.some(
            (s) => s.cardAccountId === r.cardAccountId && s.closingDate === r.closingDate,
          )
        ) {
          return false;
        }
        world.statementStore.push(r);
        return true;
      },
      listForAccounts: async (_ws, ids) => world.statementStore.filter((s) => ids.includes(s.cardAccountId)),
      find: async (_ws, id) => world.statementStore.find((s) => s.id === id) ?? null,
      updateStatus: async (_ws, id, status) => {
        const i = world.statementStore.findIndex((s) => s.id === id);
        if (i >= 0) world.statementStore[i] = { ...(world.statementStore[i] as StatementRecord), status };
      },
      setReported: async (_ws, id, input) => {
        const i = world.statementStore.findIndex((s) => s.id === id);
        const cur = world.statementStore[i];
        if (!cur || cur.version !== input.expectedVersion) return false;
        world.statementStore[i] = {
          ...cur,
          reportedBilledBalance: input.billed,
          reportedMinimumDue: input.minimum,
          version: cur.version + 1,
        };
        return true;
      },
    };

    const plans: InstallmentPlanRepository = {
      insert: async (plan) => {
        world.planStore.set(plan.id, CardInstallmentPlan.restore(plan.snapshot));
        plan.markPersisted();
      },
      save: async (plan) => {
        world.planStore.set(plan.id, CardInstallmentPlan.restore(plan.snapshot));
        plan.markPersisted();
        return true;
      },
      findById: async (_ws, id) => {
        const p = world.planStore.get(id);
        return p ? CardInstallmentPlan.restore(p.snapshot) : null;
      },
      findByPurchase: async (_ws, txn) => {
        const p = [...world.planStore.values()].find(
          (x) => x.snapshot.purchaseTransactionId === txn && x.status !== 'CANCELLED',
        );
        return p ? CardInstallmentPlan.restore(p.snapshot) : null;
      },
      listForCardAccounts: async (_ws, ids) =>
        [...world.planStore.values()]
          .filter((p) => ids.includes(p.snapshot.cardAccountId))
          .map((p) => CardInstallmentPlan.restore(p.snapshot)),
    };

    const utilization: UtilizationRepository = {
      states: async (cardId) => world.stateStore.filter((s) => s.cardId === cardId),
      upsert: async (_ws, cardId, scopeKey, states) => {
        for (const s of states) {
          const i = world.stateStore.findIndex(
            (x) => x.cardId === cardId && x.scopeKey === scopeKey && x.threshold === s.threshold,
          );
          const row = { ...s, scopeKey, cardId };
          if (i >= 0) world.stateStore[i] = row;
          else world.stateStore.push(row);
        }
      },
      prune: async (_ws, cardId, keep) => {
        for (let i = world.stateStore.length - 1; i >= 0; i -= 1) {
          const s = world.stateStore[i] as (typeof world.stateStore)[number];
          if (
            s.cardId === cardId &&
            !keep.some((k) => k.scopeKey === s.scopeKey && k.threshold === s.threshold)
          ) {
            world.stateStore.splice(i, 1);
          }
        }
      },
      insertCrossing: async () => undefined,
    };

    const reminders: ReminderRepository = {
      insertIfAbsent: async (i) => {
        const key = `${i.cardAccountId}|${i.closingDate}`;
        if (world.reminderStore.has(key)) return false;
        world.reminderStore.add(key);
        return true;
      },
    };

    const balances: CardBalancePort = {
      at: async (_ws, accountId, dates) =>
        new Map(
          dates.map((d) => [
            d,
            world.entries
              .filter((e) => e.accountId === accountId && e.date <= d)
              .reduce((acc, e) => acc.plus(e.amount), dec('0'))
              .toFixed(SCALES[world.currencyOf(accountId)] ?? 2),
          ]),
        ),
      today: async () => new Map(),
    };

    const recurring: RecurringDefinitionPort = {
      createManaged: async (input) => {
        world.calls.push({ method: 'createManaged', input });
        if (!('monthlyRule' in input)) throw new Error('only monthly rules in this fake');
        const id = ids.next();
        world.definitions.set(id, {
          id,
          managedRef: input.managedRef,
          accountId: input.accountId,
          toAccountId: input.toAccountId,
          monthDays: [...input.monthlyRule.monthDays],
          weekendAdjustment: input.monthlyRule.weekendAdjustment,
          startDate: input.monthlyRule.startDate,
          ended: false,
          occurrences: new Map(),
        });
        world.ensureOccurrences(id);
        return { definitionId: id };
      },
      settle: async () => undefined,
      unsettle: async () => undefined,
      setExpected: async (input) => {
        world.calls.push({ method: 'setExpected', input });
        const occ = world.definitions.get(input.definitionId)?.occurrences.get(input.key);
        if (!occ) throw new Error(`no occurrence ${input.key}`);
        const e = input.expectation;
        occ.expected =
          !e || e.type === 'NONE'
            ? { type: 'VARIABLE', amount: null }
            : { type: e.type, amount: e.amount ?? null };
      },
      skip: async (input) => {
        world.calls.push({ method: 'skip', input });
        const occ = world.definitions.get(input.definitionId)?.occurrences.get(input.key);
        if (!occ) throw new Error(`no occurrence ${input.key}`);
        occ.status = 'SKIPPED';
        occ.skipReason = input.reason;
      },
      listOccurrences: async (input) => {
        world.ensureOccurrences(input.definitionId);
        const def = world.definitions.get(input.definitionId);
        return [...(def?.occurrences.values() ?? [])]
          .filter((o) => o.key >= input.from && o.key <= input.to)
          .map((o): ManagedOccurrenceDto => ({
            occurrenceId: `occ-${o.key}`,
            key: o.key,
            occurrenceDate: o.key,
            dueDate: o.key,
            status: o.status,
            expected: {
              type: o.expected.type as ManagedOccurrenceDto['expected']['type'],
              amount: o.expected.amount,
              min: null,
              max: null,
              currency: 'BOB',
            },
            transactionId: null,
            editedByUser: o.editedByUser,
            skipReason: o.skipReason,
          }));
      },
      end: async (input) => {
        world.calls.push({ method: 'end', input });
        const def = world.definitions.get(input.definitionId);
        if (def) def.ended = true;
      },
      revise: async (input) => {
        world.calls.push({ method: 'revise', input });
        const def = world.definitions.get(input.definitionId);
        if (def && input.monthDays) {
          def.monthDays = [...input.monthDays];
          // La revisión reescribe las no resueltas y descarta lo fijado por el administrador.
          def.occurrences.clear();
          if (input.weekendAdjustment) def.weekendAdjustment = input.weekendAdjustment;
          def.startDate = input.effectiveFrom;
          world.ensureOccurrences(def.id);
        }
      },
    };

    const recurringQuery: RecurringDefinitionQuery = {
      listActiveTransfersTo: async (input) =>
        world.userTransfers
          .filter((t) => t.accountId === input.accountId)
          .map((t) => ({ definitionId: t.definitionId, name: t.name })),
    };

    this.deps = {
      uow: { run: (_ws, fn) => fn() },
      cards,
      statements,
      plans,
      utilization,
      reminders,
      accounts: {
        find: async (_ws, ids2) => world.accounts.filter((a) => ids2.includes(a.accountId)),
        assertCanPost: async () => undefined,
      },
      balances,
      movements: {
        summarizeAccountMovements: async (input) =>
          world.entries
            .filter(
              (e) =>
                input.accountIds.includes(e.accountId) && e.date >= input.dateFrom && e.date <= input.dateTo,
            )
            .map((e): AccountMovementRowDto => ({
              accountId: e.accountId,
              businessDate: e.date,
              movementClass: e.cls,
              systemCategoryCode: null,
              transactionId: e.transactionId ?? null,
              amount: { amount: e.amount, currency: world.currencyOf(e.accountId) },
            })),
      },
      pending: {
        listPending: async (input) =>
          world.pending.filter((p) => !input.accountIds || input.accountIds.includes(p.accountId)),
      },
      links: {
        getForLink: async (input) => world.transactions.get(input.transactionId) ?? null,
        getManyForLink: async (input) =>
          input.transactionIds
            .map((id) => world.transactions.get(id))
            .filter((t): t is TransactionLinkDto => !!t),
        listLinkCandidates: async () => [],
      },
      recurring,
      recurringQuery,
      rates: {
        resolveValuationRates: async (input) =>
          input.requests.map((r) => {
            const v = world.rates.get(`${r.base}/${r.quote}`);
            if (!v) return null;
            return {
              resolved: { base: r.base, quote: r.quote, value: v } as never,
              exact: { base: r.base, quote: r.quote, value: v },
            };
          }),
      },
      calendar: { timeZoneOf: async () => world.timeZone },
      currencies: { scaleOf: async (code) => SCALES[code] ?? null },
      audit: {
        append: async (entry) => {
          world.audit.push({ action: entry.action, changes: entry.changes ?? [] });
        },
      },
      outbox: {
        append: async (e) => {
          world.outbox.push({
            eventType: e.eventType,
            aggregateVersion: e.aggregateVersion,
            payload: e.payload as Record<string, unknown>,
          });
        },
      },
      ids,
      clock: this.clock,
      settings: { rateValidityWindowDays: 7, historyCycles: 12, planHorizonDays: 90 },
    };
  }

  currencyOf(accountId: string): string {
    return this.accounts.find((a) => a.accountId === accountId)?.currency ?? 'BOB';
  }

  addAccount(accountId: string, name: string, type: string, currency: string): void {
    this.accounts.push({
      accountId,
      name,
      type,
      nature: type === 'CREDIT_CARD' ? 'LIABILITY' : 'ASSET',
      currency,
      status: 'ACTIVE',
    });
  }

  /** Mueve el reloj a un instante UTC. */
  setNow(iso: string): void {
    this.clock.set(Instant.parse(iso));
  }

  /** Genera (idempotente) las ocurrencias mensuales de una definición para los próximos 8 meses. */
  ensureOccurrences(definitionId: string): void {
    const def = this.definitions.get(definitionId);
    if (!def || def.ended) return;
    const start = LocalDate.parse(def.startDate);
    for (let i = 0; i < 9; i += 1) {
      const idx = start.year * 12 + (start.month - 1) + i;
      const year = Math.floor(idx / 12);
      const month = (idx % 12) + 1;
      const nominal = LocalDate.of(
        year,
        month,
        Math.min(def.monthDays[0] as number, LocalDate.daysInMonth(year, month)),
      );
      if (nominal.compare(start) < 0) continue;
      const key = nominal.toString();
      if (!def.occurrences.has(key)) {
        def.occurrences.set(key, {
          key,
          status: 'SCHEDULED',
          expected: { type: 'VARIABLE', amount: null },
          editedByUser: false,
          skipReason: null,
        });
      }
    }
    void WeekendAdjustment;
  }

  addEntry(entry: Entry): void {
    this.entries.push(entry);
  }

  occurrence(definitionId: string, key: string): FakeOccurrence {
    return this.definitions.get(definitionId)?.occurrences.get(key) as FakeOccurrence;
  }
}
