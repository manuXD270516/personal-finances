// Fixture QUE DEBE FALLAR (TC-PLATFORM-ARCH-002): cada línea marcada reporta pf/no-number-money o
// no-restricted-imports. Excluido del lint del monorepo; lo usa src/no-number-money.test.ts.
import Decimal from 'decimal.js'; // no-restricted-imports (Decimal global, H7)

declare const Money: { of(amount: unknown, currency: string): unknown };
declare const dto: { fee: string };

export interface Expense {
  amount: number; // numberField
  feeAmount: number | string; // numberField (unión)
  description: string;
}

export class Posting {
  totalAmount: number = 0; // numberField
  count = 3;
}

export function applyFee(price: number, fee: string): string {
  // numberField: parámetro `price`
  return `${price}${fee}`;
}

export const created = Money.of(10.5, 'BOB'); // numericLiteral
export const fee = parseFloat(dto.fee); // floatParse
export const total = 12;
export const shown = total.toFixed(2); // numberMethod
export const amount = new Decimal('1');
export const leaked = amount.toNumber(); // numberMethod
