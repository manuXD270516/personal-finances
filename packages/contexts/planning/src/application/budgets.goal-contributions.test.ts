import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BudgetQueries } from './budget.queries.js';
import { BudgetsService } from './budgets.service.js';
import type { GoalPlanPort, GoalPlanRow } from './ports/index.js';
import { InMemoryBudgets } from './testing/in-memory-budgets.js';

const W = '0190a000-0000-7000-8000-00000000a001';
const G_ALIM = '0190a000-0000-7000-8000-000000000100';
const SUPER = '0190a000-0000-7000-8000-000000000001';
const money = (amount: string, currency = 'BOB') => ({ amount, currency });

const row = (over: Partial<GoalPlanRow> & Pick<GoalPlanRow, 'goalId' | 'goalName'>): GoalPlanRow => ({
  currency: 'BOB',
  planned: '0.00',
  contributed: '0.00',
  pending: '0.00',
  exceededBy: '0.00',
  automation: 'NONE',
  definitionId: null,
  complete: true,
  ...over,
});

const FONDO = row({
  goalId: 'g-fondo',
  goalName: 'Fondo de emergencia',
  planned: '1500.00',
  contributed: '1000.00',
  pending: '500.00',
});
const LAPTOP = row({ goalId: 'g-laptop', goalName: 'Laptop', planned: '800.00', pending: '800.00' });

/** Plan de "2026-10" con disponible para gastar 3750.00 BOB (máximo 3750.00 sin gasto). */
async function setup(rows: () => readonly GoalPlanRow[]) {
  const env = new InMemoryBudgets();
  env.mem.workspace(W);
  env.mem.clock.set(Instant.parse('2026-10-10T15:00:00Z'));
  env.tree = {
    groups: [{ groupId: G_ALIM, name: 'Alimentación', kind: 'EXPENSE', archived: false }],
    categories: [
      {
        categoryId: SUPER,
        name: 'Supermercado',
        kind: 'EXPENSE',
        groupId: G_ALIM,
        parentId: null,
        systemCode: null,
        archived: false,
      },
    ],
    tags: [],
  };
  const oct = env.mem.seed(W, '2026-10', 'ACTIVE');
  const requests: { workspaceId: string; from: string; to: string }[] = [];
  const goalPlans: GoalPlanPort = {
    getForPeriod: async (input) => {
      requests.push(input);
      return rows();
    },
  };
  const plain = env.deps();
  const withGoals = env.deps({ goalPlans });
  const budget = await new BudgetsService(plain).createBudget({ workspaceId: W, periodId: oct.id });
  await new BudgetsService(plain).addLine({
    workspaceId: W,
    budgetId: budget.id,
    target: { kind: 'CATEGORY', id: SUPER },
    spec: { kind: 'MAXIMUM', planned: money('3750.00') },
  });
  return {
    env,
    budgetId: budget.id,
    requests,
    without: new BudgetQueries(plain),
    queries: new BudgetQueries(withGoals),
  };
}

describe('GET /budgets/{id}: sección "Aportes a metas" (planning/budgets)', () => {
  it('[TC-GOALS-SAVINGS-050] muestra pendientes de 500.00 y 800.00 BOB, total 1300.00 BOB, sin cambiar el disponible (3750.00)', async () => {
    const ctx = await setup(() => [FONDO, LAPTOP]);
    const dto = await ctx.queries.getBudget(W, ctx.budgetId);
    expect(dto.goalContributions.items).toEqual([
      {
        goalId: 'g-fondo',
        name: 'Fondo de emergencia',
        planned: money('1500.00'),
        contributed: money('1000.00'),
        pending: money('500.00'),
        exceededBy: money('0.00'),
      },
      {
        goalId: 'g-laptop',
        name: 'Laptop',
        planned: money('800.00'),
        contributed: money('0.00'),
        pending: money('800.00'),
        exceededBy: money('0.00'),
      },
    ]);
    expect(dto.goalContributions.pendingTotal).toEqual({
      native: [money('1300.00')],
      base: money('1300.00'),
      complete: true,
    });
    // La consulta cubre el rango del periodo del plan.
    expect(ctx.requests).toEqual([{ workspaceId: W, from: dto.periodStart, to: dto.periodEnd }]);

    // No crea líneas ni cambia gastado, umbrales ni disponible para gastar.
    const plain = await ctx.without.getBudget(W, ctx.budgetId);
    expect(dto.totals.availableToSpend).toEqual(money('3750.00'));
    expect(dto.totals).toEqual(plain.totals);
    expect(dto.lines).toEqual(plain.lines);
  });

  it('[TC-GOALS-SAVINGS-050] con "Laptop" pausada (el puerto ya no la devuelve) el total pendiente es 500.00 BOB', async () => {
    let paused = false;
    const ctx = await setup(() => (paused ? [FONDO] : [FONDO, LAPTOP]));
    expect((await ctx.queries.getBudget(W, ctx.budgetId)).goalContributions.pendingTotal.base).toEqual(
      money('1300.00'),
    );
    paused = true;
    const dto = await ctx.queries.getBudget(W, ctx.budgetId);
    expect(dto.goalContributions.items.map((i) => i.name)).toEqual(['Fondo de emergencia']);
    expect(dto.goalContributions.pendingTotal.base).toEqual(money('500.00'));
    expect(dto.totals.availableToSpend).toEqual(money('3750.00'));
  });

  it('[TC-GOALS-SAVINGS-050] consolida las metas en otra moneda a la tasa vigente de hoy en una sola resolución; sin tasa queda fuera y la sección, incompleta', async () => {
    const usd = row({
      goalId: 'g-viaje',
      goalName: 'Viaje',
      currency: 'USD',
      planned: '100.00',
      pending: '100.00',
    });
    const ctx = await setup(() => [FONDO, usd]);
    const incomplete = (await ctx.queries.getBudget(W, ctx.budgetId)).goalContributions.pendingTotal;
    expect(incomplete).toEqual({
      native: [money('500.00'), money('100.00', 'USD')],
      base: money('500.00'),
      complete: false,
    });

    ctx.env.rate('USD', 'BOB', '2026-10-09T10:00:00Z', '12.00');
    const dto = await ctx.queries.getBudget(W, ctx.budgetId);
    expect(dto.goalContributions.pendingTotal).toEqual({
      native: [money('500.00'), money('100.00', 'USD')],
      base: money('1700.00'),
      complete: true,
    });
    expect(dto.meta.ratesUsed.map((r) => [r.rate.base, r.rate.quote, r.rate.value])).toEqual([
      ['USD', 'BOB', '12.00'],
    ]);
  });

  it('[TC-GOALS-SAVINGS-050] sin el puerto de metas la sección va vacía y el plan no cambia', async () => {
    const ctx = await setup(() => [FONDO]);
    const dto = await ctx.without.getBudget(W, ctx.budgetId);
    expect(dto.goalContributions).toEqual({
      items: [],
      pendingTotal: { native: [], base: null, complete: true },
    });
    expect(ctx.requests).toEqual([]);
  });
});
