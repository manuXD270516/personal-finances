import type { Money } from '@pf/shared-kernel';
import type { AccountType } from '../../domain/account.js';

/**
 * Puerto PROPIEDAD de Accounts (driven port). Accounts no conoce a Ledger:
 * el adapter de infrastructure traduce esta llamada a `@pf/ledger/contracts`.
 * Si Ledger se extrajera, solo cambia el adapter.
 */
export interface LedgerPostingPort {
  postOpeningBalance(input: { accountId: string; type: AccountType; amount: Money }): Promise<string>;
}
