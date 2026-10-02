import type { InMemoryUnitOfWork } from '@pf/platform/in-memory';
import type { Account, AccountRepository } from '../domain/account.js';

/** Adapter: en producción sería Kysely sobre el schema `accounts`. */
export class InMemoryAccountRepository implements AccountRepository {
  constructor(private readonly uow: InMemoryUnitOfWork) {}

  async save(account: Account): Promise<void> {
    this.uow.table<Account>('accounts.account').set(account.id, account);
  }

  async findById(id: string): Promise<Account | undefined> {
    return this.uow.table<Account>('accounts.account').get(id);
  }
}
