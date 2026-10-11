import { LocalDate, currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { calculateSchedule } from './amortization-calculator.js';
import {
  detectReferenceTable,
  parseReferenceSchedule,
  validateReferenceRows,
} from './reference-schedule-parser.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);

const vehicular = () =>
  calculateSchedule({
    currency: BOB,
    principal: '50000.00',
    annualRate: '0.115',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    installments: 24,
    accrualStart: d('2026-10-15'),
    firstDueDate: d('2026-11-15'),
  }).installments;

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Tabla del banco "pegada desde la planilla": separador decimal coma, fechas dd/mm/aaaa. */
const pegada = (mutate?: (rows: string[][]) => void, delimiter = ';') => {
  const rows = vehicular().map((c) => [
    String(c.n),
    ddmmyyyy(c.dueDate),
    c.principal.replace('.', ','),
    c.interest.replace('.', ','),
    c.total.replace('.', ','),
  ]);
  mutate?.(rows);
  return [['Nro', 'Fecha', 'Capital', 'Interés', 'Cuota'], ...rows].map((r) => r.join(delimiter)).join('\n');
};

const mapping = {
  installmentNo: 'Nro',
  dueDate: 'Fecha',
  principal: 'Capital',
  interest: 'Interés',
  total: 'Cuota',
};
const base = { mapping, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',', currency: BOB } as const;

describe('ReferenceScheduleParser — tabla del banco', () => {
  it('[TC-DEBT-AMORT-015] 24 filas con coma decimal y fechas dd/mm/aaaa, mapeadas por encabezado', () => {
    const r = parseReferenceSchedule({ ...base, text: pegada() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delimiter).toBe(';');
    expect(r.rows).toHaveLength(24);
    expect(r.rows[0]).toEqual({
      n: 1,
      dueDate: '2026-11-15',
      principal: '1862.85',
      interest: '479.17',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
      total: '2342.02',
    });
    expect(r.rows[23]!.total).toBe('2341.90');
  });

  it('[TC-DEBT-AMORT-015] texto pegado con tabuladores se detecta y el mapeo puede ser por índice', () => {
    const text = pegada(undefined, '\t');
    expect(detectReferenceTable(text)).toMatchObject({
      delimiter: '\t',
      headers: ['Nro', 'Fecha', 'Capital', 'Interés', 'Cuota'],
      rowCount: 24,
    });
    const r = parseReferenceSchedule({
      ...base,
      text,
      mapping: { installmentNo: 0, dueDate: 1, principal: 2, interest: 3, total: 4 },
    });
    expect(r.ok && r.rows.length).toBe(24);
  });

  it('[TC-DEBT-AMORT-016] la fila 3 con total 2342.20 en vez de 2342.02 se rechaza con el detalle', () => {
    const text = pegada((rows) => {
      rows[2] = ['3', '15/01/2027', '1898,73', '443,29', '2342,20'];
    });
    const r = parseReferenceSchedule({ ...base, text });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({
      row: 3,
      field: 'total',
      details: { calculated: '2342.02', reported: '2342.20' },
    });
    expect(r.errors[0]!.message).toContain('2342.02 calculado frente a 2342.20 informado');
  });

  it('montos ilegibles, negativos y con escala mayor a la de la moneda se informan por fila', () => {
    const text = pegada((rows) => {
      rows[0] = ['1', '15/11/2026', 'abc', '479,17', '2342,02'];
      rows[1] = ['2', '15/12/2026', '-1880,71', '461,31', '2342,02'];
      rows[3] = ['4', '15/02/2027', '1900,123', '441,89', '2342,02'];
    });
    const r = parseReferenceSchedule({ ...base, text });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.row, e.field, e.code])).toEqual([
      [1, 'principal', 'AMOUNT_UNREADABLE'],
      [2, 'principal', 'AMOUNT_NEGATIVE'],
      [4, 'principal', 'AMOUNT_SCALE_EXCEEDED'],
    ]);
  });

  it('fechas inválidas, números repetidos y formatos de fecha alternativos', () => {
    const text = pegada((rows) => {
      rows[1] = ['1', '31/02/2026', '1880,71', '461,31', '2342,02'];
    });
    const r = parseReferenceSchedule({ ...base, text });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.row, e.field, e.code])).toEqual([
      [2, 'dueDate', 'DATE_INVALID'],
      [2, 'installmentNo', 'INSTALLMENT_NO_DUPLICATED'],
    ]);

    const iso = parseReferenceSchedule({
      text: 'n,fecha,capital,interes\n1,2026-11-15,"1,000.50",10.25\n2,2026-12-15,5.00,0.10',
      mapping: { installmentNo: 'n', dueDate: 'fecha', principal: 'capital', interest: 'interes' },
      dateFormat: 'YYYY-MM-DD',
      decimalSeparator: '.',
      currency: BOB,
    });
    expect(iso.ok && iso.rows.map((x) => [x.principal, x.total])).toEqual([
      ['1000.50', '1010.75'],
      ['5.00', '5.10'],
    ]);
    const us = parseReferenceSchedule({
      text: 'n,date,p,i\n1,11/15/2026,10.00,1.00',
      mapping: { installmentNo: 'n', dueDate: 'date', principal: 'p', interest: 'i' },
      dateFormat: 'MM/DD/YYYY',
      decimalSeparator: '.',
      currency: BOB,
    });
    expect(us.ok && us.rows[0]!.dueDate).toBe('2026-11-15');
  });

  it('columnas opcionales (comisiones, seguro, impuestos, saldo) y total derivado', () => {
    const r = parseReferenceSchedule({
      text: 'n;f;c;i;com;seg;imp;saldo\n1;15/11/2026;100,00;10,00;1,50;0,50;0,25;900,00',
      mapping: {
        installmentNo: 'n',
        dueDate: 'f',
        principal: 'c',
        interest: 'i',
        fees: 'com',
        insurance: 'seg',
        taxes: 'imp',
        balance: 'saldo',
      },
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      currency: BOB,
    });
    expect(r.ok && r.rows[0]).toMatchObject({
      fees: '1.50',
      insurance: '0.50',
      taxes: '0.25',
      total: '112.25',
      balance: '900.00',
    });
  });

  it('límites: más de 600 filas, más de 256 KiB, mapeo inexistente y tabla vacía', () => {
    const fila = (i: number) => `${i};15/11/2026;1,00;0,10`;
    const muchas = ['n;f;c;i', ...Array.from({ length: 601 }, (_, i) => fila(i + 1))].join('\n');
    const m = { installmentNo: 'n', dueDate: 'f', principal: 'c', interest: 'i' };
    const big = parseReferenceSchedule({
      text: muchas,
      mapping: m,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      currency: BOB,
    });
    expect(big.ok).toBe(false);
    expect(!big.ok && big.errors[0]).toMatchObject({ row: 0, field: 'file', code: 'TOO_MANY_ROWS' });

    const grande = parseReferenceSchedule({
      text: 'x'.repeat(262_145),
      mapping: m,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      currency: BOB,
    });
    expect(!grande.ok && grande.errors[0]).toMatchObject({ field: 'file', code: 'TOO_LARGE' });

    const sinCol = parseReferenceSchedule({
      text: 'a;b\n1;2',
      mapping: m,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      currency: BOB,
    });
    expect(!sinCol.ok && sinCol.errors.map((e) => e.code)).toContain('MAPPING_COLUMN_NOT_FOUND');

    const vacia = parseReferenceSchedule({
      text: 'n;f;c;i\n',
      mapping: m,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      currency: BOB,
    });
    expect(!vacia.ok && vacia.errors[0]!.code).toBe('NO_ROWS');
  });

  it('filas ingresadas a mano reciben las mismas validaciones', () => {
    const ok = validateReferenceRows(
      [{ n: 1, dueDate: '2026-11-15', principal: '10.00', interest: '1.00' }],
      BOB,
    );
    expect(ok.ok && ok.rows[0]!.total).toBe('11.00');
    const bad = validateReferenceRows(
      [{ n: 1, dueDate: '2026-11-15', principal: '10.00', interest: '1.00', total: '12.00' }],
      BOB,
    );
    expect(!bad.ok && bad.errors[0]).toMatchObject({ row: 1, field: 'total' });
  });
});
