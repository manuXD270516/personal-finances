import { Money, type IdGenerator } from '@pf/shared-kernel';
import type { UnitOfWork } from '@pf/platform';
import { Account, type AccountRepository } from '../domain/account.js';
import type { LedgerPostingPort } from './ports/ledger-posting.port.js';
import type { AccountDto, AccountsApi, OpenAccountCommand } from '../contracts/index.js';

/** Application service: clase TS plana (sin @Injectable). Nest la instancia vía useFactory. */
export class OpenAccountService implements AccountsApi {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly ledger: LedgerPostingPort,
    private readonly ids: IdGenerator,
  ) {}

  /** Apertura + asiento de saldo inicial en UNA transacción (un solo COMMIT o ROLLBACK). */
  openAccount(cmd: OpenAccountCommand): Promise<AccountDto> {
    return this.uow.run(async () => {
      const account = Account.open({
        id: this.ids.next(),
        name: cmd.name,
        type: cmd.type,
        openingBalance: Money.ofMinor(BigInt(cmd.openingBalanceMinor), cmd.currency),
      });
      await this.accounts.save(account);
      let openingJournalEntryId: string | null = null;
      if (!account.openingBalance.isZero()) {
        openingJournalEntryId = await this.ledger.postOpeningBalance({
          accountId: account.id,
          type: account.type,
          amount: account.openingBalance,
        });
      }
      return toDto(account, openingJournalEntryId);
    });
  }

  async getAccount(id: string): Promise<AccountDto | undefined> {
    const a = await this.accounts.findById(id);
    return a && toDto(a, null);
  }
}

function toDto(a: Account, openingJournalEntryId: string | null): AccountDto {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    openingBalanceMinor: a.openingBalance.minor.toString(),
    openingJournalEntryId,
  };
}
