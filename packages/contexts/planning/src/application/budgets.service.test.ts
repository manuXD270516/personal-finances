import { Instant } from '@pf/shared-kernel';
import { describe, expect, it, vi } from 'vitest';
import { BudgetQueries } from './budget.queries.js';
import { BudgetThresholdService } from './budget-thresholds.service.js';
import { BudgetCalculator } from './budget-calculator.js';
import { BudgetsService } from './budgets.service.js';
import { RolloverService } from './rollover.service.js';
import { InMemoryBudgets } from './testing/in-memory-budgets.js';

const W = '0190a000-0000-7000-8000-00000000a001';
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const G_ALIM = id(100);
const G_VIV = id(101);
const G_ING = id(102);
const SUPER = id(1);
const CARNES = id(2);
const REST = id(3);
const ALQ = id(4);
const SERV = id(5);
const LUZ = id(6);
const SALARIO = id(7);
const FEES = id(9);
const TAG_VIAJE = id(200);
const TRANSPORTE = id(10);

const money = (amount: string, currency = 'BOB') => ({ amount, currency });
const cat = (cid: string) => ({ kind: 'CATEGORY', id: cid });
const maxLine = (amount: string) => ({ kind: 'MAXIMUM', planned: money(amount) });

function setup(now = '2026-11-10T15:00:00Z') {
  const env = new InMemoryBudgets();
  env.mem.workspace(W);
  env.mem.clock.set(Instant.parse(now));
  const node = (
    categoryId: string,
    name: string,
    groupId: string,
    parentId: string | null = null,
    kind: 'EXPENSE' | 'INCOME' = 'EXPENSE',
  ) => ({
    categoryId,
    name,
    kind,
    groupId,
    parentId,
    systemCode: null,
    archived: false,
  });
  env.tree = {
    groups: [
      { groupId: G_ALIM, name: 'Alimentación', kind: 'EXPENSE', archived: false },
      { groupId: G_VIV, name: 'Vivienda', kind: 'EXPENSE', archived: false },
      { groupId: G_ING, name: 'Ingresos', kind: 'INCOME', archived: false },
    ],
    categories: [
      node(SUPER, 'Supermercado', G_ALIM),
      node(CARNES, 'Carnes', G_ALIM, SUPER),
      node(REST, 'Restaurantes', G_ALIM),
      node(ALQ, 'Alquiler', G_VIV),
      node(SERV, 'Servicios básicos', G_VIV),
      node(LUZ, 'Luz', G_VIV, SERV),
      node(TRANSPORTE, 'Transporte', G_VIV),
      node(FEES, 'Comisiones', G_VIV),
      node(SALARIO, 'Salario', G_ING, null, 'INCOME'),
    ],
    tags: [{ tagId: TAG_VIAJE, name: 'Viaje Santa Cruz', archived: false }],
  };
  const sep = env.mem.seed(W, '2026-09', 'CLOSED');
  const oct = env.mem.seed(W, '2026-10', 'ACTIVE');
  const nov = env.mem.seed(W, '2026-11', 'ACTIVE');
  const dec = env.mem.seed(W, '2026-12', 'DRAFT');
  const deps = env.deps();
  return {
    env,
    sep,
    oct,
    nov,
    dec,
    service: new BudgetsService(deps),
    queries: new BudgetQueries(deps),
    thresholds: new BudgetThresholdService(deps, new BudgetCalculator(deps)),
    rollover: new RolloverService(deps),
    events: (type: string) => env.mem.events.filter((e) => e.eventType === type),
  };
}
type Ctx = ReturnType<typeof setup>;

async function plan(ctx: Ctx, periodId: string) {
  return ctx.service.createBudget({ workspaceId: W, periodId });
}
const line = (b: Awaited<ReturnType<typeof plan>>, categoryId: string) =>
  b.lines.find((l) => l.target.id === categoryId)!;
const reject = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe('CreateBudget (planning/budgets: un plan mensual por periodo)', () => {
  it('[TC-PLANNING-BUDGET-001] crea el plan vacío en BOB y un segundo plan se rechaza con BUDGET_ALREADY_EXISTS sin cambiarlo', async () => {
    const ctx = setup();
    const first = await plan(ctx, ctx.nov.id);
    expect(first).toMatchObject({ currency: 'BOB', origin: 'EMPTY', periodLabel: '2026-11', lines: [] });
    await reject(plan(ctx, ctx.nov.id), 'BUDGET_ALREADY_EXISTS');
    expect(ctx.env.budgetRows.size).toBe(1);
    expect(ctx.events('planning.BudgetCreated')).toHaveLength(1);
    expect(ctx.env.mem.audits.filter((a) => a.action === 'planning.budget.created')).toHaveLength(1);
  });

  it('[TC-PLANNING-BUDGET-002] no se crea el plan de un periodo cerrado (PERIOD_CLOSED)', async () => {
    const ctx = setup();
    await reject(plan(ctx, ctx.sep.id), 'PERIOD_CLOSED');
    expect(ctx.env.budgetRows.size).toBe(0);
  });

  it('un periodo inexistente se rechaza con REFERENCE_NOT_FOUND', async () => {
    const ctx = setup();
    await reject(plan(ctx, id(999)), 'REFERENCE_NOT_FOUND');
  });
});

describe('Gasto real derivado de transacciones (INV-034)', () => {
  it('[TC-PLANNING-BUDGET-003] la categoría incluye sus subcategorías y solo el gasto del periodo (550.00 BOB)', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SUPER),
      spec: maxLine('1500.00'),
    });
    ctx.env.flow('2026-11-03', 'EXPENSE', SUPER, '400.00');
    ctx.env.flow('2026-11-04', 'EXPENSE', CARNES, '150.00');
    ctx.env.flow('2026-11-05', 'EXPENSE', REST, '200.00');
    ctx.env.flow('2026-10-31', 'EXPENSE', SUPER, '90.00');
    const view = await ctx.queries.getBudget(W, b.id);
    const l = line(view, SUPER);
    expect(l.progress.actual.amount).toBe('550.00');
    expect(l.progress.remaining.amount).toBe('950.00');
    expect(l.progress.utilization).toBe('36.7');
    // 10 de 30 días transcurridos el 2026-11-10 (La Paz): 550.00 / 10 x 30.
    expect(l.progress.projection?.amount).toBe('1650.00');
  });

  it('[TC-PLANNING-BUDGET-004] el ingreso esperado muestra real 6500.00 y diferencia -1500.00', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SALARIO),
      spec: { kind: 'FIXED', planned: money('8000.00') },
    });
    ctx.env.flow('2026-11-05', 'INCOME', SALARIO, '6500.00');
    const l = line(await ctx.queries.getBudget(W, b.id), SALARIO);
    expect(l.progress).toMatchObject({
      actual: money('6500.00'),
      difference: money('-1500.00'),
      projection: null,
    });
    await reject(
      ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(SALARIO), spec: maxLine('8000.00') }),
      'BUDGET_INVALID_LINE_KIND',
    );
  });

  it('[TC-PLANNING-BUDGET-014] el grupo Vivienda suma sus categorías y subcategorías (3110.00, restante 90.00)', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: { kind: 'GROUP', id: G_VIV },
      spec: maxLine('3200.00'),
    });
    ctx.env.flow('2026-11-01', 'EXPENSE', ALQ, '2800.00');
    ctx.env.flow('2026-11-03', 'EXPENSE', SERV, '250.00');
    ctx.env.flow('2026-11-04', 'EXPENSE', LUZ, '60.00');
    ctx.env.flow('2026-11-04', 'EXPENSE', SUPER, '999.00');
    const l = (await ctx.queries.getBudget(W, b.id)).lines[0]!;
    expect(l.progress.actual.amount).toBe('3110.00');
    expect(l.progress.remaining.amount).toBe('90.00');
  });

  it('[TC-PLANNING-BUDGET-021] el tag suma gastos de varias categorías (1500.00) y no entra al disponible', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: { kind: 'TAG', id: TAG_VIAJE },
      spec: maxLine('2000.00'),
    });
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    ctx.env.flow('2026-11-02', 'EXPENSE', TRANSPORTE, '1200.00', 'BOB', [TAG_VIAJE]);
    ctx.env.flow('2026-11-02', 'EXPENSE', REST, '300.00', 'BOB', [TAG_VIAJE]);
    ctx.env.flow('2026-11-03', 'EXPENSE', REST, '50.00', 'BOB', []);
    const view = await ctx.queries.getBudget(W, b.id);
    expect(view.lines.find((l) => l.target.kind === 'TAG')!.progress.actual.amount).toBe('1500.00');
    expect(line(view, REST).progress.actual.amount).toBe('350.00');
    // Solo Restaurantes entra: 600.00 - 350.00.
    expect(view.totals.availableToSpend.amount).toBe('250.00');
    expect(view.totals.actual.amount).toBe('350.00');
  });

  it('[TC-PLANNING-ACTUAL-002] una comisión de transferencia suma en la categoría de comisiones y no en las demás', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(FEES), spec: maxLine('50.00') });
    ctx.env.flow('2026-11-05', 'EXPENSE', FEES, '2.00');
    const view = await ctx.queries.getBudget(W, b.id);
    expect(line(view, REST).progress.actual.amount).toBe('0.00');
    expect(line(view, FEES).progress.actual.amount).toBe('2.00');
  });

  it('[TC-PLANNING-ACTUAL-003] el gasto del 2026-11-30 cuenta en noviembre y no en diciembre (fecha de negocio)', async () => {
    const ctx = setup();
    const nov = await plan(ctx, ctx.nov.id);
    const dec = await plan(ctx, ctx.dec.id);
    for (const b of [nov, dec]) {
      await ctx.service.addLine({
        workspaceId: W,
        budgetId: b.id,
        target: cat(REST),
        spec: maxLine('600.00'),
      });
    }
    ctx.env.flow('2026-11-30', 'EXPENSE', REST, '40.00');
    expect(line(await ctx.queries.getBudget(W, nov.id), REST).progress.actual.amount).toBe('40.00');
    expect(line(await ctx.queries.getBudget(W, dec.id), REST).progress.actual.amount).toBe('0.00');
  });

  it('[TC-PLANNING-ACTUAL-004][TC-PLANNING-ACTUAL-005] 20.00 USD a 12.05 + 100.00 BOB = 341.00; una tasa posterior no recalcula', async () => {
    const ctx = setup('2026-11-25T15:00:00Z');
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    ctx.env.rate('USD', 'BOB', '2026-11-12T10:00:00Z', '12.05');
    ctx.env.flow('2026-11-12', 'EXPENSE', REST, '20.00', 'USD');
    ctx.env.flow('2026-11-13', 'EXPENSE', REST, '100.00');
    const first = await ctx.queries.getBudget(W, b.id);
    const l = line(first, REST);
    expect(l.progress.actual.amount).toBe('341.00');
    expect(l.progress.actualComplete).toBe(true);
    expect(first.meta.ratesUsed.map((r) => r.rate.value)).toEqual(['12.05']);
    // Se registra después la tasa del 2026-11-20 (12.40): el gasto del día 12 sigue valorado con la de su fecha.
    ctx.env.rate('USD', 'BOB', '2026-11-20T10:00:00Z', '12.40');
    expect(line(await ctx.queries.getBudget(W, b.id), REST).progress.actual.amount).toBe('341.00');
  });

  it('[TC-PLANNING-ACTUAL-006] 5.00 EUR sin tasa en la ventana queda sin convertir: 341.00 BOB incompleto (no 346.00)', async () => {
    const ctx = setup('2026-11-25T15:00:00Z');
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    ctx.env.rate('USD', 'BOB', '2026-11-12T10:00:00Z', '12.05');
    ctx.env.flow('2026-11-12', 'EXPENSE', REST, '20.00', 'USD');
    ctx.env.flow('2026-11-13', 'EXPENSE', REST, '100.00');
    ctx.env.flow('2026-11-14', 'EXPENSE', REST, '5.00', 'EUR');
    // Una tasa EUR/BOB vieja, fuera de la ventana de 7 días, no se usa.
    ctx.env.rate('EUR', 'BOB', '2026-11-01T10:00:00Z', '13.00');
    const view = await ctx.queries.getBudget(W, b.id);
    const l = line(view, REST);
    expect(l.progress.actual.amount).toBe('341.00');
    expect(l.progress.actualComplete).toBe(false);
    expect(l.progress.unconverted).toEqual([money('5.00', 'EUR')]);
    expect(view.totals.complete).toBe(false);
    expect(view.totals.unconverted).toEqual([money('5.00', 'EUR')]);
  });
});

describe('Cambios del plan: periodo cerrado, permisos de edición y auditoría', () => {
  it('[TC-PLANNING-BUDGET-012][TC-PLANNING-PLANGUARD-001] un periodo cerrado rechaza crear, editar y quitar líneas; reabierto o en borrador sí acepta', async () => {
    const ctx = setup();
    const sepBudget = await plan(ctx, ctx.oct.id);
    const added = await ctx.service.addLine({
      workspaceId: W,
      budgetId: sepBudget.id,
      target: cat(SUPER),
      spec: maxLine('1500.00'),
    });
    const draft = await plan(ctx, ctx.dec.id);
    const draftLine = await ctx.service.addLine({
      workspaceId: W,
      budgetId: draft.id,
      target: cat(SUPER),
      spec: maxLine('1500.00'),
    });
    // El periodo se cierra (add-month-closing): sus líneas pasan a solo lectura.
    ctx.env.mem.rows.set(ctx.oct.id, { ...ctx.oct, status: 'CLOSED', closeCount: 1, latestCloseNo: 1 });
    const crossingsBefore = ctx.env.crossingRows.length;
    await reject(
      ctx.service.updateLine({
        workspaceId: W,
        budgetId: sepBudget.id,
        lineId: added.id,
        expectedVersion: added.version,
        patch: { planned: money('1800.00') },
      }),
      'PERIOD_CLOSED',
    );
    await reject(
      ctx.service.addLine({
        workspaceId: W,
        budgetId: sepBudget.id,
        target: cat(REST),
        spec: maxLine('600.00'),
      }),
      'PERIOD_CLOSED',
    );
    await reject(
      ctx.service.removeLine({ workspaceId: W, budgetId: sepBudget.id, lineId: added.id }),
      'PERIOD_CLOSED',
    );
    expect(ctx.env.budgetRows.get(sepBudget.id)!.lines[0]!.planned).toBe('1500.00');
    expect(ctx.env.crossingRows.length).toBe(crossingsBefore);
    // Se reabre: el cambio se acepta y el plan queda en 1800.00.
    ctx.env.mem.rows.set(ctx.oct.id, {
      ...ctx.oct,
      status: 'REOPENED',
      closeCount: 1,
      reopenCount: 1,
      latestCloseNo: 1,
    });
    const updated = await ctx.service.updateLine({
      workspaceId: W,
      budgetId: sepBudget.id,
      lineId: added.id,
      expectedVersion: added.version,
      patch: { planned: money('1800.00') },
    });
    expect(updated.planned?.amount).toBe('1800.00');
    // Un periodo en borrador siempre se puede planificar.
    const draftUpdated = await ctx.service.updateLine({
      workspaceId: W,
      budgetId: draft.id,
      lineId: draftLine.id,
      expectedVersion: draftLine.version,
      patch: { planned: money('1600.00') },
    });
    expect(draftUpdated.planned?.amount).toBe('1600.00');
  });

  it('[TC-PLANNING-BUDGET-013] cada cambio se audita con el antes (1500.00 BOB) y el después (1400.00 BOB) en la misma operación', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    const added = await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SUPER),
      spec: maxLine('1500.00'),
    });
    await ctx.service.updateLine({
      workspaceId: W,
      budgetId: b.id,
      lineId: added.id,
      expectedVersion: added.version,
      patch: { planned: money('1400.00') },
    });
    const entry = ctx.env.mem.audits.find((a) => a.action === 'planning.budget.line_updated')!;
    expect(entry).toMatchObject({ aggregateType: 'Budget', aggregateId: b.id });
    const planned = entry.changes!.find((c) => c.field === 'planned')!;
    expect(planned.before).toEqual(money('1500.00'));
    expect(planned.after).toEqual(money('1400.00'));
    expect(entry.changes!.find((c) => c.field === 'line')!.after).toBe(added.id);
  });

  it('una operación rechazada no deja auditoría ni cambios (el plan no cambia)', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    const audits = ctx.env.mem.audits.length;
    await reject(
      ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(SUPER), spec: maxLine('-1.00') }),
      'BUDGET_INVALID_AMOUNTS',
    );
    expect(ctx.env.mem.audits.length).toBe(audits);
    expect((await ctx.queries.getBudget(W, b.id)).lines).toHaveLength(0);
  });

  it('[TC-PLANNING-BUDGET-020] base cero: por asignar 500.00 y 0.00 tras agregar el ahorro programado', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SALARIO),
      spec: { kind: 'FIXED', planned: money('8000.00') },
    });
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SUPER),
      spec: maxLine('7500.00'),
    });
    const zero = await ctx.service.setZeroBased({
      workspaceId: W,
      budgetId: b.id,
      zeroBased: true,
      expectedVersion: (await ctx.queries.getBudget(W, b.id)).version,
    });
    expect(zero.totals.toAssign?.amount).toBe('500.00');
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(ALQ),
      spec: { kind: 'FIXED', planned: money('500.00') },
    });
    expect((await ctx.queries.getBudget(W, b.id)).totals.toAssign?.amount).toBe('0.00');
  });

  it('[TC-PLANNING-BUDGET-019] porcentaje de ingresos reales: 10 % de 6500.00 = 650.00', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(REST),
      spec: { kind: 'PERCENT_OF_INCOME', percent: '10', incomeBasis: 'ACTUAL' },
    });
    ctx.env.flow('2026-11-05', 'INCOME', SALARIO, '6500.00');
    const l = line(await ctx.queries.getBudget(W, b.id), REST);
    expect(l.progress.effectivePlanned.amount).toBe('650.00');
  });
});

describe('Umbrales: emisión única por objetivo, umbral y periodo', () => {
  async function restaurants(ctx: Ctx, spent: string) {
    const b = await plan(ctx, ctx.nov.id);
    const l = await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(REST),
      spec: maxLine('600.00'),
    });
    if (spent !== '0.00') ctx.env.flow('2026-11-05', 'EXPENSE', REST, spent);
    return { b, l };
  }
  const reached = (ctx: Ctx) =>
    ctx.events('planning.BudgetThresholdReached').map((e) => e.payload as Record<string, unknown>);

  it('[TC-PLANNING-THRESHOLD-003] cruzar el 50 % (280.00 -> 310.00) emite un único hecho con reference 600.00 y actual 310.00', async () => {
    const ctx = setup();
    await restaurants(ctx, '280.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(0);
    ctx.env.flow('2026-11-06', 'EXPENSE', REST, '30.00');
    await ctx.thresholds.evaluateWorkspace(W);
    const events = reached(ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      threshold: '50',
      alsoCrossed: [],
      reference: money('600.00'),
      actual: money('310.00'),
      periodLabel: '2026-11',
      utilization: '51.7',
      actualComplete: true,
      target: { kind: 'CATEGORY', id: REST },
    });
    expect(ctx.env.crossingRows.map((c) => c.threshold)).toEqual(['50']);
  });

  it('[TC-PLANNING-THRESHOLD-004] bajar (reembolso) y volver a subir no re-emite el 50 %', async () => {
    const ctx = setup();
    await restaurants(ctx, '310.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(1);
    ctx.env.flow('2026-11-07', 'EXPENSE', REST, '-40.00');
    await ctx.thresholds.evaluateWorkspace(W);
    ctx.env.flow('2026-11-08', 'EXPENSE', REST, '60.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(1);
    expect(ctx.env.crossingRows).toHaveLength(1);
  });

  it('[TC-PLANNING-THRESHOLD-003] la reentrega del mismo evento de origen no duplica el cruce ni el hecho', async () => {
    const ctx = setup();
    await restaurants(ctx, '310.00');
    await Promise.all([ctx.thresholds.evaluateWorkspace(W), ctx.thresholds.evaluateWorkspace(W)]);
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(1);
    expect(ctx.env.crossingRows).toHaveLength(1);
  });

  it('[TC-PLANNING-THRESHOLD-006] de 280.00 a 550.00 emite UN hecho del 90 % con alsoCrossed 50 y 75; a 600.00 solo el 100 %', async () => {
    const ctx = setup();
    await restaurants(ctx, '550.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toEqual([expect.objectContaining({ threshold: '90', alsoCrossed: ['50', '75'] })]);
    expect(ctx.env.crossingRows.map((c) => c.threshold).sort()).toEqual(['50', '75', '90']);
    ctx.env.flow('2026-11-09', 'EXPENSE', REST, '50.00');
    await ctx.thresholds.evaluateWorkspace(W);
    const events = reached(ctx);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ threshold: '100', alsoCrossed: [], actual: money('600.00') });
  });

  it('[TC-PLANNING-THRESHOLD-007] bajar el máximo a 500.00 con 470.00 emite el 90 % en la misma operación, sin re-emitir 50 ni 75', async () => {
    const ctx = setup();
    const { b, l } = await restaurants(ctx, '470.00');
    await ctx.thresholds.evaluateWorkspace(W);
    // 78.3 %: cruzados 50 y 75 (un hecho con alsoCrossed). Se cuentan antes del cambio.
    const before = reached(ctx).length;
    expect(before).toBe(1);
    await ctx.service.updateLine({
      workspaceId: W,
      budgetId: b.id,
      lineId: l.id,
      expectedVersion: l.version,
      patch: { planned: money('500.00') },
    });
    const events = reached(ctx);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      threshold: '90',
      alsoCrossed: [],
      reference: money('500.00'),
      actual: money('470.00'),
      utilization: '94.0',
    });
  });

  it('agregar una línea con gasto previo evalúa sus umbrales al agregarla (síncrono)', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    ctx.env.flow('2026-11-05', 'EXPENSE', REST, '350.00');
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    expect(reached(ctx)).toEqual([expect.objectContaining({ threshold: '50' })]);
  });

  it('quitar y volver a agregar la línea no re-alerta (dedupe por objetivo)', async () => {
    const ctx = setup();
    const { b, l } = await restaurants(ctx, '310.00');
    await ctx.thresholds.evaluateWorkspace(W);
    await ctx.service.removeLine({ workspaceId: W, budgetId: b.id, lineId: l.id });
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(1);
  });

  it('[TC-PLANNING-THRESHOLD-001] las líneas de mínimo e ingreso no tienen umbrales ni emiten hechos', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(REST),
      spec: { kind: 'MINIMUM', min: money('100.00') },
    });
    ctx.env.flow('2026-11-05', 'EXPENSE', REST, '500.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(0);
  });

  it('gastado incompleto (sin tasa): evalúa con la parte convertida y reevalúa al llegar la tasa (docs/33 D82)', async () => {
    const ctx = setup('2026-11-25T15:00:00Z');
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    ctx.env.flow('2026-11-12', 'EXPENSE', REST, '100.00');
    ctx.env.flow('2026-11-13', 'EXPENSE', REST, '30.00', 'USD'); // sin tasa: 360.00 BOB cuando llegue 12.00
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toHaveLength(0);
    expect(line(await ctx.queries.getBudget(W, b.id), REST).progress.actualComplete).toBe(false);
    ctx.env.rate('USD', 'BOB', '2026-11-13T10:00:00Z', '12.00');
    await ctx.thresholds.evaluateWorkspace(W);
    expect(reached(ctx)).toEqual([expect.objectContaining({ threshold: '75', alsoCrossed: ['50'] })]);
  });

  it('los periodos cerrados nunca se evalúan', async () => {
    const ctx = setup();
    const b = await plan(ctx, ctx.oct.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: b.id, target: cat(REST), spec: maxLine('600.00') });
    ctx.env.flow('2026-10-05', 'EXPENSE', REST, '580.00');
    ctx.env.mem.rows.set(ctx.oct.id, { ...ctx.oct, status: 'CLOSED', closeCount: 1, latestCloseNo: 1 });
    const before = ctx.events('planning.BudgetThresholdReached').length;
    await ctx.thresholds.evaluateWorkspace(W);
    expect(ctx.events('planning.BudgetThresholdReached')).toHaveLength(before);
  });
});

describe('Rollover del remanente al periodo siguiente', () => {
  async function twoMonths(ctx: Ctx, policy: 'CARRY_POSITIVE' | 'CARRY_ALL', cap?: string) {
    const octB = await plan(ctx, ctx.oct.id);
    const spec = {
      kind: 'MAXIMUM',
      planned: money('600.00'),
      rolloverPolicy: policy,
      ...(cap ? { rolloverCap: money(cap) } : {}),
    };
    await ctx.service.addLine({ workspaceId: W, budgetId: octB.id, target: cat(REST), spec });
    const novB = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({ workspaceId: W, budgetId: novB.id, target: cat(REST), spec });
    return { octB, novB };
  }

  it('[TC-PLANNING-BUDGET-017] remanente 80.00 => planificado efectivo 680.00 (provisional); con tope 50.00 => 650.00', async () => {
    const ctx = setup();
    const { novB } = await twoMonths(ctx, 'CARRY_POSITIVE');
    ctx.env.flow('2026-10-10', 'EXPENSE', REST, '520.00');
    const l = line(await ctx.queries.getBudget(W, novB.id), REST);
    expect(l.progress.effectivePlanned.amount).toBe('680.00');
    expect(l.progress.rolloverIn?.amount).toBe('80.00');
    expect(l.progress.rolloverStatus).toBe('PROVISIONAL');
    const capped = setup();
    const { novB: novCapped } = await twoMonths(capped, 'CARRY_POSITIVE', '50.00');
    capped.env.flow('2026-10-10', 'EXPENSE', REST, '520.00');
    expect(line(await capped.queries.getBudget(W, novCapped.id), REST).progress.effectivePlanned.amount).toBe(
      '650.00',
    );
  });

  it('[TC-PLANNING-BUDGET-017] exceso de 50.00: política completa => 550.00; solo positiva => 600.00', async () => {
    const all = setup();
    const { novB } = await twoMonths(all, 'CARRY_ALL');
    all.env.flow('2026-10-10', 'EXPENSE', REST, '650.00');
    expect(line(await all.queries.getBudget(W, novB.id), REST).progress.effectivePlanned.amount).toBe(
      '550.00',
    );
    const positive = setup();
    const { novB: novPositive } = await twoMonths(positive, 'CARRY_POSITIVE');
    positive.env.flow('2026-10-10', 'EXPENSE', REST, '650.00');
    expect(
      line(await positive.queries.getBudget(W, novPositive.id), REST).progress.effectivePlanned.amount,
    ).toBe('600.00');
  });

  it('[TC-PLANNING-BUDGET-018] se congela al cerrar, vuelve a provisional al reabrir y se recalcula al re-cerrar (50.00 => 650.00)', async () => {
    const ctx = setup();
    const { novB } = await twoMonths(ctx, 'CARRY_POSITIVE');
    ctx.env.flow('2026-10-10', 'EXPENSE', REST, '520.00');
    // 2026-10 se cierra: MonthClosed => el consumidor congela el remanente en el plan de noviembre.
    ctx.env.mem.rows.set(ctx.oct.id, { ...ctx.oct, status: 'CLOSED', closeCount: 1, latestCloseNo: 1 });
    expect(await ctx.rollover.onPeriodClosed({ workspaceId: W, periodId: ctx.oct.id })).toBe(1);
    const frozen = line(await ctx.queries.getBudget(W, novB.id), REST);
    expect(frozen.progress.rolloverStatus).toBe('FINAL');
    expect(frozen.progress.rolloverIn?.amount).toBe('80.00');
    expect(ctx.env.budgetRows.get(novB.id)!.lines[0]).toMatchObject({ rolloverStatus: 'FINAL' });
    // Reentregar MonthClosed no cambia el resultado.
    expect(await ctx.rollover.onPeriodClosed({ workspaceId: W, periodId: ctx.oct.id })).toBe(0);

    // Reapertura: vuelve a provisional.
    ctx.env.mem.rows.set(ctx.oct.id, {
      ...ctx.oct,
      status: 'REOPENED',
      closeCount: 1,
      reopenCount: 1,
      latestCloseNo: 1,
    });
    expect(await ctx.rollover.onPeriodReopened({ workspaceId: W, periodId: ctx.oct.id })).toBe(1);
    expect(line(await ctx.queries.getBudget(W, novB.id), REST).progress.rolloverStatus).toBe('PROVISIONAL');

    // Gasto adicional de 30.00 el 2026-10-28 y nuevo cierre: remanente 50.00 y planificado efectivo 650.00.
    ctx.env.flow('2026-10-28', 'EXPENSE', REST, '30.00');
    ctx.env.mem.rows.set(ctx.oct.id, {
      ...ctx.oct,
      status: 'CLOSED',
      closeCount: 2,
      reopenCount: 1,
      latestCloseNo: 2,
    });
    await ctx.rollover.onPeriodClosed({ workspaceId: W, periodId: ctx.oct.id });
    const refrozen = line(await ctx.queries.getBudget(W, novB.id), REST);
    expect(refrozen.progress.rolloverIn?.amount).toBe('50.00');
    expect(refrozen.progress.rolloverStatus).toBe('FINAL');
    expect(refrozen.progress.effectivePlanned.amount).toBe('650.00');
    await ctx.rollover.onPeriodClosed({ workspaceId: W, periodId: ctx.oct.id });
    expect(line(await ctx.queries.getBudget(W, novB.id), REST).progress.effectivePlanned.amount).toBe(
      '650.00',
    );
  });
});

describe('BudgetVsActualQuery (contrato público para add-month-closing)', () => {
  it('devuelve el plan del periodo con referencia, gastado y totales; null si el periodo no tiene plan', async () => {
    const ctx = setup();
    expect(await ctx.queries.getForPeriod({ workspaceId: W, periodId: ctx.nov.id })).toBeNull();
    const b = await plan(ctx, ctx.nov.id);
    await ctx.service.addLine({
      workspaceId: W,
      budgetId: b.id,
      target: cat(SUPER),
      spec: maxLine('1500.00'),
    });
    ctx.env.flow('2026-11-03', 'EXPENSE', SUPER, '550.00');
    const result = await ctx.queries.getForPeriod({
      workspaceId: W,
      periodId: ctx.nov.id,
      asOf: '2026-11-30T23:00:00Z',
    });
    expect(result).toMatchObject({
      budgetId: b.id,
      currency: 'BOB',
      totals: {
        planned: money('1500.00'),
        actual: money('550.00'),
        availableToSpend: money('950.00'),
        complete: true,
      },
    });
    expect(result?.lines[0]).toMatchObject({
      reference: money('1500.00'),
      actual: money('550.00'),
      status: 'WITHIN',
      target: { kind: 'CATEGORY', id: SUPER },
    });
  });
});

describe('Costo por evento del cálculo de presupuesto (improve-event-throughput 2.5)', () => {
  it('con varias líneas de rollover lee los periodos y el plan anterior una sola vez por cálculo y el resultado no cambia', async () => {
    const ctx = setup();
    const spec = { kind: 'MAXIMUM', planned: money('600.00'), rolloverPolicy: 'CARRY_POSITIVE' };
    const octB = await plan(ctx, ctx.oct.id);
    const novB = await plan(ctx, ctx.nov.id);
    for (const target of [REST, ALQ, SUPER]) {
      await ctx.service.addLine({ workspaceId: W, budgetId: octB.id, target: cat(target), spec });
      await ctx.service.addLine({ workspaceId: W, budgetId: novB.id, target: cat(target), spec });
    }
    ctx.env.flow('2026-10-10', 'EXPENSE', REST, '520.00');
    const expected = line(await ctx.queries.getBudget(W, novB.id), REST).progress.rolloverIn?.amount;
    expect(expected).toBe('80.00');

    const deps = ctx.env.deps();
    const periodsList = vi.spyOn(deps.periods, 'list');
    const byPeriod = vi.spyOn(deps.budgets, 'findByPeriod');
    const catalog = vi.spyOn(deps.catalog, 'categoryTree');
    const budget = (await deps.budgets.findById(W, novB.id))!;
    const period = (await deps.periods.list(W)).find((p) => p.id === ctx.nov.id)!;
    periodsList.mockClear();
    const view = await new BudgetCalculator(deps).view({
      workspaceId: W,
      budget,
      period,
      now: ctx.env.mem.clock.now(),
    });
    expect(view.lines.find((v) => v.line.target.id === REST)?.rolloverIn?.toJSON().amount).toBe(expected);
    // Antes: una lectura de periodos y de plan anterior por línea con rollover (3 y 6) y el árbol por periodo encadenado.
    expect(periodsList).toHaveBeenCalledTimes(1);
    expect(byPeriod).toHaveBeenCalledTimes(2); // octubre y septiembre (uno por periodo encadenado)
    expect(catalog).toHaveBeenCalledTimes(1);
  });
});
