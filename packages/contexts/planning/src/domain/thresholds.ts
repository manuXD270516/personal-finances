import { DomainError, dec, type Decimal } from '@pf/shared-kernel';

export const MAX_THRESHOLDS = 10;
const MAX_THRESHOLD_PERCENT = 1000;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const invalid = (detail: string) =>
  new DomainError('BUDGET_THRESHOLD_INVALID', `invalid thresholds: ${detail}`).at('/thresholds');

/** Forma canónica de un umbral: sin ceros finales ("75.50" -> "75.5", "90.00" -> "90"). */
const canonical = (value: Decimal): string => value.toFixed();

/**
 * Valida y normaliza una lista de umbrales (FR-PLANNING-022, `Threshold` del design decisión 7): de 1 a 10 valores
 * distintos, mayores que 0 y de hasta 1000 %, con a lo sumo dos decimales. Devuelve la lista ordenada ascendente en
 * forma canónica. Cualquier violación ⇒ `BUDGET_THRESHOLD_INVALID`.
 */
export function normalizeThresholds(input: readonly unknown[]): string[] {
  if (input.length < 1 || input.length > MAX_THRESHOLDS) {
    throw invalid(`between 1 and ${MAX_THRESHOLDS} values are required`);
  }
  const values: Decimal[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || !DECIMAL.test(raw)) throw invalid('each value must be a decimal string');
    const value = dec(raw);
    if (value.lte(0) || value.gt(MAX_THRESHOLD_PERCENT)) {
      throw invalid(`each value must be greater than 0 and at most ${MAX_THRESHOLD_PERCENT}`);
    }
    if (value.decimalPlaces() > 2) throw invalid('at most two decimals are allowed');
    values.push(value);
  }
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.eq(sorted[i - 1]!)) throw invalid('values must be distinct');
  }
  return sorted.map(canonical);
}
