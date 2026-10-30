import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQifDate, QifReader } from '../../domain/qif-reader.js';
import type { ParseOptions } from '../../domain/statement.js';

const DIR = resolve(__dirname, '../../../../../../tests/fixtures/imports');
const bytes = (rel: string) => new Uint8Array(readFileSync(resolve(DIR, rel)));
const OPTIONS: ParseOptions = {
  timeZone: 'America/La_Paz',
  maxRows: 5000,
  accountCurrency: 'BOB',
  currencyScale: 2,
};
const reader = new QifReader();

describe('lector QIF', () => {
  it('[TC-IMPORTS-PIPELINE-017] una fecha ambigua sin orden elegido espera mapeo y ninguna fila tiene fecha', () => {
    const parsed = reader.parse(bytes('qif/banco.qif'), OPTIONS);
    expect(parsed.needsMapping).toEqual([{ code: 'IMPORT_AMBIGUOUS_DATE' }]);
    expect(parsed.records.map((r) => r.bookingDate)).toEqual([null, null]);
  });

  it('[TC-IMPORTS-PIPELINE-018] con día primero un QIF de tarjeta da una salida de 120.00 del 2026-04-03', () => {
    const parsed = reader.parse(bytes('qif/tarjeta.qif'), { ...OPTIONS, dateOrder: 'DMY' });
    expect(parsed.needsMapping).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      bookingDate: '2026-04-03',
      amount: '-120.00',
      description: 'RESTAURANTE SINTETICO Compra con tarjeta',
      counterparty: 'RESTAURANTE SINTETICO',
      issues: [],
    });
    const monthFirst = reader.parse(bytes('qif/tarjeta.qif'), { ...OPTIONS, dateOrder: 'MDY' });
    expect(monthFirst.records[0]?.bookingDate).toBe('2026-03-04');
  });

  it('lee banco con miles, número de cheque como referencia y fechas inequívocas sin pedir orden', () => {
    const parsed = reader.parse(bytes('qif/banco.qif'), { ...OPTIONS, dateOrder: 'DMY' });
    expect(parsed.records.map((r) => [r.bookingDate, r.amount, r.reference])).toEqual([
      ['2026-04-03', '-245.30', '1042'],
      ['2026-04-15', '1500.00', null],
    ]);
    expect(parseQifDate("15/04'26", undefined)).toEqual({ kind: 'OK', date: '2026-04-15' });
    expect(parseQifDate('05/05/2026', undefined)).toEqual({ kind: 'OK', date: '2026-05-05' });
    expect(parseQifDate('31/02/2026', 'DMY')).toEqual({ kind: 'INVALID' });
  });

  it('[TC-IMPORTS-PIPELINE-019] divisiones de -60.00 y -30.00 que no suman -100.00 invalidan la fila', () => {
    const parsed = reader.parse(bytes('qif/divisiones-no-suman.qif'), { ...OPTIONS, dateOrder: 'DMY' });
    expect(parsed.records[0]?.issues).toContainEqual({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
    expect(parsed.records[0]?.amount).toBeNull();
  });

  it('divisiones que sí suman dejan la fila válida', () => {
    const qif = '!Type:Bank\nD3/4/2026\nT-90.00\nPX\n$-60.00\n$-30.00\n^\n';
    const parsed = reader.parse(new TextEncoder().encode(qif), { ...OPTIONS, dateOrder: 'DMY' });
    expect(parsed.records[0]).toMatchObject({ amount: '-90.00', issues: [] });
  });

  it('tipos no admitidos, binario y exceso de filas fallan la lectura', () => {
    const encode = (s: string) => new TextEncoder().encode(s);
    expect(reader.parse(encode('!Type:Invst\nD1/1/2026\nT1\n^\n'), OPTIONS).failure?.code).toBe(
      'IMPORT_PARSE_FAILED',
    );
    expect(reader.parse(encode('sin cabecera'), OPTIONS).failure?.code).toBe('IMPORT_PARSE_FAILED');
    const many = `!Type:Bank\n${'D1/1/2026\nT-1.00\n^\n'.repeat(3)}`;
    const over = reader.parse(encode(many), { ...OPTIONS, maxRows: 2 });
    expect(over.failure).toEqual({ code: 'IMPORT_TOO_MANY_ROWS', pointer: null });
    expect(over.records).toEqual([]);
  });

  it('[TC-IMPORTS-PIPELINE-011] el detector reconoce QIF por su contenido', () => {
    expect(reader.sniff(bytes('qif/tarjeta.qif'))).toEqual({ format: 'QIF', confidence: 'HIGH' });
    expect(reader.sniff(new TextEncoder().encode('Fecha;Monto'))).toBeNull();
  });
});
