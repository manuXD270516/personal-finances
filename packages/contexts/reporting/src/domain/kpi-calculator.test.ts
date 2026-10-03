import { currency, dec, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { KpiCalculator, type NominalFlow } from './kpi-calculator.js';
import { present, type ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (a: string) => Money.parse(a, BOB);
const SEP = { from: '2026-09-01', to: '2026-09-30' };

const flow = (
  nature: NominalFlow['nature'],
  amount: Money,
  categoryId: string,
  businessDate = '2026-09-10',
): NominalFlow => ({ nature, amount, categoryId, businessDate });

/**
 * Fixtures = filas de `SummarizeNominalFlows` (postings a INCOME/EXPENSE de asientos activos, docs/09 §6). Por
 * construcción, una transferencia, el principal de una conversión, un saldo inicial o un ajuste NO generan filas; una
 * comisión de conversión genera una fila EXPENSE de *Fees* y un reembolso una fila EXPENSE negativa.
 */
describe('KpiCalculator (docs/14 §4)', () => {
  it('[TC-REPORTING-KPI-001] los ingresos del mes son solo el salario: transferencia, conversión y saldo inicial no son ingreso', () => {
    // Salario 8000.00 BOB; transferencia 1000.00 BOB (sin filas); conversión 100 USDT → 685.00 BOB con fee 5.00 BOB
    // (solo la fila del fee, EXPENSE); saldo inicial 500.00 BOB (sin filas).
    const flows = [
      flow('INCOME', bob('8000.00'), 'cat-salario', '2026-09-05'),
      flow('EXPENSE', bob('5.00'), 'cat-fees', '2026-09-30'),
    ];
    expect(KpiCalculator.incomeByCurrency(KpiCalculator.within(flows, SEP)).map(String)).toEqual([
      '8000.00 BOB',
    ]);
  });

  it('[TC-REPORTING-KPI-002] los gastos incluyen el fee de conversión, restan reembolsos y excluyen el pago de tarjeta', () => {
    // El pago de tarjeta de 400.00 BOB es una transferencia sin fee: no produce filas (INV-030).
    const flows = [
      flow('EXPENSE', bob('1200.00'), 'cat-super'),
      flow('EXPENSE', bob('300.00'), 'cat-resto'),
      flow('EXPENSE', bob('-200.00'), 'cat-resto', '2026-09-20'),
      flow('EXPENSE', bob('5.00'), 'cat-fees', '2026-09-30'),
    ];
    expect(KpiCalculator.expenseByCurrency(flows).map(String)).toEqual(['1305.00 BOB']);
  });

  it('[TC-REPORTING-KPI-002] variante: una categoría con reembolso mayor que el gasto se informa con neto negativo', () => {
    const flows = [
      flow('EXPENSE', bob('50.00'), 'cat-resto', '2026-09-03'),
      flow('EXPENSE', bob('-80.00'), 'cat-resto', '2026-09-04'),
    ];
    const top = KpiCalculator.topCategories(flows, 5, {
      target: BOB,
      rateFor: () => null,
      nameOf: () => 'Restaurantes',
    });
    expect(top.map((c) => [c.name, Money.roundToScale(c.amount, BOB).toString()])).toEqual([
      ['Restaurantes', '-30.00 BOB'],
    ]);
  });

  it('[TC-REPORTING-KPI-004] ahorro = ingresos − gastos y tasa de ahorro con 1 decimal HALF_EVEN', () => {
    const savings = dec('8000.00').minus(dec('1305.00'));
    expect(savings.toFixed(2)).toBe('6695.00');
    expect(KpiCalculator.savingsRate(dec('8000.00'), savings)).toBe('83.7');
  });

  it('[TC-REPORTING-KPI-004] sin ingresos la tasa de ahorro no está definida (null), nunca 0 % ni infinito', () => {
    const savings = dec('0').minus(dec('300.00'));
    expect(savings.toFixed(2)).toBe('-300.00');
    expect(KpiCalculator.savingsRate(dec('0'), savings)).toBeNull();
  });

  it('[TC-REPORTING-KPI-006] top-N ordena por gasto neto descendente, incluye Fees y respeta N', () => {
    const names: Record<string, string> = {
      s: 'Supermercado',
      r: 'Restaurantes',
      t: 'Transporte',
      f: 'Fees',
    };
    const flows = [
      flow('EXPENSE', bob('1200.00'), 's'),
      flow('EXPENSE', bob('300.00'), 'r'),
      flow('EXPENSE', bob('-200.00'), 'r'),
      flow('EXPENSE', bob('80.00'), 't'),
      flow('EXPENSE', bob('5.00'), 'f'),
      flow('INCOME', bob('8000.00'), 'salario'),
    ];
    const opts = { target: BOB, rateFor: () => null, nameOf: (id: string) => names[id] ?? id };
    const top2 = KpiCalculator.topCategories(flows, 2, opts);
    expect(top2.map((c) => `${c.name} ${present(c.amount, BOB).toFixed()}`)).toEqual([
      'Supermercado 1200.00',
      'Restaurantes 100.00',
    ]);
    expect(KpiCalculator.topCategories(flows, 20, opts).map((c) => c.name)).toEqual([
      'Supermercado',
      'Restaurantes',
      'Transporte',
      'Fees',
    ]);
    expect(KpiCalculator.topCategories(flows, 0, opts)).toEqual([]);
  });

  it('[TC-REPORTING-KPI-006] empate de montos: desempate por nombre (collation es): Agua antes que Cine', () => {
    const names: Record<string, string> = { c: 'Cine', a: 'Agua', e: 'Éxito' };
    const flows = [
      flow('EXPENSE', bob('40.00'), 'c'),
      flow('EXPENSE', bob('40.00'), 'a'),
      flow('EXPENSE', bob('40.00'), 'e'),
    ];
    const top = KpiCalculator.topCategories(flows, 6, {
      target: BOB,
      rateFor: () => null,
      nameOf: (id) => names[id] ?? id,
    });
    expect(top.map((c) => c.name)).toEqual(['Agua', 'Cine', 'Éxito']);
  });

  it('top-N consolida cada categoría con la tasa de la fecha de cada flujo y marca incompleta la que no tiene tasa', () => {
    const rate: ExactRate = { base: 'USD', quote: 'BOB', value: dec('11.96') };
    const flows = [
      flow('EXPENSE', Money.parse('20.00', USD), 'viajes', '2026-09-10'),
      flow('EXPENSE', Money.parse('5.00', USD), 'libros', '2026-09-11'),
    ];
    const top = KpiCalculator.topCategories(flows, 5, {
      target: BOB,
      rateFor: (_ccy, date) => (date === '2026-09-10' ? rate : null),
      nameOf: (id) => id,
    });
    expect(top.map((c) => [c.name, present(c.amount, BOB).toFixed(), c.complete])).toEqual([
      ['viajes', '239.20', true],
      ['libros', '0.00', false],
    ]);
  });

  it('within filtra por fecha de negocio inclusiva', () => {
    const flows = [
      flow('EXPENSE', bob('1.00'), 'x', '2026-08-31'),
      flow('EXPENSE', bob('2.00'), 'x', '2026-09-01'),
      flow('EXPENSE', bob('3.00'), 'x', '2026-09-30'),
      flow('EXPENSE', bob('4.00'), 'x', '2026-10-01'),
    ];
    expect(KpiCalculator.expenseByCurrency(KpiCalculator.within(flows, SEP)).map(String)).toEqual([
      '5.00 BOB',
    ]);
  });
});
