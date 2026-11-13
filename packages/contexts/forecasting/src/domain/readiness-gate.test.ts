import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { PeriodAggregate } from './period-series-builder.js';
import { DEFAULT_THRESHOLDS, ReadinessGate, type CategoryInfo } from './readiness-gate.js';

const labelAt = (i: number): string => {
  const index = 2025 * 12 + 10 + i; // desde 2025-11
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

interface PeriodSpec {
  active?: boolean;
  expense?: number;
  income?: number;
  cats?: Record<string, { v: number; tx: number }>;
}

const periods = (specs: PeriodSpec[], from = 0): PeriodAggregate[] =>
  specs.map((s, i) => {
    const byCategory = new Map(
      Object.entries(s.cats ?? {}).map(([k, f]) => [k, { value: dec(String(f.v)), txCount: f.tx }]),
    );
    const total = s.expense ?? [...byCategory.values()].reduce((a, f) => a + Number(f.value), 0);
    return {
      label: labelAt(from + i),
      start: '2025-11-01',
      end: '2025-11-30',
      expenseTotal: dec(String(total)),
      incomeTotal: dec(String(s.income ?? 0)),
      expenseTx: [...byCategory.values()].reduce((a, f) => a + f.txCount, 0),
      incomeTx: s.income ? 1 : 0,
      expenseByCategory: byCategory,
      unvaluedCount: 0,
      active: s.active ?? true,
    };
  });

const rest: CategoryInfo = { categoryId: 'rest', groupId: 'g1', name: 'Restaurantes', uncategorized: false };
const evaluate = (ps: PeriodAggregate[], categories: CategoryInfo[] = [rest], truncated = false) =>
  ReadinessGate.evaluate({
    periods: ps,
    categories,
    groups: [{ groupId: 'g1', name: 'Personal' }],
    thresholds: DEFAULT_THRESHOLDS,
    truncated,
  });
const byScope = (series: ReturnType<typeof evaluate>, scope: string, ref: string | null = null) =>
  series.find((s) => s.scope === scope && s.scopeRef === ref);
const withData = (n: number, tx = 10) =>
  periods(Array.from({ length: n }, () => ({ cats: { rest: { v: 100, tx } } })));

describe('ReadinessGate', () => {
  it('[TC-FORECAST-SERVICE-014] 4 periodos: estimación simple con datos insuficientes; faltan 2 para el modelo', () => {
    const s = byScope(evaluate(withData(4)), 'CATEGORY', 'rest');
    expect(s?.readiness).toBe('SIMPLE');
    expect(s?.readinessReasons[0]).toEqual({
      code: 'TOO_FEW_PERIODS',
      missingForSimple: 0,
      missingForModel: 2,
    });
  });

  it('[TC-FORECAST-SERVICE-015] 2 periodos: no se pronostica; falta 1 para la estimación simple y 4 para el modelo', () => {
    const s = byScope(evaluate(withData(2)), 'CATEGORY', 'rest');
    expect(s?.readiness).toBe('INSUFFICIENT');
    expect(s?.readinessReasons[0]).toEqual({
      code: 'TOO_FEW_PERIODS',
      missingForSimple: 1,
      missingForModel: 4,
    });
  });

  it('[TC-FORECAST-SERVICE-016] 8 periodos: admite modelos estadísticos', () => {
    const series = evaluate(withData(8));
    expect(byScope(series, 'TOTAL_EXPENSE')?.readiness).toBe('MODEL');
    expect(byScope(series, 'TOTAL_EXPENSE')?.readinessReasons).toEqual([]);
  });

  it('[TC-FORECAST-SERVICE-017] una categoría esporádica se suma en «Otras categorías» de su grupo', () => {
    const regalos: CategoryInfo = { categoryId: 'reg', groupId: 'g1', name: 'Regalos', uncategorized: false };
    const ps = periods(
      Array.from({ length: 8 }, (_, i) => ({
        cats: {
          rest: { v: 100, tx: 10 },
          ...(i < 6 ? { reg: { v: 30, tx: 1 } } : i === 6 ? { reg: { v: 30, tx: 3 } } : {}),
        },
      })),
    );
    const series = evaluate(ps, [rest, regalos]);
    expect(byScope(series, 'CATEGORY', 'reg')).toBeUndefined();
    const other = byScope(series, 'OTHER_CATEGORIES', 'g1');
    expect(other?.groupedCategoryIds).toEqual(['reg']);
    expect(other?.name).toBe('Personal');
  });

  it('[TC-FORECAST-SERVICE-018] dos periodos sin registros truncan la historia de todas las series', () => {
    const specs: PeriodSpec[] = [
      ...Array.from({ length: 4 }, () => ({ cats: { rest: { v: 100, tx: 10 } } })),
      { active: false },
      { active: false },
      ...Array.from({ length: 6 }, () => ({ cats: { rest: { v: 100, tx: 10 } } })),
    ];
    const gap = ReadinessGate.applyGaps(periods(specs));
    expect(gap.truncated).toBe(true);
    expect(gap.periods).toHaveLength(6);
    expect(gap.periods[0]?.label).toBe(labelAt(6));
    const series = evaluate([...gap.periods], [rest], gap.truncated);
    expect(byScope(series, 'TOTAL_EXPENSE')?.historyFrom).toBe(labelAt(6));
    expect(byScope(series, 'TOTAL_EXPENSE')?.readinessReasons.some((r) => r.code === 'GAP_TRUNCATED')).toBe(
      true,
    );
  });

  it('[TC-FORECAST-SERVICE-018] un hueco aislado no trunca: cuenta como cero', () => {
    const specs: PeriodSpec[] = [
      { cats: { rest: { v: 100, tx: 10 } } },
      { active: false },
      { cats: { rest: { v: 100, tx: 10 } } },
    ];
    const gap = ReadinessGate.applyGaps(periods(specs));
    expect(gap.truncated).toBe(false);
    expect(gap.periods).toHaveLength(3);
  });

  it('[TC-FORECAST-SERVICE-020] con mucho gasto sin categoría las series por categoría quedan insuficientes', () => {
    const unc: CategoryInfo = {
      categoryId: 'unc',
      groupId: 'g1',
      name: 'Sin categoría',
      uncategorized: true,
    };
    const specs: PeriodSpec[] = Array.from({ length: 8 }, (_, i) => ({
      cats: { rest: { v: 100, tx: 10 }, ...(i < 3 ? { unc: { v: 50, tx: 5 } } : {}) },
    }));
    const series = evaluate(periods(specs), [rest, unc]);
    expect(byScope(series, 'TOTAL_EXPENSE')?.readiness).toBe('MODEL');
    expect(byScope(series, 'CATEGORY', 'rest')?.readiness).toBe('INSUFFICIENT');
    expect(
      byScope(series, 'CATEGORY', 'rest')?.readinessReasons.some((r) => r.code === 'LOW_CATEGORIZATION'),
    ).toBe(true);
    expect(byScope(series, 'CATEGORY_GROUP', 'g1')?.readiness).toBe('INSUFFICIENT');
  });

  it('[TC-FORECAST-SERVICE-026] el total se pronostica 12 periodos y una categoría con 14 periodos de historia 6', () => {
    const series = evaluate(withData(14));
    expect(byScope(series, 'TOTAL_EXPENSE')?.horizon).toBe(12);
    expect(byScope(series, 'CATEGORY', 'rest')?.horizon).toBe(6);
    expect(byScope(evaluate(withData(24)), 'CATEGORY', 'rest')?.horizon).toBe(12);
  });
});
