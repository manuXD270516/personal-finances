import type { AccountSummaryDto, PostingEligibilityDto } from '@pf/accounts/contracts';
import type { AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import type { ValuationRateDto, WorkspaceCurrencyDto } from '@pf/fx/contracts';
import { DomainError, FixedClock, Instant, LocalDate } from '@pf/shared-kernel';
import type {
  PendingFlowRowDto,
  RecurringTransactionPort,
  TransactionLinkDto,
} from '@pf/transactions/contracts';
import {
  MatchSuggestion,
  RecurringDefinition,
  RecurringOccurrence,
  isUnresolved,
  type DefinitionState,
  type DefinitionVersion,
  type ExistingOccurrence,
  type OccurrenceState,
  type OccurrenceStatus,
  type SuggestionState,
} from '../../domain/index.js';
import type {
  CommitmentsDeps,
  DefinitionFilter,
  DefinitionListRow,
  DefinitionRepository,
  FinancialPeriodView,
  MatchOccurrenceRow,
  MatchSuggestionRepository,
  OccurrenceFilter,
  OccurrenceRepository,
  OccurrenceView,
  ResolvedOutflowRow,
} from '../ports/index.js';

export const WS = '0190a000-0000-7000-8000-00000000a001';
export const USER = '0190a000-0000-7000-8000-0000000b0001';
export const BANK = '0190a000-0000-7000-8000-0000000acc01';
export const CASH = '0190a000-0000-7000-8000-0000000acc02';
export const SAVINGS = '0190a000-0000-7000-8000-0000000acc03';
export const CARD = '0190a000-0000-7000-8000-0000000acc04';
export const USD_BANK = '0190a000-0000-7000-8000-0000000acc05';
/** add-subscriptions: tarjeta en USD y billetera USDT (la tarjeta en BOB es `CARD`). */
export const VISA_USD = '0190a000-0000-7000-8000-0000000acc06';
export const WALLET_USDT = '0190a000-0000-7000-8000-0000000acc07';
export const CATEGORY = '0190a000-0000-7000-8000-0000000ca701';
export const ARCHIVED_CATEGORY = '0190a000-0000-7000-8000-0000000ca702';

export interface Recorded {
  readonly entry: AuditEntry;
  readonly steps: readonly LifecycleStepInput[];
}

export interface FakeTransaction extends TransactionLinkDto {
  readonly occurrenceId: string | null;
  readonly description: string;
}

/** Dobles en memoria de los puertos de COMMITMENTS (misma semántica que las tablas: estados persistidos, no instancias). */
export class InMemoryCommitments {
  readonly clock = new FixedClock(Instant.parse('2026-10-09T16:00:00Z'));
  readonly events: {
    eventType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
  }[] = [];
  readonly recorded: Recorded[] = [];
  readonly transactionsStore = new Map<string, FakeTransaction>();
  readonly recordCalls: Parameters<RecurringTransactionPort['record']>[0][] = [];
  /** Errores a lanzar al crear transacciones (clave: fecha de negocio `YYYY-MM-DD`, o `*`). */
  readonly closedMonths = new Set<string>();
  failRecordWith: DomainError | null = null;
  /** Intentos de crear transacciones (no se revierten con la unidad de trabajo). */
  recordAttempts = 0;
  readonly archivedCategories = new Set<string>([ARCHIVED_CATEGORY]);
  readonly rateTable = new Map<string, string>();
  timeZone = 'America/La_Paz';
  baseCurrency = 'BOB';
  private seq = 0;
  /** Ganchos de extensiones (suscripciones): cada uno toma su instantánea y devuelve cómo revertirla. */
  protected readonly extensions: (() => () => void)[] = [];
  protected definitionsMap = new Map<string, { state: DefinitionState; versions: DefinitionVersion[] }>();
  protected occurrencesMap = new Map<string, OccurrenceState>();
  protected suggestionsMap = new Map<string, SuggestionState>();
  readonly accountList: AccountSummaryDto[] = [
    account(BANK, 'Banco BOB', 'BANK', 'ASSET', 'BOB', 'LIQUID'),
    account(CASH, 'Efectivo', 'CASH', 'ASSET', 'BOB', 'LIQUID'),
    account(SAVINGS, 'Ahorro BOB', 'SAVINGS', 'ASSET', 'BOB', 'SEMI_LIQUID'),
    account(CARD, 'Tarjeta X', 'CREDIT_CARD', 'LIABILITY', 'BOB', 'ILLIQUID'),
    account(USD_BANK, 'Banco USD', 'BANK', 'ASSET', 'USD', 'LIQUID'),
    account(VISA_USD, 'Visa USD', 'CREDIT_CARD', 'LIABILITY', 'USD', 'ILLIQUID'),
    account(WALLET_USDT, 'Wallet USDT', 'CRYPTO_WALLET', 'ASSET', 'USDT', 'LIQUID'),
  ];

  // ─────────────────────────────────────────────── puertos

  readonly definitions: DefinitionRepository = {
    insert: async (def) => {
      const s = def.snapshot;
      this.definitionsMap.set(s.id, { state: s, versions: [...def.versions] });
      def.markPersisted();
    },
    findById: async (workspaceId, id) => {
      const row = this.definitionsMap.get(id);
      return row && row.state.workspaceId === workspaceId
        ? RecurringDefinition.restore(row.state, row.versions)
        : null;
    },
    save: async (def) => {
      const row = this.definitionsMap.get(def.id);
      if (!row || row.state.version !== def.persistedVersion) return false;
      row.state = def.snapshot;
      row.versions.push(...def.addedVersions);
      def.markPersisted();
      return true;
    },
    list: async (workspaceId, filter) => this.listDefinitions(workspaceId, filter),
    idsNeedingWork: async (workspaceId) =>
      [...this.definitionsMap.values()]
        .filter(
          (r) =>
            r.state.workspaceId === workspaceId &&
            (r.state.status === 'ACTIVE' ||
              [...this.occurrencesMap.values()].some(
                (o) => o.definitionId === r.state.id && (o.status === 'SCHEDULED' || o.status === 'DUE'),
              )),
        )
        .map((r) => r.state.id),
    hasActive: async (workspaceId) =>
      [...this.definitionsMap.values()].some(
        (r) => r.state.workspaceId === workspaceId && r.state.status === 'ACTIVE',
      ),
    listActiveTransfersTo: async (workspaceId, accountId) =>
      [...this.definitionsMap.values()]
        .filter((r) => {
          const current = r.versions.find((v) => v.versionNo === r.state.currentVersionNo);
          return (
            r.state.workspaceId === workspaceId &&
            r.state.status === 'ACTIVE' &&
            r.state.managedBy === 'USER' &&
            r.state.kind === 'TRANSFER' &&
            current?.toAccountId === accountId
          );
        })
        .sort((a, b) => a.state.name.toLowerCase().localeCompare(b.state.name.toLowerCase()))
        .map((r) => ({ definitionId: r.state.id, name: r.state.name })),
  };

  readonly occurrences: OccurrenceRepository = {
    insertIfAbsent: async (list) => {
      const inserted: RecurringOccurrence[] = [];
      for (const occ of list) {
        const s = occ.snapshot;
        const taken = [...this.occurrencesMap.values()].some(
          (o) => o.definitionId === s.definitionId && o.occurrenceDate === s.occurrenceDate,
        );
        if (taken) continue;
        this.occurrencesMap.set(s.id, s);
        occ.markPersisted();
        inserted.push(occ);
      }
      return inserted;
    },
    findById: async (workspaceId, id) => {
      const s = this.occurrencesMap.get(id);
      return s && s.workspaceId === workspaceId ? RecurringOccurrence.restore(s) : null;
    },
    save: async (occ) => {
      const stored = this.occurrencesMap.get(occ.id);
      if (!stored || stored.version !== occ.persistedVersion) return false;
      const next = occ.snapshot;
      if (
        next.transactionId &&
        !next.sharesTransaction &&
        [...this.occurrencesMap.values()].some(
          (o) =>
            o.id !== next.id &&
            o.transactionId === next.transactionId &&
            (o.status === 'MATERIALIZED' || o.status === 'MATCHED'),
        )
      ) {
        throw new DomainError('TRANSACTION_ALREADY_LINKED', 'transaction already linked');
      }
      this.occurrencesMap.set(occ.id, next);
      occ.markPersisted();
      return true;
    },
    findByTransaction: async (workspaceId, transactionId) => {
      const s = [...this.occurrencesMap.values()].find(
        (o) =>
          o.workspaceId === workspaceId &&
          o.transactionId === transactionId &&
          (o.status === 'MATERIALIZED' || o.status === 'MATCHED'),
      );
      return s ? RecurringOccurrence.restore(s) : null;
    },
    listForDefinition: async (_ws, definitionId, options = {}) =>
      this.sorted([...this.occurrencesMap.values()])
        .filter(
          (o) =>
            o.definitionId === definitionId &&
            (!options.from || o.occurrenceDate >= options.from) &&
            (!options.statuses || options.statuses.includes(o.status)),
        )
        .map((s) => RecurringOccurrence.restore(s)),
    listExisting: async (_ws, definitionId, from) =>
      this.sorted([...this.occurrencesMap.values()])
        .filter((o) => o.definitionId === definitionId && (!from || o.occurrenceDate >= from))
        .map((o): ExistingOccurrence => o),
    list: async (workspaceId, filter) => this.listViews(workspaceId, filter),
    findView: async (_ws, id) => {
      const s = this.occurrencesMap.get(id);
      return s ? this.viewOf(s) : null;
    },
    listUnresolvedInRange: async (workspaceId, from, to) =>
      this.listViews(workspaceId, { statuses: ['SCHEDULED', 'DUE', 'OVERDUE'], dueFrom: from, dueTo: to }),
    listUnresolvedBefore: async (workspaceId, before) => {
      const day = LocalDate.parse(before).plusDays(-1).toString();
      return this.listViews(workspaceId, { statuses: ['SCHEDULED', 'DUE', 'OVERDUE'], dueTo: day });
    },
    listResolvedOutflows: async (_ws, from, to): Promise<ResolvedOutflowRow[]> =>
      this.sorted([...this.occurrencesMap.values()])
        .filter(
          (o) =>
            (o.status === 'MATERIALIZED' || o.status === 'MATCHED') &&
            o.dueDate >= from &&
            o.dueDate <= to &&
            this.definitionsMap.get(o.definitionId)?.state.kind !== 'LOAN_PAYMENT',
        )
        .map((o) => ({
          occurrenceId: o.id,
          definitionId: o.definitionId,
          definitionName: this.definitionsMap.get(o.definitionId)?.state.name ?? '',
          generatedAt: o.createdAt,
          resolution: o.status === 'MATCHED' ? ('MATCHED' as const) : ('MATERIALIZED' as const),
          matchedBy: o.matchedBy,
          transactionId: o.transactionId as string,
          currency: o.currency,
        })),
    lastResolvedNominal: async (_ws, definitionId) =>
      this.sorted([...this.occurrencesMap.values()])
        .filter(
          (o) => o.definitionId === definitionId && ['MATERIALIZED', 'MATCHED', 'SKIPPED'].includes(o.status),
        )
        .at(-1)?.occurrenceDate ?? null,
  };

  readonly matching: MatchSuggestionRepository = {
    insertIfAbsent: async (suggestion) => {
      const s = suggestion.snapshot;
      const taken = [...this.suggestionsMap.values()].some(
        (x) => x.occurrenceId === s.occurrenceId && x.transactionId === s.transactionId,
      );
      if (taken) return false;
      this.suggestionsMap.set(s.id, s);
      suggestion.markPersisted();
      return true;
    },
    findById: async (workspaceId, id) => {
      const s = this.suggestionsMap.get(id);
      return s && s.workspaceId === workspaceId ? MatchSuggestion.restore(s) : null;
    },
    save: async (suggestion) => {
      const stored = this.suggestionsMap.get(suggestion.id);
      if (!stored || stored.version !== suggestion.persistedVersion) return false;
      this.suggestionsMap.set(suggestion.id, suggestion.snapshot);
      suggestion.markPersisted();
      return true;
    },
    listByTransaction: async (workspaceId, transactionId) =>
      [...this.suggestionsMap.values()]
        .filter((s) => s.workspaceId === workspaceId && s.transactionId === transactionId)
        .map((s) => MatchSuggestion.restore(s)),
    listByOccurrences: async (workspaceId, occurrenceIds) =>
      [...this.suggestionsMap.values()]
        .filter((s) => s.workspaceId === workspaceId && occurrenceIds.includes(s.occurrenceId))
        .map((s) => MatchSuggestion.restore(s)),
    expireForOccurrences: async (workspaceId, occurrenceIds, reason, options = {}) =>
      this.expireWhere(
        (s) =>
          s.workspaceId === workspaceId &&
          occurrenceIds.includes(s.occurrenceId) &&
          s.id !== options.exceptId,
        reason,
      ),
    expireForTransaction: async (workspaceId, transactionId, reason, options = {}) =>
      this.expireWhere(
        (s) =>
          s.workspaceId === workspaceId && s.transactionId === transactionId && s.id !== options.exceptId,
        reason,
      ),
    list: async (workspaceId, filter) => {
      let rows = [...this.suggestionsMap.values()].filter(
        (s) =>
          s.workspaceId === workspaceId &&
          (!filter.statuses || filter.statuses.includes(s.status)) &&
          (!filter.occurrenceId || s.occurrenceId === filter.occurrenceId) &&
          (!filter.transactionId || s.transactionId === filter.transactionId) &&
          (!filter.definitionId || s.definitionId === filter.definitionId),
      );
      rows.sort((a, b) => {
        const byScore = Number(b.score) - Number(a.score);
        return byScore !== 0 ? byScore : a.id < b.id ? -1 : 1;
      });
      if (filter.after) {
        const [score, id] = filter.after;
        rows = rows.filter(
          (s) => Number(s.score) < Number(score) || (Number(s.score) === Number(score) && s.id > id),
        );
      }
      return (filter.limit ? rows.slice(0, filter.limit) : rows).map((s) => MatchSuggestion.restore(s));
    },
    countProposed: async (workspaceId) =>
      [...this.suggestionsMap.values()].filter(
        (s) => s.workspaceId === workspaceId && s.status === 'PROPOSED',
      ).length,
    candidateOccurrences: async (workspaceId, input) =>
      [...this.occurrencesMap.values()]
        .filter(
          (o) =>
            o.workspaceId === workspaceId &&
            ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status) &&
            o.dueDate >= input.from &&
            o.dueDate <= input.to,
        )
        .map((o) => this.matchRowOf(o))
        .filter(
          (r) =>
            (r.occurrence.kind === input.kind ||
              (input.kind === 'TRANSFER' && r.occurrence.kind === 'CARD_PAYMENT')) &&
            r.occurrence.accountId === input.accountId &&
            (input.kind !== 'TRANSFER' || r.occurrence.toAccountId === input.toAccountId),
        )
        .sort((a, b) => a.occurrence.dueDate.localeCompare(b.occurrence.dueDate)),
    occurrencesByIds: async (workspaceId, ids) =>
      ids
        .map((id) => this.occurrencesMap.get(id))
        .filter(
          (o): o is OccurrenceState =>
            !!o &&
            o.workspaceId === workspaceId &&
            this.definitionsMap.get(o.definitionId)?.state.kind !== 'LOAN_PAYMENT',
        )
        .map((o) => this.matchRowOf(o)),
    linkedTransactionIds: async (workspaceId, transactionIds) =>
      new Set(
        [...this.occurrencesMap.values()]
          .filter(
            (o) =>
              o.workspaceId === workspaceId &&
              (o.status === 'MATERIALIZED' || o.status === 'MATCHED') &&
              o.transactionId !== null &&
              transactionIds.includes(o.transactionId),
          )
          .map((o) => o.transactionId as string),
      ),
  };

  readonly transactions: RecurringTransactionPort = {
    record: async (input) => {
      this.recordAttempts += 1;
      this.recordCalls.push(input);
      if (this.failRecordWith) throw this.failRecordWith;
      if (this.closedMonths.has(input.businessDate.slice(0, 7))) {
        throw new DomainError('PERIOD_CLOSED', `period ${input.businessDate.slice(0, 7)} is closed`);
      }
      const dup = [...this.transactionsStore.values()].find(
        (t) => t.externalRef?.id === input.occurrenceRef.occurrenceId,
      );
      if (dup) throw new DomainError('TRANSACTION_ALREADY_LINKED', 'duplicated externalRef');
      const id = this.id();
      this.transactionsStore.set(id, {
        transactionId: id,
        kind: input.kind,
        status: input.status,
        businessDate: input.businessDate,
        amount: input.amount,
        accountId: input.accountId,
        toAccountId: input.toAccountId ?? null,
        counterpartyId: input.counterpartyId ?? null,
        source: 'RECURRING',
        externalRef: { namespace: 'commitments.occurrence', id: input.occurrenceRef.occurrenceId },
        occurrenceId: input.occurrenceRef.occurrenceId,
        description: input.description,
      });
      return { transactionId: id, status: input.status, businessDate: input.businessDate };
    },
  };

  /** Registra una transacción manual (para vincular, anular o contar como pendiente). */
  addTransaction(
    t: Partial<FakeTransaction> & Pick<FakeTransaction, 'amount' | 'accountId' | 'kind'>,
  ): string {
    const id = t.transactionId ?? this.id();
    this.transactionsStore.set(id, {
      transactionId: id,
      status: 'POSTED',
      businessDate: '2026-10-19',
      toAccountId: null,
      counterpartyId: null,
      source: 'MANUAL',
      externalRef: null,
      occurrenceId: null,
      description: 'manual',
      ...t,
    });
    return id;
  }

  readonly links = {
    getForLink: async ({ transactionId }: { workspaceId: string; transactionId: string }) =>
      this.transactionsStore.get(transactionId) ?? null,
    getManyForLink: async ({ transactionIds }: { workspaceId: string; transactionIds: readonly string[] }) =>
      transactionIds.map((id) => this.transactionsStore.get(id)).filter((t): t is FakeTransaction => !!t),
    listLinkCandidates: async (input: {
      workspaceId: string;
      accountIds: readonly string[];
      from: string;
      to: string;
    }): Promise<readonly FakeTransaction[]> =>
      [...this.transactionsStore.values()]
        .filter(
          (t) =>
            t.status !== 'VOIDED' &&
            ['INCOME', 'EXPENSE', 'TRANSFER'].includes(t.kind) &&
            input.accountIds.includes(t.accountId) &&
            t.businessDate >= input.from &&
            t.businessDate <= input.to,
        )
        .sort((a, b) =>
          a.businessDate === b.businessDate
            ? a.transactionId < b.transactionId
              ? -1
              : 1
            : a.businessDate < b.businessDate
              ? -1
              : 1,
        ),
  };

  readonly pending = {
    listPending: async (input: {
      workspaceId: string;
      dateFrom?: string;
      dateTo?: string;
    }): Promise<PendingFlowRowDto[]> =>
      [...this.transactionsStore.values()]
        .filter(
          (t) =>
            t.status === 'PENDING' &&
            (!input.dateFrom || t.businessDate >= input.dateFrom) &&
            (!input.dateTo || t.businessDate <= input.dateTo),
        )
        .map((t) => ({
          transactionId: t.transactionId,
          kind: t.kind,
          businessDate: t.businessDate,
          accountId: t.accountId,
          toAccountId: t.toAccountId,
          direction: t.kind === 'INCOME' ? ('IN' as const) : ('OUT' as const),
          amount: t.amount,
          description: t.description,
          source: t.source,
          externalRef: t.externalRef,
        })),
  };

  /** Anula una transacción (la prueba entrega después el hecho al consumidor). */
  voidTransaction(id: string): void {
    const t = this.transactionsStore.get(id);
    if (t) this.transactionsStore.set(id, { ...t, status: 'VOIDED' });
  }

  readonly accounts = {
    getPostingEligibility: async ({
      accountIds,
    }: {
      accountIds: readonly string[];
    }): Promise<PostingEligibilityDto[]> =>
      this.accountList
        .filter((a) => accountIds.includes(a.accountId))
        .map((a) => ({ accountId: a.accountId, currency: a.currency, nature: a.nature, status: a.status })),
    assertCanPost: async ({
      accounts,
    }: {
      accounts: readonly { accountId: string; currency?: string }[];
    }): Promise<PostingEligibilityDto[]> => {
      const out: PostingEligibilityDto[] = [];
      for (const req of accounts) {
        const found = this.accountList.find((a) => a.accountId === req.accountId);
        if (!found) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found');
        if (found.status === 'ARCHIVED') throw new DomainError('ACCOUNT_ARCHIVED', 'account is archived');
        if (found.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', 'account is closed');
        if (req.currency && req.currency !== found.currency) {
          throw new DomainError('CURRENCY_MISMATCH', `account is in ${found.currency}`);
        }
        out.push({
          accountId: found.accountId,
          currency: found.currency,
          nature: found.nature,
          status: found.status,
        });
      }
      return out;
    },
  };

  readonly accountCatalog = {
    listAccounts: async (): Promise<readonly AccountSummaryDto[]> => this.accountList,
  };

  readonly classification = {
    validate: async (input: { categoryIds?: readonly { categoryId: string; splitKind: string }[] }) => {
      for (const ref of input.categoryIds ?? []) {
        if (this.archivedCategories.has(ref.categoryId)) {
          throw new DomainError('CATEGORY_ARCHIVED', 'the category is archived').at('/categoryId');
        }
      }
    },
    validateCustomFieldValues: async () => [],
  };

  readonly rates = {
    workspaceCurrencies: async (): Promise<readonly WorkspaceCurrencyDto[]> =>
      [
        { code: 'BOB', scale: 2, kind: 'FIAT', enabled: true },
        { code: 'USD', scale: 2, kind: 'FIAT', enabled: true },
        { code: 'USDT', scale: 6, kind: 'CRYPTO', enabled: true },
      ] as unknown as WorkspaceCurrencyDto[],
    enabledCurrencies: async () => [],
    resolveValuationRates: async (input: {
      requests: readonly { base: string; quote: string; at: string }[];
    }): Promise<(ValuationRateDto | null)[]> =>
      input.requests.map((r) => {
        const value = this.rateTable.get(`${r.base}/${r.quote}`);
        if (!value) return null;
        return {
          exact: { base: r.base, quote: r.quote, value },
          resolved: {
            rate: { base: r.base, quote: r.quote, value },
            fxRateId: `rate-${r.base}-${r.quote}`,
            derivation: 'DIRECT',
            asOf: '2026-10-09T12:00:00.000Z',
            components: [],
          },
        } as unknown as ValuationRateDto;
      }),
    windowDays: 7,
  };

  readonly calendar = { calendarOf: async () => ({ timeZone: this.timeZone, fiscalMonthStartDay: 1 }) };
  readonly settings = {
    settingsOf: async () => ({ baseCurrency: this.baseCurrency, timeZone: this.timeZone }),
  };

  readonly periods = {
    getPeriod: async ({
      periodId,
    }: {
      workspaceId: string;
      periodId: string;
    }): Promise<FinancialPeriodView | null> =>
      periodId.startsWith('0190a000-0000-7000-8000-')
        ? monthPeriod(`${periodId.slice(24, 28)}-${periodId.slice(28, 30)}`)
        : null,
    getPeriodContaining: async ({ date }: { workspaceId: string; date: string }) =>
      monthPeriod(date.slice(0, 7)),
  };

  readonly audit = {
    append: async (entry: AuditEntry) => {
      this.recorded.push({ entry, steps: [] });
    },
  };

  readonly lifecycle = {
    record: async (entry: AuditEntry, steps: readonly LifecycleStepInput[]) => {
      this.recorded.push({ entry, steps });
    },
    recordMany: async (items: readonly Recorded[]) => {
      this.recorded.push(...items);
    },
  };

  readonly outbox = {
    append: async (event: {
      eventType: string;
      aggregateId: string;
      aggregateVersion: number;
      payload: object;
    }) => {
      const dup = this.events.some(
        (e) =>
          e.eventType === event.eventType &&
          e.aggregateId === event.aggregateId &&
          e.aggregateVersion === event.aggregateVersion,
      );
      if (dup)
        throw new Error(
          `duplicated outbox key ${event.eventType} ${event.aggregateId} v${event.aggregateVersion}`,
        );
      this.events.push({
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        payload: event.payload as Record<string, unknown>,
      });
    },
  };

  readonly uow = {
    run: async <T>(_workspaceId: string, fn: () => Promise<T>): Promise<T> => {
      const defs = new Map(
        [...this.definitionsMap].map(([k, v]) => [k, { state: v.state, versions: [...v.versions] }]),
      );
      const occs = new Map(this.occurrencesMap);
      const suggestions = new Map(this.suggestionsMap);
      const txns = new Map(this.transactionsStore);
      const counts = [this.events.length, this.recorded.length, this.recordCalls.length];
      const restores = this.extensions.map((snapshot) => snapshot());
      try {
        return await fn();
      } catch (err) {
        for (const restore of restores) restore();
        this.definitionsMap = defs;
        this.occurrencesMap = occs;
        this.suggestionsMap = suggestions;
        this.transactionsStore.clear();
        for (const [k, v] of txns) this.transactionsStore.set(k, v);
        this.events.length = counts[0] as number;
        this.recorded.length = counts[1] as number;
        this.recordCalls.length = counts[2] as number;
        throw err;
      }
    },
  };

  deps(overrides: Partial<CommitmentsDeps> = {}): CommitmentsDeps {
    return {
      uow: this.uow,
      definitions: this.definitions,
      occurrences: this.occurrences,
      matching: this.matching,
      calendar: this.calendar,
      settings: this.settings,
      periods: this.periods,
      accounts: this.accounts as never,
      accountCatalog: this.accountCatalog,
      classification: this.classification as never,
      rates: this.rates as never,
      transactions: this.transactions,
      links: this.links,
      pending: this.pending as never,
      audit: this.audit,
      lifecycle: this.lifecycle,
      outbox: this.outbox,
      ids: { next: () => this.id() },
      clock: this.clock,
      horizonDays: 90,
      rateValidityWindowDays: 7,
      ...overrides,
    };
  }

  // ─────────────────────────────────────────────── helpers de prueba

  setNow(iso: string): void {
    this.clock.set(Instant.parse(iso));
  }

  all(): OccurrenceState[] {
    return this.sorted([...this.occurrencesMap.values()]);
  }

  forDefinition(definitionId: string): OccurrenceState[] {
    return this.all().filter((o) => o.definitionId === definitionId);
  }

  occurrence(id: string): OccurrenceState {
    const s = this.occurrencesMap.get(id);
    if (!s) throw new Error(`no occurrence ${id}`);
    return s;
  }

  eventsOf(type: string): typeof this.events {
    return this.events.filter((e) => e.eventType === type);
  }

  recordedFor(aggregateId: string): Recorded[] {
    return this.recorded.filter((r) => r.entry.aggregateId === aggregateId);
  }

  /** Sugerencias de la prueba (estados persistidos), por id. */
  suggestions(): SuggestionState[] {
    return [...this.suggestionsMap.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  suggestionFor(occurrenceId: string, transactionId: string): SuggestionState | undefined {
    return this.suggestions().find(
      (s) => s.occurrenceId === occurrenceId && s.transactionId === transactionId,
    );
  }

  private expireWhere(
    match: (s: SuggestionState) => boolean,
    reason: SuggestionState['expireReason'],
  ): string[] {
    const ids: string[] = [];
    for (const s of [...this.suggestionsMap.values()]) {
      if (s.status !== 'PROPOSED' || !match(s)) continue;
      this.suggestionsMap.set(s.id, {
        ...s,
        status: 'EXPIRED',
        expireReason: reason,
        version: s.version + 1,
      });
      ids.push(s.id);
    }
    return ids;
  }

  private matchRowOf(s: OccurrenceState): MatchOccurrenceRow {
    const row = this.definitionsMap.get(s.definitionId) as {
      state: DefinitionState;
      versions: DefinitionVersion[];
    };
    const v = row.versions.find((x) => x.versionNo === s.definitionVersionNo) as DefinitionVersion;
    return {
      definitionName: row.state.name,
      occurrence: {
        occurrenceId: s.id,
        definitionId: s.definitionId,
        kind: row.state.kind,
        status: s.status,
        dueDate: s.dueDate,
        expected: s.expected,
        currency: s.currency,
        accountId: v.accountId,
        toAccountId: v.toAccountId,
        counterpartyId: v.counterpartyId,
        tolerances: {
          amountTolerancePct: row.state.matchingAmountTolerancePct,
          dateWindowDays: row.state.matchingDateWindowDays,
        },
      },
    };
  }

  protected id(): string {
    this.seq += 1;
    return `0190a000-0000-7000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  private sorted(list: OccurrenceState[]): OccurrenceState[] {
    return list.sort((a, b) =>
      a.occurrenceDate === b.occurrenceDate
        ? a.id < b.id
          ? -1
          : 1
        : a.occurrenceDate < b.occurrenceDate
          ? -1
          : 1,
    );
  }

  private viewOf(s: OccurrenceState): OccurrenceView {
    const row = this.definitionsMap.get(s.definitionId) as {
      state: DefinitionState;
      versions: DefinitionVersion[];
    };
    const v = row.versions.find((x) => x.versionNo === s.definitionVersionNo) as DefinitionVersion;
    return {
      occurrence: s,
      definitionName: row.state.name,
      kind: row.state.kind,
      managedBy: row.state.managedBy,
      accountId: v.accountId,
      toAccountId: v.toAccountId,
      mode: v.materialization.mode,
      leadDays: v.materialization.leadDays,
    };
  }

  private listViews(workspaceId: string, filter: OccurrenceFilter): OccurrenceView[] {
    let rows = [...this.occurrencesMap.values()].filter((o) => o.workspaceId === workspaceId);
    if (filter.definitionId) rows = rows.filter((o) => o.definitionId === filter.definitionId);
    if (filter.statuses) rows = rows.filter((o) => filter.statuses?.includes(o.status));
    if (filter.dueFrom) rows = rows.filter((o) => o.dueDate >= (filter.dueFrom as string));
    if (filter.dueTo) rows = rows.filter((o) => o.dueDate <= (filter.dueTo as string));
    rows.sort((a, b) => (a.dueDate === b.dueDate ? (a.id < b.id ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1));
    if (filter.after) {
      const [d, id] = filter.after;
      rows = rows.filter((o) => o.dueDate > d || (o.dueDate === d && o.id > id));
    }
    let views = rows.map((o) => this.viewOf(o));
    if (filter.requiresApproval !== undefined) {
      views = views.filter(
        (v) =>
          (v.mode === 'PENDING_APPROVAL' &&
            (v.occurrence.status === 'DUE' || v.occurrence.status === 'OVERDUE')) === filter.requiresApproval,
      );
    }
    return filter.limit ? views.slice(0, filter.limit) : views;
  }

  private listDefinitions(workspaceId: string, filter: DefinitionFilter): DefinitionListRow[] {
    return [...this.definitionsMap.values()]
      .filter(
        (r) =>
          r.state.workspaceId === workspaceId &&
          (!filter.status || r.state.status === filter.status) &&
          (!filter.kind || r.state.kind === filter.kind) &&
          (!filter.q || r.state.name.toLowerCase().includes(filter.q.toLowerCase())),
      )
      .sort((a, b) => a.state.name.localeCompare(b.state.name))
      .map((r) => {
        const open = this.sorted([...this.occurrencesMap.values()]).filter(
          (o) => o.definitionId === r.state.id && isUnresolved(o.status),
        );
        const next = open[0];
        return {
          definition: RecurringDefinition.restore(r.state, r.versions),
          nextOccurrence: next ? { occurrenceDate: next.occurrenceDate, dueDate: next.dueDate } : null,
          pendingApprovalCount: open.filter(
            (o) =>
              (o.status === 'DUE' || o.status === 'OVERDUE') && this.viewOf(o).mode === 'PENDING_APPROVAL',
          ).length,
        };
      });
  }
}

function account(
  accountId: string,
  name: string,
  type: AccountSummaryDto['type'],
  nature: AccountSummaryDto['nature'],
  currency: string,
  liquidity: AccountSummaryDto['liquidity'],
): AccountSummaryDto {
  return {
    accountId,
    name,
    type,
    nature,
    currency,
    status: 'ACTIVE',
    liquidity,
    includeInNetWorth: true,
    displayOrder: 0,
  };
}

function monthPeriod(label: string): FinancialPeriodView {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const last = LocalDate.daysInMonth(y, m);
  return {
    id: `0190a000-0000-7000-8000-${label.replace('-', '')}000000`,
    label,
    periodStart: `${label}-01`,
    periodEnd: `${label}-${String(last).padStart(2, '0')}`,
    status: 'ACTIVE',
  };
}

export type { OccurrenceStatus };
