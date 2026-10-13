import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { parseReferenceSchedule } from '../domain/reference-schedule-parser.js';

const BOB = currency('BOB', 2);
const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '../../../../../tests/fixtures/loans/plan-pagos-vehicular', name), 'utf8');

const input = (text: string) =>
  ({
    text,
    mapping: {
      installmentNo: 'Nro Cuota',
      dueDate: 'Fecha Vencimiento',
      principal: 'Capital',
      interest: 'Interes',
      total: 'Total Cuota',
      balance: 'Saldo Capital',
    },
    dateFormat: 'DD/MM/YYYY',
    decimalSeparator: ',',
    currency: BOB,
  }) as const;

describe('ReferenceScheduleParser — golden files del banco (ficticios)', () => {
  it('[TC-DEBT-AMORT-015] el plan de pagos vehicular de ejemplo se lee completo y cierra el saldo en cero', () => {
    const r = parseReferenceSchedule(input(fixture('input.csv')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delimiter).toBe(';');
    expect(r.rows).toHaveLength(36);
    expect(r.rows[0]).toMatchObject({
      n: 1,
      dueDate: '2026-11-15',
      principal: '1988.38',
      interest: '814.58',
    });
    expect(r.rows[35]).toMatchObject({ n: 36, balance: '0.00' });
  });

  it('[TC-DEBT-AMORT-015] la variante con el vencimiento corrido a día hábil cambia solo la cuota 7', () => {
    const base = parseReferenceSchedule(input(fixture('input.csv')));
    const variant = parseReferenceSchedule(input(fixture('variante-fechas-banco.csv')));
    expect(base.ok && variant.ok).toBe(true);
    if (!base.ok || !variant.ok) return;
    const changed = variant.rows.filter((row, i) => row.dueDate !== base.rows[i]!.dueDate);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ n: 7, dueDate: '2027-05-17' });
  });
});
