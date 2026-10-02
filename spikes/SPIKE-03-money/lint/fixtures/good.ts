// Fixture: idiomatic money code, no reports expected.
import type Decimal from 'decimal.js';

export interface TransactionDto {
  amount: string;
  currency: string;
  lineCount: number;
}

export class Rate {
  value: Decimal | undefined;
  rate: string = '6.96';
}

export function split(amount: string, parts: number): string[] {
  return Array.from({ length: parts }, () => amount);
}
