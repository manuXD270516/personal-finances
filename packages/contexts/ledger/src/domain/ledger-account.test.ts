import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BOB, id, USDT, W1 } from './fixtures.test-support.js';
import { LedgerAccount, LedgerAccountCode, natureOfSystemKind } from './ledger-account.js';

describe('LedgerAccount y LedgerAccountCode (plan de cuentas)', () => {
  it('[TC-LEDGER-CHART-001] naturaleza y moneda únicas e inmutables: el agregado no ofrece cómo cambiarlas', () => {
    const bankA = LedgerAccount.forUserAccount({
      id: id(),
      workspaceId: W1,
      sourceAccountId: id(),
      nature: 'ASSET',
      currency: BOB,
    });
    expect(Object.isFrozen(bankA)).toBe(true);
    expect(() => {
      (bankA as unknown as { currency: unknown }).currency = { code: 'USD', scale: 2 };
    }).toThrow(TypeError);
    const mutators = Object.getOwnPropertyNames(LedgerAccount.prototype).filter((n) =>
      /^(set|change|update)/i.test(n),
    );
    expect(mutators).toEqual([]);
    const archived = bankA.archive('2026-10-03T00:00:00Z');
    expect([archived.nature, archived.currency.code, archived.isArchived, bankA.isArchived]).toEqual([
      'ASSET',
      'BOB',
      true,
      false,
    ]);
    expect(archived.archive('2027-01-01T00:00:00Z').archivedAt).toBe('2026-10-03T00:00:00Z');
  });

  it('[TC-LEDGER-CHART-001] cuentas de usuario ASSET/LIABILITY y de sistema con su código y naturaleza', () => {
    const src = id();
    const visa = LedgerAccount.forUserAccount({
      id: id(),
      workspaceId: W1,
      sourceAccountId: src,
      nature: 'LIABILITY',
      currency: BOB,
    });
    expect(visa.code.value).toBe(`LIABILITY:${src}`);
    expect(visa.code.isSystem).toBe(false);
    const fx = LedgerAccount.system({ id: id(), workspaceId: W1, kind: 'FX_TRADING', currency: USDT });
    expect([fx.code.value, fx.nature, fx.code.isSystem]).toEqual(['EQUITY:FX_TRADING:USDT', 'EQUITY', true]);
    expect(
      LedgerAccount.system({ id: id(), workspaceId: W1, kind: 'EXPENSE', currency: BOB }).code.value,
    ).toBe('EXPENSE:BOB');
    expect(natureOfSystemKind('INCOME')).toBe('INCOME');
    expect(LedgerAccountCode.parse('EQUITY:OPENING_BALANCE:BOB').isSystem).toBe(true);
    expect(LedgerAccountCode.parse(`ASSET:${src}`).value).toBe(`ASSET:${src}`);
    expect(() => LedgerAccountCode.parse('EQUITY:BOB')).toThrow(DomainError);
    expect(() => LedgerAccountCode.forUserAccount('ASSET', 'x')).toThrow(DomainError);
    expect(() =>
      LedgerAccount.forUserAccount({
        id: id(),
        workspaceId: W1,
        sourceAccountId: src,
        nature: 'EQUITY' as 'ASSET',
        currency: BOB,
      }),
    ).toThrow(DomainError);
    expect(() =>
      LedgerAccount.system({ id: id(), workspaceId: W1, kind: 'OTHER' as 'INCOME', currency: BOB }),
    ).toThrow(DomainError);
  });

  it('restore verifica la coherencia de naturaleza, origen y código', () => {
    const fx = LedgerAccount.system({ id: id(), workspaceId: W1, kind: 'FX_TRADING', currency: USDT });
    expect(LedgerAccount.restore({ ...fx }).code.value).toBe('EQUITY:FX_TRADING:USDT');
    expect(() => LedgerAccount.restore({ ...fx, nature: 'ASSET' })).toThrow(/inconsistent/);
    expect(() => LedgerAccount.restore({ ...fx, systemKind: null })).toThrow(/inconsistent/);
    expect(() => LedgerAccount.restore({ ...fx, code: LedgerAccountCode.parse('EXPENSE:USDT') })).toThrow(
      /inconsistent/,
    );
  });
});
