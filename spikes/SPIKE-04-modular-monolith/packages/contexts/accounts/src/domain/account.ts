import { DomainError, Money } from '@pf/shared-kernel';

export type AccountType = 'asset' | 'liability';

/** Agregado Account: TypeScript puro, sin decoradores ni I/O. */
export class Account {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly type: AccountType,
    readonly currency: string,
    readonly openingBalance: Money,
  ) {}

  static open(props: { id: string; name: string; type: AccountType; openingBalance: Money }): Account {
    const name = props.name.trim();
    if (name.length === 0) throw new DomainError('ACCOUNT_NAME_REQUIRED', 'El nombre es obligatorio');
    if (name.length > 80) throw new DomainError('ACCOUNT_NAME_TOO_LONG', 'Nombre > 80 caracteres');
    return new Account(props.id, name, props.type, props.openingBalance.currency, props.openingBalance);
  }
}

/** Puerto de persistencia (lo implementa infrastructure). */
export interface AccountRepository {
  save(account: Account): Promise<void>;
  findById(id: string): Promise<Account | undefined>;
}
