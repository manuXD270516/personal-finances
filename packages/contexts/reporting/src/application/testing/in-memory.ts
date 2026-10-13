import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { CategorySummaryDto } from '@pf/classification/contracts';
import type {
  FxValuationPort,
  WorkspaceCurrencyDto,
  ResolvedRateDto,
  ValuationRateDto,
} from '@pf/fx/contracts';
import type { AccountBalanceDto } from '@pf/ledger/contracts';
import { FixedClock, Instant } from '@pf/shared-kernel';
import type { ConversionCostRowDto, NominalFlowRowDto } from '@pf/transactions/contracts';
import type {
  AccountReservationRow,
  BudgetAvailabilityRow,
  ClosingSnapshotsPort,
  CommittedRangeRow,
  ConversionCostDeps,
  GoalPlanRow,
  SpendableCommittedRow,
  GoalFlowRow,
  GoalHomeSummaryRow,
  NetWorthHistoryDeps,
  PendingTransactionRow,
  ReportingDeps,
  ResolvedOutflowRow,
  UpcomingOccurrenceRow,
  UpcomingPaymentsDeps,
} from '../ports/index.js';

export interface FakeRate {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
  readonly asOf: string;
  readonly rateType?: ResolvedRateDto['rateType'];
  readonly source?: ResolvedRateDto['source'];
  readonly sourceLabel?: string | null;
  readonly provider?: ResolvedRateDto['provider'];
  readonly selection?: ResolvedRateDto['selection'];
  readonly stale?: boolean;
  readonly fxRateId?: string;
}

const ATTRIBUTION = {
  PARALELO_BO: {
    provider: 'PARALELO_BO',
    text: 'Fuente: paralelo.bo',
    url: 'https://paralelo.bo',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  DOLARAPI_BO: {
    provider: 'DOLARAPI_BO',
    text: 'Fuente: bo.dolarapi.com',
    url: 'https://bo.dolarapi.com',
    license: null,
    licenseUrl: null,
  },
} as const;

/**
 * Dobles en memoria de los puertos de REPORTING (contratos públicos de los otros contextos). El doble de FX NO elige
 * entre niveles de fallback: devuelve, por par, la tasa más reciente con `asOf ≤ at` dentro de la ventana — la
 * selección real (principal/respaldo/obsoleta/manual) la prueban los tests de FX y los de integración con PG.
 */
export class InMemoryReporting {
  readonly clock = new FixedClock(Instant.parse('2026-09-30T22:00:00Z'));
  settings = { baseCurrency: 'BOB', timeZone: 'America/La_Paz' };
  /** Catálogo con el estado de habilitación en el workspace (`enabled: false` = moneda no habilitada). */
  readonly currencies: WorkspaceCurrencyDto[] = [
    { code: 'BOB', kind: 'FIAT', scale: 2, enabled: true },
    { code: 'USD', kind: 'FIAT', scale: 2, enabled: true },
    { code: 'USDT', kind: 'CRYPTO', scale: 6, enabled: true },
    { code: 'BTC', kind: 'CRYPTO', scale: 8, enabled: true },
  ];
  readonly accounts: AccountSummaryDto[] = [];
  /** Saldo PRESENTADO por cuenta. */
  readonly balances = new Map<string, { amount: string; currency: string }>();
  readonly flows: NominalFlowRowDto[] = [];
  readonly categories: CategorySummaryDto[] = [];
  readonly rates: FakeRate[] = [];
  readonly rateRequests: { base: string; quote: string; at: string }[] = [];
  latestEntryAt: string | null = '2026-09-30T21:00:00.000Z';
  version = '0';
  /** Ventana con la que se "compuso" FX (se usa si el llamador no pasa la suya). */
  windowDays = 7;
  /** Ajuste de Reporting `REPORTING_RATE_VALIDITY_WINDOW` (docs/31 D53); `undefined` = default de Reporting. */
  rateValidityWindowDays: number | undefined;
  /** Ventanas recibidas por el puerto de FX en cada llamada. */
  readonly windowRequests: (number | undefined)[] = [];

  /** Periodos financieros del workspace (add-net-worth-evolution). */
  readonly periods: { id: string; label: string; periodStart: string; periodEnd: string; status: string }[] =
    [];
  /** Snapshots de cierre vigentes por periodo (`ClosingSnapshotQuery.listCurrent`). */
  readonly snapshots: Awaited<ReturnType<ClosingSnapshotsPort['listCurrent']>>[number][] = [];
  /** Saldo PRESENTADO por cuenta a cada fecha de corte (`asOf` → cuenta → saldo); sin entrada = cuenta sin saldo. */
  readonly balancesByDate = new Map<string, Map<string, { amount: string; currency: string }>>();

  /** Revisión vigente de las conversiones posteadas (TRANSACTIONS, `ConversionDetailQuery`; add-conversion-cost-analysis). */
  readonly conversionRows: ConversionCostRowDto[] = [];
  /** Nombres vigentes de contrapartes (CLASSIFICATION, `CounterpartyCatalogQuery`). */
  readonly counterpartyNames = new Map<string, string>();
  /** Compra/venta paralela publicada (FX, `FxQuoteSideRatesPort`); `null` = puerto no cableado. */
  parallelRates:
    | { base: string; quote: string; side: 'PARALLEL_BUY' | 'PARALLEL_SELL'; value: string; asOf: string }[]
    | null = null;
  /** Día de inicio del mes financiero (IDENTITY); `null` = puerto no cableado. */
  fiscalMonthStartDay: number | null = null;

  /** Definiciones recurrentes activas (COMMITMENTS, `DefinitionStatsQuery`). */
  hasActiveDefinitions = false;
  /** Ocurrencias de egreso no resueltas que informa COMMITMENTS (`UpcomingPaymentsQuery`). */
  readonly occurrences: UpcomingOccurrenceRow[] = [];
  /** Transacciones `PENDING` (TRANSACTIONS, `PendingFlowQuery`). */
  readonly pendingTransactions: PendingTransactionRow[] = [];
  /** Comprometido por rango en montos nativos (`CommittedQuery.getForRange`); por defecto vacío. */
  committed: CommittedRangeRow = {
    fromCommitments: [],
    fromPending: [],
    withoutAmountCount: 0,
    overdueBefore: { count: 0, amounts: [] },
  };
  readonly committedRequests: { from: string; to: string }[] = [];
  /** Egresos resueltos por transacciones no anuladas (`ResolvedOccurrencesQuery`). */
  readonly resolvedOutflows: ResolvedOutflowRow[] = [];
  readonly metricSamples: { name: string; value: number }[] = [];
  /** Metas del Home (GOALS, `GoalSummaryQuery`); `null` = puerto no cableado (Q9 `NO_DATA`). */
  goalHome: GoalHomeSummaryRow | null = null;
  /** Flujos netos de metas (GOALS, `GoalFlowsQuery`); `null` = puerto no cableado. */
  goalFlowRows: GoalFlowRow[] | null = null;
  readonly goalRequests: { kind: 'home' | 'flows'; from?: string; to?: string; limit?: number }[] = [];

  /** Q5 (add-spendable-amount): `true` cablea los puertos de COMMITMENTS, GOALS, IDENTITY y PLANNING del disponible. */
  spendableEnabled = false;
  /** Ítems de egreso para Q5 (`CommittedQuery.listForSpendable`). */
  readonly spendableItems: SpendableCommittedRow[] = [];
  /** Reservado por metas por cuenta (`GoalReservationsQuery`). */
  readonly reservations: AccountReservationRow[] = [];
  /** Aportes planificados del periodo (`GoalPlansQuery`). */
  readonly goalPlans: GoalPlanRow[] = [];
  /** Reserva mínima de liquidez (`WorkspaceSettingsQuery`). */
  minimumReserve: { amount: string; currency: string } | null = null;
  /** Disponible del plan por periodo (`BudgetVsActualQuery`, por `periodId`). */
  readonly budgets = new Map<string, BudgetAvailabilityRow>();
  readonly spendableRequests: { periodFrom: string; periodTo: string }[] = [];

  addPeriod(label: string, periodStart: string, periodEnd: string, status = 'CLOSED') {
    this.periods.push({ id: `period-${label}`, label, periodStart, periodEnd, status });
  }

  /** Fija los saldos presentados de las cuentas a una fecha de corte. */
  setBalances(asOf: string, balances: Record<string, { amount: string; currency: string }>) {
    this.balancesByDate.set(asOf, new Map(Object.entries(balances)));
  }

  addAccount(
    over: Partial<AccountSummaryDto> & Pick<AccountSummaryDto, 'name' | 'type' | 'currency'>,
    /** Saldo presentado; `null` = cuenta sin postings (todavía sin cuenta contable ni línea de saldo). */
    balance: string | null,
  ) {
    const liability = ['CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY'].includes(over.type);
    const account: AccountSummaryDto = {
      accountId: over.accountId ?? `acc-${this.accounts.length + 1}`,
      nature: liability ? 'LIABILITY' : 'ASSET',
      status: 'ACTIVE',
      liquidity: liability || over.type === 'INVESTMENT' ? 'ILLIQUID' : 'LIQUID',
      includeInNetWorth: true,
      displayOrder: this.accounts.length + 1,
      ...over,
    };
    this.accounts.push(account);
    if (balance !== null)
      this.balances.set(account.accountId, { amount: balance, currency: account.currency });
    return account;
  }

  flow(
    businessDate: string,
    nature: 'INCOME' | 'EXPENSE',
    categoryId: string,
    amount: string,
    currency = 'BOB',
  ) {
    this.flows.push({ businessDate, nature, categoryId, amount: { amount, currency } });
  }

  private resolve(
    req: { base: string; quote: string; at: string },
    windowDays: number,
  ): ValuationRateDto | null {
    const at = Date.parse(req.at);
    const from = at - windowDays * 86_400_000;
    const candidates = this.rates
      .filter((r) => {
        const t = Date.parse(r.asOf);
        const pair =
          (r.base === req.base && r.quote === req.quote) || (r.base === req.quote && r.quote === req.base);
        return pair && t <= at && t >= from;
      })
      .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
    const r = candidates.at(-1);
    if (!r) return null;
    const ageMs = Math.max(0, at - Date.parse(r.asOf));
    const provider = r.provider === undefined ? 'PARALELO_BO' : r.provider;
    const resolved: ResolvedRateDto = {
      rate: { base: r.base, quote: r.quote, value: r.value },
      fxRateId: r.fxRateId ?? `rate-${r.base}-${r.quote}-${r.asOf}`,
      derivation: r.base === req.base ? 'DIRECT' : 'INVERSE',
      components: [],
      rateType: r.rateType ?? 'PARALLEL',
      requestedRateType: r.rateType ?? 'PARALLEL',
      source: r.source ?? (provider ? 'PROVIDER' : 'MANUAL'),
      sourceLabel: r.sourceLabel ?? null,
      asOf: r.asOf,
      ageDays: Math.floor(ageMs / 86_400_000),
      ageSeconds: Math.floor(ageMs / 1000),
      approx: false,
      provider,
      selection: r.selection ?? (provider ? 'PRIMARY' : 'MANUAL'),
      stale: r.stale ?? false,
      attribution: provider ? ATTRIBUTION[provider] : null,
    };
    return { resolved, exact: { base: r.base, quote: r.quote, value: r.value } };
  }

  deps(): ReportingDeps {
    const fx: FxValuationPort = {
      windowDays: this.windowDays,
      resolveValuationRates: async ({ requests, windowDays }) => {
        this.rateRequests.push(...requests);
        this.windowRequests.push(windowDays);
        return requests.map((r) => this.resolve(r, windowDays ?? this.windowDays));
      },
      enabledCurrencies: async () => this.currencies.filter((c) => c.enabled),
      workspaceCurrencies: async () => this.currencies,
    };
    return {
      uow: { run: (_ctx, fn) => fn(), join: (_ws, fn) => fn() },
      workspaces: { settingsOf: async () => this.settings },
      accounts: { listAccounts: async () => [...this.accounts] },
      balances: {
        getAccountBalances: async ({ accountIds, asOf }) => ({
          asOf: asOf ?? null,
          latestEntryAt: this.latestEntryAt,
          balances: [...this.balances.entries()]
            .filter(([id]) => accountIds === undefined || accountIds.includes(id))
            .map(([id, presented]): AccountBalanceDto => ({
              ledgerAccountId: `la-${id}`,
              code: `USER:${id}`,
              nature: this.accounts.find((a) => a.accountId === id)?.nature ?? 'ASSET',
              accountId: id,
              balance: presented,
              presented,
            })),
        }),
      },
      flows: {
        summarizeNominalFlows: async ({ dateFrom, dateTo }) =>
          this.flows.filter((f) => f.businessDate >= dateFrom && f.businessDate <= dateTo),
      },
      categories: {
        categoriesByIds: async ({ categoryIds }) =>
          this.categories.filter((c) => categoryIds.includes(c.categoryId)),
      },
      rates: fx,
      versions: { versionOf: async () => this.version, bump: async () => undefined },
      clock: this.clock,
      commitments: { hasActiveDefinitions: async () => this.hasActiveDefinitions },
      pending: {
        listPending: async (input) =>
          this.pendingTransactions.filter(
            (p) =>
              (input.dateFrom === undefined || p.businessDate >= input.dateFrom) &&
              (input.dateTo === undefined || p.businessDate <= input.dateTo) &&
              (input.accountIds === undefined || input.accountIds.includes(p.accountId)),
          ),
      },
      ...(this.spendableEnabled
        ? {
            spendable: {
              commitments: {
                listForSpendable: async ({
                  periodFrom,
                  periodTo,
                }: {
                  periodFrom: string;
                  periodTo: string;
                }) => {
                  this.spendableRequests.push({ periodFrom, periodTo });
                  const items = this.spendableItems
                    .filter((i) => i.date <= periodTo)
                    .map((i) => ({
                      ...i,
                      overdueFromPrevious: i.source === 'OCCURRENCE' && i.date < periodFrom,
                    }));
                  return { items, withoutAmountCount: items.filter((i) => i.amount === null).length };
                },
              },
              reservations: {
                getReservedByAccount: async ({ accountIds }: { accountIds?: readonly string[] }) =>
                  this.reservations.filter(
                    (r) => accountIds === undefined || accountIds.includes(r.accountId),
                  ),
              },
              goalPlans: { getForPeriod: async () => [...this.goalPlans] },
              minimumReserve: { getMinimumLiquidityReserve: async () => this.minimumReserve },
              budgets: {
                getForPeriod: async ({ periodId }: { periodId: string }) =>
                  this.budgets.get(periodId) ?? null,
              },
              periods: { listPeriods: async () => [...this.periods] },
              metrics: {
                observe: (name: string, value: number) => void this.metricSamples.push({ name, value }),
              },
            },
          }
        : {}),
      ...(this.goalHome
        ? {
            goalSummary: {
              listForHome: async ({ limit }: { limit: number }) => {
                this.goalRequests.push({ kind: 'home', limit });
                return this.goalHome as GoalHomeSummaryRow;
              },
            },
          }
        : {}),
      ...(this.goalFlowRows
        ? {
            goalFlows: {
              netForRange: async ({ from, to }: { from: string; to: string }) => {
                this.goalRequests.push({ kind: 'flows', from, to });
                return (this.goalFlowRows as GoalFlowRow[]).filter((f) => f.date >= from && f.date <= to);
              },
            },
          }
        : {}),
      ...(this.rateValidityWindowDays === undefined
        ? {}
        : { rateValidityWindowDays: this.rateValidityWindowDays }),
    };
  }

  /** Puertos de `GetNetWorthHistory`: los de `deps()` más periodos, snapshots y saldos por fecha. */
  historyDeps(): NetWorthHistoryDeps {
    return {
      ...this.deps(),
      accounts: { listAccounts: async () => [...this.accounts] },
      periods: { listPeriods: async () => [...this.periods] },
      snapshots: {
        listCurrent: async ({ periodIds }) => this.snapshots.filter((s) => periodIds.includes(s.periodId)),
      },
      balanceHistory: {
        getAccountBalancesAtDates: async ({ dates }) => ({
          latestEntryAt: this.latestEntryAt,
          byDate: dates.map((asOf) => ({
            asOf,
            balances: [...(this.balancesByDate.get(asOf)?.entries() ?? [])].map(
              ([id, presented]): AccountBalanceDto => ({
                ledgerAccountId: `la-${id}`,
                code: `USER:${id}`,
                nature: this.accounts.find((a) => a.accountId === id)?.nature ?? 'ASSET',
                accountId: id,
                balance: presented,
                presented,
              }),
            ),
          })),
        }),
      },
    };
  }

  /** Puertos de `GetUpcomingPayments`/`GetSurprisePayments`: los de `deps()` más periodos, COMMITMENTS y métricas. */
  upcomingDeps(): UpcomingPaymentsDeps {
    return {
      ...this.deps(),
      periods: { listPeriods: async () => [...this.periods] },
      commitments: {
        listUpcoming: async ({ through }) => this.occurrences.filter((o) => o.dueDate <= through),
        getForRange: async ({ from, to }) => {
          this.committedRequests.push({ from, to });
          return this.committed;
        },
        listResolvedOutflows: async ({ from, to }) =>
          this.resolvedOutflows.filter((r) => r.transactionDate >= from && r.transactionDate <= to),
        hasActiveDefinitions: async () => this.hasActiveDefinitions,
      },
      metrics: { observe: (name, value) => void this.metricSamples.push({ name, value }) },
    };
  }

  /** Puertos de `GetConversionCostAnalysis` (add-conversion-cost-analysis): los de `deps()` más conversiones y nombres. */
  conversionCostDeps(): ConversionCostDeps {
    const base = this.deps();
    return {
      uow: base.uow,
      workspaces: base.workspaces,
      accounts: base.accounts,
      counterparties: {
        counterpartiesByIds: async ({ counterpartyIds }) =>
          counterpartyIds.flatMap((id) => {
            const name = this.counterpartyNames.get(id);
            return name === undefined ? [] : [{ counterpartyId: id, name, archived: false }];
          }),
      },
      conversions: {
        listForCostAnalysis: async ({ from, to, includeVoided }) =>
          this.conversionRows.filter(
            (r) => r.businessDate >= from && r.businessDate <= to && (includeVoided === true || !r.voided),
          ),
      },
      rates: base.rates,
      ...(this.parallelRates
        ? {
            quoteSide: {
              resolveQuoteSideRates: async ({ requests }) =>
                requests.map((req) => {
                  const at = Date.parse(req.at);
                  const found = (this.parallelRates ?? [])
                    .filter(
                      (r) =>
                        r.base === req.base &&
                        r.quote === req.quote &&
                        r.side === req.side &&
                        Date.parse(r.asOf) <= at,
                    )
                    .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf))
                    .at(-1);
                  if (!found) return null;
                  const exact = { base: found.base, quote: found.quote, value: found.value };
                  return {
                    exact,
                    resolved: {
                      rate: exact,
                      fxRateId: `parallel-${found.side}-${found.asOf}`,
                      derivation: 'DIRECT' as const,
                      components: [],
                      rateType: found.side,
                      requestedRateType: found.side,
                      source: 'PROVIDER' as const,
                      sourceLabel: null,
                      asOf: found.asOf,
                      ageDays: 0,
                      ageSeconds: 0,
                      approx: false,
                      provider: 'PARALELO_BO' as const,
                      selection: 'PRIMARY' as const,
                      stale: false,
                      attribution: null,
                    },
                  };
                }),
            },
          }
        : {}),
      periods: { listPeriods: async () => [...this.periods] },
      ...(this.fiscalMonthStartDay === null
        ? {}
        : {
            calendar: {
              calendarOf: async () => ({
                timeZone: this.settings.timeZone,
                fiscalMonthStartDay: this.fiscalMonthStartDay as number,
              }),
            },
          }),
      clock: this.clock,
      ...(this.rateValidityWindowDays === undefined
        ? {}
        : { rateValidityWindowDays: this.rateValidityWindowDays }),
    };
  }
}
