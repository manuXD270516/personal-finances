/** API pública de Accounts. Solo DTOs, interfaces y tokens (sin Nest, sin clases de dominio). */
export interface OpenAccountCommand {
  readonly name: string;
  readonly type: 'asset' | 'liability';
  readonly currency: string;
  /** Unidades menores como string (nunca number). */
  readonly openingBalanceMinor: string;
}

export interface AccountDto {
  readonly id: string;
  readonly name: string;
  readonly type: 'asset' | 'liability';
  readonly currency: string;
  readonly openingBalanceMinor: string;
  readonly openingJournalEntryId: string | null;
}

export interface AccountsApi {
  openAccount(cmd: OpenAccountCommand): Promise<AccountDto>;
  getAccount(id: string): Promise<AccountDto | undefined>;
}

export const ACCOUNTS_API = Symbol.for('pf.accounts.AccountsApi');
