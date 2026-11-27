import { Money, currency as makeCurrency } from '@pf/shared-kernel';
import type { FlowMoneyDto } from '../contracts/index.js';

const CANONICAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;
const ZEROS = /^0*$/;

/**
 * Normaliza el `NUMERIC(38,18)` de PostgreSQL (`"685.000000000000000000"`) a la escala de la moneda.
 *
 * Camino rápido por texto (sin `Decimal`) para el caso habitual: número canónico, con solo ceros más allá de la
 * escala, de menos de 20 enteros y distinto de cero negativo. Cualquier otro texto (más decimales significativos,
 * formatos raros, fuera de rango) pasa por `Money.parse(...).toJSON()`, que es la referencia y conserva sus errores
 * (`AMOUNT_SCALE_EXCEEDED`, `AMOUNT_OUT_OF_RANGE`, `MONEY_INVALID_AMOUNT`). Misma salida que la referencia
 * (fix-trends-report-perf, tarea 5.2: ~20 000 filas por petición de tendencias de 24 meses).
 */
export function normalizeFlowAmount(amount: string, code: string, scale: number): FlowMoneyDto {
  const m = CANONICAL.exec(amount);
  if (m) {
    const sign = m[1] as string;
    const int = m[2] as string;
    const frac = m[3] ?? '';
    if (int.length <= 20 && ZEROS.test(frac.slice(scale))) {
      const kept = frac.slice(0, scale).padEnd(scale, '0');
      if (!(sign === '-' && int === '0' && ZEROS.test(kept))) {
        return { amount: scale > 0 ? `${sign}${int}.${kept}` : `${sign}${int}`, currency: code };
      }
    }
  }
  return Money.parse(amount, makeCurrency(code, scale)).toJSON();
}
