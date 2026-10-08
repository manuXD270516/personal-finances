import fc from 'fast-check';
import { LocalDate, currency, dec, type Decimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  BudgetProgressCalculator,
  type AggregateLine,
  type LineProgressInput,
} from './budget-progress-calculator.js';
import type { BudgetLineKind, BudgetNature, TargetKind } from './budget-types.js';

const BOB = currency('BOB', 2);
const NOV = { start: LocalDate.parse('2026-11-01'), end: LocalDate.parse('2026-11-30') };
const OCT = { start: LocalDate.parse('2026-10-01'), end: LocalDate.parse('2026-10-31') };

function input(over: Partial<LineProgressInput> & { kind: BudgetLineKind }): LineProgressInput {
  return {
    nature: 'EXPENSE',
    currency: BOB,
    planned: null,
    min: null,
    max: null,
    percent: null,
    incomeBase: null,
    rolloverIn: null,
    actual: dec('0'),
    period: NOV,
    today: LocalDate.parse('2026-11-10'),
    ...over,
  };
}

describe('BudgetProgressCalculator.line', () => {
  it('[TC-PLANNING-BUDGET-005] fijo: en el objetivo con 2800.00 (restante 0.00, 100.0 %) y por debajo con 2700.00 (restante 100.00)', () => {
    const exact = BudgetProgressCalculator.line(
      input({ kind: 'FIXED', planned: dec('2800'), actual: dec('2800') }),
    );
    expect(exact.status).toBe('ON_TARGET');
    expect(exact.remaining.toString()).toBe('0.00 BOB');
    expect(exact.utilization).toBe('100.0');
    const under = BudgetProgressCalculator.line(
      input({ kind: 'FIXED', planned: dec('2800'), actual: dec('2700') }),
    );
    expect(under.status).toBe('UNDER');
    expect(under.remaining.toString()).toBe('100.00 BOB');
  });

  it('[TC-PLANNING-BUDGET-006] máximo excedido: 650.00 de 600.00 => restante -50.00, 108.3 % y estado OVER', () => {
    const p = BudgetProgressCalculator.line(
      input({
        kind: 'MAXIMUM',
        planned: dec('600'),
        actual: dec('650'),
        today: LocalDate.parse('2026-11-30'),
      }),
    );
    expect(p.status).toBe('OVER');
    expect(p.remaining.toString()).toBe('-50.00 BOB');
    expect(p.utilization).toBe('108.3');
  });

  it('[TC-PLANNING-BUDGET-009] proyección lineal: 550.00 al día 10 de 30 => 1650.00, restante 950.00 y 36.7 %; periodo terminado => igual al gastado', () => {
    const mid = BudgetProgressCalculator.line(
      input({ kind: 'MAXIMUM', planned: dec('1500'), actual: dec('550') }),
    );
    expect(mid.remaining.toString()).toBe('950.00 BOB');
    expect(mid.utilization).toBe('36.7');
    expect(mid.projection?.toString()).toBe('1650.00 BOB');
    const past = BudgetProgressCalculator.line(
      input({ kind: 'MAXIMUM', planned: dec('1500'), actual: dec('1320'), period: OCT }),
    );
    expect(past.projection?.toString()).toBe('1320.00 BOB');
    const future = BudgetProgressCalculator.line(
      input({
        kind: 'MAXIMUM',
        planned: dec('1500'),
        actual: dec('0'),
        today: LocalDate.parse('2026-10-20'),
      }),
    );
    expect(future.projection).toBeNull();
  });

  it('[TC-PLANNING-BUDGET-010] planificado 0.00 con gasto: sin presupuesto, porcentaje null y restante -40.00', () => {
    const p = BudgetProgressCalculator.line(input({ kind: 'MAXIMUM', planned: dec('0'), actual: dec('40') }));
    expect(p.status).toBe('NO_BUDGET');
    expect(p.utilization).toBeNull();
    expect(p.remaining.toString()).toBe('-40.00 BOB');
  });

  it('[TC-PLANNING-BUDGET-022] fijo y mínimo no proyectan: pendiente antes del pago, cumplido (sin 42000.00) después; el máximo sí proyecta', () => {
    const before = BudgetProgressCalculator.line(
      input({ kind: 'FIXED', planned: dec('2800'), actual: dec('0'), today: LocalDate.parse('2026-11-01') }),
    );
    expect(before.status).toBe('UNDER');
    expect(before.projection).toBeNull();
    const after = BudgetProgressCalculator.line(
      input({
        kind: 'FIXED',
        planned: dec('2800'),
        actual: dec('2800'),
        today: LocalDate.parse('2026-11-02'),
      }),
    );
    expect(after.status).toBe('ON_TARGET');
    expect(after.remaining.toString()).toBe('0.00 BOB');
    expect(after.utilization).toBe('100.0');
    expect(after.projection).toBeNull();
    const minimum = BudgetProgressCalculator.line(
      input({ kind: 'MINIMUM', min: dec('500'), actual: dec('200'), today: LocalDate.parse('2026-11-02') }),
    );
    expect(minimum.status).toBe('PENDING');
    expect(minimum.projection).toBeNull();
    const max = BudgetProgressCalculator.line(
      input({
        kind: 'MAXIMUM',
        planned: dec('1500'),
        actual: dec('200'),
        today: LocalDate.parse('2026-11-02'),
      }),
    );
    expect(max.projection?.toString()).toBe('3000.00 BOB');
  });

  it('[TC-PLANNING-BUDGET-015] mínimo: faltan 150.00 con 250.00 y cumplido con 450.00', () => {
    const pending = BudgetProgressCalculator.line(
      input({ kind: 'MINIMUM', min: dec('400'), actual: dec('250') }),
    );
    expect(pending.status).toBe('PENDING');
    expect(pending.remaining.toString()).toBe('150.00 BOB');
    const met = BudgetProgressCalculator.line(
      input({ kind: 'MINIMUM', min: dec('400'), actual: dec('450') }),
    );
    expect(met.status).toBe('MET');
  });

  it('[TC-PLANNING-BUDGET-016] rango 1200.00-1500.00: debajo (1100.00), dentro (1350.00 = 90.0 % del máximo) y encima con exceso 50.00 (1550.00)', () => {
    const range = (actual: string) =>
      BudgetProgressCalculator.line(
        input({ kind: 'RANGE', min: dec('1200'), max: dec('1500'), actual: dec(actual) }),
      );
    expect(range('1100').status).toBe('BELOW');
    const within = range('1350');
    expect(within.status).toBe('WITHIN');
    expect(within.utilization).toBe('90.0');
    const above = range('1550');
    expect(above.status).toBe('ABOVE');
    expect(above.remaining.toString()).toBe('-50.00 BOB');
  });

  it('[TC-PLANNING-BUDGET-019] porcentaje de ingresos: 10 % de 8000.00 = 800.00; 10 % de 6500.00 = 650.00; 12.5 % de 8000.50 = 1000.06 (HALF_EVEN)', () => {
    const pct = (percent: string, base: string) =>
      BudgetProgressCalculator.line(
        input({ kind: 'PERCENT_OF_INCOME', percent: dec(percent), incomeBase: dec(base) }),
      ).effectivePlanned.toString();
    expect(pct('10', '8000')).toBe('800.00 BOB');
    expect(pct('10', '6500')).toBe('650.00 BOB');
    expect(pct('12.5', '8000.50')).toBe('1000.06 BOB');
  });

  it('el rollover recibido suma al planificado y nunca lo deja bajo 0.00', () => {
    const withIn = (rolloverIn: string) =>
      BudgetProgressCalculator.line(
        input({ kind: 'MAXIMUM', planned: dec('600'), rolloverIn: dec(rolloverIn) }),
      ).effectivePlanned.toString();
    expect(withIn('80')).toBe('680.00 BOB');
    expect(withIn('-50')).toBe('550.00 BOB');
    expect(withIn('-900')).toBe('0.00 BOB');
  });

  it('línea de ingreso: diferencia real - esperado (6500.00 de 8000.00 => -1500.00) y sin proyección', () => {
    const p = BudgetProgressCalculator.line(
      input({ kind: 'FIXED', nature: 'INCOME', planned: dec('8000'), actual: dec('6500') }),
    );
    expect(p.difference.toString()).toBe('-1500.00 BOB');
    expect(p.projection).toBeNull();
    expect(p.status).toBe('UNDER');
  });
});

describe('BudgetProgressCalculator.totals', () => {
  const line = (
    nature: BudgetNature,
    targetKind: TargetKind,
    kind: BudgetLineKind,
    planned: string,
    actual: string,
  ): AggregateLine => ({
    nature,
    targetKind,
    progress: BudgetProgressCalculator.line(
      input({
        kind,
        nature,
        planned: dec(planned),
        min: kind === 'MINIMUM' ? dec(planned) : null,
        actual: dec(actual),
      }),
    ),
  });

  it('[TC-PLANNING-BUDGET-011] disponible para gastar 3750.00 = 950.00 + 0.00 (excedida) + 2800.00', () => {
    const totals = BudgetProgressCalculator.totals(
      [
        line('EXPENSE', 'CATEGORY', 'MAXIMUM', '1500', '550'),
        line('EXPENSE', 'CATEGORY', 'MAXIMUM', '600', '650'),
        line('EXPENSE', 'CATEGORY', 'FIXED', '2800', '0'),
      ],
      BOB,
      false,
    );
    expect(totals.availableToSpend.toString()).toBe('3750.00 BOB');
    expect(totals.toAssign).toBeNull();
  });

  it('[TC-PLANNING-BUDGET-021] las líneas de tag no entran al disponible ni a los totales de gasto', () => {
    const totals = BudgetProgressCalculator.totals(
      [
        line('EXPENSE', 'CATEGORY', 'MAXIMUM', '1500', '550'),
        line('EXPENSE', 'TAG', 'MAXIMUM', '2000', '1500'),
      ],
      BOB,
      false,
    );
    expect(totals.availableToSpend.toString()).toBe('950.00 BOB');
    expect(totals.planned.toString()).toBe('1500.00 BOB');
    expect(totals.actual.toString()).toBe('550.00 BOB');
  });

  it('[TC-PLANNING-BUDGET-020] base cero: por asignar 500.00 con 8000.00 esperados y 7500.00 planificados; 0.00 tras agregar 500.00', () => {
    const lines = [
      line('INCOME', 'CATEGORY', 'FIXED', '8000', '0'),
      line('EXPENSE', 'CATEGORY', 'MAXIMUM', '7500', '0'),
    ];
    expect(BudgetProgressCalculator.totals(lines, BOB, true).toAssign?.toString()).toBe('500.00 BOB');
    const more = [...lines, line('EXPENSE', 'CATEGORY', 'FIXED', '500', '0')];
    expect(BudgetProgressCalculator.totals(more, BOB, true).toAssign?.toString()).toBe('0.00 BOB');
    const over = [...more, line('EXPENSE', 'CATEGORY', 'FIXED', '100', '0')];
    expect(BudgetProgressCalculator.totals(over, BOB, true).toAssign?.toString()).toBe('-100.00 BOB');
  });

  it('PBT [TC-PLANNING-BUDGET-011]: el disponible nunca es negativo y no supera Σ de referencias', () => {
    const cents = fc.integer({ min: 0, max: 5_000_000 });
    const asDec = (n: number): Decimal => dec(String(n)).div(100);
    fc.assert(
      fc.property(fc.array(fc.tuple(cents, cents), { minLength: 0, maxLength: 12 }), (pairs) => {
        const lines = pairs.map(([planned, actual]) =>
          line('EXPENSE', 'CATEGORY', 'MAXIMUM', asDec(planned).toFixed(2), asDec(actual).toFixed(2)),
        );
        const totals = BudgetProgressCalculator.totals(lines, BOB, false);
        const refs = pairs.reduce((a, [p]) => a + p, 0);
        expect(totals.availableToSpend.isNegative()).toBe(false);
        expect(totals.availableToSpend.amount.lte(asDec(refs))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
