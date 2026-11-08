import { currency as makeCurrency, dec, Money, type Decimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  categoriesOfTarget,
  PlannedSpending,
  type PlanCategoryNode,
  type PlannedLineInput,
  type PlannedPeriodInput,
} from './planned-spending.js';

const BOB = makeCurrency('BOB', 2);
const bob = (a: string) => Money.parse(a, BOB);

const CATEGORIES = new Map<string, PlanCategoryNode>([
  ['super', { parentId: null, groupId: 'alimentos' }],
  ['verduras', { parentId: 'super', groupId: 'alimentos' }],
  ['transporte', { parentId: null, groupId: 'movilidad' }],
]);

const octubre = (lines: readonly PlannedLineInput[]): PlannedPeriodInput => ({
  periodId: 'p-2026-10',
  label: '2026-10',
  start: '2026-10-01',
  end: '2026-10-31',
  plan: { currency: 'BOB', lines },
});
const noviembre: PlannedPeriodInput = {
  periodId: null,
  label: '2026-11',
  start: '2026-11-01',
  end: '2026-11-30',
  plan: null,
};
const supermercado = {
  targetKind: 'CATEGORY' as const,
  targetId: 'super',
  nature: 'EXPENSE' as const,
  reference: bob('1200.00'),
  actual: bob('600.00'),
};

const compute = (over: Partial<Parameters<typeof PlannedSpending.compute>[0]> = {}) =>
  PlannedSpending.compute({
    today: '2026-10-20',
    horizonEnd: '2026-11-19',
    periods: [octubre([supermercado]), noviembre],
    categories: CATEGORIES,
    committed: [],
    liquidCurrencies: new Set(['BOB']),
    ...over,
  });

const days = (r: ReturnType<typeof compute>) =>
  [...(r.byCurrency.get('BOB') ?? new Map())].map(([d, v]) => `${d}=${v.toFixed()}`);

describe('PlannedSpending: serie del gasto planificado restante (FR-REPORTING-014, FR-PLANNING-024)', () => {
  it('[TC-REPORTING-FORECAST-011] el restante del plan se reparte por día hasta el fin del periodo y el periodo sin plan se indica', () => {
    const r = compute();
    const list = days(r);
    expect(list).toHaveLength(12);
    expect(list[0]).toBe('2026-10-20=50');
    expect(list.at(-1)).toBe('2026-10-31=50');
    expect(r.periods).toEqual([
      { periodId: 'p-2026-10', label: '2026-10', status: 'PLAN' },
      { periodId: null, label: '2026-11', status: 'NO_PLAN' },
    ]);
  });

  it('[TC-REPORTING-FORECAST-011] un compromiso de la misma categoría se descuenta sin doble conteo', () => {
    const r = compute({
      committed: [{ date: '2026-10-25', categoryId: 'verduras', amount: bob('240.00') }],
    });
    expect(days(r)[0]).toBe('2026-10-20=30');
    expect(days(r)).toHaveLength(12);
  });

  it('[TC-REPORTING-FORECAST-011] las líneas por etiqueta, los ingresos y las categorías ajenas no suman', () => {
    const r = compute({
      periods: [
        octubre([
          { ...supermercado, targetKind: 'TAG', targetId: 'tag-1' },
          { ...supermercado, nature: 'INCOME' },
        ]),
        noviembre,
      ],
    });
    expect(r.byCurrency.size).toBe(0);
    const ajeno = compute({
      committed: [{ date: '2026-10-25', categoryId: 'transporte', amount: bob('240.00') }],
    });
    expect(days(ajeno)[0]).toBe('2026-10-20=50');
  });

  it('[TC-REPORTING-FORECAST-011] lo gastado o comprometido por encima del plan no resta (restante no negativo)', () => {
    const r = compute({
      committed: [{ date: '2026-10-25', categoryId: 'super', amount: bob('700.00') }],
    });
    expect(r.byCurrency.size).toBe(0);
  });

  it('[TC-REPORTING-FORECAST-011] el reparto es exacto sin redondeo intermedio', () => {
    const r = compute({
      periods: [octubre([{ ...supermercado, reference: bob('1000.00'), actual: bob('0.00') }]), noviembre],
    });
    const values = [...(r.byCurrency.get('BOB') ?? new Map<string, Decimal>()).values()];
    const total = values.reduce((acc, v) => acc.plus(v), dec('0'));
    // 1000 / 12 no es decimal finito: la suma exacta vuelve a 1000 sin haber redondeado por día.
    expect(values).toHaveLength(12);
    expect(total.toDecimalPlaces(30).toFixed()).toBe('1000');
    expect(values.every((v) => v.eq(values[0] as Decimal))).toBe(true);
  });

  it('[TC-REPORTING-FORECAST-011] un plan en una moneda sin cuentas líquidas se informa sin aplicarse', () => {
    const r = compute({ liquidCurrencies: new Set(['USD']) });
    expect(r.byCurrency.size).toBe(0);
    expect(r.periods[0]).toMatchObject({ label: '2026-10', status: 'PLAN' });
  });

  it('[TC-REPORTING-FORECAST-011] un periodo posterior con plan reparte el plan completo y aplica solo los días del horizonte', () => {
    const r = compute({
      periods: [
        octubre([supermercado]),
        {
          periodId: 'p-2026-11',
          label: '2026-11',
          start: '2026-11-01',
          end: '2026-11-30',
          plan: {
            currency: 'BOB',
            lines: [
              {
                targetKind: 'CATEGORY',
                targetId: 'super',
                nature: 'EXPENSE',
                reference: bob('600.00'),
                actual: bob('0.00'),
              },
            ],
          },
        },
      ],
    });
    const list = days(r);
    // Octubre 20..31 a 50 y noviembre 1..19 a 600 / 30 = 20 por día.
    expect(list).toHaveLength(12 + 19);
    expect(list).toContain('2026-11-01=20');
    expect(list).toContain('2026-11-19=20');
  });
});

describe('categoriesOfTarget: categoría con subcategorías y grupo con sus categorías', () => {
  it('[TC-REPORTING-FORECAST-011] una categoría cubre sus subcategorías y un grupo cubre sus categorías', () => {
    expect([...categoriesOfTarget('CATEGORY', 'super', CATEGORIES)].sort()).toEqual(['super', 'verduras']);
    expect([...categoriesOfTarget('GROUP', 'alimentos', CATEGORIES)].sort()).toEqual(['super', 'verduras']);
    expect([...categoriesOfTarget('TAG', 'x', CATEGORIES)]).toEqual([]);
  });
});
