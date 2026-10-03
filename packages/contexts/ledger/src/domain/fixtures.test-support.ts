import { currency, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import type { JournalEntryInput, PostingInput } from './journal-entry.js';
import { LedgerAccount, type SystemKind } from './ledger-account.js';

/** Fixtures de dominio compartidas por los tests del ledger (no se publican: excluido del build). */
export const BOB = currency('BOB', 2);
export const USD = currency('USD', 2);
export const USDT = currency('USDT', 6);

export const W1 = '0190a000-0000-7000-8000-00000000a001';
export const W2 = '0190a000-0000-7000-8000-00000000a002';

let seq = 0;
export const id = (): string => {
  seq += 1;
  return `0190a000-0000-7000-8000-${seq.toString(16).padStart(12, '0')}`;
};

export const userAccount = (nature: 'ASSET' | 'LIABILITY', cur: Currency, workspaceId = W1): LedgerAccount =>
  LedgerAccount.forUserAccount({ id: id(), workspaceId, sourceAccountId: id(), nature, currency: cur });

export const systemAccount = (kind: SystemKind, cur: Currency, workspaceId = W1): LedgerAccount =>
  LedgerAccount.system({ id: id(), workspaceId, kind, currency: cur });

export const m = (amount: string, cur: Currency): Money => Money.parse(amount, cur);

export const line = (
  account: LedgerAccount,
  amount: string,
  splitId: string | null = null,
): PostingInput => ({
  id: id(),
  account,
  amount: m(amount, account.currency),
  splitId,
});

export const entry = (
  postings: readonly PostingInput[],
  overrides: Partial<JournalEntryInput> = {},
): JournalEntryInput => ({
  id: id(),
  workspaceId: W1,
  entryDate: LocalDate.parse('2026-03-10'),
  entryType: 'STANDARD',
  sourceRef: { context: 'TRANSACTIONS', type: 'Transaction', id: id(), revision: 1 },
  reversesEntryId: null,
  memo: null,
  correlationId: null,
  createdBy: null,
  postings,
  ...overrides,
});

export const OPEN = { periodLocked: false } as const;
