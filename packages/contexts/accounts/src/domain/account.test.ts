import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Account, maskedAccountNumber } from './account.js';
import { ACCOUNT_TYPES, defaultLiquidityFor, natureOf } from './account-type.js';
import { countryCode, Institution } from './institution.js';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const open = (over: Partial<Parameters<typeof Account.open>[0]> = {}) =>
  Account.open({
    id: 'a1',
    workspaceId: 'w1',
    name: 'Bank A',
    type: 'BANK',
    currency: 'BOB',
    currencyKind: 'FIAT',
    displayOrder: 0,
    openedOn: '2026-01-01',
    ...over,
  });

describe('AccountType y liquidez', () => {
  it('[TC-ACCOUNTS-TYPES-001] los 11 tipos derivan su naturaleza y el tipo "checking" se rechaza', () => {
    const assets = ACCOUNT_TYPES.filter((t) => natureOf(t) === 'ASSET');
    const liabilities = ACCOUNT_TYPES.filter((t) => natureOf(t) === 'LIABILITY');
    expect(assets).toHaveLength(8);
    expect(liabilities).toEqual(['CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY']);
    for (const type of ACCOUNT_TYPES) {
      const currencyKind = type === 'CRYPTO_WALLET' ? 'CRYPTO' : 'FIAT';
      const a = open({ id: type, type, currencyKind });
      expect(a.status).toBe('ACTIVE');
      expect(a.nature).toBe(natureOf(type));
    }
    expect(code(() => open({ type: 'checking' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-ACCOUNTS-LIQUIDITY-001] liquidez por defecto según el tipo y editable sin tocar el saldo', () => {
    expect(defaultLiquidityFor('BANK')).toBe('LIQUID');
    expect(defaultLiquidityFor('CASH')).toBe('LIQUID');
    expect(defaultLiquidityFor('DIGITAL_WALLET')).toBe('LIQUID');
    expect(defaultLiquidityFor('CRYPTO_WALLET')).toBe('LIQUID');
    expect(defaultLiquidityFor('SAVINGS')).toBe('LIQUID');
    expect(defaultLiquidityFor('INVESTMENT')).toBe('SEMI_LIQUID');
    for (const t of ['VIRTUAL', 'MANUAL_ASSET', 'CREDIT_CARD', 'LOAN', 'MANUAL_LIABILITY'] as const) {
      expect(defaultLiquidityFor(t)).toBe('ILLIQUID');
    }
    const savings = open({ type: 'INVESTMENT' });
    expect(savings.snapshot.liquidity).toBe('SEMI_LIQUID');
    expect(savings.update({ liquidity: 'LIQUID' }, { hasPostings: true })).toEqual(['liquidity']);
    expect(code(() => open({ liquidity: 'VERY_LIQUID' }))).toBe('VALIDATION_FAILED');
  });
});

describe('Account', () => {
  it('[TC-ACCOUNTS-CURRENCY-002] la moneda solo cambia sin movimientos', () => {
    const c = open();
    expect(code(() => c.update({ currency: 'USD' }, { hasPostings: true }))).toBe(
      'ACCOUNT_CURRENCY_IMMUTABLE',
    );
    expect(c.currency).toBe('BOB');
    const d = open({ id: 'd' });
    expect(d.update({ currency: 'USD' }, { hasPostings: false, currencyKind: 'FIAT' })).toEqual(['currency']);
    expect(d.currency).toBe('USD');
    expect(d.version).toBe(2);
  });

  it('[TC-ACCOUNTS-TYPES-002] el tipo es inmutable: AccountChanges no lo admite', () => {
    const a = open();
    // `type` no forma parte de AccountChanges: un cambio forzado se ignora y el tipo sigue siendo BANK.
    a.update({ type: 'CASH' } as never, { hasPostings: false });
    expect(a.type).toBe('BANK');
    expect(a.nature).toBe('ASSET');
    expect(a.version).toBe(1);
  });

  it('[TC-ACCOUNTS-CLOSE-001] cerrar exige saldo cero y solo desde ACTIVE', () => {
    const b = open();
    expect(code(() => b.close('2026-03-31', null, { balanceIsZero: false }))).toBe(
      'ACCOUNT_BALANCE_NOT_ZERO',
    );
    expect(b.status).toBe('ACTIVE');
    b.close('2026-03-31', 'fin', { balanceIsZero: true });
    expect(b.status).toBe('CLOSED');
    expect(b.snapshot.closedOn).toBe('2026-03-31');
    expect(code(() => b.close('2026-04-01', null, { balanceIsZero: true }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(code(() => open({ id: 'x' }).close('2025-12-31', null, { balanceIsZero: true }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[TC-ACCOUNTS-ARCHIVE-001] archivar dos veces es una transición inválida', () => {
    const a = open();
    a.archive('2026-03-15T14:00:00Z', 'Cuenta cerrada en el banco');
    expect(a.status).toBe('ARCHIVED');
    expect(code(() => a.archive('2026-03-15T14:00:00Z', null))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-ACCOUNTS-ARCHIVE-003] reactivar devuelve a ACTIVE desde ARCHIVED o CLOSED', () => {
    const a = open();
    a.archive('2026-03-15T14:00:00Z', null);
    expect(a.reactivate()).toBe('ARCHIVED');
    expect(a.status).toBe('ACTIVE');
    expect(code(() => a.reactivate())).toBe('INVALID_STATUS_TRANSITION');
    a.close('2026-03-31', null, { balanceIsZero: true });
    expect(a.reactivate()).toBe('CLOSED');
  });

  it('[TC-ACCOUNTS-ARCHIVE-002] una cuenta archivada o cerrada no recibe movimientos (INV-026)', () => {
    const a = open();
    expect(() => a.assertCanReceivePostings()).not.toThrow();
    a.archive('2026-03-15T14:00:00Z', null);
    expect(code(() => a.assertCanReceivePostings())).toBe('ACCOUNT_ARCHIVED');
    const c = open({ id: 'c' });
    c.close('2026-03-31', null, { balanceIsZero: true });
    expect(code(() => c.assertCanReceivePostings())).toBe('ACCOUNT_CLOSED');
  });

  it('[TC-ACCOUNTS-MASK-001] solo se aceptan 4 caracteres alfanuméricos del identificador', () => {
    expect(maskedAccountNumber('6789')).toBe('6789');
    expect(code(() => maskedAccountNumber('DEMO-000123456789'))).toBe('VALIDATION_FAILED');
    expect(code(() => maskedAccountNumber('123456789'))).toBe('VALIDATION_FAILED');
    expect(code(() => open({ accountNumberLast4: '12-4' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-ACCOUNTS-CRYPTO-001] una billetera cripto exige moneda CRYPTO', () => {
    expect(code(() => open({ type: 'CRYPTO_WALLET', currency: 'BOB', currencyKind: 'FIAT' }))).toBe(
      'ACCOUNT_CURRENCY_KIND_MISMATCH',
    );
    const btc = open({
      type: 'CRYPTO_WALLET',
      currency: 'BTC',
      currencyKind: 'CRYPTO',
      cryptoNetwork: 'BTC',
    });
    expect(btc.snapshot.cryptoNetwork).toBe('BTC');
  });
});

describe('Institution', () => {
  it('[TC-ACCOUNTS-INSTITUTION-001] país ISO alfa-2 opcional y tipo de institución válido', () => {
    expect(countryCode('BO')).toBe('BO');
    expect(code(() => countryCode('Bolivia'))).toBe('VALIDATION_FAILED');
    const i = Institution.create({ id: 'i1', workspaceId: 'w1', name: 'Fintech Y', kind: 'FINTECH' });
    expect(i.snapshot.countryCode).toBeNull();
    expect(code(() => Institution.create({ id: 'i2', workspaceId: 'w1', name: 'X', kind: 'CASA' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
