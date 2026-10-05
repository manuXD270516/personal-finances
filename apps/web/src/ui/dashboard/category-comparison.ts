import { subtractAmounts } from '../common/money';
import { isNegative, isZero } from './format';
import type { Money, ReportSummary, TopCategory } from './types';

/** Máximo de `topCategories` que admite `GET /reports/summary` (contrato: 0..20). */
export const MAX_TOP_CATEGORIES = 20;

/**
 * Top de categorías del periodo de comparación (Q7 básico, FR-REPORTING-004): `loading` mientras se consulta,
 * `unavailable` si no hay comparación o la consulta falló (el Home se muestra igual, sin variaciones), `ready` con
 * las categorías del periodo anterior. `saturated` = la respuesta llegó al máximo del contrato, así que una categoría
 * ausente pudo quedar fuera del top (no se puede afirmar que antes fue cero).
 */
export type PreviousCategories =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly items: readonly TopCategory[]; readonly saturated: boolean };

export type CategoryTrend = 'up' | 'down' | 'flat' | 'new' | 'unknown';

export interface CategoryComparison {
  readonly trend: CategoryTrend;
  /** Gasto neto de la categoría en el periodo anterior (`null` si no se puede saber). */
  readonly previous: Money | null;
  /** Actual − anterior, exacto con bigint (`null` si no se puede saber). */
  readonly delta: Money | null;
}

/**
 * Consulta del periodo anterior "a la fecha" que usa la propia respuesta (`comparison.previousPeriod`), en la misma
 * moneda de reporte y sin comparación anidada; `undefined` si el Home no tiene comparación (Q7 no disponible) o no
 * hay categorías que comparar.
 */
export function previousCategoriesQuery(summary: ReportSummary): string | undefined {
  const cmp = summary.comparison;
  const q7 = summary.questions.find((q) => q.question === 'Q7');
  if (!cmp || (q7 && q7.status !== 'AVAILABLE') || summary.topExpenseCategories.length === 0)
    return undefined;
  return new URLSearchParams({
    dateFrom: cmp.previousPeriod.from,
    dateTo: cmp.previousPeriod.to,
    reportingCurrency: summary.meta.reportingCurrency,
    compare: 'NONE',
    topCategories: String(MAX_TOP_CATEGORIES),
  }).toString();
}

const fractionDigits = (amount: string): number => amount.split('.')[1]?.length ?? 0;

const trendOf = (delta: string): CategoryTrend =>
  isZero(delta) ? 'flat' : isNegative(delta) ? 'down' : 'up';

/**
 * Variación de una categoría contra el periodo anterior. La resta es exacta (`Money` del shared-kernel, bigint) sobre
 * los montos ya redondeados por la API en la moneda de reporte: nunca pasa por `number`.
 */
export function compareCategory(
  current: TopCategory,
  previous: PreviousCategories,
): CategoryComparison | undefined {
  if (previous.status !== 'ready') return undefined;
  const { currency, amount } = current.amount;
  const before = previous.items.find((c) => c.categoryId === current.categoryId);
  if (before && before.amount.currency !== currency) return { trend: 'unknown', previous: null, delta: null };
  if (!before && previous.saturated) return { trend: 'unknown', previous: null, delta: null };
  const scale = fractionDigits(amount);
  const prevAmount = before?.amount.amount ?? (scale > 0 ? `0.${'0'.repeat(scale)}` : '0');
  const delta = subtractAmounts(amount, prevAmount, currency, Math.max(scale, fractionDigits(prevAmount)));
  const trend: CategoryTrend = isZero(prevAmount) && !isZero(amount) ? 'new' : trendOf(delta);
  return { trend, previous: { amount: prevAmount, currency }, delta: { amount: delta, currency } };
}

/** Decimal canónico como entero escalado a `scale` decimales (exacto, truncando lo que sobre). */
function scaled(decimal: string, scale: number): bigint {
  const negative = decimal.startsWith('-');
  const [int = '0', frac = ''] = decimal.replace(/^[-+]/, '').split('.');
  const digits = BigInt(`${int || '0'}${frac.padEnd(scale, '0').slice(0, scale)}`);
  return negative ? -digits : digits;
}

/** Comparación exacta de dos decimales canónicos (−1, 0, 1). */
function compareDecimals(a: string, b: string): number {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const [x, y] = [scaled(a, scale), scaled(b, scale)];
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Resolución de las barras: 1/1000 del ancho. */
const BAR_STEPS = 1000n;

/**
 * Proporción [0, 1] para el ANCHO de una barra (solo presentación: no se muestra como cifra), calculada con enteros
 * exactos y redondeada a 1/1000. Los negativos (reembolso mayor que el gasto) no tienen barra.
 */
export function barRatio(amount: string, max: string): number {
  const scale = Math.max(fractionDigits(amount), fractionDigits(max));
  const [value, top] = [scaled(amount, scale), scaled(max, scale)];
  if (top <= 0n || value <= 0n) return 0;
  if (value >= top) return 1;
  return Number((value * BAR_STEPS) / top) / Number(BAR_STEPS);
}

/** Mayor de los montos (comparación exacta; solo para escalar barras). */
export const maxAmount = (amounts: readonly string[]): string =>
  amounts.reduce((m, a) => (compareDecimals(a, m) > 0 ? a : m), '0');
