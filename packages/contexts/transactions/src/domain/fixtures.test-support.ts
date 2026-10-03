import { currency, Money } from '@pf/shared-kernel';
import { Transaction, type RecordTransactionInput } from './transaction.js';

export const BOB = currency('BOB', 2);
export const USD = currency('USD', 2);
export const bob = (amount: string): Money => Money.parse(amount, BOB);
export const WS = '0192f3c4-0000-7000-8000-000000000001';
export const BANK_A = '0192f3c4-0000-7000-8000-0000000000a1';
export const CARD = '0192f3c4-0000-7000-8000-0000000000c1';
export const UNCATEGORIZED = '0192f3c4-0000-7000-8000-0000000000f0';
let seq = 0;
export const nextId = (): string => `0192f3c4-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;

export function expense(over: Partial<RecordTransactionInput> = {}): Transaction {
  return Transaction.record({
    id: nextId(),
    workspaceId: WS,
    kind: 'EXPENSE',
    businessDate: '2026-09-30',
    accountId: BANK_A,
    accountNature: 'ASSET',
    accountCurrency: 'BOB',
    amount: bob('150.00'),
    defaultCategoryId: UNCATEGORIZED,
    defaultSplitId: nextId(),
    ...over,
  });
}
