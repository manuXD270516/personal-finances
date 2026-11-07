import type { CategoryTreeDto } from '@pf/classification/contracts';
import { attributionsOf, type ResolvedRateDto, type ValuationRateDto } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  plusDays,
  type Currency,
  type DatedAmount,
  type FlowRates,
  type Instant,
} from '@pf/shared-kernel';
import type {
  ReportAmountDto,
  ReportBaselineDto,
  ReportConversionMetaDto,
  ReportMetaDto,
  ReportPeriodDto,
  ReportVariationDto,
} from '../contracts/financial-reports.js';
import {
  ReportConversionPolicy,
  ReportPeriodCalendar,
  type ReportAmount,
  type ReportBaseline,
  type ReportCompareMode,
  type ReportGrouping,
  type ReportPeriod,
  type ReportVariation,
} from '../domain/index.js';
import type { FinancialReportsDeps } from './ports/financial-reports.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey } from './valuation-support.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface ReportParams {
  readonly userId: string | null;
  readonly workspaceId: string;
  readonly from: string;
  readonly to: string;
  readonly grouping?: ReportGrouping;
  readonly compare?: ReportCompareMode;
  readonly compareFrom?: string;
  readonly compareTo?: string;
  readonly normalize?: 'NONE' | 'PER_DAY';
  readonly rolling?: number;
  readonly reportingCurrency?: string;
  readonly conversion?: 'HISTORICAL' | 'CUTOFF';
  readonly accountIds?: readonly string[];
  readonly currencies?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly tagIds?: readonly string[];
  /** Con `tagIds`: cualquiera (por omisión) o todas las etiquetas (add-financial-reports-extended). */
  readonly tagMatch?: 'ANY' | 'ALL';
  readonly counterpartyIds?: readonly string[];
}

export const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/** Filtros ya normalizados (ids de categoría expandidos con sus subcategorías; ids malformados rechazados). */
export interface ReportFilters {
  readonly accountIds: readonly string[];
  readonly currencies: readonly string[];
  readonly categoryIds: readonly string[];
  /** Ids pedidos (sin expandir), para informarlos en `meta.filters`. */
  readonly requestedCategoryIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly tagMatch: 'ANY' | 'ALL';
  readonly counterpartyIds: readonly string[];
}

export interface Span {
  readonly from: string;
  readonly to: string;
}

/** Une rangos solapados o contiguos (para leer cada tramo UNA vez). */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from.localeCompare(b.from));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.from <= plusDays(LocalDate.parse(last.to), 1).toString()) {
      if (s.to > last.to) out[out.length - 1] = { from: last.from, to: s.to };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export const amountDto = (a: ReportAmount): ReportAmountDto => ({
  byCurrency: a.byCurrency.map((m) => m.toJSON()),
  consolidated: a.consolidated.toJSON(),
  complete: a.complete,
  unconverted: a.unconverted.map((m) => m.toJSON()),
});

export const periodDto = (p: ReportPeriod): ReportPeriodDto => ({
  label: p.label,
  from: p.from,
  to: p.to,
  partial: p.partial,
  days: p.days,
});

export const variationDto = (v: ReportVariation): ReportVariationDto => ({
  compared: amountDto(v.compared),
  deltaAbs: v.deltaAbs.toJSON(),
  deltaPct: v.deltaPct,
  isNew: v.isNew,
});

export const baselineDto = (b: ReportBaseline): ReportBaselineDto => ({
  periods: b.periods,
  average: b.average?.toJSON() ?? null,
  periodsUsed: b.periodsUsed,
  insufficient: b.insufficient,
  deltaAbs: b.deltaAbs?.toJSON() ?? null,
  deltaPct: b.deltaPct,
});

/**
 * Contexto de UNA petición de reporte (add-financial-reports, design decisión 2): moneda de reporte validada, hoy en la
 * zona del workspace, calendario de periodos, catálogo de monedas y de categorías, filtros normalizados y la única
 * resolución de tasas de la petición. Se crea dentro de la unidad de trabajo de lectura. Sin efectos.
 */
export class ReportContext {
  private rates: FlowRates<ResolvedRateDto> | null = null;
  private collectorRef: ReturnType<FlowRates<ResolvedRateDto>['collector']> | null = null;
  private readonly missing = new Map<string, Money>();
  private incomplete = false;

  private constructor(
    readonly deps: FinancialReportsDeps,
    readonly params: ReportParams,
    readonly timeZone: string,
    readonly known: ReadonlyMap<string, Currency>,
    readonly kinds: ReadonlyMap<string, string>,
    readonly reporting: Currency,
    readonly now: Instant,
    readonly today: string,
    readonly windowDays: number,
    readonly calendar: ReportPeriodCalendar,
    readonly tree: CategoryTreeDto,
    readonly filters: ReportFilters,
    readonly cutoff: string | null,
  ) {}

  /** Calendario de periodos del workspace y hoy en su zona (vistas guardadas con rango relativo). */
  static async calendarFor(
    deps: FinancialReportsDeps,
    workspaceId: string,
    grouping: ReportGrouping,
  ): Promise<{ calendar: ReportPeriodCalendar; today: string }> {
    const settings = await deps.workspaces.settingsOf(workspaceId);
    const today = LocalDate.ofInstant(deps.clock.now(), settings.timeZone).toString();
    const known = await deps.periods.listPeriods({ workspaceId });
    const startDay = deps.calendar ? (await deps.calendar.calendarOf(workspaceId)).fiscalMonthStartDay : null;
    const calendar = ReportPeriodCalendar.of(
      grouping,
      known.map((p) => ({
        label: p.label,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        ...(p.startDay !== undefined ? { startDay: p.startDay } : {}),
      })),
      startDay,
      today,
    );
    return { calendar, today };
  }

  static async create(deps: FinancialReportsDeps, params: ReportParams): Promise<ReportContext> {
    const ws = params.workspaceId;
    const settings = await deps.workspaces.settingsOf(ws);
    const catalog = await deps.rates.workspaceCurrencies(ws);
    const known = new Map(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const kinds = new Map(catalog.map((c) => [c.code, String(c.kind)]));
    const enabled = new Set(catalog.filter((c) => c.enabled).map((c) => c.code));
    const code = params.reportingCurrency ?? settings.baseCurrency;
    const reporting = enabled.has(code) ? known.get(code) : undefined;
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(
        '/reportingCurrency',
      );
    }
    for (const [list, pointer] of [
      [params.accountIds, '/accountId'],
      [params.categoryIds, '/categoryId'],
      [params.tagIds, '/tagId'],
      [params.counterpartyIds, '/counterpartyId'],
    ] as const) {
      if (list?.some((id) => !UUID.test(id))) throw invalid('the filter contains a malformed id', pointer);
    }
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, settings.timeZone).toString();
    const known1 = await deps.periods.listPeriods({ workspaceId: ws });
    const startDay = deps.calendar ? (await deps.calendar.calendarOf(ws)).fiscalMonthStartDay : null;
    const calendar = ReportPeriodCalendar.of(
      params.grouping ?? 'FINANCIAL_PERIOD',
      known1.map((p) => ({
        label: p.label,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        ...(p.startDay !== undefined ? { startDay: p.startDay } : {}),
      })),
      startDay,
      today,
    );
    const tree = await deps.categories.categoryTree({ userId: params.userId ?? '', workspaceId: ws });
    const requested = params.categoryIds ?? [];
    const expanded = [
      ...new Set(
        requested.flatMap((id) => [
          id,
          ...tree.categories.filter((c) => c.parentId === id).map((c) => c.categoryId),
        ]),
      ),
    ];
    if (params.tagMatch !== undefined && params.tagMatch !== 'ANY' && params.tagMatch !== 'ALL') {
      throw invalid('tagMatch must be ANY or ALL', '/tagMatch');
    }
    for (const c of params.currencies ?? []) {
      if (!/^[A-Z0-9]{2,16}$/u.test(c)) throw invalid('the currency filter is malformed', '/currency');
    }
    const cutoff = params.conversion === 'CUTOFF' ? (params.to < today ? params.to : today) : null;
    return new ReportContext(
      deps,
      params,
      settings.timeZone,
      known,
      kinds,
      reporting,
      now,
      today,
      deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS,
      calendar,
      tree,
      {
        accountIds: params.accountIds ?? [],
        currencies: params.currencies ?? [],
        categoryIds: expanded,
        requestedCategoryIds: requested,
        tagIds: params.tagIds ?? [],
        tagMatch: params.tagMatch ?? 'ANY',
        counterpartyIds: params.counterpartyIds ?? [],
      },
      cutoff,
    );
  }

  currencyOf(code: string, sample = '0'): Currency {
    return this.known.get(code) ?? makeCurrency(code, sample.split('.')[1]?.length ?? 0);
  }

  money(m: { readonly amount: string; readonly currency: string }): Money {
    return Money.parse(m.amount, this.currencyOf(m.currency, m.amount));
  }

  /** Fecha con la que se pide la tasa de un flujo fechado en `date` (la de corte si se pidió). */
  flowDate(date: string): string {
    return this.cutoff ?? date;
  }

  /** Resuelve, en UNA llamada, las tasas de todos los montos fechados de la petición (flujos y saldos). */
  async resolveRates(flows: readonly DatedAmount[]): Promise<void> {
    const { deps } = this;
    this.rates = await FlowValuation.resolveRates<ResolvedRateDto>({
      flows,
      target: this.reporting,
      timeZone: this.timeZone,
      now: this.now,
      windowDays: this.windowDays,
      resolve: async ({ requests, windowDays }) => {
        const found = await deps.rates.resolveValuationRates({
          workspaceId: this.params.workspaceId,
          requests,
          windowDays,
        });
        return found.map((r: ValuationRateDto | null) =>
          r ? { exact: r.exact, resolved: r.resolved } : null,
        );
      },
      keyOf: rateKey,
    });
    this.collectorRef = this.rates.collector();
  }

  private get collector() {
    if (!this.collectorRef) throw new Error('resolveRates must run before valuing');
    return this.collectorRef;
  }

  /** Política de los flujos: tasa de su día, o la de la fecha de corte si se pidió `CUTOFF`. */
  flowPolicy(): ReportConversionPolicy {
    const rateFor = this.collector.rateFor;
    return this.cutoff
      ? ReportConversionPolicy.cutoffDate(this.reporting, this.cutoff, rateFor)
      : ReportConversionPolicy.transactionDate(this.reporting, rateFor);
  }

  /** Política de los saldos: tasa de su fecha de valoración. */
  balancePolicy(): ReportConversionPolicy {
    return ReportConversionPolicy.valuationDate(this.reporting, this.collector.rateFor);
  }

  rateFor(code: string, date: string) {
    return this.collector.rateFor(code, date);
  }

  /** Tasa usada por un monto concreto (para el drill-down); `null` si es la moneda de reporte o no hay. */
  rateOf(code: string, date: string): ResolvedRateDto | null {
    if (code === this.reporting.code || !this.rates) return null;
    const mini = this.rates.collector();
    return mini.rateFor(code, this.flowDate(date)) ? (mini.used()[0] ?? null) : null;
  }

  /** Acumula la completitud de una cifra de la respuesta (los sin tasa se suman por moneda). */
  track(a: ReportAmount): void {
    if (!a.complete) this.incomplete = true;
    for (const m of a.unconverted) {
      const prev = this.missing.get(m.currency.code);
      this.missing.set(m.currency.code, prev ? prev.add(m) : m);
    }
  }

  conversionMeta(policy: ReportConversionMetaDto['policy']): ReportConversionMetaDto {
    const used = this.collectorRef?.used() ?? [];
    const attributions = new Map<string, string>();
    for (const r of used) for (const a of attributionsOf(r)) attributions.set(a.provider, a.text);
    return {
      policy: this.cutoff ? 'CUTOFF_DATE' : policy,
      cutoffDate: this.cutoff,
      rateWindowDays: this.windowDays,
      ratesUsed: used,
      attributions: [...attributions.values()],
    };
  }

  async meta(input: {
    readonly reportId: string;
    readonly periods: readonly ReportPeriod[];
    readonly comparison: ReportMetaDto['comparison'];
    readonly policy: ReportConversionMetaDto['policy'];
    readonly from?: string;
    readonly to?: string;
  }): Promise<ReportMetaDto> {
    const { deps } = this;
    const ws = this.params.workspaceId;
    // `latestEntryAt` sin fechas: solo la lectura de frescura (sin saldos).
    const fresh = await deps.balanceHistory.getAccountBalancesAtDates({
      workspaceId: ws,
      accountIds: [],
      dates: [],
    });
    return {
      reportId: input.reportId,
      reportingCurrency: this.reporting.code,
      grouping: this.calendar.grouping,
      from: input.from ?? this.params.from,
      to: input.to ?? this.params.to,
      periods: input.periods.map(periodDto),
      comparison: input.comparison,
      conversion: this.conversionMeta(input.policy),
      complete: !this.incomplete,
      unconverted: [...this.missing.values()].filter((m) => !m.isZero()).map((m) => m.toJSON()),
      dataVersion: await deps.versions.versionOf(ws),
      latestEntryAt: fresh.latestEntryAt,
      generatedAt: this.now.toString(),
      filters: {
        accountIds: this.filters.accountIds,
        currencies: this.filters.currencies,
        categoryIds: this.filters.requestedCategoryIds,
        tagIds: this.filters.tagIds,
        counterpartyIds: this.filters.counterpartyIds,
      },
    };
  }
}
