import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { currency as makeCurrency, dec, DomainError, Instant, LocalDate, Money } from '@pf/shared-kernel';
import type { MoneyDto } from '../contracts/index.js';

/** `BaseCurrencyBalance` del contrato HTTP: equivalente con la tasa usada (nunca persistido). */
export interface BaseCurrencyBalanceDto {
  readonly amount: MoneyDto;
  /** Fecha de negocio del `asOf` de la tasa en la zona del workspace. */
  readonly rateDate: string;
  readonly rateSource: string;
  /** Versión almacenada usada (para una cruzada, la primera tasa almacenada del cálculo). */
  readonly fxRateId: string;
  /** Tasa resuelta completa (tipo, derivación, `asOf`, `stale`, selección, atribución). */
  readonly rate: ResolvedRateDto;
}

/**
 * Valora el saldo presentado de una cuenta en la moneda base del workspace con la tasa de valoración de FX (misma
 * semántica que Reporting: tipo preferido del par, selección principal → respaldo → última conocida obsoleta o manual,
 * directa → inversa → cruzada). Convierte con la tasa EXACTA en su orientación almacenada (multiplica desde `base`,
 * divide desde `quote`; precisión 40) y cuantiza HALF_EVEN una sola vez a la escala de la moneda base (INV-020).
 * `null` si la cuenta ya está en la moneda base o si no hay tasa (nunca 1:1).
 */
export function baseCurrencyBalanceOf(input: {
  readonly balance: MoneyDto;
  readonly base: { readonly code: string; readonly scale: number };
  readonly valuation: ValuationRateDto | null;
  readonly timeZone: string;
}): BaseCurrencyBalanceDto | null {
  const { balance, valuation } = input;
  const from = balance.currency;
  if (from === input.base.code || !valuation) return null;
  const { exact, resolved } = valuation;
  const amount = dec(balance.amount);
  let value;
  if (exact.base === from && exact.quote === input.base.code) value = amount.times(dec(exact.value));
  else if (exact.quote === from && exact.base === input.base.code) value = amount.div(dec(exact.value));
  else {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `rate ${exact.base}/${exact.quote} cannot convert ${from} to ${input.base.code}`,
    );
  }
  const target = makeCurrency(input.base.code, input.base.scale);
  const firstComponent = (resolved.components[0] as { readonly id?: unknown } | undefined)?.id;
  const fxRateId = resolved.fxRateId ?? (typeof firstComponent === 'string' ? firstComponent : null);
  if (fxRateId === null) return null;
  return {
    amount: Money.roundToScale(value, target, 'HALF_EVEN').toJSON(),
    rateDate: LocalDate.ofInstant(Instant.parse(resolved.asOf), input.timeZone).toString(),
    rateSource: resolved.source,
    fxRateId,
    rate: resolved,
  };
}
