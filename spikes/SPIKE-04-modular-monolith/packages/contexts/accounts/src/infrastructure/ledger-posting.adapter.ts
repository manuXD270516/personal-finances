// Única dependencia hacia Ledger: su API pública. `@pf/ledger/src/...` no resuelve (package.json#exports).
import type { LedgerPostingApi } from '@pf/ledger/contracts';
import type { LedgerPostingPort } from '../application/ports/ledger-posting.port.js';

const OPENING_BALANCE_EQUITY = 'equity:opening-balances';

/** Adapter in-process. Si Ledger se extrajera, se reemplaza por un cliente HTTP sin tocar application/domain. */
export class LedgerPostingAdapter implements LedgerPostingPort {
  constructor(private readonly ledger: LedgerPostingApi) {}

  async postOpeningBalance(input: Parameters<LedgerPostingPort['postOpeningBalance']>[0]): Promise<string> {
    const { amount } = input;
    // Activo: débito en la cuenta, crédito en equity. Pasivo: al revés.
    const accountLine = input.type === 'asset' ? amount.minor : -amount.minor;
    const { journalEntryId } = await this.ledger.postJournalEntry({
      description: `Saldo inicial cuenta ${input.accountId}`,
      lines: [
        { ledgerAccountRef: `account:${input.accountId}`, amountMinor: accountLine.toString(), currency: amount.currency },
        { ledgerAccountRef: OPENING_BALANCE_EQUITY, amountMinor: (-accountLine).toString(), currency: amount.currency },
      ],
    });
    return journalEntryId;
  }
}
