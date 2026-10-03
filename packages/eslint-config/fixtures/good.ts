// Fixture QUE DEBE PASAR (TC-PLATFORM-ARCH-002): código monetario idiomático, sin falsos positivos.
declare const Money: { of(amount: string, currency: string): { toFixed(): string } };
declare const items: readonly string[];

export interface Expense {
  amount: { amount: string; currency: string };
  lineCount: number;
}

export class Rate {
  rate: string = '6.96';
}

export const money = Money.of('10.50', 'BOB');
export const shown = money.toFixed();
export const count: number = items.length;

export function split(amount: string, parts: number): string[] {
  return Array.from({ length: parts }, () => amount);
}
