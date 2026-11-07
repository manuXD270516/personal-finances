import { currency as makeCurrency, DomainError, Instant, Money } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { CashFlowCalendarQueries } from './cash-flow-calendar.queries.js';
import type { CashFlowOccurrenceRow, PendingTransactionRow } from './ports/index.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const text = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

const calendar = async (query: { horizon?: number; accountId?: string } = {}) =>
  (
    await new CashFlowCalendarQueries(mem.upcomingDeps()).getCashFlowCalendar({
      userId: USER,
      workspaceId: WS,
      ...query,
    })
  ).calendar;
const summary = async () =>
  (await new ReportSummaryQueries(mem.upcomingDeps()).getReportSummary({ userId: USER, workspaceId: WS }))
    .summary;
const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
  return undefined;
};

let seq = 0;
function occurrence(
  name: string,
  dueDate: string,
  amount: string | null,
  over: Partial<CashFlowOccurrenceRow> & { currency?: string } = {},
): CashFlowOccurrenceRow {
  seq += 1;
  const { currency = 'BOB', ...rest } = over;
  const row: CashFlowOccurrenceRow = {
    occurrenceId: `occ-${String(seq).padStart(3, '0')}`,
    definitionId: `def-${seq}`,
    definitionName: name,
    kind: 'EXPENSE',
    dueDate,
    status: 'SCHEDULED',
    expected: { type: amount === null ? 'VARIABLE' : 'FIXED', amount, min: null, max: null, currency },
    accountId: 'banco',
    toAccountId: null,
    managedBy: 'USER',
    categoryId: null,
    ...rest,
  };
  mem.cashFlowOccurrences.push(row);
  return row;
}

function pending(
  name: string,
  businessDate: string,
  amount: string,
  over: Partial<PendingTransactionRow> = {},
) {
  seq += 1;
  mem.pendingTransactions.push({
    transactionId: `txn-${seq}`,
    kind: 'EXPENSE',
    businessDate,
    accountId: 'banco',
    toAccountId: null,
    direction: 'OUT',
    amount: bob(amount),
    description: name,
    externalRef: null,
    ...over,
  });
}

/**
 * Datos de la spec "Saldo esperado de octubre y noviembre" (FixedClock 2026-10-20T10:00:00-04:00, La Paz): "Banco BOB"
 * 4000.00 y "Efectivo BOB" 500.00; pendiente "Cena" 300.00 del 2026-10-18; ocurrencias "Internet" 199.00 (10-22), "Luz"
 * ESTIMATED 180.00 (10-28), ingreso "Sueldo" 8000.00 (10-31), "Alquiler" 2500.00 (11-01) y pago de tarjeta 1120.50 (11-15).
 */
beforeEach(() => {
  seq = 0;
  mem = new InMemoryReporting();
  mem.spendableEnabled = true;
  mem.clock.set(Instant.parse('2026-10-20T14:00:00Z'));
  mem.hasActiveDefinitions = true;
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '4000.00');
  mem.addAccount({ accountId: 'efectivo', name: 'Efectivo BOB', type: 'CASH', currency: 'BOB' }, '500.00');
  mem.addAccount({ accountId: 'visa', name: 'Visa Oro BOB', type: 'CREDIT_CARD', currency: 'BOB' }, '0.00');
  mem.addAccount(
    { accountId: 'plazo', name: 'Plazo fijo', type: 'SAVINGS', currency: 'BOB', liquidity: 'ILLIQUID' },
    '10000.00',
  );
  mem.addPeriod('2026-10', '2026-10-01', '2026-10-31', 'ACTIVE');
  mem.addPeriod('2026-11', '2026-11-01', '2026-11-30', 'ACTIVE');
  pending('Cena', '2026-10-18', '300.00');
  occurrence('Internet', '2026-10-22', '199.00');
  occurrence('Luz', '2026-10-28', '180.00', {
    expected: { type: 'ESTIMATED', amount: '180.00', min: null, max: null, currency: 'BOB' },
  });
  occurrence('Sueldo', '2026-10-31', '8000.00', { kind: 'INCOME' });
  occurrence('Alquiler', '2026-11-01', '2500.00');
  occurrence('Pago de tarjeta · Visa Oro', '2026-11-15', '1120.50', {
    kind: 'CARD_PAYMENT',
    toAccountId: 'visa',
  });
});

const bobCurrency = (c: Awaited<ReturnType<typeof calendar>>) =>
  c.currencies.find((x) => x.currency === 'BOB')!;
const balanceOn = (c: Awaited<ReturnType<typeof calendar>>, date: string) =>
  text(bobCurrency(c).series.find((p) => p.date === date)?.balance);

describe('GetCashFlowCalendar: horizonte y fecha local (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-FORECAST-001] el calendario de 30 días va de hoy a hoy + 30 con un punto por día y un horizonte no admitido se rechaza', async () => {
    const c = await calendar();
    expect(c).toMatchObject({
      horizonDays: 30,
      today: '2026-10-20',
      from: '2026-10-20',
      to: '2026-11-19',
      reportingCurrency: 'BOB',
    });
    expect(bobCurrency(c).series).toHaveLength(31);
    for (const horizon of [7, 60, 90]) expect((await calendar({ horizon })).horizonDays).toBe(horizon);
    expect(await codeOf(() => calendar({ horizon: 45 }))).toBe('INVALID_FILTER');
    expect(await codeOf(() => calendar({ horizon: 0 }))).toBe('INVALID_FILTER');
  });

  it('[TC-REPORTING-FORECAST-002] "hoy" es la fecha local del workspace y no la fecha UTC', async () => {
    mem.clock.set(Instant.parse('2026-10-21T03:30:00Z'));
    const c = await calendar({ horizon: 7 });
    expect(c).toMatchObject({ today: '2026-10-20', from: '2026-10-20', to: '2026-10-27' });
  });
});

describe('GetCashFlowCalendar: saldo esperado, riesgo y consolidado', () => {
  it('[TC-REPORTING-FORECAST-003] el saldo esperado de octubre y noviembre sale de las lecturas de COMMITMENTS y TRANSACTIONS', async () => {
    const c = await calendar();
    const b = bobCurrency(c);
    expect(text(b.startBalance)).toBe('4500.00 BOB');
    expect(balanceOn(c, '2026-10-20')).toBe('4200.00 BOB');
    expect(balanceOn(c, '2026-10-28')).toBe('3821.00 BOB');
    expect(balanceOn(c, '2026-11-01')).toBe('9321.00 BOB');
    expect(text(b.endBalance)).toBe('8200.50 BOB');
    expect(text(b.lowest.amount)).toBe('3821.00 BOB');
    expect(b.lowest.date).toBe('2026-10-28');
    expect(c.events.map((e) => e.name)).not.toContain('Seguro anual');
  });

  it('[TC-REPORTING-FORECAST-004] lo vencido sin resolver se aplica hoy con sus días de atraso', async () => {
    occurrence('Netflix', '2026-10-15', '49.00', { status: 'OVERDUE' });
    const c = await calendar();
    expect(balanceOn(c, '2026-10-20')).toBe('4151.00 BOB');
    expect(c.events.find((e) => e.name === 'Netflix')).toMatchObject({
      date: '2026-10-20',
      originalDate: '2026-10-15',
      overdue: true,
      daysOverdue: 5,
      source: 'OCCURRENCE',
      sourceRef: { context: 'COMMITMENTS' },
    });
  });

  it('[TC-REPORTING-FORECAST-007] los rangos usan el máximo en egresos y el mínimo en ingresos, y los variables se cuentan aparte', async () => {
    mem.cashFlowOccurrences.length = 0;
    occurrence('Gimnasio', '2026-10-25', null, {
      expected: { type: 'MIN_MAX', amount: null, min: '150.00', max: '200.00', currency: 'BOB' },
    });
    occurrence('Freelance', '2026-10-26', null, {
      kind: 'INCOME',
      expected: { type: 'MIN_MAX', amount: null, min: '1000.00', max: '3000.00', currency: 'BOB' },
    });
    occurrence('Agua', '2026-10-27', null);
    mem.pendingTransactions.length = 0;
    const c = await calendar();
    expect(text(bobCurrency(c).endBalance)).toBe('5300.00 BOB');
    expect(bobCurrency(c).withoutAmountCount).toBe(1);
    expect(c.events.find((e) => e.name === 'Agua')).toMatchObject({ amount: null, certainty: 'ESTIMATED' });
  });

  it('[TC-REPORTING-FORECAST-009] el riesgo contra la reserva mínima informa primera fecha, faltante y mínimo negativo', async () => {
    mem.balances.set('banco', bob('2000.00'));
    mem.cashFlowOccurrences.splice(
      mem.cashFlowOccurrences.findIndex((o) => o.definitionName === 'Sueldo'),
      1,
      occurrence('Sueldo', '2026-11-01', '8000.00', { kind: 'INCOME' }),
    );
    mem.minimumReserve = bob('1500.00');
    const b = bobCurrency(await calendar());
    expect(text(b.lowest.amount)).toBe('-679.00 BOB');
    expect(b).toMatchObject({ risk: 'HIGH', firstShortfallDate: '2026-11-01', belowZero: true });
    expect(text(b.shortfallAmount)).toBe('2179.00 BOB');
    expect(b.threshold.source).toBe('MINIMUM_RESERVE');
  });

  it('[TC-REPORTING-FORECAST-011] el gasto planificado restante del plan se reparte por día sin doble conteo y el periodo sin plan se indica', async () => {
    mem.minimumReserve = bob('3500.00');
    mem.categoryNodes.push({
      categoryId: 'super',
      name: 'Supermercado',
      kind: 'EXPENSE',
      groupId: null,
      parentId: null,
      archived: false,
    } as never);
    mem.budgets.set('period-2026-10', {
      budgetId: 'budget-1',
      currency: 'BOB',
      lines: [
        {
          target: { kind: 'CATEGORY', id: 'super' },
          nature: 'EXPENSE',
          reference: bob('1200.00'),
          actual: bob('600.00'),
        },
      ],
      totals: { availableToSpend: bob('0.00'), complete: true },
    });
    const c = await calendar();
    const b = bobCurrency(c);
    expect(text(b.planned?.lowest.amount)).toBe('3221.00 BOB');
    expect(b.planned?.lowest.date).toBe('2026-10-31');
    expect(b.risk).toBe('POSSIBLE');
    expect(b.firstShortfallDate).toBe('2026-10-28');
    expect(c.plannedSpending.periods).toEqual([
      { periodId: 'period-2026-10', label: '2026-10', status: 'PLAN' },
      { periodId: 'period-2026-11', label: '2026-11', status: 'NO_PLAN' },
    ]);
    // Con una ocurrencia de la misma categoría el reparto baja a 30.00 por día y la principal no cambia.
    occurrence('Canasta', '2026-10-25', '240.00', { categoryId: 'super' });
    const withCanasta = bobCurrency(await calendar());
    expect(text(withCanasta.planned?.series.find((p) => p.date === '2026-10-20')?.balance)).toBe(
      '4170.00 BOB',
    );
    expect(text(withCanasta.endBalance)).toBe('7960.50 BOB');
  });

  it('[TC-REPORTING-FORECAST-012] el peor caso sin ingresos esperados se informa sin cambiar el riesgo', async () => {
    mem.minimumReserve = bob('1500.00');
    const b = bobCurrency(await calendar());
    expect(text(b.withoutExpectedIncome.lowest.amount)).toBe('200.50 BOB');
    expect(b.withoutExpectedIncome.lowest.date).toBe('2026-11-15');
    expect(b.risk).toBe('NONE');
  });

  it('[TC-REPORTING-FORECAST-014] el mínimo consolidado convierte USD con la tasa vigente y sin tasa queda incompleto', async () => {
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '100.00');
    occurrence('Spotify', '2026-10-25', '5.99', { accountId: 'caja-usd', currency: 'USD' });
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-19T12:00:00Z' });
    const ok = await calendar();
    expect(text(ok.consolidated.lowest?.amount)).toBe('4949.12 BOB');
    expect(ok.consolidated.lowest?.date).toBe('2026-10-28');
    expect(ok.consolidated.complete).toBe(true);
    expect(ok.meta.ratesUsed).toHaveLength(1);
    mem.rates.length = 0;
    const none = await calendar();
    expect(text(none.consolidated.lowest?.amount)).toBe('3821.00 BOB');
    expect(none.consolidated.complete).toBe(false);
    expect(none.consolidated.unconverted.map(text)).toEqual(['94.01 USD']);
  });

  it('[TC-REPORTING-FORECAST-015] si el motor genera ocurrencias hasta 60 días el calendario de 90 días se marca con cobertura incompleta', async () => {
    mem.generatedThrough = '2026-12-19';
    const c = await calendar({ horizon: 90 });
    expect(c.to).toBe('2027-01-18');
    expect(c.coverage).toEqual({ through: '2026-12-19', complete: false });
    expect((await calendar({ horizon: 30 })).coverage).toEqual({ through: '2026-11-19', complete: true });
  });

  it('[TC-REPORTING-FORECAST-016] un déficit en BOB cubrible con USD sugiere convertir el equivalente aproximado antes de la fecha', async () => {
    mem.balances.set('banco', bob('2000.00'));
    mem.cashFlowOccurrences.splice(
      mem.cashFlowOccurrences.findIndex((o) => o.definitionName === 'Sueldo'),
      1,
      occurrence('Sueldo', '2026-11-01', '8000.00', { kind: 'INCOME' }),
    );
    mem.minimumReserve = bob('1500.00');
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '400.00');
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-19T12:00:00Z' });
    const c = await calendar();
    expect(c.suggestions).toHaveLength(1);
    expect(c.suggestions[0]).toMatchObject({ fromCurrency: 'USD', toCurrency: 'BOB', before: '2026-11-01' });
    expect(text(c.suggestions[0]!.approxAmount)).toBe('181.58 USD');
  });
});

describe('GetCashFlowCalendar: serie por cuenta', () => {
  it('[TC-REPORTING-FORECAST-013] la serie de cada cuenta suma la de su moneda y la serie solo viene al pedir la cuenta', async () => {
    occurrence('Ahorro mensual', '2026-10-25', '500.00', { kind: 'TRANSFER', toAccountId: 'efectivo' });
    const withoutAccount = await calendar();
    expect(withoutAccount.accounts.every((a) => a.series === null)).toBe(true);
    const banco = (await calendar({ accountId: 'banco' })).accounts.find((a) => a.accountId === 'banco')!;
    const efectivo = (await calendar({ accountId: 'efectivo' })).accounts.find(
      (a) => a.accountId === 'efectivo',
    )!;
    expect(text(banco.endBalance)).toBe('7200.50 BOB');
    expect(text(banco.lowest.amount)).toBe('2821.00 BOB');
    expect(banco.lowest.date).toBe('2026-10-28');
    expect(text(efectivo.series?.find((p) => p.date === '2026-10-25')?.balance)).toBe('1000.00 BOB');
    const total = bobCurrency(withoutAccount).series.map((p) => p.balance.amount);
    const dec = (m: { amount: string }) => Money.parse(m.amount, makeCurrency('BOB', 2));
    const sum = banco.series!.map((p, i) => dec(p.balance).add(dec(efectivo.series![i]!.balance)).toFixed());
    expect(sum).toEqual(total);
    expect(withoutAccount.accounts.map((a) => a.accountId).sort()).toEqual(['banco', 'efectivo']);
  });

  it('[TC-REPORTING-FORECAST-013] una cuenta no líquida, archivada o inexistente pedida se rechaza con INVALID_FILTER', async () => {
    expect(await codeOf(() => calendar({ accountId: 'plazo' }))).toBe('INVALID_FILTER');
    expect(await codeOf(() => calendar({ accountId: 'otro-workspace' }))).toBe('INVALID_FILTER');
  });
});

describe('Resumen del Home: bloque cashFlow de la tarjeta Q8', () => {
  beforeEach(() => {
    mem.cashFlowOccurrences.length = 0;
    mem.pendingTransactions.length = 0;
  });

  it('[TC-REPORTING-FORECAST-017] con riesgo alto muestra la moneda con su mínimo y su fecha', async () => {
    mem.balances.set('banco', bob('2000.00'));
    pending('Cena', '2026-10-18', '300.00');
    occurrence('Internet', '2026-10-22', '199.00');
    occurrence('Luz', '2026-10-28', '180.00');
    occurrence('Alquiler', '2026-11-01', '2500.00');
    occurrence('Sueldo', '2026-11-01', '8000.00', { kind: 'INCOME' });
    occurrence('Pago de tarjeta · Visa Oro', '2026-11-15', '1120.50', {
      kind: 'CARD_PAYMENT',
      toAccountId: 'visa',
    });
    mem.minimumReserve = bob('1500.00');
    const block = (await summary()).cashFlow!;
    expect(block.horizonDays).toBe(30);
    expect(block.worst).toMatchObject({ currency: 'BOB', risk: 'HIGH', lowestDate: '2026-11-01' });
    expect(text(block.worst?.lowest)).toBe('-679.00 BOB');
    expect(text(block.consolidatedLowest?.amount)).toBe('-679.00 BOB');
  });

  it('[TC-REPORTING-FORECAST-017] sin riesgo muestra el saldo más bajo consolidado con su fecha', async () => {
    pending('Cena', '2026-10-18', '300.00');
    occurrence('Internet', '2026-10-22', '199.00');
    occurrence('Luz', '2026-10-28', '180.00');
    occurrence('Sueldo', '2026-10-31', '8000.00', { kind: 'INCOME' });
    occurrence('Alquiler', '2026-11-01', '2500.00');
    mem.minimumReserve = bob('1500.00');
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '100.00');
    occurrence('Spotify', '2026-10-25', '5.99', { accountId: 'caja-usd', currency: 'USD' });
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-19T12:00:00Z' });
    const block = (await summary()).cashFlow!;
    expect(block.worst).toBeNull();
    expect(text(block.consolidatedLowest?.amount)).toBe('4949.12 BOB');
    expect(block.consolidatedLowest?.date).toBe('2026-10-28');
  });

  it('[TC-REPORTING-FORECAST-017] sin cuentas líquidas la tarjeta no trae saldo esperado ni riesgo', async () => {
    mem.accounts.length = 0;
    mem.balances.clear();
    mem.addAccount({ accountId: 'visa', name: 'Visa Oro BOB', type: 'CREDIT_CARD', currency: 'BOB' }, '0.00');
    expect((await summary()).cashFlow).toBeNull();
  });

  it('[TC-REPORTING-FORECAST-017] el resumen reutiliza las tasas y no pide a FX más de una resolución para el bloque', async () => {
    mem.addAccount({ accountId: 'caja-usd', name: 'Caja USD', type: 'CASH', currency: 'USD' }, '100.00');
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-19T12:00:00Z' });
    await summary();
    const pairs = mem.rateRequests.filter(
      (r) => r.base === 'USD' && r.quote === 'BOB' && r.at === mem.clock.now().toString(),
    );
    expect(pairs.length).toBeLessThanOrEqual(1);
  });
});

describe('GetCashFlowCalendar: lectura inmediata y frescura', () => {
  it('[TC-REPORTING-FORECAST-020] omitir una ocurrencia se refleja en la siguiente consulta y la respuesta declara su frescura', async () => {
    const before = await calendar();
    expect(balanceOn(before, '2026-10-28')).toBe('3821.00 BOB');
    mem.cashFlowOccurrences.splice(
      mem.cashFlowOccurrences.findIndex((o) => o.definitionName === 'Luz'),
      1,
    );
    mem.version = '7';
    const after = await new CashFlowCalendarQueries(mem.upcomingDeps()).getCashFlowCalendar({
      userId: USER,
      workspaceId: WS,
    });
    expect(balanceOn(after.calendar, '2026-10-28')).toBe('4001.00 BOB');
    expect(text(bobCurrency(after.calendar).endBalance)).toBe('8380.50 BOB');
    expect(after.dataVersion).toBe('7');
    expect(after.calendar).toMatchObject({ from: '2026-10-20', to: '2026-11-19', reportingCurrency: 'BOB' });
    expect(after.calendar.meta.generatedAt).toBe(mem.clock.now().toString());
    expect(after.calendar.meta.dataFreshness).toBeDefined();
  });

  it('[TC-REPORTING-FORECAST-020] un workspace sin movimientos devuelve el saldo inicial plano', async () => {
    mem.cashFlowOccurrences.length = 0;
    mem.pendingTransactions.length = 0;
    const c = await calendar({ horizon: 7 });
    expect(bobCurrency(c).series.every((p) => p.balance.amount === '4500.00')).toBe(true);
    expect(c.events).toEqual([]);
  });
});
