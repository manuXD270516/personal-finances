import { Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReportSummaryQueries } from './report-summary.queries.js';
import type { SpendableCommittedRow } from './ports/index.js';
import { SpendableQueries } from './spendable.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const spendable = async () =>
  (
    await new SpendableQueries(mem.deps(), mem.deps().spendable!).getSpendable({
      userId: USER,
      workspaceId: WS,
    })
  ).spendable;
const summary = async () =>
  (await new ReportSummaryQueries(mem.deps()).getReportSummary({ userId: USER, workspaceId: WS })).summary;
const text = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });

let seq = 0;
function item(
  name: string,
  date: string,
  amount: { amount: string; currency: string } | null,
  over: Partial<SpendableCommittedRow> = {},
) {
  seq += 1;
  const row: SpendableCommittedRow = {
    source: 'OCCURRENCE',
    id: `item-${seq}-${name}`,
    definitionId: `def-${name}`,
    name,
    kind: 'EXPENSE',
    date,
    accountId: 'banco',
    toAccountId: null,
    sourceLiquid: true,
    targetLiquid: null,
    managedBy: 'USER',
    amount,
    overdueFromPrevious: false,
    ...over,
  };
  mem.spendableItems.push(row);
  return row;
}

/**
 * Datos base (docs/tasks 1.3): FixedClock 2026-10-20T10:00:00-04:00, periodo "2026-10"; líquidas 12000.00, 800.00 y
 * 3000.00 BOB; metas con 3000.00 reales en "Ahorro BOB" y 2000.00 reservados en "Banco BOB"; comprometido desde líquidas
 * 3179.00 BOB (Internet 199.00, Luz 180.00, Pago Tarjeta X 2500.00, pendiente Cena 300.00); pendiente planificado 600.00;
 * reserva mínima 1500.00.
 */
beforeEach(() => {
  seq = 0;
  mem = new InMemoryReporting();
  mem.spendableEnabled = true;
  mem.clock.set(Instant.parse('2026-10-20T14:00:00Z'));
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '12000.00');
  mem.addAccount({ accountId: 'efectivo', name: 'Efectivo BOB', type: 'CASH', currency: 'BOB' }, '800.00');
  mem.addAccount({ accountId: 'ahorro', name: 'Ahorro BOB', type: 'SAVINGS', currency: 'BOB' }, '3000.00');
  mem.addAccount(
    { accountId: 'tarjeta-x', name: 'Tarjeta X', type: 'CREDIT_CARD', currency: 'BOB' },
    '2500.00',
  );
  mem.addPeriod('2026-10', '2026-10-01', '2026-10-31', 'ACTIVE');
  mem.reservations.push(
    { accountId: 'ahorro', currency: 'BOB', reserved: '3000.00' },
    { accountId: 'banco', currency: 'BOB', reserved: '2000.00' },
  );
  mem.goalPlans.push({ goalId: 'g1', goalName: 'Fondo de emergencia', currency: 'BOB', pending: '600.00' });
  mem.minimumReserve = bob('1500.00');
  item('Internet', '2026-10-22', bob('199.00'));
  item('Luz', '2026-10-28', bob('180.00'));
  item('Pago Tarjeta X', '2026-10-25', bob('2500.00'), {
    kind: 'TRANSFER',
    toAccountId: 'tarjeta-x',
    targetLiquid: false,
  });
  item('Cena', '2026-10-18', bob('300.00'), { source: 'PENDING', definitionId: null, managedBy: null });
});

describe('GetSpendable: términos del disponible (reporting/dashboard, Q5)', () => {
  it('[TC-REPORTING-SPENDABLE-001] el disponible de octubre es 5521.00 BOB con cada término visible y el ingreso esperado no suma', async () => {
    item('Sueldo', '2026-10-30', bob('8000.00'), { kind: 'INCOME' });
    const s = await spendable();
    expect(s.period).toEqual({
      id: 'period-2026-10',
      label: '2026-10',
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(s.byCurrency).toHaveLength(1);
    const t = s.byCurrency[0]!;
    expect(t).toMatchObject({
      currency: 'BOB',
      liquid: bob('15800.00'),
      reservedForGoals: bob('5000.00'),
      committed: bob('3179.00'),
      plannedGoalContributions: bob('600.00'),
      minimumReserve: bob('1500.00'),
      spendable: bob('5521.00'),
    });
    expect(text(s.consolidated.total)).toBe('5521.00 BOB');
    expect(s.consolidated.complete).toBe(true);
    expect(s.status).toBe('OK');
    expect(s.shortfalls).toEqual([]);
  });

  it('[TC-REPORTING-SPENDABLE-001] sin reserva mínima el disponible es 7021.00 BOB y el término no se informa', async () => {
    mem.minimumReserve = null;
    const s = await spendable();
    expect(s.byCurrency[0]!.minimumReserve).toBeNull();
    expect(text(s.consolidated.total)).toBe('7021.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-002] sin Netflix (tarjeta) y con 1 pago sin monto no descontado', async () => {
    item('Netflix', '2026-10-15', bob('49.00'), { accountId: 'tarjeta-x', sourceLiquid: false });
    item('Agua', '2026-10-26', null);
    const s = await spendable();
    expect(s.byCurrency[0]!.committed).toEqual(bob('3179.00'));
    expect(s.committedItems.map((i) => i.name)).not.toContain('Netflix');
    expect(s.committedItems.map((i) => i.name)).toEqual(['Cena', 'Internet', 'Pago Tarjeta X', 'Luz']);
    expect(s.withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-SPENDABLE-003] el aporte de una meta se cuenta una sola vez: 4621.00 BOB', async () => {
    item('Aporte Fondo de emergencia', '2026-10-28', bob('1500.00'), {
      kind: 'TRANSFER',
      toAccountId: 'plazo',
      targetLiquid: false,
      managedBy: 'GOAL',
    });
    mem.goalPlans[0] = { ...mem.goalPlans[0]!, pending: '1500.00' };
    const s = await spendable();
    expect(s.byCurrency[0]).toMatchObject({
      committed: bob('3179.00'),
      plannedGoalContributions: bob('1500.00'),
      spendable: bob('4621.00'),
    });
  });

  it('[TC-REPORTING-SPENDABLE-004] un vencido anterior resta (5401.00 BOB) y una transferencia entre líquidas no suma', async () => {
    item('Seguro', '2026-09-28', bob('120.00'));
    item('Ahorro mensual', '2026-10-25', bob('500.00'), {
      kind: 'TRANSFER',
      toAccountId: 'efectivo',
      targetLiquid: true,
      managedBy: 'USER',
    });
    const s = await spendable();
    expect(s.byCurrency[0]!.committed).toEqual(bob('3299.00'));
    expect(text(s.consolidated.total)).toBe('5401.00 BOB');
    expect(s.committedItems.find((i) => i.name === 'Seguro')?.overdueFromPrevious).toBe(true);
  });

  it('[TC-REPORTING-SPENDABLE-005] una cuenta sobre-asignada resta como máximo su saldo y las reservas de cuentas no líquidas no restan', async () => {
    mem.spendableItems.length = 0;
    mem.goalPlans.length = 0;
    mem.minimumReserve = null;
    mem.accounts.splice(0, mem.accounts.length);
    mem.balances.clear();
    mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '1500.00');
    mem.addAccount(
      { accountId: 'inversion', name: 'Inversión', type: 'INVESTMENT', currency: 'BOB' },
      '4000.00',
    );
    mem.reservations.length = 0;
    mem.reservations.push(
      { accountId: 'banco', currency: 'BOB', reserved: '2000.00' },
      { accountId: 'inversion', currency: 'BOB', reserved: '4000.00' },
    );
    const s = await spendable();
    expect(s.byCurrency[0]!.reservedForGoals).toEqual(bob('1500.00'));
    expect(text(s.consolidated.total)).toBe('0.00 BOB');
    expect(s.reservedByAccount.map((r) => [r.name, text(r.reserved), text(r.counted)])).toEqual([
      ['Banco BOB', '2000.00 BOB', '1500.00 BOB'],
    ]);
  });

  it('[TC-REPORTING-SPENDABLE-009] los aportes planificados pendientes que informa GOALS restan por moneda de la meta', async () => {
    mem.goalPlans.push({ goalId: 'g2', goalName: 'Viaje', currency: 'USD', pending: '100.00' });
    const s = await spendable();
    expect(s.plannedByGoal.map((g) => [g.goalName, text(g.pending)])).toEqual([
      ['Fondo de emergencia', '600.00 BOB'],
      ['Viaje', '100.00 USD'],
    ]);
    expect(s.byCurrency.find((t) => t.currency === 'USD')?.plannedGoalContributions).toEqual(usd('100.00'));
  });
});

describe('GetSpendable: moneda, consolidado y estado', () => {
  const withUsd = () => {
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '50.00');
    item('Spotify', '2026-10-24', usd('5.99'), { accountId: 'caja-usd' });
  };

  it('[TC-REPORTING-SPENDABLE-006] BOB y USD por moneda y consolidado 6049.12 BOB con la tasa 12.00 y su fuente', async () => {
    withUsd();
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-20T13:00:00Z' });
    const s = await spendable();
    expect(s.byCurrency.map((t) => text(t.spendable))).toEqual(['5521.00 BOB', '44.01 USD']);
    expect(text(s.consolidated.total)).toBe('6049.12 BOB');
    expect(s.consolidated.complete).toBe(true);
    expect(s.meta.ratesUsed.map((r) => r.rate.value)).toEqual(['12.00']);
    expect(s.meta.attributions.map((a) => a.text)).toEqual(['Fuente: paralelo.bo']);
    expect(s.meta.rateWindowDays).toBe(7);
  });

  it('[TC-REPORTING-SPENDABLE-006] sin tasa dentro de la ventana el consolidado es 5521.00 BOB, incompleto, con 44.01 USD sin convertir', async () => {
    withUsd();
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-09-01T13:00:00Z' });
    const s = await spendable();
    expect(text(s.consolidated.total)).toBe('5521.00 BOB');
    expect(s.consolidated.complete).toBe(false);
    expect(s.consolidated.unconverted.map(text)).toEqual(['44.01 USD']);
  });

  it('[TC-REPORTING-SPENDABLE-007] −200.00 BOB y 100.00 USD: consolidado 1000.00 BOB, faltante de 200.00 BOB y estado OK', async () => {
    mem.spendableItems.length = 0;
    mem.goalPlans.length = 0;
    mem.reservations.length = 0;
    mem.minimumReserve = null;
    mem.accounts.splice(0, mem.accounts.length);
    mem.balances.clear();
    mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '2000.00');
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '100.00');
    item('Alquiler', '2026-10-26', bob('2200.00'));
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-20T13:00:00Z' });
    const s = await spendable();
    expect(s.byCurrency.map((t) => text(t.spendable))).toEqual(['-200.00 BOB', '100.00 USD']);
    expect(text(s.consolidated.total)).toBe('1000.00 BOB');
    expect(s.shortfalls.map(text)).toEqual(['200.00 BOB']);
    expect(s.status).toBe('OK');
  });

  it('[TC-REPORTING-SPENDABLE-008] más comprometido que líquido: −600.00 BOB con estado WARNING y desglose', async () => {
    mem.spendableItems.length = 0;
    mem.goalPlans.length = 0;
    mem.reservations.length = 0;
    mem.minimumReserve = null;
    mem.accounts.splice(0, mem.accounts.length);
    mem.balances.clear();
    mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '2000.00');
    item('Alquiler', '2026-10-26', bob('2600.00'));
    const s = await summary();
    expect(s.spendable?.status).toBe('WARNING');
    expect(text(s.spendable?.consolidated.total)).toBe('-600.00 BOB');
    expect(s.spendable?.byCurrency[0]).toMatchObject({ liquid: bob('2000.00'), committed: bob('2600.00') });
  });
});

describe('GetSpendable: segunda vista, periodo y frescura', () => {
  it('[TC-REPORTING-SPENDABLE-010] la segunda vista muestra el disponible del presupuesto y, sin plan, ofrece crearlo', async () => {
    mem.budgets.set('period-2026-10', {
      budgetId: 'bud-1',
      totals: { availableToSpend: bob('3750.00'), complete: true },
    });
    const withPlan = await summary();
    expect(text(withPlan.spendable?.consolidated.total)).toBe('5521.00 BOB');
    expect(withPlan.spendable?.budgetView).toEqual({
      status: 'AVAILABLE',
      action: null,
      budgetId: 'bud-1',
      amount: bob('3750.00'),
      complete: true,
    });
    mem.budgets.clear();
    const noPlan = await summary();
    expect(noPlan.spendable?.budgetView).toEqual({
      status: 'NO_PLAN',
      action: 'CREATE_BUDGET',
      budgetId: null,
      amount: null,
      complete: null,
    });
    expect(text(noPlan.spendable?.consolidated.total)).toBe('5521.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-011] con día de inicio 25 usa el periodo 2026-09 (25-sep a 24-oct): 499.00 BOB comprometidos y 8201.00 BOB', async () => {
    mem.periods.length = 0;
    mem.addPeriod('2026-09', '2026-09-25', '2026-10-24', 'ACTIVE');
    mem.addPeriod('2026-10', '2026-10-25', '2026-11-24', 'ACTIVE');
    const s = await spendable();
    expect(s.period).toMatchObject({ label: '2026-09', start: '2026-09-25', end: '2026-10-24' });
    expect(s.byCurrency[0]!.committed).toEqual(bob('499.00'));
    expect(text(s.consolidated.total)).toBe('8201.00 BOB');
    expect(mem.spendableRequests.at(-1)).toEqual({ periodFrom: '2026-09-25', periodTo: '2026-10-24' });
  });

  it('[TC-REPORTING-SPENDABLE-011] a las 23:30 del 24 en La Paz (03:30Z del 25) sigue el periodo 2026-09', async () => {
    mem.periods.length = 0;
    mem.addPeriod('2026-09', '2026-09-25', '2026-10-24', 'ACTIVE');
    mem.addPeriod('2026-10', '2026-10-25', '2026-11-24', 'ACTIVE');
    mem.clock.set(Instant.parse('2026-10-25T03:30:00Z'));
    expect((await spendable()).period.label).toBe('2026-09');
    mem.clock.set(Instant.parse('2026-10-25T04:00:00Z'));
    expect((await spendable()).period.label).toBe('2026-10');
  });

  it('[TC-REPORTING-SPENDABLE-011] sin periodo que cubra hoy usa el mes calendario y no consulta el plan', async () => {
    mem.periods.length = 0;
    const s = await spendable();
    expect(s.period).toEqual({ id: null, label: '2026-10', start: '2026-10-01', end: '2026-10-31' });
    expect(s.budgetView.status).toBe('NO_PLAN');
  });

  it('[TC-REPORTING-SPENDABLE-012] una reserva recién registrada se refleja en la siguiente consulta: 5521.00 → 5021.00 BOB', async () => {
    const before = await spendable();
    expect(text(before.consolidated.total)).toBe('5521.00 BOB');
    mem.reservations[1] = { accountId: 'banco', currency: 'BOB', reserved: '2500.00' };
    const after = await spendable();
    expect(text(after.consolidated.total)).toBe('5021.00 BOB');
    expect(after.period.label).toBe('2026-10');
    expect(after.reportingCurrency).toBe('BOB');
    expect(after.meta.generatedAt).toBe('2026-10-20T14:00:00.000Z');
    expect(after.meta.dataFreshness).toBe('2026-09-30T21:00:00.000Z');
  });

  it('[TC-REPORTING-SPENDABLE-014] expone la métrica reporting_spendable_duration_seconds sin etiquetas', async () => {
    await spendable();
    expect(mem.metricSamples.filter((m) => m.name === 'reporting_spendable_duration_seconds')).toHaveLength(
      1,
    );
  });
});

describe('GetSpendable: tarjetas sin pago programado y resumen del Home', () => {
  it('[TC-REPORTING-SPENDABLE-002] una tarjeta con saldo adeudado sin pago programado se cuenta; con "Pago Tarjeta X" no', async () => {
    expect((await spendable()).cardsWithoutPaymentCount).toBe(0);
    mem.spendableItems.splice(
      mem.spendableItems.findIndex((i) => i.name === 'Pago Tarjeta X'),
      1,
    );
    expect((await spendable()).cardsWithoutPaymentCount).toBe(1);
    mem.balances.set('tarjeta-x', bob('0.00'));
    expect((await spendable()).cardsWithoutPaymentCount).toBe(0);
  });

  it('[TC-REPORTING-SPENDABLE-001] el resumen del Home trae el bloque spendable con las mismas cifras y Q5 disponible', async () => {
    const s = await summary();
    expect(s.spendable).not.toBeNull();
    expect(text(s.spendable?.consolidated.total)).toBe('5521.00 BOB');
    expect(s.questions.find((q) => q.question === 'Q5')).toEqual({
      question: 'Q5',
      status: 'AVAILABLE',
      actionHint: null,
    });
    const detail = await spendable();
    const {
      committedItems: _a,
      reservedByAccount: _b,
      plannedByGoal: _c,
      essentialItems: _d,
      essentialWarnings: _e,
      meta: _m,
      ...base
    } = detail;
    expect(s.spendable).toEqual(base);
  });

  it('[TC-REPORTING-SPENDABLE-006] el resumen reutiliza las tasas del dinero disponible: una sola petición a FX por moneda', async () => {
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '50.00');
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-20T13:00:00Z' });
    mem.rateRequests.length = 0;
    const s = await summary();
    expect(mem.rateRequests.filter((r) => r.base === 'USD')).toHaveLength(1);
    expect(s.meta.ratesUsed.filter((r) => r.rate.base === 'USD')).toHaveLength(1);
    expect(text(s.spendable?.consolidated.total)).toBe('6121.00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-015] sin cuentas Q5 es NO_DATA con CREATE_ACCOUNT y no hay bloque ni 0.00 BOB', async () => {
    mem.accounts.splice(0, mem.accounts.length);
    mem.balances.clear();
    const s = await summary();
    expect(s.spendable).toBeNull();
    expect(s.questions.find((q) => q.question === 'Q5')).toEqual({
      question: 'Q5',
      status: 'NO_DATA',
      actionHint: 'CREATE_ACCOUNT',
    });
  });

  it('[TC-REPORTING-SPENDABLE-015] con cuentas pero ninguna líquida Q5 también es NO_DATA con CREATE_ACCOUNT', async () => {
    mem.accounts.splice(0, mem.accounts.length);
    mem.balances.clear();
    mem.addAccount(
      { accountId: 'tarjeta-x', name: 'Tarjeta X', type: 'CREDIT_CARD', currency: 'BOB' },
      '100.00',
    );
    const s = await summary();
    expect(s.spendable).toBeNull();
    expect(s.questions.find((q) => q.question === 'Q5')?.status).toBe('NO_DATA');
  });

  it('[TC-REPORTING-DASHBOARD-005] ninguna pregunta del Home queda NOT_AVAILABLE_IN_PHASE con Q5 habilitada', async () => {
    const s = await summary();
    expect(s.questions.filter((q) => q.status === 'NOT_AVAILABLE_IN_PHASE')).toEqual([]);
  });

  it('[TC-REPORTING-SPENDABLE-013] un workspace con datos de otro no los suma: las consultas se hacen siempre con el workspaceId del llamador', async () => {
    const seen: string[] = [];
    const deps = mem.deps();
    const wrapped = {
      ...deps,
      spendable: {
        ...deps.spendable!,
        commitments: {
          listForSpendable: async (input: { workspaceId: string; periodFrom: string; periodTo: string }) => {
            seen.push(input.workspaceId);
            return deps.spendable!.commitments.listForSpendable(input);
          },
        },
      },
    };
    await new SpendableQueries(wrapped, wrapped.spendable).getSpendable({ userId: USER, workspaceId: WS });
    expect(seen).toEqual([WS]);
  });
});

const SUPER = 'cat-supermercado';
const TRANSPORTE = 'cat-transporte';

function setSettings(over: Partial<NonNullable<typeof mem.spendableSettings>>) {
  mem.spendableSettings = {
    horizonMode: 'FINANCIAL_PERIOD',
    subtractEssentials: false,
    essentialCategoryIds: [],
    version: 2,
    ...over,
  };
}

function income(name: string, dueDate: string, status: 'SCHEDULED' | 'OVERDUE' = 'SCHEDULED') {
  mem.cashFlowOccurrences.push({
    occurrenceId: `income-${name}-${dueDate}`,
    definitionId: `def-${name}`,
    definitionName: name,
    kind: 'INCOME',
    dueDate,
    status,
    expected: { type: 'FIXED', amount: '8000.00', min: null, max: null, currency: 'BOB' },
    accountId: 'banco',
    toAccountId: null,
    managedBy: 'USER',
    categoryId: null,
  });
}

function plan(periodId: string, lines: { id: string; reference: string; actual: string }[]) {
  mem.budgets.set(periodId, {
    budgetId: `budget-${periodId}`,
    currency: 'BOB',
    lines: lines.map((l) => ({
      target: { kind: 'CATEGORY', id: l.id },
      nature: 'EXPENSE',
      reference: bob(l.reference),
      actual: bob(l.actual),
    })),
    totals: { availableToSpend: bob('0.00'), complete: true },
  });
}

describe('GetSpendable: horizonte hasta el próximo ingreso y esenciales (add-cash-flow-forecast; D377, D378)', () => {
  const node = (categoryId: string, name: string) =>
    ({ categoryId, name, kind: 'EXPENSE', groupId: null, parentId: null, archived: false }) as never;

  beforeEach(() => {
    mem.categoryNodes.push(node(SUPER, 'Supermercado'), node(TRANSPORTE, 'Transporte'));
  });

  it('[TC-REPORTING-FORECAST-022] sin esenciales el disponible no cambia, no hay término e informa el horizonte usado', async () => {
    const s = await spendable();
    expect(s.horizon).toEqual({
      mode: 'FINANCIAL_PERIOD',
      from: '2026-10-01',
      to: '2026-10-31',
      nextIncome: null,
      fallback: false,
    });
    expect(text(s.consolidated.total)).toBe('5521.00 BOB');
    expect(s.byCurrency[0]!.essentials).toBeNull();
    expect(s.essentialItems).toEqual([]);
  });

  it('[TC-REPORTING-FORECAST-023] hasta el próximo ingreso el horizonte termina en el sueldo y el disponible es 5701.00 BOB', async () => {
    setSettings({ horizonMode: 'NEXT_INCOME' });
    income('Sueldo', '2026-10-26');
    const s = await spendable();
    expect(s.horizon).toMatchObject({
      mode: 'NEXT_INCOME',
      from: '2026-10-20',
      to: '2026-10-26',
      fallback: false,
    });
    expect(s.horizon.nextIncome?.name).toBe('Sueldo');
    expect(s.byCurrency[0]!.committed).toEqual(bob('2999.00'));
    expect(text(s.consolidated.total)).toBe('5701.00 BOB');
    expect(mem.spendableRequests.at(-1)).toEqual({ periodFrom: '2026-10-01', periodTo: '2026-10-26' });
  });

  it('[TC-REPORTING-FORECAST-023] un ingreso atrasado sin resolver no fija el horizonte', async () => {
    setSettings({ horizonMode: 'NEXT_INCOME' });
    income('Sueldo', '2026-10-18', 'OVERDUE');
    income('Sueldo', '2026-11-18');
    const s = await spendable();
    expect(s.horizon.to).toBe('2026-11-18');
  });

  it('[TC-REPORTING-FORECAST-024] sin ingreso esperado usa 30 días desde hoy y lo indica', async () => {
    setSettings({ horizonMode: 'NEXT_INCOME' });
    const s = await spendable();
    expect(s.horizon).toMatchObject({
      from: '2026-10-20',
      to: '2026-11-19',
      fallback: true,
      nextIncome: null,
    });
  });

  it('[TC-REPORTING-FORECAST-024] un horizonte que cruza de periodo suma lo planificado completo del periodo siguiente', async () => {
    mem.clock.set(Instant.parse('2026-10-27T14:00:00Z'));
    mem.addPeriod('2026-11', '2026-11-01', '2026-11-30', 'ACTIVE');
    mem.spendableItems.length = 0;
    item('Luz', '2026-10-28', bob('180.00'));
    item('Alquiler', '2026-11-01', bob('2500.00'));
    item('Internet', '2026-11-22', bob('199.00'));
    mem.goalPlansByPeriodStart.set('2026-11-01', [
      { goalId: 'g1', goalName: 'Fondo de emergencia', currency: 'BOB', pending: '1500.00' },
    ]);
    setSettings({ horizonMode: 'NEXT_INCOME' });
    income('Sueldo', '2026-11-05');
    const s = await spendable();
    expect(s.horizon).toMatchObject({ from: '2026-10-27', to: '2026-11-05' });
    expect(s.byCurrency[0]!.committed).toEqual(bob('2680.00'));
    expect(s.byCurrency[0]!.plannedGoalContributions).toEqual(bob('2100.00'));
    expect(text(s.consolidated.total)).toBe('4520.00 BOB');
    expect(s.plannedByGoal).toEqual([
      { goalId: 'g1', goalName: 'Fondo de emergencia', pending: bob('2100.00') },
    ]);
  });

  it('[TC-REPORTING-FORECAST-025] los esenciales restan lo planificado menos lo gastado: 450.00 y disponible 5071.00 BOB', async () => {
    setSettings({ subtractEssentials: true, essentialCategoryIds: [SUPER] });
    plan('period-2026-10', [{ id: SUPER, reference: '1200.00', actual: '750.00' }]);
    const s = await spendable();
    expect(s.byCurrency[0]!.essentials).toEqual(bob('450.00'));
    expect(text(s.consolidated.total)).toBe('5071.00 BOB');
    expect(s.essentialItems).toEqual([
      {
        categoryId: SUPER,
        name: 'Supermercado',
        periodLabel: '2026-10',
        reference: bob('1200.00'),
        actual: bob('750.00'),
        committed: bob('0.00'),
        counted: bob('450.00'),
        prorated: false,
      },
    ]);
  });

  it('[TC-REPORTING-FORECAST-025] un compromiso de la misma categoría no se cuenta dos veces: comprometido 3379.00, esenciales 250.00', async () => {
    setSettings({ subtractEssentials: true, essentialCategoryIds: [SUPER] });
    plan('period-2026-10', [{ id: SUPER, reference: '1200.00', actual: '750.00' }]);
    item('Canasta', '2026-10-25', bob('200.00'), { categoryId: SUPER });
    const s = await spendable();
    expect(s.byCurrency[0]!.committed).toEqual(bob('3379.00'));
    expect(s.byCurrency[0]!.essentials).toEqual(bob('250.00'));
    expect(text(s.consolidated.total)).toBe('5071.00 BOB');
  });

  it('[TC-REPORTING-FORECAST-026] los esenciales de un periodo posterior se prorratean por días: 650.00 y disponible 3870.00 BOB', async () => {
    mem.clock.set(Instant.parse('2026-10-27T14:00:00Z'));
    mem.addPeriod('2026-11', '2026-11-01', '2026-11-30', 'ACTIVE');
    mem.spendableItems.length = 0;
    item('Luz', '2026-10-28', bob('180.00'));
    item('Alquiler', '2026-11-01', bob('2500.00'));
    mem.goalPlansByPeriodStart.set('2026-11-01', [
      { goalId: 'g1', goalName: 'Fondo de emergencia', currency: 'BOB', pending: '1500.00' },
    ]);
    setSettings({ horizonMode: 'NEXT_INCOME', subtractEssentials: true, essentialCategoryIds: [SUPER] });
    income('Sueldo', '2026-11-05');
    plan('period-2026-10', [{ id: SUPER, reference: '1200.00', actual: '750.00' }]);
    plan('period-2026-11', [{ id: SUPER, reference: '1200.00', actual: '0.00' }]);
    const s = await spendable();
    expect(s.byCurrency[0]!.essentials).toEqual(bob('650.00'));
    expect(text(s.consolidated.total)).toBe('3870.00 BOB');
    expect(s.essentialItems.map((i) => [i.periodLabel, i.prorated, i.counted.amount])).toEqual([
      ['2026-10', false, '450.00'],
      ['2026-11', true, '200.00'],
    ]);
  });

  it('[TC-REPORTING-FORECAST-026] una categoría esencial sin línea no resta y se indica', async () => {
    setSettings({ subtractEssentials: true, essentialCategoryIds: [SUPER, TRANSPORTE] });
    plan('period-2026-10', [{ id: SUPER, reference: '1200.00', actual: '750.00' }]);
    const s = await spendable();
    expect(s.byCurrency[0]!.essentials).toEqual(bob('450.00'));
    expect(s.essentialWarnings).toEqual([
      { categoryId: TRANSPORTE, reason: 'NO_LINE', periodLabel: '2026-10' },
    ]);
  });

  it('[TC-REPORTING-FORECAST-026] sin plan del periodo los esenciales no restan y se indica sin plan', async () => {
    setSettings({ subtractEssentials: true, essentialCategoryIds: [SUPER] });
    const s = await spendable();
    expect(s.byCurrency[0]!.essentials).toEqual(bob('0.00'));
    expect(text(s.consolidated.total)).toBe('5521.00 BOB');
    expect(s.essentialWarnings[0]).toMatchObject({ categoryId: SUPER, reason: 'NO_PLAN' });
  });

  it('[TC-REPORTING-FORECAST-022] el resumen del Home usa los mismos ajustes que el detalle', async () => {
    setSettings({ subtractEssentials: true, essentialCategoryIds: [SUPER] });
    plan('period-2026-10', [{ id: SUPER, reference: '1200.00', actual: '750.00' }]);
    const s = await summary();
    expect(text(s.spendable?.consolidated.total)).toBe('5071.00 BOB');
    expect(s.spendable?.horizon.mode).toBe('FINANCIAL_PERIOD');
  });
});
