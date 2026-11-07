import { currency as makeCurrency, dec, Money, type ExactRate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  CashFlowCalendar,
  type CashFlowAccountInput,
  type CashFlowMovementInput,
  type CashFlowResult,
} from './cash-flow-calendar.js';
import { CashFlowConsolidator, CashFlowRiskPolicy, CashFlowSuggester } from './cash-flow-risk.js';

const BOB = makeCurrency('BOB', 2);
const USD = makeCurrency('USD', 2);
const bob = (a: string) => Money.parse(a, BOB);
const usd = (a: string) => Money.parse(a, USD);
const text = (m: Money | null) => (m ? m.toFixed() : null);
const TODAY = '2026-10-20';

let seq = 0;
const mov = (
  name: string,
  date: string,
  amount: Money,
  over: Partial<CashFlowMovementInput> = {},
): CashFlowMovementInput => ({
  id: `m${++seq}`,
  source: 'OCCURRENCE',
  kind: 'EXPENSE',
  date,
  accountId: 'banco',
  toAccountId: null,
  amountType: 'FIXED',
  name,
  managedBy: 'USER',
  categoryId: null,
  amount,
  toAmount: null,
  ...over,
});

const accounts = (banco = '2000.00'): CashFlowAccountInput[] => [
  { accountId: 'banco', name: 'Banco BOB', balance: bob(banco) },
  { accountId: 'efectivo', name: 'Efectivo BOB', balance: bob('500.00') },
];

const movements = (): CashFlowMovementInput[] => [
  mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
  mov('Internet', '2026-10-22', bob('199.00')),
  mov('Luz', '2026-10-28', bob('180.00')),
  mov('Alquiler', '2026-11-01', bob('2500.00')),
  mov('Sueldo', '2026-11-01', bob('8000.00'), { kind: 'INCOME' }),
  mov('Pago de tarjeta · Visa Oro', '2026-11-15', bob('1120.50'), {
    kind: 'CARD_PAYMENT',
    toAccountId: 'visa',
  }),
];

const calendar = (
  list = movements(),
  accs = accounts(),
  plannedByDay?: Map<string, Map<string, ReturnType<typeof dec>>>,
) =>
  CashFlowCalendar.compute({
    today: TODAY,
    horizonDays: 30,
    accounts: accs,
    movements: list,
    ...(plannedByDay ? { plannedByDay } : {}),
  });
const bobOf = (r: CashFlowResult) => r.currencies.find((c) => c.currency.code === 'BOB')!;

describe('CashFlowRiskPolicy: riesgo de déficit por moneda (FR-REPORTING-015)', () => {
  it('[TC-REPORTING-FORECAST-009] bajo la reserva mínima el riesgo es HIGH con primera fecha, faltante y mínimo negativo', () => {
    const a = CashFlowRiskPolicy.assess(bobOf(calendar()), bob('1500.00'));
    expect(a).toMatchObject({ risk: 'HIGH', firstShortfallDate: '2026-11-01', belowZero: true });
    expect(text(a.shortfallAmount)).toBe('2179.00');
    expect(a.thresholdSource).toBe('MINIMUM_RESERVE');
    expect(text(a.threshold)).toBe('1500.00');
  });

  it('[TC-REPORTING-FORECAST-009] sin reserva mínima el umbral es cero y el faltante 679.00', () => {
    const a = CashFlowRiskPolicy.assess(bobOf(calendar()), null);
    expect(a.risk).toBe('HIGH');
    expect(a.thresholdSource).toBe('ZERO');
    expect(text(a.threshold)).toBe('0.00');
    expect(text(a.shortfallAmount)).toBe('679.00');
  });

  it('[TC-REPORTING-FORECAST-009] por debajo de la reserva sin llegar a cero: mínimo 621.00, faltante 879.00 y no negativo', () => {
    const r = calendar(movements(), accounts('3300.00'));
    expect(text(bobOf(r).lowest.amount)).toBe('621.00');
    expect(bobOf(r).lowest.date).toBe('2026-11-01');
    const a = CashFlowRiskPolicy.assess(bobOf(r), bob('1500.00'));
    expect(a.risk).toBe('HIGH');
    expect(text(a.shortfallAmount)).toBe('879.00');
    expect(a.belowZero).toBe(false);
  });

  it('[TC-REPORTING-FORECAST-010] sin déficit el riesgo es NONE o LOW según el margen del 10 % de los egresos', () => {
    const base = (): CashFlowMovementInput[] => [
      mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
      mov('Internet', '2026-10-22', bob('199.00')),
      mov('Luz', '2026-10-28', bob('180.00'), { amountType: 'ESTIMATED' }),
      mov('Sueldo', '2026-10-31', bob('8000.00'), { kind: 'INCOME' }),
      mov('Alquiler', '2026-11-01', bob('2500.00')),
      mov('Pago de tarjeta · Visa Oro', '2026-11-15', bob('1120.50'), {
        kind: 'CARD_PAYMENT',
        toAccountId: 'visa',
      }),
    ];
    const block = bobOf(calendar(base(), accounts('4000.00')));
    expect(text(block.lowest.amount)).toBe('3821.00');
    expect(text(block.outflowTotal)).toBe('4299.50');
    expect(CashFlowRiskPolicy.assess(block, bob('1500.00')).risk).toBe('NONE');
    // 3500 + 10 % × 4299.50 = 3929.95 > 3821.00
    const low = CashFlowRiskPolicy.assess(block, bob('3500.00'));
    expect(low.risk).toBe('LOW');
    expect(low.firstShortfallDate).toBeNull();
    expect(low.shortfallAmount).toBeNull();
  });

  it('[TC-REPORTING-FORECAST-010] otra moneda usa umbral cero aunque la reserva esté en BOB', () => {
    const r = CashFlowCalendar.compute({
      today: TODAY,
      horizonDays: 30,
      accounts: [...accounts('4000.00'), { accountId: 'caja-usd', name: 'Caja USD', balance: usd('100.00') }],
      movements: [mov('Spotify', '2026-10-25', usd('5.99'), { accountId: 'caja-usd' })],
    });
    const u = r.currencies.find((c) => c.currency.code === 'USD')!;
    const a = CashFlowRiskPolicy.assess(u, bob('1500.00'));
    expect(a.risk).toBe('NONE');
    expect(text(a.threshold)).toBe('0.00');
    expect(a.thresholdSource).toBe('ZERO');
  });

  it('[TC-REPORTING-FORECAST-011] con el gasto planificado el riesgo pasa a POSSIBLE con su primera fecha', () => {
    const base = (): CashFlowMovementInput[] => [
      mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
      mov('Internet', '2026-10-22', bob('199.00')),
      mov('Luz', '2026-10-28', bob('180.00'), { amountType: 'ESTIMATED' }),
      mov('Sueldo', '2026-10-31', bob('8000.00'), { kind: 'INCOME' }),
      mov('Alquiler', '2026-11-01', bob('2500.00')),
      mov('Pago de tarjeta · Visa Oro', '2026-11-15', bob('1120.50'), {
        kind: 'CARD_PAYMENT',
        toAccountId: 'visa',
      }),
    ];
    const planned = new Map([
      ['BOB', new Map(Array.from({ length: 12 }, (_, i) => [`2026-10-${20 + i}`, dec('50')] as const))],
    ]);
    const block = bobOf(calendar(base(), accounts('4000.00'), planned));
    const a = CashFlowRiskPolicy.assess(block, bob('3500.00'));
    expect(a.risk).toBe('POSSIBLE');
    expect(a.firstShortfallDate).toBe('2026-10-28');
    expect(text(block.planned!.lowest.amount)).toBe('3221.00');
    expect(text(a.shortfallAmount)).toBe('279.00');
  });

  it('[TC-REPORTING-FORECAST-009] la moneda con el riesgo más alto gana y el empate lo decide el faltante', () => {
    const w = CashFlowRiskPolicy.worst([
      { code: 'BOB', risk: 'LOW' as const, shortfallAmount: null },
      { code: 'USD', risk: 'HIGH' as const, shortfallAmount: usd('10.00') },
      { code: 'EUR', risk: 'HIGH' as const, shortfallAmount: usd('50.00') },
    ]);
    expect(w?.code).toBe('EUR');
    expect(
      CashFlowRiskPolicy.worst([{ code: 'BOB', risk: 'NONE' as const, shortfallAmount: null }]),
    ).toBeNull();
  });
});

const rate = (base: string, quote: string, value: string): ExactRate => ({ base, quote, value: dec(value) });

describe('CashFlowConsolidator: mínimo consolidado informativo (FR-REPORTING-014)', () => {
  const withUsd = () =>
    CashFlowCalendar.compute({
      today: TODAY,
      horizonDays: 30,
      accounts: [
        { accountId: 'banco', name: 'Banco BOB', balance: bob('4000.00') },
        { accountId: 'efectivo', name: 'Efectivo BOB', balance: bob('500.00') },
        { accountId: 'caja-usd', name: 'Caja USD', balance: usd('100.00') },
      ],
      movements: [
        mov('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', amountType: null }),
        mov('Internet', '2026-10-22', bob('199.00')),
        mov('Luz', '2026-10-28', bob('180.00'), { amountType: 'ESTIMATED' }),
        mov('Sueldo', '2026-10-31', bob('8000.00'), { kind: 'INCOME' }),
        mov('Spotify', '2026-10-25', usd('5.99'), { accountId: 'caja-usd' }),
      ],
    });

  it('[TC-REPORTING-FORECAST-014] convierte cada moneda con la tasa vigente y redondea HALF_EVEN al presentar', () => {
    const c = CashFlowConsolidator.lowest(withUsd().currencies, BOB, (code) =>
      code === 'USD' ? rate('USD', 'BOB', '12.00') : null,
    );
    expect(c.complete).toBe(true);
    expect(text(c.lowest!.amount)).toBe('4949.12');
    expect(c.lowest!.date).toBe('2026-10-28');
    expect(c.convertedCurrencies).toEqual(['USD']);
  });

  it('[TC-REPORTING-FORECAST-014] sin tasa vigente excluye la moneda, marca incompleto y nunca la convierte 1:1', () => {
    const c = CashFlowConsolidator.lowest(withUsd().currencies, BOB, () => null);
    expect(c.complete).toBe(false);
    expect(text(c.lowest!.amount)).toBe('3821.00');
    expect(c.lowest!.date).toBe('2026-10-28');
    expect(c.unconverted.map(text)).toEqual(['94.01']);
  });
});

describe('CashFlowSuggester: conversión sugerida ante un déficit cubrible (Could)', () => {
  const r = (usdBalance: string) =>
    CashFlowCalendar.compute({
      today: TODAY,
      horizonDays: 30,
      accounts: [...accounts(), { accountId: 'caja-usd', name: 'Caja USD', balance: usd(usdBalance) }],
      movements: movements(),
    });
  const entries = (calc: CashFlowResult) =>
    calc.currencies.map((block) => ({ block, assessment: CashFlowRiskPolicy.assess(block, bob('1500.00')) }));

  it('[TC-REPORTING-FORECAST-016] sugiere convertir aproximadamente 181.58 USD antes del 2026-11-01', () => {
    const s = CashFlowSuggester.suggest({
      blocks: entries(r('400.00')),
      rateFor: (from, to) => (from === 'USD' && to === 'BOB' ? rate('USD', 'BOB', '12.00') : null),
    });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ fromCurrency: 'USD', toCurrency: 'BOB', before: '2026-11-01' });
    expect(text(s[0]!.approxAmount)).toBe('181.58');
  });

  it('[TC-REPORTING-FORECAST-016] no sugiere nada si la otra moneda no cubre el faltante o no hay tasa', () => {
    const rateFor = (from: string, to: string) =>
      from === 'USD' && to === 'BOB' ? rate('USD', 'BOB', '12.00') : null;
    expect(CashFlowSuggester.suggest({ blocks: entries(r('100.00')), rateFor })).toEqual([]);
    expect(CashFlowSuggester.suggest({ blocks: entries(r('400.00')), rateFor: () => null })).toEqual([]);
  });
});
