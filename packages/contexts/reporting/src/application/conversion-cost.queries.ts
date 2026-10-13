import type { RateAttributionDto, ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  dec,
  DomainError,
  LocalDate,
  Money,
  plusDays,
  Rate,
  type Currency,
  type ExactRate,
} from '@pf/shared-kernel';
import type { ConversionCostRowDto } from '@pf/transactions/contracts';
import type {
  ConversionCostAnalysisDto,
  ConversionCostGroupDto,
  ConversionCostGroupingDto,
} from '../contracts/index.js';
import {
  channelOf,
  ConversionCostAggregator,
  CostPeriodCalendar,
  MAX_COST_PERIODS,
  type ConversionCostGrouping,
  type CostConversion,
  type CostGroup,
} from '../domain/index.js';
import type { ConversionCostDeps } from './ports/index.js';
import { csvCell, UTF8_BOM } from './csv.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey, toExact } from './valuation-support.js';

export interface GetConversionCostAnalysisQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** Fechas de negocio inclusivas `YYYY-MM-DD`. Sin ellas: los últimos 12 periodos hasta hoy. */
  readonly from?: string;
  readonly to?: string;
  /** Por defecto `FINANCIAL_PERIOD`. */
  readonly grouping?: ConversionCostGroupingDto;
  /** Could (D247): spread alternativo contra la compra/venta paralela del día. */
  readonly compareWith?: 'PARALLEL_SIDE';
}

export interface ConversionCostExport {
  readonly fileName: string;
  readonly contentType: 'text/csv; charset=utf-8';
  readonly body: Buffer;
}

/** Periodos por defecto de la consulta sin rango: los últimos 12 (D246). */
const DEFAULT_PERIODS = 12;

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/**
 * `GetConversionCostAnalysis` (add-conversion-cost-analysis, fx/conversion-pricing; D244–D247): el costo real de convertir
 * por periodo, canal y par, calculado desde la FUENTE DE VERDAD (la revisión vigente de las conversiones posteadas; nunca
 * anuladas ni pendientes) en una sola transacción de lectura con RLS del workspace. Se apoya en `ConversionDetailQuery`
 * y NO en las observaciones de FX (no tienen contraparte, cuentas ni fees: design.md decisión 1). Las tasas de
 * valoración al instante de cada conversión se resuelven en UNA llamada por lote. Todo lo financiero lo hace
 * `ConversionCostAggregator`; aquí solo se orquesta y se presenta. Sin efectos.
 */
export class ConversionCostQueries {
  constructor(private readonly deps: ConversionCostDeps) {}

  getAnalysis(query: GetConversionCostAnalysisQuery): Promise<ConversionCostAnalysisDto> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.compute(query),
    );
  }

  /** CSV del mismo análisis (una fila por grupo) con celdas de texto neutralizadas contra fórmulas (NFR-SEC-015). */
  async exportCsv(query: Omit<GetConversionCostAnalysisQuery, 'compareWith'>): Promise<ConversionCostExport> {
    const analysis = await this.getAnalysis(query);
    const lines = [
      [...CSV_COLUMNS],
      ...analysis.groups.map((g) => csvRow(g, analysis.reportingCurrency)),
    ].map((row) => row.map(csvCell).join(','));
    return {
      fileName: `conversion-costs-${analysis.from}-${analysis.to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(`${UTF8_BOM}${lines.join('\r\n')}\r\n`, 'utf8'),
    };
  }

  private async compute(query: GetConversionCostAnalysisQuery): Promise<ConversionCostAnalysisDto> {
    const { deps } = this;
    const ws = query.workspaceId;
    const grouping: ConversionCostGrouping = query.grouping ?? 'FINANCIAL_PERIOD';
    if (grouping !== 'FINANCIAL_PERIOD' && grouping !== 'CALENDAR_MONTH') {
      throw invalid('grouping must be FINANCIAL_PERIOD or CALENDAR_MONTH', '/grouping');
    }
    const settings = await deps.workspaces.settingsOf(ws);
    const timeZone = settings.timeZone;
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const reporting = known.get(settings.baseCurrency);
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${settings.baseCurrency} is not enabled`);
    }
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, timeZone).toString();
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;

    // ---- calendario de periodos y rango
    const periods = await deps.periods.listPeriods({ workspaceId: ws });
    const startDay = deps.calendar ? (await deps.calendar.calendarOf(ws)).fiscalMonthStartDay : null;
    const calendar = CostPeriodCalendar.of(grouping, periods, startDay);
    const to = query.to ?? today;
    const from = query.from ?? defaultFrom(calendar, to);
    for (const [value, pointer] of [
      [from, '/from'],
      [to, '/to'],
    ] as const) {
      try {
        LocalDate.parse(value);
      } catch {
        throw invalid(`${pointer.slice(1)} must be a business date YYYY-MM-DD`, pointer);
      }
    }
    if (from > to) throw invalid('from must not be after to', '/from');
    if (calendar.periodsBetween(from, to).length > MAX_COST_PERIODS) {
      throw invalid(`the range covers more than ${MAX_COST_PERIODS} periods`, '/from');
    }

    // ---- conversiones vigentes y nombres (en bloque, sin N+1)
    const rows = await deps.conversions.listForCostAnalysis({ workspaceId: ws, from, to });
    const accountNames = new Map(
      (await deps.accounts.listAccounts({ workspaceId: ws, includeArchived: true })).map((a) => [
        a.accountId,
        a.name,
      ]),
    );
    const counterpartyIds = [
      ...new Set(rows.map((r) => r.counterparty.counterpartyId).filter((id): id is string => id !== null)),
    ];
    const counterpartyNames = new Map(
      counterpartyIds.length > 0
        ? (await deps.counterparties.counterpartiesByIds({ workspaceId: ws, counterpartyIds })).map((c) => [
            c.counterpartyId,
            c.name,
          ])
        : [],
    );

    // ---- valoración: una resolución por lote de las tasas al instante de cada conversión
    const currencyOf = (code: string, sample = '0'): Currency =>
      known.get(code) ?? makeCurrency(code, sample.split('.')[1]?.length ?? 0);
    const need = new Map<string, { base: string; quote: string; at: string }>();
    const want = (code: string, at: string) => {
      if (code !== reporting.code) need.set(`${code}|${at}`, { base: code, quote: reporting.code, at });
    };
    for (const r of rows) {
      want(r.effectiveRate.quote, r.executedAt);
      if (r.spread) want(r.spread.amount.currency, r.executedAt);
      for (const f of r.fees) want(f.amount.currency, r.executedAt);
    }
    const requests = [...need.entries()];
    const resolved = requests.length
      ? await deps.rates.resolveValuationRates({
          workspaceId: ws,
          requests: requests.map(([, r]) => r),
          windowDays,
        })
      : [];
    const byKey = new Map<string, ValuationRateDto | null>(
      requests.map(([k], i) => [k, resolved[i] ?? null]),
    );
    const used = new Map<string, ResolvedRateDto>();

    // ---- Could: compra/venta paralela vigente al instante de cada conversión
    const parallel = new Map<string, ValuationRateDto | null>();
    if (query.compareWith === 'PARALLEL_SIDE' && deps.quoteSide && rows.length > 0) {
      const sideRequests = rows.map((r) => ({
        base: r.effectiveRate.base,
        quote: r.effectiveRate.quote,
        at: r.executedAt,
        side: (r.sourceAmount.currency === r.effectiveRate.base ? 'PARALLEL_SELL' : 'PARALLEL_BUY') as
          'PARALLEL_SELL' | 'PARALLEL_BUY',
      }));
      const found = await deps.quoteSide.resolveQuoteSideRates({
        workspaceId: ws,
        requests: sideRequests,
        windowDays,
      });
      rows.forEach((r, i) => parallel.set(r.transactionId, found[i] ?? null));
    }

    // ---- agregación
    const conversions = rows.map((r) =>
      toCostConversion(r, {
        calendar,
        currencyOf,
        accountName: (id) => accountNames.get(id) ?? id,
        counterpartyName: (id) => counterpartyNames.get(id),
        alternative:
          query.compareWith === 'PARALLEL_SIDE' ? (parallel.get(r.transactionId) ?? null) : undefined,
      }),
    );
    const analysis = ConversionCostAggregator.aggregate(conversions, {
      reporting,
      rateFor: (code, at): ExactRate | null => {
        const rate = byKey.get(`${code}|${at}`);
        if (!rate) return null;
        used.set(rateKey(rate.resolved), rate.resolved);
        return toExact(rate);
      },
    });

    const attributions = new Map<string, RateAttributionDto>();
    for (const r of used.values()) if (r.attribution) attributions.set(r.attribution.provider, r.attribution);
    return {
      reportingCurrency: reporting.code,
      grouping,
      from,
      to,
      groups: analysis.groups.map(toGroupDto),
      totals: {
        conversions: analysis.totals.conversions,
        converted: analysis.totals.converted.toJSON(),
        spreadAmount: analysis.totals.spreadAmount.toJSON(),
        fees: analysis.totals.fees.toJSON(),
        costTotal: analysis.totals.costTotal.toJSON(),
        excludedCount: analysis.totals.excludedCount,
        costComplete: analysis.totals.costComplete,
      },
      meta: {
        generatedAt: now.toString(),
        timeZone,
        rateWindowDays: windowDays,
        ratesUsed: [...used.values()],
        attributions: [...attributions.values()],
      },
    };
  }
}

/** Inicio del rango por defecto: el primer día del periodo 11 periodos antes del que contiene `to`. */
function defaultFrom(calendar: CostPeriodCalendar, to: string): string {
  let from = calendar.periodOf(to).from;
  for (let i = 1; i < DEFAULT_PERIODS; i += 1) {
    from = calendar.periodOf(plusDays(LocalDate.parse(from), -1).toString()).from;
  }
  return from;
}

function toCostConversion(
  r: ConversionCostRowDto,
  ctx: {
    readonly calendar: CostPeriodCalendar;
    readonly currencyOf: (code: string, sample?: string) => Currency;
    readonly accountName: (id: string) => string;
    readonly counterpartyName: (id: string) => string | undefined;
    /** `undefined` = no se pidió el alternativo; `null` = se pidió y no hay tasa paralela del lado. */
    readonly alternative: ValuationRateDto | null | undefined;
  },
): CostConversion {
  const { currencyOf } = ctx;
  const money = (m: { amount: string; currency: string }) =>
    Money.parse(m.amount, currencyOf(m.currency, m.amount));
  const rate = (x: { base: string; quote: string; value: string }) =>
    Rate.of(currencyOf(x.base), currencyOf(x.quote), x.value);
  const base = currencyOf(r.effectiveRate.base);
  const quote = currencyOf(r.effectiveRate.quote);
  const side = r.sourceAmount.currency === base.code ? 'SELL' : 'BUY';
  const counterparty = r.counterparty.counterpartyId
    ? {
        counterpartyId: r.counterparty.counterpartyId,
        name: ctx.counterpartyName(r.counterparty.counterpartyId) ?? r.counterparty.name,
      }
    : r.counterparty;
  return {
    id: r.transactionId,
    period: ctx.calendar.periodOf(r.businessDate),
    executedAt: r.executedAt,
    channel: channelOf(counterparty),
    sourceAccountId: r.sourceAccountId,
    sourceAccountName: ctx.accountName(r.sourceAccountId),
    targetAccountId: r.targetAccountId,
    targetAccountName: ctx.accountName(r.targetAccountId),
    pair: { base, quote },
    side,
    // La cantidad convertida de la moneda base: la vendida (bruto − fees en origen) o la comprada (bruto antes de fees).
    baseQty: money(side === 'SELL' ? r.convertedSourceAmount : r.grossTargetAmount),
    reference: r.referenceRate ? rate(r.referenceRate.rate) : null,
    spread: r.spread ? { pct: dec(r.spread.percentage), amount: money(r.spread.amount) } : null,
    fees: r.fees.map((f) => money(f.amount)),
    ...(ctx.alternative !== undefined
      ? {
          alternative: {
            quoted: r.quotedRate ? rate(r.quotedRate) : null,
            parallel: ctx.alternative
              ? Rate.of(
                  currencyOf(ctx.alternative.exact.base),
                  currencyOf(ctx.alternative.exact.quote),
                  ctx.alternative.exact.value,
                )
              : null,
          },
        }
      : {}),
  };
}

function toGroupDto(g: CostGroup): ConversionCostGroupDto {
  return {
    period: { ...g.period },
    channel: { ...g.channel },
    sourceAccountId: g.sourceAccountId,
    sourceAccountName: g.sourceAccountName,
    targetAccountId: g.targetAccountId,
    targetAccountName: g.targetAccountName,
    pair: { ...g.pair },
    conversions: g.conversions,
    converted: g.converted.toJSON(),
    spreadPct: g.spreadPct,
    spreadAmount: g.spreadAmount.toJSON(),
    fees: g.fees.toJSON(),
    costTotal: g.costTotal.toJSON(),
    costComplete: g.costComplete,
    unvaluedFees: g.unvaluedFees.map((m) => m.toJSON()),
    excluded: g.excluded.map((b) => ({
      reason: b.reason,
      count: b.count,
      amounts: b.amounts.map((m) => m.toJSON()),
    })),
    alternative: g.alternative ? { ...g.alternative } : null,
  };
}

/** Encabezado estable del CSV (claves en español, sin traducir), en este orden. */
export const CSV_COLUMNS = [
  'periodo',
  'canal',
  'cuenta_origen',
  'cuenta_destino',
  'par',
  'conversiones',
  'monto_convertido',
  'spread_promedio_pct',
  'monto_spread',
  'fees',
  'costo_total',
  'conversiones_excluidas',
  'moneda_reporte',
] as const;

function csvRow(g: ConversionCostGroupDto, reporting: string): string[] {
  return [
    g.period.label,
    g.channel.kind === 'NONE' ? 'Sin canal' : (g.channel.name ?? ''),
    g.sourceAccountName,
    g.targetAccountName,
    `${g.pair.base}/${g.pair.quote}`,
    String(g.conversions),
    g.converted.amount,
    g.spreadPct ?? '',
    g.spreadAmount.amount,
    g.fees.amount,
    g.costTotal.amount,
    String(g.excluded.reduce((n, b) => n + b.count, 0)),
    reporting,
  ];
}
