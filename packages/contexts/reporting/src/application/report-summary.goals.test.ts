import { beforeEach, describe, expect, it } from 'vitest';
import { ReportSummaryQueries } from './report-summary.queries.js';
import type { GoalHomeItemRow } from './ports/index.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const summary = async (q: Partial<Parameters<ReportSummaryQueries['getReportSummary']>[0]> = {}) =>
  (await new ReportSummaryQueries(mem.deps()).getReportSummary({ userId: USER, workspaceId: WS, ...q }))
    .summary;
const amount = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

const bob = (value: string) => ({ amount: value, currency: 'BOB' });

function item(over: Partial<GoalHomeItemRow> & Pick<GoalHomeItemRow, 'goalId' | 'name' | 'priority'>) {
  const row: GoalHomeItemRow = {
    percent: '0.00',
    progress: bob('0.00'),
    target: bob('1000.00'),
    tracking: { status: null, lifecycleStatus: 'ACTIVE', expected: null, deviationPercent: null },
    lifecycleStatus: 'ACTIVE',
    requiredMonthly: null,
    overdue: false,
    expectedDate: null,
    overAllocated: false,
    complete: true,
    ...over,
  };
  return row;
}

beforeEach(() => {
  mem = new InMemoryReporting();
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '685.00');
  mem.categories.push(
    { categoryId: 'sal', name: 'Salario', kind: 'INCOME', parentId: null, systemCode: null, archived: false },
    {
      categoryId: 'sup',
      name: 'Supermercado',
      kind: 'EXPENSE',
      parentId: null,
      systemCode: null,
      archived: false,
    },
  );
});

describe('GetReportSummary: metas en curso (Q9, reporting/dashboard)', () => {
  it('[TC-GOALS-SAVINGS-046] muestra 3 de 4 metas en el orden de GOALS con sus cálculos, moreCount 1 y la marca de sobre-asignada', async () => {
    mem.goalHome = {
      goalCount: 4,
      moreCount: 1,
      ratesUsed: [],
      items: [
        item({
          goalId: 'g1',
          name: 'Fondo de emergencia',
          priority: 1,
          percent: '33.33',
          progress: bob('1000.00'),
          target: bob('3000.00'),
          tracking: {
            status: 'BEHIND',
            lifecycleStatus: 'ACTIVE',
            expected: bob('1500.00'),
            deviationPercent: '-33.33',
          },
          requiredMonthly: bob('500.00'),
          expectedDate: '2027-04-30',
        }),
        item({ goalId: 'g2', name: 'Viaje a Cusco', priority: 2, percent: '45.00' }),
        item({ goalId: 'g3', name: 'Laptop', priority: 2, percent: '22.22', overAllocated: true }),
      ],
    };
    const s = await summary();
    expect(s.goals.status).toBe('AVAILABLE');
    expect(s.goals.action).toBeNull();
    expect(s.goals.items.map((i) => i.name)).toEqual(['Fondo de emergencia', 'Viaje a Cusco', 'Laptop']);
    expect(s.goals.moreCount).toBe(1);
    expect(s.goals.complete).toBe(true);
    expect(s.goals.items[0]).toMatchObject({
      percent: '33.33',
      tracking: { status: 'BEHIND' },
      requiredMonthly: bob('500.00'),
      expectedDate: '2027-04-30',
    });
    expect(s.goals.items.map((i) => i.overAllocated)).toEqual([false, false, true]);
    // Una sola consulta por lote, con el límite de la tarjeta (nada por meta en bucle).
    expect(mem.goalRequests.filter((r) => r.kind === 'home')).toEqual([{ kind: 'home', limit: 3 }]);
    expect(s.questions.find((q) => q.question === 'Q9')).toEqual({
      question: 'Q9',
      status: 'AVAILABLE',
      actionHint: null,
    });
  });

  it('[TC-GOALS-SAVINGS-046] una meta con progreso sin convertir marca el bloque como incompleto', async () => {
    mem.goalHome = {
      goalCount: 1,
      moreCount: 0,
      ratesUsed: [],
      items: [item({ goalId: 'g1', name: 'Viaje', priority: 1, complete: false })],
    };
    expect((await summary()).goals.complete).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-047] sin metas Q9 es NO_DATA con CREATE_GOAL, sin items ni 0 %; Q5 sigue no disponible', async () => {
    mem.goalHome = { goalCount: 0, moreCount: 0, ratesUsed: [], items: [] };
    const s = await summary();
    expect(s.goals).toEqual({
      status: 'NO_DATA',
      action: 'CREATE_GOAL',
      items: [],
      moreCount: 0,
      complete: true,
      ratesUsed: [],
    });
    const by = Object.fromEntries(s.questions.map((q) => [q.question, q]));
    expect(by['Q9']).toEqual({ question: 'Q9', status: 'NO_DATA', actionHint: 'CREATE_GOAL' });
    expect(by['Q5']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE' });
  });

  it('[TC-GOALS-SAVINGS-047] sin el puerto de metas cableado Q9 es NO_DATA con CREATE_GOAL', async () => {
    const s = await summary();
    expect(s.goals).toMatchObject({ status: 'NO_DATA', action: 'CREATE_GOAL', items: [] });
    expect(s.goalContributions).toEqual({ native: [], base: null, complete: true });
  });
});

describe('GetReportSummary: aportes a metas del mes (Q6, reporting/dashboard)', () => {
  const october = () => {
    mem.flow('2026-10-05', 'INCOME', 'sal', '8000.00');
    mem.flow('2026-10-10', 'EXPENSE', 'sup', '1305.00');
  };

  it('[TC-GOALS-SAVINGS-048] informa 2500.00 BOB de aportes netos sin cambiar el ahorro (6695.00) ni la tasa (83.7 %)', async () => {
    october();
    // Aporte real 1000.00, reserva 2000.00 y liberación -500.00; la reasignación de 1000.00 no llega (GOALS la excluye).
    mem.goalFlowRows = [
      { date: '2026-10-05', amount: bob('1000.00') },
      { date: '2026-10-08', amount: bob('2000.00') },
      { date: '2026-10-12', amount: bob('-500.00') },
    ];
    const withGoals = await summary({ month: '2026-10' });
    expect(withGoals.goalContributions).toEqual({
      native: [bob('2500.00')],
      base: bob('2500.00'),
      complete: true,
    });
    expect(mem.goalRequests.filter((r) => r.kind === 'flows')).toEqual([
      { kind: 'flows', from: '2026-10-01', to: '2026-10-31' },
    ]);
    expect(amount(withGoals.consolidated.net)).toBe('6695.00 BOB');
    expect(withGoals.consolidated.savingsRate).toBe('83.7');

    // Idéntico ahorro y tasa que sin el bloque de metas.
    mem.goalFlowRows = null;
    const without = await summary({ month: '2026-10' });
    expect(without.consolidated.net).toEqual(withGoals.consolidated.net);
    expect(without.consolidated.savingsRate).toBe(withGoals.consolidated.savingsRate);
  });

  it('[TC-GOALS-SAVINGS-048] consolida cada flujo en otra moneda con la tasa de su fecha y resuelve las tasas en una sola llamada', async () => {
    mem.rates.push({
      base: 'USD',
      quote: 'BOB',
      value: '11.96',
      asOf: '2026-09-30T20:00:00Z',
      fxRateId: 'r-usd',
    });
    mem.goalFlowRows = [
      { date: '2026-10-05', amount: bob('1000.00') },
      { date: '2026-10-06', amount: { amount: '100.00', currency: 'USD' } },
    ];
    const s = await summary({ month: '2026-10' });
    expect(s.goalContributions.native.map(amount)).toEqual(['1000.00 BOB', '100.00 USD']);
    expect(amount(s.goalContributions.base)).toBe('2196.00 BOB');
    expect(s.goalContributions.complete).toBe(true);
    expect(s.meta.ratesUsed.map((r) => r.fxRateId)).toEqual(['r-usd']);
    expect(mem.windowRequests).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-048] un flujo sin tasa no se convierte 1:1: queda fuera del consolidado y el bloque, incompleto', async () => {
    mem.goalFlowRows = [
      { date: '2026-10-05', amount: bob('1000.00') },
      { date: '2026-10-06', amount: { amount: '100.00', currency: 'USD' } },
    ];
    const s = await summary({ month: '2026-10' });
    expect(amount(s.goalContributions.base)).toBe('1000.00 BOB');
    expect(s.goalContributions.native.map(amount)).toEqual(['1000.00 BOB', '100.00 USD']);
    expect(s.goalContributions.complete).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-048] con el puerto cableado y sin movimientos el consolidado es 0.00 y está completo', async () => {
    mem.goalFlowRows = [];
    const s = await summary({ month: '2026-10' });
    expect(s.goalContributions).toEqual({ native: [], base: bob('0.00'), complete: true });
  });
});
