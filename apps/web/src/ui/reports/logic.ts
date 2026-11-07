import { formatSignedDecimal } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';

/**
 * Lógica pura de la sección de reportes (add-financial-reports, FR-REPORTING-008..012): modelo de filtros con estado en
 * la URL (compartible), rutas de la API, y utilidades de presentación. Los montos viajan como texto decimal exacto:
 * nunca pasan por `number` (solo las proporciones de las barras, calculadas con enteros).
 */

export interface ReportAmount {
  readonly byCurrency: readonly Money[];
  readonly consolidated: Money;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}
export interface ReportPeriod {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly partial: boolean;
  readonly days: number;
}
export interface ReportVariation {
  readonly compared: ReportAmount;
  readonly deltaAbs: Money;
  readonly deltaPct: string | null;
  readonly isNew: boolean;
}
export interface ReportBaseline {
  readonly periods: number;
  readonly average: Money | null;
  readonly insufficient: boolean;
  readonly deltaAbs: Money | null;
  readonly deltaPct: string | null;
}
export interface ResolvedRateLite {
  readonly rate: { readonly base: string; readonly quote: string; readonly value: string };
  readonly rateType: string;
  readonly source: string;
  readonly provider: string | null;
  readonly asOf: string;
}
export interface ReportMeta {
  readonly reportId: string;
  readonly reportingCurrency: string;
  readonly grouping: string;
  readonly from: string;
  readonly to: string;
  readonly periods: readonly ReportPeriod[];
  readonly comparison: {
    readonly mode: string;
    readonly from: string;
    readonly to: string;
    readonly days: number;
    readonly currentDays: number;
    readonly normalized: boolean;
  } | null;
  readonly conversion: {
    readonly policy: string;
    readonly cutoffDate: string | null;
    readonly rateWindowDays: number;
    readonly ratesUsed: readonly ResolvedRateLite[];
    readonly attributions: readonly string[];
  };
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
  readonly generatedAt: string;
}

export interface IncomeExpensesRow {
  readonly period: ReportPeriod;
  readonly income: ReportAmount;
  readonly expenses: ReportAmount;
  readonly savings: ReportAmount;
  readonly savingsRate: string | null;
  readonly comparison: {
    readonly income: ReportVariation;
    readonly expenses: ReportVariation;
    readonly savings: ReportVariation;
  } | null;
  readonly baseline: {
    readonly income: ReportBaseline;
    readonly expenses: ReportBaseline;
    readonly savings: ReportBaseline;
  } | null;
}
export interface IncomeExpensesReport {
  readonly meta: ReportMeta;
  readonly granularity: 'PERIOD' | 'WEEK';
  readonly rows: readonly IncomeExpensesRow[];
  readonly totals: Omit<IncomeExpensesRow, 'period' | 'baseline'>;
}
export interface CategoryLeaf {
  readonly categoryId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly amount: ReportAmount;
  readonly negativeNet: boolean;
  readonly comparison: ReportVariation | null;
  readonly subcategories?: readonly CategoryLeaf[];
}
export interface ExpensesByCategoryReport {
  readonly meta: ReportMeta;
  readonly groups: readonly {
    readonly groupId: string;
    readonly name: string;
    readonly amount: ReportAmount;
    readonly negativeNet: boolean;
    readonly comparison: ReportVariation | null;
    readonly categories: readonly CategoryLeaf[];
  }[];
  readonly others: ReportAmount | null;
  readonly total: ReportAmount;
}
export interface BudgetVsActualReport {
  readonly meta: ReportMeta;
  readonly periods: readonly {
    readonly period: ReportPeriod;
    readonly status: 'BUDGETED' | 'NO_BUDGET';
    readonly periodId: string;
    readonly currency: string | null;
    readonly lines: readonly {
      readonly budgetLineId: string;
      readonly target: { readonly kind: string; readonly id: string; readonly name: string };
      readonly nature: string;
      readonly reference: Money;
      readonly actual: Money;
      readonly actualComplete: boolean;
      readonly status: string;
    }[];
  }[];
}
export interface CashFlowReport {
  readonly meta: ReportMeta;
  readonly periods: readonly {
    readonly period: ReportPeriod;
    readonly byCurrency: readonly Record<string, Money | string>[];
    readonly consolidated: Record<string, Money | boolean | readonly Money[]>;
    readonly comparison: Record<string, ReportVariation> | null;
  }[];
}
export interface AccountBalanceHistoryReport {
  readonly meta: ReportMeta;
  readonly accountId: string;
  readonly currency: string;
  readonly opening: Money;
  readonly days: readonly {
    readonly date: string;
    readonly balance: Money;
    readonly valued: Money | null;
    readonly hasMovements: boolean;
    readonly reconciled: boolean;
  }[];
  readonly closing: Money;
}
export interface NetWorthReport {
  readonly meta: ReportMeta;
  readonly granularity: 'PERIOD' | 'DAY';
  readonly points: readonly { readonly date: string; readonly netWorth: ReportAmount }[];
  readonly decomposition: readonly {
    readonly period: ReportPeriod;
    readonly opening: Money;
    readonly closing: Money;
    readonly savings: Money;
    readonly conversionResult: Money;
    readonly adjustments: Money;
    readonly otherMovements: Money;
    readonly fxRevaluation: Money;
    readonly assetRevaluation: Money;
    readonly revaluationByCurrency: readonly {
      readonly currency: string;
      readonly kind: string;
      readonly amount: Money;
    }[];
    readonly complete: boolean;
    readonly unvalued: readonly Money[];
  }[];
}
export interface DrillRow {
  readonly transactionId: string | null;
  readonly splitId: string | null;
  readonly journalEntryId: string | null;
  readonly date: string;
  readonly accountId: string | null;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly component: string | null;
  readonly amount: Money;
  readonly valued: Money | null;
}
export interface DrillDownPage {
  readonly meta: ReportMeta;
  readonly kind: string;
  readonly totals: ReportAmount;
  readonly count: number;
  readonly rows: readonly DrillRow[];
  readonly nextCursor: string | null;
}
export interface TagsReport {
  readonly meta: ReportMeta;
  readonly nonAdditive: true;
  readonly tagMatch: 'ANY' | 'ALL';
  readonly tags: readonly {
    readonly tagId: string;
    readonly name: string;
    readonly archived: boolean;
    readonly amount: ReportAmount;
    readonly comparison: ReportVariation | null;
  }[];
}
export interface AccountsReport {
  readonly meta: ReportMeta;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly type: string;
    readonly institutionId: string | null;
    readonly amount: ReportAmount;
    readonly comparison: ReportVariation | null;
    readonly byCategory: readonly {
      readonly categoryId: string;
      readonly name: string;
      readonly amount: ReportAmount;
    }[];
  }[];
  readonly total: ReportAmount;
  readonly totalComparison: ReportVariation | null;
}
export interface TrendsReport {
  readonly meta: ReportMeta;
  readonly normalized: boolean;
  readonly series: readonly {
    readonly categoryId: string | null;
    readonly name: string;
    readonly total: ReportAmount;
    readonly cells: readonly { readonly period: ReportPeriod; readonly amount: ReportAmount }[];
  }[];
}
export interface FeesReport {
  readonly meta: ReportMeta;
  readonly months: readonly {
    readonly period: ReportPeriod;
    readonly byType: readonly { readonly type: string; readonly amount: ReportAmount }[];
    readonly total: ReportAmount;
  }[];
  readonly last12Months: ReportAmount;
}
export interface GoalsReport {
  readonly meta: ReportMeta;
  readonly goals: readonly {
    readonly goalId: string;
    readonly name: string;
    readonly currency: string;
    readonly target: Money;
    readonly months: readonly {
      readonly period: string;
      readonly monthEnd: string;
      readonly contributions: Money;
      readonly withdrawals: Money;
      readonly accumulated: Money;
      readonly percent: string | null;
      readonly expected: Money | null;
      readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
      readonly complete: boolean;
    }[];
  }[];
}
export interface DebtsReport {
  readonly meta: ReportMeta;
  readonly debts: readonly {
    readonly debtId: string;
    readonly kind: 'LOAN' | 'CARD';
    readonly name: string;
    readonly currency: string;
    readonly months: readonly {
      readonly period: ReportPeriod;
      readonly outstanding: Money;
      readonly principalPaid: Money | null;
      readonly interestPaid: Money | null;
      readonly chargesPaid: Money | null;
    }[];
  }[];
  readonly consolidated: readonly {
    readonly period: ReportPeriod;
    readonly outstanding: ReportAmount;
    readonly principalPaid: ReportAmount;
    readonly interestPaid: ReportAmount;
  }[];
}
export interface RecurringCostsReport {
  readonly meta: ReportMeta;
  readonly items: readonly {
    readonly definitionId: string;
    readonly name: string;
    readonly cadence: string;
    readonly interval: number;
    readonly variable: boolean;
    readonly monthly: Money | null;
    readonly annual: Money | null;
    readonly monthlyReporting: Money | null;
  }[];
  readonly totals: { readonly monthly: ReportAmount; readonly annual: ReportAmount };
  readonly variableCount: number;
}
export interface SubscriptionsReport {
  readonly meta: ReportMeta;
  readonly months: readonly {
    readonly period: ReportPeriod;
    readonly monthlyCost: ReportAmount;
    readonly active: number;
    readonly events: readonly {
      readonly date: string;
      readonly subscriptionId: string;
      readonly name: string;
      readonly kind: 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED';
      readonly previousPrice: Money | null;
      readonly newPrice: Money | null;
    }[];
  }[];
}
export interface ConversionsReport {
  readonly meta: ReportMeta;
  readonly points: readonly {
    readonly transactionId: string;
    readonly date: string;
    readonly pair: string;
    readonly effectiveRate: string;
    readonly referenceRate: string | null;
  }[];
  readonly months: readonly {
    readonly period: ReportPeriod;
    readonly cost: Money;
    readonly conversions: number;
    readonly excluded: number;
    readonly costComplete: boolean;
  }[];
  readonly costTotal: Money;
  readonly costComplete: boolean;
}

/** Vista guardada (FR-REPORTING-019): solo ids y parámetros; al abrirla trae la consulta lista y sus avisos. */
export interface SavedViewLite {
  readonly id: string;
  readonly reportId: string;
  readonly name: string;
  readonly version: number;
}
export interface OpenedSavedView extends SavedViewLite {
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly warnings: readonly {
    readonly code: 'ARCHIVED_FILTER' | 'MISSING_FILTER';
    readonly kind: 'CATEGORY' | 'ACCOUNT' | 'TAG' | 'COUNTERPARTY';
    readonly id: string;
    readonly name: string | null;
  }[];
}

/** Parámetros de una vista guardada desde los filtros aplicados: rango fijo o relativo (últimos N periodos). */
export function savedViewParams(
  f: ReportFilters,
  range: 'FIXED' | 'LAST_3' | 'LAST_6' | 'LAST_12',
  slug: ReportSlug,
): Record<string, unknown> {
  const list = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const out: Record<string, unknown> = {};
  const allowed = SLUG_PARAMS[slug];
  if (!RANGELESS_SLUGS.includes(slug)) {
    out['range'] =
      range === 'FIXED'
        ? { kind: 'FIXED', from: f.from, to: f.to }
        : { kind: 'LAST_N_PERIODS', periods: Number(range.slice(5)) };
  }
  const put = (key: string, value: unknown, param: string) => {
    if (value === '' || (Array.isArray(value) && value.length === 0)) return;
    if (allowed && !allowed.includes(param)) return;
    out[key] = value;
  };
  put('grouping', f.grouping === 'CALENDAR_MONTH' ? 'CALENDAR_MONTH' : '', 'grouping');
  put('compare', f.compare === 'NONE' || f.compare === 'CUSTOM' ? '' : f.compare, 'compare');
  put('normalize', f.normalize ? 'PER_DAY' : '', 'normalize');
  put('rolling', f.rolling ? Number(f.rolling) : '', 'rolling');
  put('reportingCurrency', f.reportingCurrency, 'reportingCurrency');
  put('conversion', f.conversion === 'CUTOFF' ? 'CUTOFF' : '', 'conversion');
  put('accountIds', list(f.accountIds), 'accountId');
  put('currencies', list(f.currencies), 'currency');
  put('categoryIds', list(f.categoryIds), 'categoryId');
  put('tagIds', list(f.tagIds), 'tagId');
  put('counterpartyIds', list(f.counterpartyIds), 'counterpartyId');
  put('tagMatch', f.tagMatch === 'ALL' ? 'ALL' : '', 'tagMatch');
  put('debtKind', f.debtKind, 'debtKind');
  return out;
}

/** Filtros desde la consulta ya calculada de una vista guardada (el rango relativo viene resuelto por la API). */
export function filtersFromView(
  query: Readonly<Record<string, string | readonly string[]>>,
  today: string,
): ReportFilters {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const item of v) search.append(k, item);
    else search.set(k, String(v));
  }
  return filtersFromSearch(search, today);
}

export interface CatalogEntry {
  readonly reportId: string;
  readonly number: number;
  readonly status: 'AVAILABLE' | 'PARTIAL' | 'PLANNED';
  readonly phase: number;
  readonly plannedIn: string | null;
  readonly endpoint: string | null;
  readonly viewPath: string | null;
}

/** Reportes disponibles de la sección: slug de la URL, id del contrato y ruta de la API. */
export const REPORT_SLUGS = {
  'ingresos-gastos': { id: 'INCOME_EXPENSES', api: 'income-expenses' },
  'presupuesto-vs-real': { id: 'BUDGET_VS_ACTUAL', api: 'budget-vs-actual' },
  'gastos-por-categoria': { id: 'EXPENSES_BY_CATEGORY', api: 'expenses/by-category' },
  'flujo-de-caja': { id: 'CASH_FLOW', api: 'cash-flow' },
  patrimonio: { id: 'NET_WORTH', api: 'net-worth' },
  'historial-de-saldo': { id: 'ACCOUNT_BALANCE_HISTORY', api: 'accounts/{accountId}/balance-history' },
  // add-financial-reports-extended
  'gastos-por-etiqueta': { id: 'EXPENSES_BY_TAG', api: 'expenses/by-tag' },
  'gastos-por-cuenta': { id: 'EXPENSES_BY_ACCOUNT', api: 'expenses/by-account' },
  tendencias: { id: 'MONTHLY_TRENDS', api: 'trends' },
  comisiones: { id: 'FEES', api: 'fees' },
  metas: { id: 'SAVINGS_GOALS', api: 'goals' },
  deudas: { id: 'DEBT_EVOLUTION', api: 'debts' },
  'costos-recurrentes': { id: 'RECURRING_COSTS', api: 'recurring' },
  suscripciones: { id: 'SUBSCRIPTION_EVOLUTION', api: 'subscriptions' },
  conversiones: { id: 'FX_CONVERSIONS', api: 'conversions' },
} as const;

const COMMON_PARAMS = [
  'from',
  'to',
  'grouping',
  'compare',
  'compareFrom',
  'compareTo',
  'normalize',
  'rolling',
  'reportingCurrency',
  'conversion',
  'accountId',
  'currency',
  'categoryId',
  'tagId',
  'tagMatch',
  'counterpartyId',
];
/** Parámetros que acepta la API de cada reporte ampliado (los demás se omiten: el contrato rechaza lo desconocido). */
const SLUG_PARAMS: Partial<Record<string, readonly string[]>> = {
  'gastos-por-etiqueta': COMMON_PARAMS,
  'gastos-por-cuenta': COMMON_PARAMS,
  tendencias: COMMON_PARAMS,
  comisiones: COMMON_PARAMS,
  conversiones: COMMON_PARAMS,
  metas: ['from', 'to', 'reportingCurrency'],
  deudas: ['from', 'to', 'reportingCurrency', 'conversion', 'debtKind'],
  'costos-recurrentes': ['reportingCurrency', 'currency', 'categoryId'],
  suscripciones: ['from', 'to', 'reportingCurrency'],
};
/** Reportes ampliados sin rango (la vista no pide fechas). */
export const RANGELESS_SLUGS: readonly string[] = ['costos-recurrentes'];

/** Deja solo los parámetros que acepta la API del reporte. */
function forSlug(q: URLSearchParams, slug: string): URLSearchParams {
  const allowed = SLUG_PARAMS[slug];
  if (!allowed) return q;
  const out = new URLSearchParams();
  for (const [k, v] of q) if (allowed.includes(k)) out.append(k, v);
  return out;
}
export type ReportSlug = keyof typeof REPORT_SLUGS;
export const isReportSlug = (slug: string): slug is ReportSlug => slug in REPORT_SLUGS;
export const slugOf = (id: string): ReportSlug | undefined =>
  (Object.keys(REPORT_SLUGS) as ReportSlug[]).find((s) => REPORT_SLUGS[s].id === id);

export interface ReportFilters {
  readonly from: string;
  readonly to: string;
  readonly grouping: 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';
  readonly compare: 'NONE' | 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR' | 'CUSTOM' | 'PREVIOUS_PERIOD_TO_DATE';
  readonly compareFrom: string;
  readonly compareTo: string;
  readonly normalize: boolean;
  readonly rolling: '' | '3' | '6' | '12';
  readonly reportingCurrency: string;
  readonly conversion: 'HISTORICAL' | 'CUTOFF';
  readonly granularity: string;
  readonly topN: string;
  /** Coincidencia de etiquetas (`ANY` por omisión) y tipo de deuda del reporte de deudas. */
  readonly tagMatch: 'ANY' | 'ALL';
  readonly debtKind: '' | 'LOAN' | 'CARD';
  readonly accountId: string;
  /** Listas separadas por coma (uuid o códigos) para cuentas, monedas, categorías, etiquetas y contrapartes. */
  readonly accountIds: string;
  readonly currencies: string;
  readonly categoryIds: string;
  readonly tagIds: string;
  readonly counterpartyIds: string;
}

/** Filtros por omisión: el último año completo hasta hoy, por periodo financiero y sin comparación (D363). */
export function defaultFilters(today: string): ReportFilters {
  const [y = '2026', m = '01'] = today.split('-');
  const to = today;
  const from = `${String(Number(y) - 1)}-${m}-01`;
  return {
    from,
    to,
    grouping: 'FINANCIAL_PERIOD',
    compare: 'NONE',
    compareFrom: '',
    compareTo: '',
    normalize: false,
    rolling: '',
    reportingCurrency: '',
    conversion: 'HISTORICAL',
    granularity: '',
    topN: '',
    tagMatch: 'ANY',
    debtKind: '',
    accountId: '',
    accountIds: '',
    currencies: '',
    categoryIds: '',
    tagIds: '',
    counterpartyIds: '',
  };
}

const LIST_PARAMS = [
  ['accountIds', 'accountId'],
  ['currencies', 'currency'],
  ['categoryIds', 'categoryId'],
  ['tagIds', 'tagId'],
  ['counterpartyIds', 'counterpartyId'],
] as const;

/** Filtros desde la URL (`URLSearchParams`); lo ausente toma el valor por omisión. */
export function filtersFromSearch(search: URLSearchParams, today: string): ReportFilters {
  const d = defaultFilters(today);
  const get = (k: string) => search.get(k) ?? undefined;
  const list = (k: string) => search.getAll(k).join(',');
  return {
    ...d,
    from: get('from') ?? d.from,
    to: get('to') ?? d.to,
    grouping: (get('grouping') as ReportFilters['grouping'] | undefined) ?? d.grouping,
    compare: (get('compare') as ReportFilters['compare'] | undefined) ?? d.compare,
    compareFrom: get('compareFrom') ?? '',
    compareTo: get('compareTo') ?? '',
    normalize: get('normalize') === 'PER_DAY',
    rolling: (get('rolling') as ReportFilters['rolling'] | undefined) ?? '',
    reportingCurrency: get('reportingCurrency') ?? '',
    conversion: (get('conversion') as ReportFilters['conversion'] | undefined) ?? 'HISTORICAL',
    granularity: get('granularity') ?? '',
    topN: get('topN') ?? '',
    tagMatch: get('tagMatch') === 'ALL' ? 'ALL' : 'ANY',
    debtKind: (get('debtKind') as ReportFilters['debtKind'] | undefined) ?? '',
    accountId: get('historyAccount') ?? '',
    accountIds: list('accountId'),
    currencies: list('currency'),
    categoryIds: list('categoryId'),
    tagIds: list('tagId'),
    counterpartyIds: list('counterpartyId'),
  };
}

/** Parámetros de consulta de los filtros (estado de la URL y petición a la API comparten la serialización). */
export function filtersToParams(
  f: ReportFilters,
  defaults: ReportFilters,
  forApi = false,
  slug?: ReportSlug,
): URLSearchParams {
  const q = new URLSearchParams();
  q.set('from', f.from);
  q.set('to', f.to);
  if (f.grouping !== defaults.grouping) q.set('grouping', f.grouping);
  if (f.compare !== 'NONE') {
    q.set('compare', f.compare);
    if (f.compare === 'CUSTOM') {
      if (f.compareFrom) q.set('compareFrom', f.compareFrom);
      if (f.compareTo) q.set('compareTo', f.compareTo);
    }
    if (f.normalize) q.set('normalize', 'PER_DAY');
  }
  if (f.normalize && f.compare === 'NONE' && slug === 'tendencias') q.set('normalize', 'PER_DAY');
  if (f.rolling) q.set('rolling', f.rolling);
  if (f.reportingCurrency) q.set('reportingCurrency', f.reportingCurrency);
  if (f.conversion === 'CUTOFF') q.set('conversion', 'CUTOFF');
  if (f.granularity) q.set('granularity', f.granularity);
  if (f.topN) q.set('topN', f.topN);
  if (f.tagMatch === 'ALL') q.set('tagMatch', 'ALL');
  if (f.debtKind) q.set('debtKind', f.debtKind);
  for (const [key, param] of LIST_PARAMS) {
    for (const v of f[key]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean))
      q.append(param, v);
  }
  if (!forApi && f.accountId) q.set('historyAccount', f.accountId);
  return q;
}

/** Error de validación local de los filtros (`null` si son válidos). */
export function filterError(f: ReportFilters): 'range' | 'custom' | null {
  if (!f.from || !f.to || f.from > f.to) return 'range';
  if (f.compare === 'CUSTOM' && (!f.compareFrom || !f.compareTo || f.compareFrom > f.compareTo))
    return 'custom';
  return null;
}

export function reportApiPath(
  base: string,
  slug: ReportSlug,
  f: ReportFilters,
  defaults: ReportFilters,
): string {
  const q = forSlug(filtersToParams(f, defaults, true, slug), slug).toString();
  const api = REPORT_SLUGS[slug].api.replace('{accountId}', f.accountId);
  return `${base}/reports/${api}${q ? `?${q}` : ''}`;
}

export function exportApiPath(
  base: string,
  slug: ReportSlug,
  f: ReportFilters,
  defaults: ReportFilters,
): string {
  const q = forSlug(filtersToParams(f, defaults, true, slug), slug).toString();
  const api = REPORT_SLUGS[slug].api.replace('{accountId}', f.accountId);
  return `${base}/reports/${api}/export${q ? `?${q}` : ''}`;
}

/** Celda abierta en el panel de drill-down. */
export interface DrillCell {
  readonly report: string;
  readonly title: string;
  readonly from: string;
  readonly to: string;
  readonly extra: Readonly<Record<string, string>>;
}

export function drillQuery(cell: DrillCell, f: ReportFilters, defaults: ReportFilters): URLSearchParams {
  const q = filtersToParams(
    { ...f, from: cell.from, to: cell.to, compare: 'NONE', rolling: '' },
    defaults,
    true,
  );
  q.set('report', cell.report);
  // Una celda de etiqueta se abre solo con esa etiqueta (sin los demás filtros de etiquetas ni su coincidencia).
  if (cell.extra['tagId']) q.delete('tagMatch');
  for (const [k, v] of Object.entries(cell.extra)) q.set(k, v);
  return q;
}

export const drillPath = (
  base: string,
  cell: DrillCell,
  f: ReportFilters,
  d: ReportFilters,
  cursor?: string,
) => {
  const q = drillQuery(cell, f, d);
  q.set('limit', '50');
  if (cursor) q.set('cursor', cursor);
  return `${base}/reports/drill-down?${q.toString()}`;
};
export const drillExportPath = (base: string, cell: DrillCell, f: ReportFilters, d: ReportFilters) =>
  `${base}/reports/drill-down/export?${drillQuery(cell, f, d).toString()}`;

// ───────────────────────────────────────────── presentación

const fractionDigits = (amount: string): number => amount.split('.')[1]?.length ?? 0;
function scaled(decimal: string, scale: number): bigint {
  const negative = decimal.startsWith('-');
  const [int = '0', frac = ''] = decimal.replace(/^[-+]/, '').split('.');
  const digits = BigInt(`${int || '0'}${frac.padEnd(scale, '0').slice(0, scale)}`);
  return negative ? -digits : digits;
}

/** Posición [0, 1] de `value` entre `min` y `max` (solo geometría de los gráficos; enteros exactos, 1/1000). */
export function ratioBetween(value: string, min: string, max: string): number {
  const scale = Math.max(fractionDigits(value), fractionDigits(min), fractionDigits(max));
  const [v, lo, hi] = [scaled(value, scale), scaled(min, scale), scaled(max, scale)];
  if (hi <= lo) return 0.5;
  const clamped = v < lo ? lo : v > hi ? hi : v;
  return Number(((clamped - lo) * 1000n) / (hi - lo)) / 1000;
}

export const lowestAmount = (values: readonly string[]): string => {
  if (values.length === 0) return '0';
  const scale = Math.max(...values.map(fractionDigits));
  return values.reduce((m, v) => (scaled(v, scale) < scaled(m, scale) ? v : m));
};
export const highestAmount = (values: readonly string[]): string => {
  if (values.length === 0) return '0';
  const scale = Math.max(...values.map(fractionDigits));
  return values.reduce((m, v) => (scaled(v, scale) > scaled(m, scale) ? v : m));
};

export type VariationTone = 'up' | 'down' | 'same' | 'new';

/** Dirección de una variación (el significado semántico —gasto sube = malo— lo decide la vista). */
export function toneOf(v: { deltaAbs: Money; isNew: boolean }): VariationTone {
  if (v.isNew) return 'new';
  if (/^-?0*(\.0*)?$/.test(v.deltaAbs.amount)) return 'same';
  return v.deltaAbs.amount.startsWith('-') ? 'down' : 'up';
}

export const TONE_ICON: Record<VariationTone, string> = { up: '▲', down: '▼', same: '■', new: '●' };

/** `+800,00 BOB (+26,67 %)` o `+150,00 BOB (nuevo)`. */
export function variationText(
  v: { deltaAbs: Money; deltaPct: string | null; isNew: boolean },
  f: FormatContext,
): string {
  const delta = `${formatSignedDecimal(v.deltaAbs.amount, f.locale)} ${v.deltaAbs.currency}`;
  if (v.isNew) return `${delta} (${f.t('variation.new')})`;
  if (v.deltaPct === null) return delta;
  return `${delta} (${formatSignedDecimal(v.deltaPct, f.locale)} %)`;
}

/** Etiqueta corta de una fecha de negocio `YYYY-MM-DD` → `dd/mm`. */
export const shortDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
