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
import type { NominalFlowRowDto } from '@pf/transactions/contracts';
import type { ClosingSnapshotsPort, NetWorthHistoryDeps, ReportingDeps } from '../ports/index.js';

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
}
