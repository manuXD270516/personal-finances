import { DomainError, LocalDate } from '@pf/shared-kernel';
import { MAX_REPORT_PERIODS, type ReportPeriod } from './report-periods.js';

/*
 * Vistas guardadas de reportes (FR-REPORTING-019, openspec add-financial-reports-extended). Una vista es un nombre más
 * una combinación de reporte, rango (relativo o fijo) y filtros: SOLO ids y parámetros, nunca montos ni resultados.
 */

/** Reportes que se pueden guardar (los disponibles del catálogo; el pronóstico vs real es de Phase 8). */
export const SAVEABLE_REPORTS: readonly string[] = [
  'INCOME_EXPENSES',
  'BUDGET_VS_ACTUAL',
  'EXPENSES_BY_CATEGORY',
  'EXPENSES_BY_TAG',
  'EXPENSES_BY_ACCOUNT',
  'MONTHLY_TRENDS',
  'CASH_FLOW',
  'NET_WORTH',
  'SAVINGS_GOALS',
  'DEBT_EVOLUTION',
  'RECURRING_COSTS',
  'SUBSCRIPTION_EVOLUTION',
  'FX_CONVERSIONS',
  'FEES',
];

/** Reportes que siempre agrupan por mes calendario (metas, deudas y suscripciones). */
export const MONTHLY_REPORTS: readonly string[] = [
  'SAVINGS_GOALS',
  'DEBT_EVOLUTION',
  'SUBSCRIPTION_EVOLUTION',
];

export const MAX_SAVED_VIEWS = 50;
export const MAX_VIEW_NAME = 80;
const MAX_LIST = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z0-9]{2,16}$/u;

export type ViewRange =
  | { readonly kind: 'FIXED'; readonly from: string; readonly to: string }
  | { readonly kind: 'LAST_N_PERIODS'; readonly periods: number }
  | { readonly kind: 'CURRENT_PERIOD' }
  | { readonly kind: 'PREVIOUS_PERIOD' };

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

const oneOf = (value: unknown, allowed: readonly string[], pointer: string): string => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw invalid(`must be one of ${allowed.join(', ')}`, pointer);
  }
  return value;
};

const idList = (value: unknown, pointer: string, pattern: RegExp): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_LIST ||
    !value.every((v) => typeof v === 'string' && pattern.test(v))
  ) {
    throw invalid(`must be a list of at most ${MAX_LIST} well-formed values`, pointer);
  }
  return [...new Set(value as string[])];
};

const date = (value: unknown, pointer: string): string => {
  try {
    return LocalDate.parse(String(value)).toString();
  } catch {
    throw invalid('must be a business date YYYY-MM-DD', pointer);
  }
};

function range(value: unknown): ViewRange {
  if (value === null || typeof value !== 'object') throw invalid('must be an object', '/params/range');
  const r = value as Record<string, unknown>;
  switch (r['kind']) {
    case 'FIXED': {
      const from = date(r['from'], '/params/range/from');
      const to = date(r['to'], '/params/range/to');
      if (from > to) throw invalid('from must not be after to', '/params/range/from');
      return { kind: 'FIXED', from, to };
    }
    case 'LAST_N_PERIODS': {
      const n = r['periods'];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_REPORT_PERIODS) {
        throw invalid(`periods must be between 1 and ${MAX_REPORT_PERIODS}`, '/params/range/periods');
      }
      return { kind: 'LAST_N_PERIODS', periods: n };
    }
    case 'CURRENT_PERIOD':
    case 'PREVIOUS_PERIOD':
      return { kind: r['kind'] };
    default:
      throw invalid('unknown range kind', '/params/range/kind');
  }
}

export type ViewParams = Readonly<Record<string, unknown>>;

/** Claves permitidas y su validación; cualquier otra (en particular cualquier monto o total) se rechaza. */
const VALIDATORS: Readonly<Record<string, (v: unknown) => unknown>> = {
  range,
  grouping: (v) => oneOf(v, ['FINANCIAL_PERIOD', 'CALENDAR_MONTH'], '/params/grouping'),
  compare: (v) =>
    oneOf(
      v,
      ['NONE', 'PREVIOUS_PERIOD', 'PREVIOUS_YEAR', 'PREVIOUS_PERIOD_TO_DATE', 'CUSTOM'],
      '/params/compare',
    ),
  compareFrom: (v) => date(v, '/params/compareFrom'),
  compareTo: (v) => date(v, '/params/compareTo'),
  normalize: (v) => oneOf(v, ['NONE', 'PER_DAY'], '/params/normalize'),
  rolling: (v) => {
    if (v !== 3 && v !== 6 && v !== 12) throw invalid('rolling must be 3, 6 or 12', '/params/rolling');
    return v;
  },
  reportingCurrency: (v) => {
    if (typeof v !== 'string' || !CODE.test(v))
      throw invalid('malformed currency code', '/params/reportingCurrency');
    return v;
  },
  conversion: (v) => oneOf(v, ['HISTORICAL', 'CUTOFF'], '/params/conversion'),
  accountIds: (v) => idList(v, '/params/accountIds', UUID),
  categoryIds: (v) => idList(v, '/params/categoryIds', UUID),
  tagIds: (v) => idList(v, '/params/tagIds', UUID),
  counterpartyIds: (v) => idList(v, '/params/counterpartyIds', UUID),
  goalIds: (v) => idList(v, '/params/goalIds', UUID),
  currencies: (v) => idList(v, '/params/currencies', CODE),
  tagMatch: (v) => oneOf(v, ['ANY', 'ALL'], '/params/tagMatch'),
  granularity: (v) => oneOf(v, ['PERIOD', 'WEEK', 'DAY'], '/params/granularity'),
  debtKind: (v) => oneOf(v, ['LOAN', 'CARD'], '/params/debtKind'),
  topN: (v) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 50) {
      throw invalid('topN must be between 1 and 50', '/params/topN');
    }
    return v;
  },
};

export interface ValidatedView {
  readonly reportId: string;
  readonly name: string;
  readonly params: ViewParams;
}

export const SavedReportViewRules = {
  /** Nombre de 1 a 80 caracteres (se recorta). */
  name(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length < 1 || name.length > MAX_VIEW_NAME) {
      throw invalid(`name must have between 1 and ${MAX_VIEW_NAME} characters`, '/name');
    }
    return name;
  },

  reportId(value: unknown): string {
    if (typeof value !== 'string' || !SAVEABLE_REPORTS.includes(value)) {
      throw invalid('this report cannot be saved as a view', '/reportId');
    }
    return value;
  },

  /** Valida y normaliza los parámetros: solo claves conocidas, sin montos ni resultados. */
  params(value: unknown): ViewParams {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw invalid('params must be an object', '/params');
    }
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const validate = VALIDATORS[key];
      if (!validate)
        throw invalid(`unknown parameter ${key}: a view only stores ids and filters`, `/params/${key}`);
      out[key] = validate(raw);
    }
    if (out['compare'] === 'CUSTOM' && (out['compareFrom'] === undefined || out['compareTo'] === undefined)) {
      throw invalid('CUSTOM comparison needs compareFrom and compareTo', '/params/compareFrom');
    }
    return out;
  },

  validate(input: { reportId: unknown; name: unknown; params: unknown }): ValidatedView {
    return {
      reportId: this.reportId(input.reportId),
      name: this.name(input.name),
      params: this.params(input.params),
    };
  },

  /**
   * Rango calculado desde hoy. `LAST_N_PERIODS` termina en el periodo que contiene hoy (incluido, aunque esté en curso) y
   * cubre N periodos; `CURRENT_PERIOD` y `PREVIOUS_PERIOD` son el actual y el anterior completos.
   */
  resolveRange(
    r: ViewRange,
    calendar: {
      periodOf(date: string): ReportPeriod;
      previous(period: { readonly from: string }): ReportPeriod;
      priorPeriods(period: { readonly from: string }, count: number): ReportPeriod[];
    },
    today: string,
  ): { from: string; to: string } {
    if (r.kind === 'FIXED') return { from: r.from, to: r.to };
    const current = calendar.periodOf(today);
    if (r.kind === 'CURRENT_PERIOD') return { from: current.from, to: current.to };
    if (r.kind === 'PREVIOUS_PERIOD') {
      const previous = calendar.previous(current);
      return { from: previous.from, to: previous.to };
    }
    const prior = r.periods > 1 ? calendar.priorPeriods(current, r.periods - 1) : [];
    return { from: (prior.at(-1) ?? current).from, to: current.to };
  },

  /** Parámetros de consulta del reporte (nombres del contrato HTTP) con el rango ya calculado. */
  query(
    params: ViewParams,
    resolved: { from: string; to: string } | null,
  ): Record<string, string | string[]> {
    const q: Record<string, string | string[]> = {};
    if (resolved) {
      q['from'] = resolved.from;
      q['to'] = resolved.to;
    }
    const plural: Record<string, string> = {
      accountIds: 'accountId',
      categoryIds: 'categoryId',
      tagIds: 'tagId',
      counterpartyIds: 'counterpartyId',
      goalIds: 'goalId',
      currencies: 'currency',
    };
    for (const [key, value] of Object.entries(params)) {
      if (key === 'range') continue;
      if (plural[key]) q[plural[key] as string] = value as string[];
      else q[key] = String(value);
    }
    return q;
  },
} as const;
