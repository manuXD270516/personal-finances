import { MoneyError } from './errors.js';

export const MAX_SCALE = 18;

/** Currency as seen by Money: code + number of minor-unit decimals (0..18). */
export interface Currency {
  readonly code: string;
  readonly scale: number;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;

export function currency(code: string, scale: number): Currency {
  if (!CODE_PATTERN.test(code)) {
    throw new MoneyError('INVALID_CURRENCY', `invalid currency code "${code}"`);
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new MoneyError('INVALID_CURRENCY', `scale must be an integer 0..${MAX_SCALE}, got ${scale}`);
  }
  return Object.freeze({ code, scale });
}

export function sameCurrency(a: Currency, b: Currency): boolean {
  return a.code === b.code && a.scale === b.scale;
}

export function assertSameCurrency(a: Currency, b: Currency): void {
  if (!sameCurrency(a, b)) {
    throw new MoneyError('CURRENCY_MISMATCH', `${a.code}(${a.scale}) vs ${b.code}(${b.scale})`);
  }
}

/** Sample registry matching ARCHITECTURE §4.7 (the real one lives in the `currency` table). */
export const CURRENCIES = Object.freeze({
  BOB: currency('BOB', 2),
  USD: currency('USD', 2),
  JPY: currency('JPY', 0),
  USDT: currency('USDT', 6),
  BTC: currency('BTC', 8),
  ETH: currency('ETH', 18),
  TRX: currency('TRX', 6),
});
