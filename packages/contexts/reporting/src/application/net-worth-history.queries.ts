import type { RateAttributionDto, ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  dec,
  DomainError,
  endOfDayInstant,
  LocalDate,
  Money,
  type Currency,
} from '@pf/shared-kernel';
import type { NetWorthHistoryDto, NetWorthPointDto } from '../contracts/index.js';
import {
  NetWorthSeriesBuilder,
  type ClosedFigures,
  type ExactRate,
  type SeriesCutoff,
  type SeriesPeriod,
  type SeriesPointInput,
  type ValuedAccount,
} from '../domain/index.js';
import type { NetWorthHistoryDeps } from './ports/index.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey } from './report-summary.queries.js';

export interface GetNetWorthHistoryQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** Etiqueta `YYYY-MM` del primer periodo; por defecto 11 periodos antes de `to`. */
  readonly from?: string;
  /** Etiqueta `YYYY-MM` del último periodo; por defecto el periodo en curso. */
  readonly to?: string;
  /** Por defecto la moneda base del workspace. */
  readonly reportingCurrency?: string;
}

export interface NetWorthHistoryResult {
  readonly history: NetWorthHistoryDto;
  /** Versión derivada de los datos del workspace (parte del ETag). */
  readonly dataVersion: string;
}

const toExact = (v: ValuationRateDto): ExactRate => ({
  base: v.exact.base,
  quote: v.exact.quote,
  value: dec(v.exact.value),
});

/**
 * `GetNetWorthHistory` (add-net-worth-evolution, design.md decisiones 1–9; reporting/net-worth): la evolución del
 * patrimonio por periodo financiero desde la FUENTE DE VERDAD en una sola transacción de lectura con RLS del workspace.
 *   - Puntos = periodos de PLANNING del rango, cortados al fin de cada periodo (hoy para el que está en curso).
 *   - Periodos CERRADOS con snapshot vigente en la moneda de reporte: cifras congeladas (NFR-DATA-006); el resto se
 *     calcula con los saldos a cada fecha (LEDGER, incluidas cuentas hoy archivadas) y la tasa vigente a esa fecha
 *     (FX, ventana `REPORTING_RATE_VALIDITY_WINDOW`, D53), nunca la de hoy (INV-012); sin tasa ⇒ punto incompleto.
 * El flag `includeInNetWorth` es el vigente para toda la serie calculada (docs/33 D103). Todo lo financiero lo hace
 * `NetWorthSeriesBuilder`; aquí solo se orquesta y se presenta HALF_EVEN una vez. Sin efectos.
 */
export class NetWorthHistoryQueries {
  constructor(private readonly deps: NetWorthHistoryDeps) {}

  getNetWorthHistory(query: GetNetWorthHistoryQuery): Promise<NetWorthHistoryResult> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.compute(query),
    );
  }

  private async compute(query: GetNetWorthHistoryQuery): Promise<NetWorthHistoryResult> {
    const { deps } = this;
    const ws = query.workspaceId;
    const settings = await deps.workspaces.settingsOf(ws);
    const timeZone = settings.timeZone;
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const enabled = new Set(catalog.filter((c) => c.enabled).map((c) => c.code));
    const reportingCode = query.reportingCurrency ?? settings.baseCurrency;
    const reporting = enabled.has(reportingCode) ? known.get(reportingCode) : undefined;
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${reportingCode} is not enabled`).at(
        '/reportingCurrency',
      );
    }
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, timeZone).toString();
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;

    // ---- periodos del rango
    const periods: SeriesPeriod[] = (await deps.periods.listPeriods({ workspaceId: ws })).map((p) => ({
      id: p.id,
      label: p.label,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      status: p.status,
    }));
    const current = periods.find((p) => p.periodStart <= today && today <= p.periodEnd);
    const range = NetWorthSeriesBuilder.resolveRange(
      { from: query.from, to: query.to },
      current?.label ?? today.slice(0, 7),
    );
    const cutoffs = NetWorthSeriesBuilder.cutoffs(periods, range, today);
    const nowText = now.toString();
    const empty = (): NetWorthHistoryResult => ({
      history: {
        reportingCurrency: reporting.code,
        points: [],
        meta: {
          generatedAt: nowText,
          timeZone,
          rateWindowDays: windowDays,
          ratesUsed: [],
          attributions: [],
        },
      },
      dataVersion: '',
    });
    if (cutoffs.length === 0) return { ...empty(), dataVersion: await deps.versions.versionOf(ws) };

    // ---- snapshots de cierre de los periodos cerrados (cifras congeladas)
    const closedIds = cutoffs.filter((c) => c.period.status === 'CLOSED').map((c) => c.period.id);
    const snapshots = new Map(
      (closedIds.length > 0
        ? await deps.snapshots.listCurrent({ workspaceId: ws, periodIds: closedIds })
        : []
      ).map((s) => [s.periodId, s]),
    );
    const scaleOf = (code: string, amount = '0') =>
      known.get(code) ?? makeCurrency(code, amount.split('.')[1]?.length ?? 0);
    const frozen = (cutoff: SeriesCutoff): ClosedFigures | null => {
      const s = snapshots.get(cutoff.period.id);
      if (!s || s.baseCurrency !== reporting.code) return null;
      return {
        assets: Money.parse(s.assets.amount, reporting),
        liabilities: Money.parse(s.liabilities.amount, reporting),
        netWorth: Money.parse(s.netWorth.amount.amount, reporting),
        complete: s.netWorth.complete,
        unconverted: s.netWorth.unconverted.map((m) => Money.parse(m.amount, scaleOf(m.currency, m.amount))),
      };
    };
    const frozenByPeriod = new Map(cutoffs.map((c) => [c.period.id, frozen(c)]));
    const toCompute = cutoffs.filter((c) => frozenByPeriod.get(c.period.id) === null);

    // ---- saldos a cada fecha (incluidas las cuentas hoy archivadas o cerradas)
    const accounts = await deps.accounts.listAccounts({ workspaceId: ws, includeArchived: true });
    const dates = [...new Set(toCompute.map((c) => c.asOf))];
    const balanceHistory =
      dates.length > 0
        ? await deps.balanceHistory.getAccountBalancesAtDates({
            workspaceId: ws,
            accountIds: accounts.map((a) => a.accountId),
            dates,
          })
        : { latestEntryAt: null, byDate: [] };
    const presentedByDate = new Map(
      balanceHistory.byDate.map((d) => [
        d.asOf,
        new Map(
          d.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b.presented]),
        ),
      ]),
    );
    const accountsAt = (asOf: string): ValuedAccount[] => {
      const byAccount = presentedByDate.get(asOf);
      return accounts.map((a) => {
        const presented = byAccount?.get(a.accountId);
        return {
          accountId: a.accountId,
          type: a.type,
          nature: a.nature,
          includeInNetWorth: a.includeInNetWorth,
          balance: presented
            ? Money.parse(presented.amount, scaleOf(presented.currency, presented.amount))
            : Money.zero(scaleOf(a.currency)),
        };
      });
    };

    // ---- tasas vigentes a la fecha de cada punto (una sola resolución por lote)
    const pointAccounts = new Map(toCompute.map((c) => [c.period.id, accountsAt(c.asOf)]));
    const requests: { base: string; quote: string; at: string; key: string; code: string }[] = [];
    for (const cutoff of toCompute) {
      const close = endOfDayInstant(cutoff.asOf, timeZone);
      const at = close.epochMillis > now.epochMillis ? nowText : close.toString();
      const codes = new Set(
        (pointAccounts.get(cutoff.period.id) ?? [])
          .filter((a) => a.includeInNetWorth && !a.balance.isZero())
          .map((a) => a.balance.currency.code)
          .filter((code) => code !== reporting.code),
      );
      for (const code of codes) {
        requests.push({ base: code, quote: reporting.code, at, key: cutoff.period.id, code });
      }
    }
    const resolved = requests.length
      ? await deps.rates.resolveValuationRates({
          workspaceId: ws,
          requests: requests.map(({ base, quote, at }) => ({ base, quote, at })),
          windowDays,
        })
      : [];
    const ratesByPoint = new Map<string, Map<string, ValuationRateDto>>();
    requests.forEach((r, i) => {
      const rate = resolved[i];
      if (!rate) return;
      const byCode = ratesByPoint.get(r.key) ?? new Map<string, ValuationRateDto>();
      byCode.set(r.code, rate);
      ratesByPoint.set(r.key, byCode);
    });

    // ---- serie
    const usedByPoint = new Map<string, Map<string, ResolvedRateDto>>();
    const inputs: SeriesPointInput[] = cutoffs.map((cutoff) => {
      const id = cutoff.period.id;
      const snapshot = frozenByPeriod.get(id) ?? null;
      const closed = cutoff.period.status === 'CLOSED' && snapshots.has(id);
      if (snapshot) return { cutoff, accounts: [], rateFor: () => null, closed, snapshot };
      const used = new Map<string, ResolvedRateDto>();
      usedByPoint.set(id, used);
      return {
        cutoff,
        accounts: pointAccounts.get(id) ?? [],
        closed,
        rateFor: (code) => {
          const rate = ratesByPoint.get(id)?.get(code);
          if (!rate) return null;
          used.set(rateKey(rate.resolved), rate.resolved);
          return toExact(rate);
        },
      };
    });
    const series = NetWorthSeriesBuilder.build(inputs, reporting);

    const allRates = new Map<string, ResolvedRateDto>();
    const points: NetWorthPointDto[] = series.map((p) => {
      const used = [...(usedByPoint.get(p.periodId)?.values() ?? [])];
      for (const r of used) allRates.set(rateKey(r), r);
      return {
        period: p.period,
        periodId: p.periodId,
        asOf: p.asOf,
        assets: p.assets.toJSON().amount,
        liabilities: p.liabilities.toJSON().amount,
        netWorth: p.netWorth.toJSON().amount,
        change: p.change === null ? null : p.change.toJSON().amount,
        comparable: p.comparable,
        complete: p.complete,
        unconverted: p.unconverted.map((m) => m.toJSON()),
        source: p.source,
        closed: p.closed,
        partial: p.partial,
        ratesUsed: used,
      };
    });
    const attributions = new Map<string, RateAttributionDto>();
    for (const r of allRates.values())
      if (r.attribution) attributions.set(r.attribution.provider, r.attribution);
    return {
      history: {
        reportingCurrency: reporting.code,
        points,
        meta: {
          generatedAt: nowText,
          timeZone,
          rateWindowDays: windowDays,
          ...(balanceHistory.latestEntryAt ? { dataFreshness: balanceHistory.latestEntryAt } : {}),
          ratesUsed: [...allRates.values()],
          attributions: [...attributions.values()],
        },
      },
      dataVersion: await deps.versions.versionOf(ws),
    };
  }
}
