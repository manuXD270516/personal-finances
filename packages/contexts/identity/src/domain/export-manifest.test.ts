import { isDomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalDecimalText,
  compareVerification,
  parseExportManifest,
  sectionCount,
  serializeExportManifest,
  type ExportManifest,
} from './export-manifest.js';

const ACCOUNT = '0190a000-0000-7000-8000-0000000000a1';
const LEDGER = '0190a000-0000-7000-8000-0000000000b1';
const USER = '0190a000-0000-7000-8000-0000000000c1';

const manifest = (over: Partial<ExportManifest> = {}): ExportManifest => ({
  format: 'pfos-export',
  formatVersion: 1,
  workspaceId: '0190a000-0000-7000-8000-0000000000d1',
  workspaceName: 'W1',
  isDemo: false,
  exportedAt: '2026-04-01T10:00:00.000Z',
  snapshotAt: '2026-04-01T09:59:59.123Z',
  pfosVersion: '0.0.0',
  baseCurrency: 'BOB',
  timezone: 'America/La_Paz',
  sections: [
    {
      name: 'transactions',
      file: 'json/transactions.jsonl',
      schema: 'https://x/t',
      count: 120,
      sha256: 'a'.repeat(64),
    },
  ],
  csv: [{ name: 'transactions', file: 'csv/transactions.csv', count: 131, sha256: 'b'.repeat(64) }],
  verification: {
    accountBalances: [{ accountId: ACCOUNT, currency: 'BOB', balance: '3099.10' }],
    trialBalance: [{ ledgerAccountId: LEDGER, currency: 'BOB', balance: '-3099.10' }],
  },
  actors: [{ userId: USER, displayName: 'Ana' }],
  ...over,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return isDomainError(err) ? err.code : 'NOT_DOMAIN_ERROR';
  }
  return undefined;
};

describe('ExportManifest (dominio IDENTITY)', () => {
  it('[TC-IDENTITY-EXPORT-003] serializar → parsear es identidad y los montos conservan su escala', () => {
    const m = manifest();
    const back = parseExportManifest(JSON.parse(serializeExportManifest(m)));
    expect(back).toEqual(m);
    expect(back.verification.accountBalances[0]?.balance).toBe('3099.10');
    expect(sectionCount(back, 'transactions')).toBe(120);
    expect(sectionCount(back, 'planning')).toBe(0);
  });

  it('[TC-IDENTITY-EXPORT-003] PBT: cualquier saldo decimal sobrevive al ida y vuelta con su escala exacta', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 18 }),
        (units, scale) => {
          const abs = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
          const text = `${units < 0n ? '-' : ''}${abs.slice(0, abs.length - scale)}${scale > 0 ? `.${abs.slice(abs.length - scale)}` : ''}`;
          const m = manifest({
            verification: {
              accountBalances: [{ accountId: ACCOUNT, currency: 'USDT', balance: text }],
              trialBalance: [],
            },
          });
          const back = parseExportManifest(JSON.parse(serializeExportManifest(m)));
          expect(back.verification.accountBalances[0]?.balance).toBe(text);
        },
      ),
    );
  });

  it('[TC-IDENTITY-RESTORE-004] rechaza manifiestos mal formados, formato desconocido y versiones no soportadas', () => {
    expect(codeOf(() => parseExportManifest(null))).toBe('EXPORT_FILE_CORRUPTED');
    expect(codeOf(() => parseExportManifest({ ...manifest(), format: 'otro' }))).toBe(
      'EXPORT_FILE_CORRUPTED',
    );
    expect(codeOf(() => parseExportManifest({ ...manifest(), formatVersion: 99 }))).toBe(
      'EXPORT_FORMAT_UNSUPPORTED',
    );
    expect(codeOf(() => parseExportManifest({ ...manifest(), formatVersion: '1' }))).toBe(
      'EXPORT_FILE_CORRUPTED',
    );
    const bad = manifest({
      sections: [
        { name: 'transactions', file: '../etc/passwd', schema: 's', count: 1, sha256: 'a'.repeat(64) },
      ],
    });
    expect(codeOf(() => parseExportManifest(bad))).toBe('EXPORT_FILE_CORRUPTED');
    const badHash = manifest({
      sections: [
        { name: 'transactions', file: 'json/transactions.jsonl', schema: 's', count: 1, sha256: 'xyz' },
      ],
    });
    expect(codeOf(() => parseExportManifest(badHash))).toBe('EXPORT_FILE_CORRUPTED');
  });

  it('[TC-IDENTITY-RESTORE-006] un export de un workspace demo se rechaza con EXPORT_FORMAT_UNSUPPORTED', () => {
    expect(codeOf(() => parseExportManifest({ ...manifest(), isDemo: true }))).toBe(
      'EXPORT_FORMAT_UNSUPPORTED',
    );
    expect(codeOf(() => parseExportManifest({ ...manifest(), isDemo: undefined }))).toBe(
      'EXPORT_FILE_CORRUPTED',
    );
  });

  it('[TC-IDENTITY-EXPORT-003] ignora campos desconocidos (compatibilidad de versiones menores)', () => {
    expect(parseExportManifest({ ...manifest(), futuro: { a: 1 } })).toEqual(manifest());
  });

  it('canonicalDecimalText ignora ceros de relleno y signo cero', () => {
    expect(canonicalDecimalText('45.90')).toBe('45.9');
    expect(canonicalDecimalText('045.000')).toBe('45');
    expect(canonicalDecimalText('-0.00')).toBe('0');
    expect(canonicalDecimalText('-3099.10')).toBe('-3099.1');
    expect(canonicalDecimalText('abc')).toBe('abc');
  });

  it('[TC-IDENTITY-RESTORE-003] la verificación detecta saldos distintos, cuentas extra y un balance que no suma 0', () => {
    const expected = manifest().verification;
    const same = {
      accountBalances: [{ accountId: ACCOUNT, currency: 'BOB', balance: '3099.1' }],
      trialBalance: [
        { ledgerAccountId: LEDGER, currency: 'BOB', balance: '-3099.10' },
        { ledgerAccountId: 'ffffffff-0000-7000-8000-000000000001', currency: 'BOB', balance: '3099.10' },
      ],
    };
    // El libro esperado solo conoce una cuenta; la extra con saldo ≠ 0 es una diferencia (aunque sume 0).
    expect(compareVerification(expected, same).map((d) => d.kind)).toEqual(['TRIAL_BALANCE']);
    const exact = {
      accountBalances: expected.accountBalances,
      trialBalance: [
        { ledgerAccountId: LEDGER, currency: 'BOB', balance: '-3099.10' },
        { ledgerAccountId: 'ffffffff-0000-7000-8000-000000000001', currency: 'BOB', balance: '3099.10' },
      ],
    };
    expect(compareVerification({ ...expected, trialBalance: exact.trialBalance }, exact)).toEqual([]);
    const off = compareVerification(expected, {
      accountBalances: [{ accountId: ACCOUNT, currency: 'BOB', balance: '3079.10' }],
      trialBalance: [{ ledgerAccountId: LEDGER, currency: 'BOB', balance: '-3099.10' }],
    });
    expect(off.map((d) => d.kind).sort()).toEqual(['ACCOUNT_BALANCE', 'TRIAL_BALANCE_SUM']);
    expect(off.find((d) => d.kind === 'ACCOUNT_BALANCE')).toMatchObject({
      expected: '3099.10',
      actual: '3079.10',
    });
  });
});
