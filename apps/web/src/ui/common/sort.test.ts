import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from './sort';

type Row = { category: string; amount: string; on: string };
const rows: Row[] = [
  { category: 'Salud', amount: '45.30', on: '2026-03-02' },
  { category: 'Alimentación', amount: '1234.56', on: '2026-01-15' },
  { category: 'Transporte', amount: '999.00', on: '2026-02-20' },
];

describe('[TC-PLATFORM-TABLES-011] orden por columna comparando el valor', () => {
  it('[TC-PLATFORM-TABLES-011] los montos se ordenan por su valor decimal, no por el texto', () => {
    const desc = sortRows(rows, (r) => r.amount, 'descending', 'decimal');
    expect(desc.map((r) => r.category)).toEqual(['Alimentación', 'Transporte', 'Salud']);
    const asc = sortRows(rows, (r) => r.amount, 'ascending', 'decimal');
    expect(asc.map((r) => r.category)).toEqual(['Salud', 'Transporte', 'Alimentación']);
    // Como texto plano "1234.56" < "999.00": comparar el string pondría Transporte antes que Alimentación.
    expect('1234.56' < '999.00').toBe(true);
  });

  it('[TC-PLATFORM-TABLES-011] compara decimales exactos que un number no distingue', () => {
    const big = [{ v: '9007199254740993.01' }, { v: '9007199254740993.02' }, { v: '9007199254740993.00' }];
    const asc = sortRows(big, (r) => r.v, 'ascending', 'decimal').map((r) => r.v);
    expect(asc).toEqual(['9007199254740993.00', '9007199254740993.01', '9007199254740993.02']);
  });

  it('[TC-PLATFORM-TABLES-011] no muta la entrada y es estable con valores iguales', () => {
    const copy = [...rows];
    const same = [
      { k: 'a', v: '1.00' },
      { k: 'b', v: '1.00' },
      { k: 'c', v: '0.50' },
    ];
    const out = sortRows(same, (r) => r.v, 'ascending', 'decimal');
    expect(out.map((r) => r.k)).toEqual(['c', 'a', 'b']);
    expect(rows).toEqual(copy);
  });

  it('[TC-PLATFORM-TABLES-011] texto con collator (acentos y números) y fechas ISO', () => {
    const t = sortRows(rows, (r) => r.category, 'ascending', 'text').map((r) => r.category);
    expect(t).toEqual(['Alimentación', 'Salud', 'Transporte']);
    const d = sortRows(rows, (r) => r.on, 'ascending', 'date').map((r) => r.on);
    expect(d).toEqual(['2026-01-15', '2026-02-20', '2026-03-02']);
  });

  it('[TC-PLATFORM-TABLES-011] los valores ausentes van al final en ambos sentidos', () => {
    const withGap = [{ v: '5.00' }, { v: undefined }, { v: '7.00' }];
    expect(sortRows(withGap, (r) => r.v, 'ascending', 'decimal').map((r) => r.v)).toEqual([
      '5.00',
      '7.00',
      undefined,
    ]);
    expect(sortRows(withGap, (r) => r.v, 'descending', 'decimal').map((r) => r.v)).toEqual([
      '7.00',
      '5.00',
      undefined,
    ]);
  });

  it('[TC-PLATFORM-TABLES-012] los montos empiezan de mayor a menor, el texto ascendente, y repetir alterna', () => {
    expect(nextSort(undefined, 'amount', 'decimal')).toEqual({ key: 'amount', direction: 'descending' });
    expect(nextSort({ key: 'amount', direction: 'descending' }, 'amount', 'decimal')).toEqual({
      key: 'amount',
      direction: 'ascending',
    });
    expect(nextSort({ key: 'amount', direction: 'descending' }, 'category', 'text')).toEqual({
      key: 'category',
      direction: 'ascending',
    });
    expect(nextSort(undefined, 'on', 'date')).toEqual({ key: 'on', direction: 'ascending' });
  });
});
