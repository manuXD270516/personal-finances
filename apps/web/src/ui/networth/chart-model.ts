import { barRatio } from '../dashboard/category-comparison';
import { isNegative, isZero } from '../dashboard/format';
import { subtractAmounts } from '../common/money';
import type { NetWorthPoint } from './types';

/** Resumen de estado de un punto: lo que la tabla y el gráfico dicen además del color (WCAG 1.4.1). */
export type PointState = 'closed' | 'partial' | 'incomplete' | 'computed';

/** Estados que aplican a un punto (puede tener varios: p. ej. cerrado e incompleto). */
export function pointStates(p: NetWorthPoint): PointState[] {
  const states: PointState[] = [];
  if (p.closed) states.push('closed');
  if (p.partial) states.push('partial');
  if (!p.complete) states.push('incomplete');
  return states.length > 0 ? states : ['computed'];
}

const fractionDigits = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/** Comparación exacta de decimales: `a − b` con signo (sin pasar por `number`). */
function compare(a: string, b: string): number {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const diff = subtractAmounts(a, b, 'XXX', scale);
  return isZero(diff) ? 0 : isNegative(diff) ? -1 : 1;
}

const lowest = (values: readonly string[]): string => values.reduce((m, v) => (compare(v, m) < 0 ? v : m));
const highest = (values: readonly string[]): string => values.reduce((m, v) => (compare(v, m) > 0 ? v : m));

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ChartColumn {
  readonly point: NetWorthPoint;
  /** Centro de la columna en x. */
  readonly x: number;
  /** y del valor del patrimonio neto (marcador de la línea). */
  readonly netY: number;
  /** Barra de activos y de pasivos: arriba (`y`) y alto (`h`) desde la línea base cero. */
  readonly assets: { readonly y: number; readonly h: number };
  readonly liabilities: { readonly y: number; readonly h: number };
}

export interface ChartModel {
  readonly geometry: ChartGeometry;
  readonly columns: readonly ChartColumn[];
  /** y de la línea base (cero). */
  readonly baseline: number;
  /** Límites del eje vertical, tal como llegan de la API (para etiquetarlos). */
  readonly lowest: string;
  readonly highest: string;
  /** Ancho de cada barra y separación entre columnas. */
  readonly barWidth: number;
  readonly step: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Geometría del gráfico a partir de los puntos. Las posiciones salen de proporciones EXACTAS (bigint) de los
 * decimales de la API redondeadas a 1/1000 (`barRatio`): solo se usan para dibujar, nunca se muestran como cifras.
 * La escala incluye siempre el cero, de modo que las barras de activos y pasivos parten de la línea base.
 */
export function buildChart(points: readonly NetWorthPoint[], geometry: ChartGeometry): ChartModel {
  const values = ['0', ...points.flatMap((p) => [p.assets, p.liabilities, p.netWorth])];
  const lo = lowest(values);
  const hi = highest(values);
  const scale = Math.max(...values.map(fractionDigits));
  const span = subtractAmounts(hi, lo, 'XXX', scale);
  const plotTop = geometry.top;
  const plotHeight = geometry.height - geometry.top - geometry.bottom;
  const plotWidth = geometry.width - geometry.left - geometry.right;
  // Posición vertical (0 = arriba) de un valor dentro de [lo, hi].
  const yOf = (value: string): number => {
    if (isZero(span)) return round(plotTop + plotHeight);
    const ratio = barRatio(subtractAmounts(value, lo, 'XXX', scale), span);
    return round(plotTop + plotHeight * (1 - ratio));
  };
  const baseline = yOf('0');
  const step = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = round(Math.min(step * 0.3, 28));
  const bar = (value: string) => {
    const y = yOf(value);
    return y <= baseline ? { y, h: round(baseline - y) } : { y: baseline, h: round(y - baseline) };
  };
  return {
    geometry,
    baseline,
    lowest: lo,
    highest: hi,
    barWidth,
    step: round(step),
    columns: points.map((point, i) => ({
      point,
      x: round(geometry.left + step * (i + 0.5)),
      netY: yOf(point.netWorth),
      assets: bar(point.assets),
      liabilities: bar(point.liabilities),
    })),
  };
}

/** Variación total entre el primer y el último punto (`null` con menos de dos puntos). */
export function totalChange(points: readonly NetWorthPoint[]): string | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) return null;
  const scale = Math.max(fractionDigits(first.netWorth), fractionDigits(last.netWorth));
  return subtractAmounts(last.netWorth, first.netWorth, 'XXX', scale);
}
