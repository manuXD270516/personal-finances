import { describe, expect, it } from 'vitest';
import { PROVIDER_RECORD_NAMESPACE_PREFIX, isImportRefNamespace } from './index.js';

describe('referencias de proveedores de movimientos externos (add-banking-providers, INV-014)', () => {
  it('acepta imports.provider:<exchange>:<tipo> y rechaza lo demás', () => {
    for (const type of ['TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'REWARD']) {
      expect(isImportRefNamespace(`${PROVIDER_RECORD_NAMESPACE_PREFIX}BINANCE:${type}`)).toBe(true);
    }
    expect(isImportRefNamespace('imports.provider:BINANCE:P2P')).toBe(false);
    expect(isImportRefNamespace('imports.provider:binance:TRADE')).toBe(false);
    expect(isImportRefNamespace('imports.provider:BINANCE')).toBe(false);
    expect(isImportRefNamespace('imports.csv-row')).toBe(true);
    expect(isImportRefNamespace('imports.ext:OFX')).toBe(true);
    expect(isImportRefNamespace('imports.other:X')).toBe(false);
  });
});
