import { Decimal as DecimalJs } from 'decimal.js';

/**
 * Constructor decimal.js aislado para dinero (ADR-0006, docs/09 §12; validado en SPIKE-03).
 * - `defaults: true`: ignora cualquier configuración global previa de `Decimal`.
 * - Umbrales de exponente amplios: `toString()`/`toFixed()` nunca emiten notación exponencial.
 * - Precisión 40 dígitos significativos (≥ NUMERIC(38,18)); HALF_EVEN solo en materializaciones explícitas.
 */
export const MoneyDecimal = DecimalJs.clone({
  defaults: true,
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

export type Decimal = DecimalJs;

/** Re-envuelve cualquier entrada en el constructor aislado (copia exacta, sin redondeo). */
export const dec = (value: Decimal | string): Decimal => new MoneyDecimal(value);
