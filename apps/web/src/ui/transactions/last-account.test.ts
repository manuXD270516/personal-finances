import { describe, expect, it } from 'vitest';
import {
  initialAccount,
  lastAccountKey,
  readLastAccount,
  writeLastAccount,
  type KeyValueStorage,
} from './last-account';

const memory = (): KeyValueStorage & { data: Map<string, string>; writes: number } => {
  const data = new Map<string, string>();
  return {
    data,
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      this.writes += 1;
      data.set(k, v);
    },
  };
};

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('cuenta recordada del alta rápida (add-quick-capture)', () => {
  it('[TC-TRANSACTIONS-QUICK-010] guarda y lee la cuenta por usuario y workspace con la clave versionada', () => {
    const s = memory();
    writeLastAccount('u1', 'w1', 'acc-1', s);
    expect(lastAccountKey('u1', 'w1')).toBe('pfos:last-account:v1:u1:w1');
    expect(readLastAccount('u1', 'w1', s)).toBe('acc-1');
    expect(readLastAccount('u1', 'w2', s)).toBeNull();
    expect(readLastAccount('u2', 'w1', s)).toBeNull();
  });

  it('[TC-TRANSACTIONS-QUICK-010] escribe solo si la cuenta cambia', () => {
    const s = memory();
    writeLastAccount('u1', 'w1', 'acc-1', s);
    writeLastAccount('u1', 'w1', 'acc-1', s);
    expect(s.writes).toBe(1);
    writeLastAccount('u1', 'w1', 'acc-2', s);
    expect(s.writes).toBe(2);
  });

  it('[TC-TRANSACTIONS-QUICK-012] con un almacenamiento que lanza o ausente no falla y no recuerda nada', () => {
    expect(readLastAccount('u1', 'w1', throwing)).toBeNull();
    expect(() => writeLastAccount('u1', 'w1', 'acc-1', throwing)).not.toThrow();
    expect(readLastAccount('u1', 'w1', null)).toBeNull();
    expect(() => writeLastAccount('u1', 'w1', 'acc-1', null)).not.toThrow();
  });

  it('[TC-TRANSACTIONS-QUICK-011] el enlace tiene prioridad sobre la cuenta recordada', () => {
    expect(
      initialAccount({ linkAccountId: 'link', remembered: 'acc-1', activeAccounts: [{ id: 'acc-1' }] }),
    ).toBe('link');
  });

  it('[TC-TRANSACTIONS-QUICK-010] usa la recordada si está activa', () => {
    expect(
      initialAccount({ linkAccountId: undefined, remembered: 'acc-1', activeAccounts: [{ id: 'acc-1' }] }),
    ).toBe('acc-1');
  });

  it('[TC-TRANSACTIONS-QUICK-012] una cuenta archivada o de otro workspace no se preselecciona', () => {
    expect(
      initialAccount({ linkAccountId: undefined, remembered: 'acc-old', activeAccounts: [{ id: 'acc-1' }] }),
    ).toBe('');
    expect(initialAccount({ linkAccountId: undefined, remembered: null, activeAccounts: [] })).toBe('');
  });
});
