import { currency as makeCurrency, dec, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { PlanCategoryNode } from './planned-spending.js';
import {
  SpendableEssentials,
  SpendableHorizon,
  type EssentialPlanPeriod,
  type UpcomingIncome,
} from './spendable-horizon.js';
import { SpendableCalculator, type SpendableCommittedItem } from './spendable-calculator.js';

const BOB = makeCurrency('BOB', 2);
const bob = (a: string) => Money.parse(a, BOB);

const income = (date: string, id = 'sueldo'): UpcomingIncome => ({ occurrenceId: id, name: 'Sueldo', date });
const PERIOD = { start: '2026-10-01', end: '2026-10-31' };

describe('SpendableHorizon: horizonte del disponible (FR-PLANNING-024)', () => {
  it('[TC-REPORTING-FORECAST-022] por omisión el horizonte es el periodo financiero que contiene hoy', () => {
    const h = SpendableHorizon.resolve({
      mode: 'FINANCIAL_PERIOD',
      today: '2026-10-20',
      period: PERIOD,
      incomes: [income('2026-10-26')],
    });
    expect(h).toEqual({
      mode: 'FINANCIAL_PERIOD',
      from: '2026-10-01',
      to: '2026-10-31',
      nextIncome: null,
      fallback: false,
    });
  });

  it('[TC-REPORTING-FORECAST-023] hasta el próximo ingreso termina en el vencimiento del sueldo, inclusive', () => {
    const h = SpendableHorizon.resolve({
      mode: 'NEXT_INCOME',
      today: '2026-10-20',
      period: PERIOD,
      incomes: [income('2026-11-18', 'otro'), income('2026-10-26')],
    });
    expect(h).toMatchObject({ from: '2026-10-20', to: '2026-10-26', fallback: false });
    expect(h.nextIncome?.occurrenceId).toBe('sueldo');
  });

  it('[TC-REPORTING-FORECAST-023] un ingreso atrasado sin resolver no fija el horizonte', () => {
    const h = SpendableHorizon.resolve({
      mode: 'NEXT_INCOME',
      today: '2026-10-20',
      period: PERIOD,
      incomes: [income('2026-10-18', 'atrasado'), income('2026-11-18', 'siguiente')],
    });
    expect(h.to).toBe('2026-11-18');
    expect(h.nextIncome?.occurrenceId).toBe('siguiente');
  });

  it('[TC-REPORTING-FORECAST-024] sin ingreso esperado en 90 días usa 30 días desde hoy e indica el respaldo', () => {
    const none = SpendableHorizon.resolve({
      mode: 'NEXT_INCOME',
      today: '2026-10-20',
      period: PERIOD,
      incomes: [],
    });
    expect(none).toMatchObject({ to: '2026-11-19', fallback: true, nextIncome: null });
    const far = SpendableHorizon.resolve({
      mode: 'NEXT_INCOME',
      today: '2026-10-20',
      period: PERIOD,
      incomes: [income('2027-02-01')],
    });
    expect(far).toMatchObject({ to: '2026-11-19', fallback: true });
  });

  it('[TC-REPORTING-FORECAST-024] los periodos alcanzados son los posteriores a hoy cuyo inicio cae en el horizonte', () => {
    const periods = [
      { start: '2026-10-01', end: '2026-10-31' },
      { start: '2026-11-01', end: '2026-11-30' },
      { start: '2026-12-01', end: '2026-12-31' },
    ];
    expect(SpendableHorizon.periodsReached(periods, '2026-10-27', '2026-11-05').map((p) => p.start)).toEqual([
      '2026-11-01',
    ]);
    expect(SpendableHorizon.periodsReached(periods, '2026-10-20', '2026-10-26')).toEqual([]);
  });
});

const CATEGORIES = new Map<string, PlanCategoryNode>([
  ['super', { parentId: null, groupId: 'alimentos' }],
  ['verduras', { parentId: 'super', groupId: 'alimentos' }],
  ['transporte', { parentId: null, groupId: 'movilidad' }],
]);

const line = (id: string, reference: string, actual: string) => ({
  targetKind: 'CATEGORY' as const,
  targetId: id,
  nature: 'EXPENSE' as const,
  reference: bob(reference),
  actual: bob(actual),
});
const octubre = (lines: ReturnType<typeof line>[]): EssentialPlanPeriod => ({
  label: '2026-10',
  start: '2026-10-01',
  end: '2026-10-31',
  plan: { currency: 'BOB', lines },
});
const compute = (over: Partial<Parameters<typeof SpendableEssentials.compute>[0]> = {}) =>
  SpendableEssentials.compute({
    essentials: [{ categoryId: 'super', name: 'Supermercado', archived: false }],
    current: octubre([line('super', '1200.00', '750.00')]),
    later: [],
    horizonEnd: '2026-10-31',
    categories: CATEGORIES,
    committed: [],
    currencyOf: () => BOB,
    ...over,
  });

describe('SpendableEssentials: esenciales presupuestados restantes (FR-PLANNING-024)', () => {
  it('[TC-REPORTING-FORECAST-025] resta lo planificado menos lo gastado: 450.00', () => {
    const r = compute();
    expect(r.byCurrency.get('BOB')?.toFixed()).toBe('450');
    expect(r.items[0]).toMatchObject({ categoryId: 'super', periodLabel: '2026-10', prorated: false });
    expect(r.warnings).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-025] el comprometido de la misma categoría no se cuenta dos veces: 250.00', () => {
    const r = compute({ committed: [{ categoryId: 'verduras', amount: bob('200.00') }] });
    expect(r.byCurrency.get('BOB')?.toFixed()).toBe('250');
    expect(r.items[0]!.committed.toFixed()).toBe('200.00');
  });

  it('[TC-REPORTING-FORECAST-025] nunca resta un valor negativo', () => {
    const r = compute({ current: octubre([line('super', '1200.00', '1500.00')]) });
    expect(r.byCurrency.get('BOB')?.toFixed()).toBe('0');
  });

  it('[TC-REPORTING-FORECAST-026] un periodo posterior se prorratea por días: 450.00 + 1200.00 × 5 / 30 = 650.00', () => {
    const r = compute({
      horizonEnd: '2026-11-05',
      later: [
        {
          label: '2026-11',
          start: '2026-11-01',
          end: '2026-11-30',
          plan: { currency: 'BOB', lines: [line('super', '1200.00', '0.00')] },
        },
      ],
    });
    expect(r.byCurrency.get('BOB')?.toFixed()).toBe('650');
    expect(r.items.map((i) => [i.periodLabel, i.prorated, i.counted.toFixed()])).toEqual([
      ['2026-10', false, '450.00'],
      ['2026-11', true, '200.00'],
    ]);
  });

  it('[TC-REPORTING-FORECAST-026] una categoría sin línea, un periodo sin plan y una categoría archivada no restan y se indican', () => {
    const r = compute({
      essentials: [
        { categoryId: 'super', name: 'Supermercado', archived: false },
        { categoryId: 'transporte', name: 'Transporte', archived: false },
        { categoryId: 'vieja', name: 'Vieja', archived: true },
      ],
      later: [{ label: '2026-11', start: '2026-11-01', end: '2026-11-30', plan: null }],
      horizonEnd: '2026-11-05',
    });
    expect(r.byCurrency.get('BOB')?.toFixed()).toBe('450');
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        { categoryId: 'transporte', reason: 'NO_LINE', periodLabel: '2026-10' },
        { categoryId: 'vieja', reason: 'ARCHIVED', periodLabel: null },
        { categoryId: 'super', reason: 'NO_PLAN', periodLabel: '2026-11' },
      ]),
    );
  });

  it('[TC-REPORTING-FORECAST-026] sin plan en el periodo en curso nada resta y se indica sin plan', () => {
    const r = compute({ current: null });
    expect(r.byCurrency.size).toBe(0);
    expect(r.warnings).toEqual([{ categoryId: 'super', reason: 'NO_PLAN', periodLabel: null }]);
  });
});

describe('SpendableCalculator: término de esenciales', () => {
  const account = { accountId: 'banco', name: 'Banco BOB', balance: bob('15800.00') };
  const item = (name: string, amount: string): SpendableCommittedItem => ({
    source: 'OCCURRENCE',
    id: name,
    definitionId: name,
    name,
    kind: 'EXPENSE',
    date: '2026-10-25',
    accountId: 'banco',
    toAccountId: null,
    sourceLiquid: true,
    targetLiquid: null,
    managedBy: 'USER',
    amount: bob(amount),
    overdueFromPrevious: false,
  });
  const base = () =>
    SpendableCalculator.calculate({
      period: { from: '2026-10-01', to: '2026-10-31' },
      liquidAccounts: [account],
      reservations: [],
      committed: [item('Luz', '3179.00')],
      planned: [],
      minimumReserve: bob('1500.00'),
    });

  it('[TC-REPORTING-FORECAST-022] sin esenciales el término no existe y el disponible no cambia', () => {
    const r = SpendableCalculator.applyEssentials(base(), null);
    expect(r.byCurrency[0]!.essentials).toBeNull();
    expect(r.byCurrency[0]!.spendable.toFixed()).toBe('11121.00');
  });

  it('[TC-REPORTING-FORECAST-025] con esenciales resta el término una sola vez: 11121.00 − 450.00', () => {
    const r = SpendableCalculator.applyEssentials(base(), new Map([['BOB', dec('450')]]));
    expect(r.byCurrency[0]!.essentials?.toFixed()).toBe('450.00');
    expect(r.byCurrency[0]!.spendable.toFixed()).toBe('10671.00');
  });

  it('[TC-REPORTING-FORECAST-026] el término se redondea HALF_EVEN una sola vez al materializarlo', () => {
    const r = SpendableCalculator.applyEssentials(base(), new Map([['BOB', dec('100.005')]]));
    expect(r.byCurrency[0]!.essentials?.toFixed()).toBe('100.00');
    const r2 = SpendableCalculator.applyEssentials(base(), new Map([['BOB', dec('100.015')]]));
    expect(r2.byCurrency[0]!.essentials?.toFixed()).toBe('100.02');
  });
});
