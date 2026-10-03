import { DomainError } from '@pf/shared-kernel';

/** Tipos canónicos de cuenta (docs/01 FR-ACCOUNTS-001, docs/31 D3). Inmutables tras la creación. */
export const ACCOUNT_TYPES = [
  'BANK',
  'CASH',
  'DIGITAL_WALLET',
  'CREDIT_CARD',
  'LOAN',
  'CRYPTO_WALLET',
  'INVESTMENT',
  'SAVINGS',
  'VIRTUAL',
  'MANUAL_ASSET',
  'MANUAL_LIABILITY',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Naturaleza contable de la cuenta (la del `LedgerAccount` 1:1, ARCHITECTURE §4.1). */
export type AccountNature = 'ASSET' | 'LIABILITY';

/** Eje de liquidez (ARCHITECTURE §4.1, docs/31 D5): solo LIQUID cuenta como dinero disponible. */
export const LIQUIDITIES = ['LIQUID', 'SEMI_LIQUID', 'ILLIQUID'] as const;
export type Liquidity = (typeof LIQUIDITIES)[number];

const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set(['CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY']);

const DEFAULT_LIQUIDITY: Readonly<Record<AccountType, Liquidity>> = {
  BANK: 'LIQUID',
  CASH: 'LIQUID',
  DIGITAL_WALLET: 'LIQUID',
  CRYPTO_WALLET: 'LIQUID',
  SAVINGS: 'LIQUID',
  INVESTMENT: 'SEMI_LIQUID',
  VIRTUAL: 'ILLIQUID',
  MANUAL_ASSET: 'ILLIQUID',
  CREDIT_CARD: 'ILLIQUID',
  LOAN: 'ILLIQUID',
  MANUAL_LIABILITY: 'ILLIQUID',
};

export const isAccountType = (value: unknown): value is AccountType =>
  typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);

export const isLiquidity = (value: unknown): value is Liquidity =>
  typeof value === 'string' && (LIQUIDITIES as readonly string[]).includes(value);

/** `VALIDATION_FAILED` si el valor no es uno de los 11 tipos (p. ej. `checking`, TC-ACCOUNTS-TYPES-001). */
export function accountType(value: unknown): AccountType {
  if (!isAccountType(value)) {
    throw new DomainError('VALIDATION_FAILED', `unknown account type '${String(value)}'`).at('/type');
  }
  return value;
}

export function liquidity(value: unknown): Liquidity {
  if (!isLiquidity(value)) {
    throw new DomainError('VALIDATION_FAILED', `unknown liquidity '${String(value)}'`).at('/liquidity');
  }
  return value;
}

/** Naturaleza derivada del tipo: CREDIT_CARD, LOAN y MANUAL_LIABILITY son pasivos; el resto, activos. */
export const natureOf = (type: AccountType): AccountNature =>
  LIABILITY_TYPES.has(type) ? 'LIABILITY' : 'ASSET';

/** Liquidez por defecto (design.md decisión 6). */
export const defaultLiquidityFor = (type: AccountType): Liquidity => DEFAULT_LIQUIDITY[type];
