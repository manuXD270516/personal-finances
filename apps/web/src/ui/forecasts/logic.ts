import { formatDecimal } from '../AuditHistory';
import type { ForecastPoint, ForecastScope, ForecastSeries, Money } from './types';

/** Ruta de la vista (sin prefijo de locale) y parámetros de URL: `horizonte` y `serie`. */
export const FORECASTS_PATH = '/pronosticos';
export const FORECAST_HORIZONS = [1, 3, 6, 12] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
export const DEFAULT_FORECAST_HORIZON: ForecastHorizon = 3;

export const isForecastHorizon = (value: number): value is ForecastHorizon =>
  (FORECAST_HORIZONS as readonly number[]).includes(value);

/** Horizonte de un parámetro de URL: solo 1/3/6/12; cualquier otro valor cae al de 3 periodos. */
export function parseHorizon(raw: string | null | undefined): ForecastHorizon {
  const n = raw && /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN;
  return isForecastHorizon(n) ? n : DEFAULT_FORECAST_HORIZON;
}

/** Clave estable de una serie para el selector (`TOTAL_EXPENSE`, `CATEGORY:<id>`). */
export const seriesKey = (s: Pick<ForecastSeries, 'scope' | 'scopeRef'>): string =>
  s.scopeRef ? `${s.scope}:${s.scopeRef}` : s.scope;

const SCOPE_ORDER: Record<ForecastScope, number> = {
  TOTAL_EXPENSE: 0,
  TOTAL_INCOME: 1,
  CATEGORY_GROUP: 2,
  CATEGORY: 3,
  OTHER_CATEGORIES: 4,
};

/** Series en el orden del selector: totales, grupos, categorías y «otras categorías»; por nombre dentro de cada tipo. */
export function sortSeries(series: readonly ForecastSeries[]): ForecastSeries[] {
  return [...series].sort(
    (a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.name.localeCompare(b.name, 'es'),
  );
}

/** Serie elegida: la pedida si existe y, si no, el gasto total (o la primera). */
export function pickSeries(
  series: readonly ForecastSeries[],
  key: string | undefined,
): ForecastSeries | undefined {
  const sorted = sortSeries(series);
  return sorted.find((s) => seriesKey(s) === key) ?? sorted[0];
}

const SYMBOLS: Record<string, string> = { BOB: 'Bs', USD: 'US$', EUR: '€' };

/** Monto con el símbolo de la moneda (`Bs 4.408,00`) y los separadores del locale; sin pasar por `number`. */
export const formatForecastMoney = (m: Money, locale: string): string =>
  `${SYMBOLS[m.currency] ?? m.currency} ${formatDecimal(m.amount, locale)}`;

/** Decimal con signo explícito (`+120,00`, `−12,00`). */
export function formatSigned(m: Money, locale: string): string {
  const negative = m.amount.startsWith('-');
  const unsigned = negative ? m.amount.slice(1) : m.amount;
  const zero = /^0*(\.0*)?$/.test(unsigned);
  const sign = zero ? '' : negative ? '−' : '+';
  return `${sign}${SYMBOLS[m.currency] ?? m.currency} ${formatDecimal(unsigned, locale)}`;
}

/** Etiqueta del periodo (`2026-12` → `dic 2026`) en el locale de formato. */
export function formatPeriod(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

export const compareDecimal = (a: string, b: string): number => {
  const [ai = '0', af = ''] = a.replace('-', '').split('.');
  const [bi = '0', bf = ''] = b.replace('-', '').split('.');
  const neg = (s: string) => s.startsWith('-') && /[1-9]/.test(s);
  const sa = neg(a) ? -1 : 1;
  const sb = neg(b) ? -1 : 1;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const na = `${ai.padStart(30, '0')}${af.padEnd(len, '0')}`;
  const nb = `${bi.padStart(30, '0')}${bf.padEnd(len, '0')}`;
  const c = na < nb ? -1 : na > nb ? 1 : 0;
  return sa === -1 ? -c : c;
};

/** Puntos de la serie hasta el horizonte pedido. */
export const pointsUpTo = (s: ForecastSeries, horizon: number): ForecastPoint[] =>
  s.points.filter((p) => p.monthsAhead <= horizon);

/** Periodos que faltan para un pronóstico estadístico (`TOO_FEW_PERIODS`), o `null`. */
export function missingPeriods(s: ForecastSeries): number | null {
  const reason = s.readinessReasons.find((r) => r.code === 'TOO_FEW_PERIODS');
  return reason?.missingForModel ?? null;
}

export const hasReason = (s: ForecastSeries, code: string): boolean =>
  s.readinessReasons.some((r) => r.code === code);

/** Ruta de la API de la vista: un solo pedido con todas las series y el horizonte pedido. */
export const latestApiPath = (base: string, horizon: number): string =>
  `${base}/forecasts/latest?horizon=${horizon}`;

export const knownItemsApiPath = (
  base: string,
  series: Pick<ForecastSeries, 'scope' | 'scopeRef'>,
  period: string,
): string => {
  const q = new URLSearchParams({ scope: series.scope, period });
  if (series.scopeRef) q.set('scopeRef', series.scopeRef);
  return `${base}/forecasts/latest/known-items?${q.toString()}`;
};

/** Selección a partir de la URL (`?horizonte=6&serie=CATEGORY:<id>`). */
export function selectionFromSearch(search: URLSearchParams): {
  horizon: ForecastHorizon;
  series: string | undefined;
} {
  const series = search.get('serie')?.trim();
  return {
    horizon: parseHorizon(search.get('horizonte')),
    series: series && /^[A-Z_]+(:[0-9a-fA-F-]{8,40})?$/.test(series) ? series : undefined,
  };
}

export function selectionToSearch(sel: {
  horizon: ForecastHorizon;
  series: string | undefined;
}): URLSearchParams {
  const q = new URLSearchParams();
  if (sel.horizon !== DEFAULT_FORECAST_HORIZON) q.set('horizonte', String(sel.horizon));
  if (sel.series && sel.series !== 'TOTAL_EXPENSE') q.set('serie', sel.series);
  return q;
}
