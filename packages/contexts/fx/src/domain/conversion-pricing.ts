import { dec, Money, type Currency, type Decimal, type Rate } from '@pf/shared-kernel';

export interface ConversionCost {
  /** Σ componentes valorados, cuantizado UNA sola vez (HALF_EVEN) a la escala de la moneda de reporte. */
  readonly amount: Money;
  /** `false` si algún componente no pudo valorarse (ver `missingValuations`). */
  readonly complete: boolean;
  readonly missingValuations: readonly Money[];
}

/**
 * Valor exacto (precisión 40, SIN cuantizar) de `amount` en la otra moneda del par. Usa siempre la tasa ORIGINAL en
 * su orientación (multiplica por ella o divide entre ella), nunca una inversa ya redondeada (INV-032).
 */
export function valueUnrounded(amount: Money, rate: Rate): Decimal | null {
  const original = rate.isDerivedInverse ? rate.inverse() : rate;
  if (original.base.code === amount.currency.code) return amount.toDecimal().times(original.value);
  if (original.quote.code === amount.currency.code) return amount.toDecimal().div(original.value);
  return null;
}

/**
 * DS `ConversionPricingService.totalCost` (fx/conversion-pricing; design.md decisión 3): costo total de una conversión
 * en la moneda de reporte = Σ fees valorados + monto de spread valorado, cada componente convertido con la tasa de
 * referencia del instante de ejecución (`rateFor`), sin redondeo intermedio y con UNA cuantización HALF_EVEN del
 * total (INV-020). Los componentes sin tasa se listan en `missingValuations` y el costo queda incompleto.
 */
export function totalCost(
  components: readonly Money[],
  reporting: Currency,
  rateFor: (currency: string) => Rate | null,
): ConversionCost {
  let sum: Decimal = dec('0');
  const missing: Money[] = [];
  for (const c of components) {
    if (c.currency.code === reporting.code) {
      sum = sum.plus(c.toDecimal());
      continue;
    }
    const rate = rateFor(c.currency.code);
    const valued = rate ? valueUnrounded(c, rate) : null;
    if (valued === null) {
      missing.push(c);
      continue;
    }
    sum = sum.plus(valued);
  }
  return {
    amount: Money.roundToScale(sum, reporting, 'HALF_EVEN'),
    complete: missing.length === 0,
    missingValuations: missing,
  };
}
