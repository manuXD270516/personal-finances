import { describe, expect, it } from 'vitest';
import { parseProfileOptions, serializeProfileOptions } from './profile-options.js';

describe('serializeProfileOptions', () => {
  it('es la inversa de parseProfileOptions (ida y vuelta exacta)', () => {
    const input = {
      version: 'imports.profile.v1',
      mapping: {
        hasHeader: true,
        skipRows: 2,
        skipFooterRows: 1,
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
        descriptionCleanup: ['COMPRA '],
        columns: {
          date: { index: 0, header: 'Fecha' },
          description: { indexes: [{ index: 1, header: 'Detalle' }, { index: 2 }] },
          amount: {
            mode: 'INDICATOR',
            index: 3,
            indicator: { index: 4 },
            debitValues: ['D'],
            creditValues: ['C'],
          },
          currency: { index: 5, aliases: { 'BS.': 'BOB' } },
          reference: { index: 6, unique: false },
          runningBalance: { index: 7 },
        },
      },
    };
    const parsed = parseProfileOptions('CSV', input);
    const again = parseProfileOptions('CSV', serializeProfileOptions(parsed));
    expect(again).toEqual(parsed);
  });
});
