// Fixture: every money-ish `number` below must be reported.
import type Decimal from 'decimal.js';

type Amount = number; // alias: invisible to the syntax-only layer

export interface TransactionDto {
  amount: number; // A + B
  feeAmount: number | string; // A + B
  balance: Amount; // B only (alias)
  description: string;
}

export class Posting {
  totalAmount: number = 0; // A + B
  count = 3; // ok: not money
}

export function applyFee(price: number, fee: string): string {
  // B: param `price`
  return `${price}${fee}`;
}

export function leak(d: Decimal): number {
  return d.toNumber(); // B: Decimal#toNumber
}

export const parsed = parseFloat('1.0'); // A
