import { LocalDate, currency, dec, type ExactRate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PeriodSeriesBuilder, type FlowRow } from './period-series-builder.js';

const BOB = currency('BOB', 2);
const usdRate = (code: string): ExactRate | null =>
  code === 'USD' ? { base: 'USD', quote: 'BOB', value: dec('6.96') } : null;
const row = (
  businessDate: string,
  amount: string,
  cur = 'BOB',
  nature: 'INCOME' | 'EXPENSE' = 'EXPENSE',
  categoryId = 'c1',
): FlowRow => ({ businessDate, nature, categoryId, amount: { amount, currency: cur } });

const build = (rows: FlowRow[], today: string, startDay = 1) =>
  PeriodSeriesBuilder.build({
    rows,
    today: LocalDate.parse(today),
    startDay,
    maxPeriods: 60,
    target: BOB,
    rateFor: usdRate,
  });

describe('PeriodSeriesBuilder', () => {
  it('[TC-FORECAST-SERVICE-011] convierte con la tasa de cada fecha y descuenta el reembolso (1448.00 BOB)', () => {
    // Día de inicio 25: 2026-09-25..2026-10-24 (etiqueta por el mes del inicio, D59: 2026-09).
    const history = build(
      [row('2026-10-02', '1200.00'), row('2026-10-02', '50.00', 'USD'), row('2026-10-02', '-100.00')],
      '2026-11-10',
      25,
    );
    const p = history.periods.find((x) => x.label === '2026-09');
    expect(p?.expenseTotal.toString()).toBe('1448');
    expect(p?.start).toBe('2026-09-25');
    expect(p?.end).toBe('2026-10-24');
  });

  it('[TC-FORECAST-SERVICE-012] un flujo sin tasa se excluye y se cuenta, nunca 1:1', () => {
    const history = build(
      [
        row('2026-09-02', '1200.00'),
        row('2026-09-02', '50.00', 'USD'),
        row('2026-09-03', '20.000000', 'USDT'),
      ],
      '2026-11-10',
    );
    const p = history.periods.find((x) => x.label === '2026-09');
    expect(p?.expenseTotal.toString()).toBe('1548');
    expect(p?.unvaluedCount).toBe(1);
  });

  it('[TC-FORECAST-SERVICE-013] el periodo en curso no entra en la historia', () => {
    const history = build([row('2026-10-05', '100.00'), row('2026-11-05', '999.00')], '2026-11-10');
    expect(history.lastFinished).toBe('2026-10');
    expect(history.currentPeriod).toBe('2026-11');
    expect(history.periods.map((p) => p.label)).toEqual(['2026-10']);
  });

  it('[TC-FORECAST-SERVICE-019] una categoría sin gasto en un periodo con actividad cuenta cero', () => {
    const history = build(
      [
        row('2026-07-05', '50.00', 'BOB', 'EXPENSE', 'rest'),
        row('2026-08-05', '70.00', 'BOB', 'EXPENSE', 'otra'),
      ],
      '2026-11-10',
    );
    const august = history.periods.find((p) => p.label === '2026-08');
    expect(august?.active).toBe(true);
    expect(august?.expenseByCategory.get('rest')).toBeUndefined();
    expect(august?.expenseTotal.toString()).toBe('70');
  });

  it('[TC-FORECAST-SERVICE-011] PBT: Σ categorías del periodo = total del periodo y el orden de filas no cambia el resultado', () => {
    const rowArb = fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      month: fc.integer({ min: 1, max: 10 }),
      cents: fc.integer({ min: 0, max: 500000 }),
      cat: fc.constantFrom('a', 'b', 'c'),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 40 }), (rs) => {
        const rows = rs.map((r) =>
          row(
            `2026-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
            (r.cents / 100).toFixed(2),
            'BOB',
            'EXPENSE',
            r.cat,
          ),
        );
        const a = build(rows, '2026-12-10');
        const b = build([...rows].reverse(), '2026-12-10');
        for (const p of a.periods) {
          let sum = dec('0');
          for (const f of p.expenseByCategory.values()) sum = sum.plus(f.value);
          expect(sum.eq(p.expenseTotal)).toBe(true);
        }
        expect(a.periods.map((p) => p.expenseTotal.toString())).toEqual(
          b.periods.map((p) => p.expenseTotal.toString()),
        );
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
