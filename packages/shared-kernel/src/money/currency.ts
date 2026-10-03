import { DomainError } from '../errors/domain-error.js';

/** Moneda con su escala canónica (`fx.currency.scale`): BOB 2, USD 2, USDT 6, BTC 8. */
export interface Currency {
  readonly code: string;
  readonly scale: number;
}

/** Mismo patrón que `CurrencyCode` del contrato. */
export const CURRENCY_CODE = /^[A-Z0-9][A-Z0-9_.-]{1,15}$/;
/** NUMERIC(38,18): como máximo 18 decimales. */
export const MAX_SCALE = 18;

export function currency(code: string, scale: number): Currency {
  if (!CURRENCY_CODE.test(code)) {
    throw new DomainError('VALIDATION_FAILED', `invalid currency code '${code}'`);
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new DomainError('VALIDATION_FAILED', `invalid scale ${scale} for ${code} (0..${MAX_SCALE})`);
  }
  return Object.freeze({ code, scale });
}

export const sameCurrency = (a: Currency, b: Currency): boolean => a.code === b.code;

/** Exige misma moneda (código y escala) para operar; si no, `CURRENCY_MISMATCH` (INV-002, TC-LEDGER-MONEY-007). */
export function assertSameCurrency(a: Currency, b: Currency): void {
  if (a.code !== b.code || a.scale !== b.scale) {
    throw new DomainError('CURRENCY_MISMATCH', `${a.code}(${a.scale}) vs ${b.code}(${b.scale})`);
  }
}
