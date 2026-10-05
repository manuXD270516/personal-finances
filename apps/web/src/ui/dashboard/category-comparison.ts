import { subtractAmounts } from '../common/money';
import { isNegative, isZero } from './format';
import type { Money, ReportSummary, TopCategory } from './types';

export type CategoryTrend = 'up' | 'down' | 'flat' | 'new' | 'unknown';

export interface CategoryComparison {
  readonly trend: CategoryTrend;
  /** Neto de la categoría en el periodo anterior (`null` si no se puede saber). */
  readonly previous: Money | null;
  /** Actual − anterior, exacto con bigint (`null` si no se puede saber). */
  readonly delta: Money | null;
}

/**
 * ¿Hay variación por categoría (Q7 básico, FR-REPORTING-004)? Solo si la respuesta trae comparación y Q7 está
 * disponible: el monto anterior de cada categoría viene en la misma respuesta (`previousAmount`), sin otra consulta.
 */
export function hasCategoryComparison(summary: ReportSummary): boolean {
  const q7 = summary.questions.find((q) => q.question === 'Q7');
  return !!summary.comparison && (!q7 || q7.status === 'AVAILABLE');
}

const fractionDigits = (amount: string): number => amount.split('.')[1]?.length ?? 0;

const trendOf = (delta: string): CategoryTrend =>
  isZero(delta) ? 'flat' : isNegative(delta) ? 'down' : 'up';

/**
 * Variación de una categoría contra el periodo anterior con su `previousAmount` (cero = no tuvo flujos; `null` = la
 * API no pudo saberlo, p. ej. un monto sin tasa). La resta es exacta (`Money` del shared-kernel, bigint) sobre los
 * montos ya redondeados por la API en la moneda de reporte: nunca pasa por `number`.
 */
export function compareCategory(current: TopCategory): CategoryComparison {
  const { currency, amount } = current.amount;
  const before = current.previousAmount ?? null;
  if (!before || before.currency !== currency) return { trend: 'unknown', previous: null, delta: null };
  const prevAmount = before.amount;
  const delta = subtractAmounts(
    amount,
    prevAmount,
    currency,
    Math.max(fractionDigits(amount), fractionDigits(prevAmount)),
  );
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
