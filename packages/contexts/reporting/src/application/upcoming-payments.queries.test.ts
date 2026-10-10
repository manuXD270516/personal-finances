import { Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingTransactionRow, UpcomingOccurrenceRow } from './ports/index.js';
import { InMemoryReporting } from './testing/in-memory.js';
import { UpcomingPaymentsQueries } from './upcoming-payments.queries.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const queries = () => new UpcomingPaymentsQueries(mem.upcomingDeps());
const upcoming = async (q: { days?: number; reportingCurrency?: string } = {}) =>
  (await queries().getUpcomingPayments({ userId: USER, workspaceId: WS, ...q })).upcoming;
const amount = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

/** FixedClock 2026-10-20T10:00:00-04:00 (America/La_Paz), USD/BOB PARALLEL 12.00 de paralelo.bo. */
beforeEach(() => {
  mem = new InMemoryReporting();
  mem.clock.set(Instant.parse('2026-10-20T14:00:00Z'));
  mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-20T13:00:00Z' });
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '4000.00');
  mem.addPeriod('2026-10', '2026-10-01', '2026-10-31', 'ACTIVE');
});

let seq = 0;
const occ = (
  name: string,
  dueDate: string,
  value: string | null,
  over: Partial<UpcomingOccurrenceRow> = {},
  currency = 'BOB',
): UpcomingOccurrenceRow => {
  seq += 1;
  const row: UpcomingOccurrenceRow = {
    occurrenceId: `occ-${seq}-${name}`,
    definitionId: `def-${name}`,
    definitionName: name,
    kind: 'EXPENSE',
    dueDate,
    status: dueDate < '2026-10-20' ? 'OVERDUE' : 'SCHEDULED',
    requiresApproval: false,
    expected: { type: value === null ? 'VARIABLE' : 'FIXED', amount: value, min: null, max: null, currency },
    projected: value === null ? null : { amount: value, currency },
    accountId: 'banco',
    toAccountId: null,
    ...over,
  };
  mem.occurrences.push(row);
  return row;
};

const pending = (
  name: string,
  businessDate: string,
  value: string,
  over: Partial<PendingTransactionRow> = {},
): PendingTransactionRow => {
  const row: PendingTransactionRow = {
    transactionId: `txn-${name}`,
    kind: 'EXPENSE',
    businessDate,
    accountId: 'banco',
    toAccountId: null,
    direction: 'OUT',
    amount: { amount: value, currency: 'BOB' },
    description: name,
    externalRef: null,
    ...over,
  };
  mem.pendingTransactions.push(row);
  return row;
};

describe('GetUpcomingPayments: lista y totales (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-UPCOMING-001] la lista de 30 días trae Cena, Internet, Luz y Alquiler con total 3179.00 BOB y la ventana declarada', async () => {
    occ('Internet', '2026-10-22', '199.00');
    occ('Luz', '2026-10-28', '180.00');
    occ('Alquiler', '2026-11-01', '2500.00');
    occ('Seguro anual', '2026-12-15', '900.00');
    pending('Cena', '2026-10-18', '300.00');
    const u = await upcoming({ days: 30 });
    expect(u.window).toEqual({ from: '2026-10-20', to: '2026-11-19', days: 30 });
    expect(u.items.map((i) => i.name)).toEqual(['Cena', 'Internet', 'Luz', 'Alquiler']);
    expect(amount(u.totals.consolidated.amount)).toBe('3179.00 BOB');
    expect(u.totals.byCurrency.map(amount)).toEqual(['3179.00 BOB']);
    expect(u.items[0]).toMatchObject({
      kind: 'PENDING_TRANSACTION',
      accountName: 'Banco BOB',
      status: 'PENDING',
    });
  });

  it('[TC-REPORTING-UPCOMING-001] por defecto la ventana es de 30 días', async () => {
    expect((await upcoming()).window.days).toBe(30);
  });

  it('[TC-REPORTING-UPCOMING-004] 91 días se rechaza con INVALID_FILTER', async () => {
    await expect(upcoming({ days: 91 })).rejects.toMatchObject({ code: 'INVALID_FILTER' });
    await expect(upcoming({ days: 0 })).rejects.toMatchObject({ code: 'INVALID_FILTER' });
  });

  it('[TC-REPORTING-UPCOMING-006] cuatro tipos de monto: total 579.00 BOB y 1 pago sin monto; nunca 0', async () => {
    occ('Internet', '2026-10-22', '199.00');
    occ('Luz', '2026-10-23', '180.00', {
      expected: { type: 'ESTIMATED', amount: '180.00', min: null, max: null, currency: 'BOB' },
    });
    occ('Gimnasio', '2026-10-24', null, {
      expected: { type: 'MIN_MAX', amount: null, min: '150.00', max: '200.00', currency: 'BOB' },
      projected: { amount: '200.00', currency: 'BOB' },
    });
    occ('Agua', '2026-10-25', null);
    const u = await upcoming();
    const by = Object.fromEntries(u.items.map((i) => [i.name, i]));
    expect(by['Luz']).toMatchObject({ estimated: true });
    expect(by['Gimnasio']?.range).toEqual({
      min: { amount: '150.00', currency: 'BOB' },
      max: { amount: '200.00', currency: 'BOB' },
    });
    expect(by['Agua']).toMatchObject({ withoutAmount: true, amount: null, converted: null });
    expect(amount(u.totals.consolidated.amount)).toBe('579.00 BOB');
    expect(u.totals.withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-UPCOMING-009] 199.00 BOB y 5.99 USD consolidan en 270.88 BOB con la tasa 12.00 PARALLEL de paralelo.bo', async () => {
    occ('Internet', '2026-10-22', '199.00');
    occ('Spotify', '2026-10-25', '5.99', {}, 'USD');
    const u = await upcoming();
    expect(u.totals.byCurrency.map(amount)).toEqual(['199.00 BOB', '5.99 USD']);
    expect(amount(u.totals.consolidated.amount)).toBe('270.88 BOB');
    expect(u.totals.consolidated.complete).toBe(true);
    expect(u.meta.rates).toHaveLength(1);
    expect(u.meta.rates[0]).toMatchObject({
      rate: { base: 'USD', quote: 'BOB', value: '12.00' },
      rateType: 'PARALLEL',
    });
    expect(u.meta.attributions[0]?.text).toBe('Fuente: paralelo.bo');
    expect(amount(u.items.find((i) => i.name === 'Spotify')?.converted)).toBe('71.88 BOB');
    // Una sola conversión por moneda, con la tasa vigente al consultar (no al vencimiento).
    expect(mem.rateRequests).toEqual([{ base: 'USD', quote: 'BOB', at: '2026-10-20T14:00:00.000Z' }]);
  });

  it('[TC-REPORTING-UPCOMING-010] sin tasa vigente el USD queda sin convertir y el consolidado es 199.00 BOB incompleto', async () => {
    mem.rates.length = 0;
    occ('Internet', '2026-10-22', '199.00');
    occ('Spotify', '2026-10-25', '5.99', {}, 'USD');
    const u = await upcoming();
    expect(amount(u.totals.consolidated.amount)).toBe('199.00 BOB');
    expect(u.totals.consolidated.complete).toBe(false);
    expect(u.totals.consolidated.unconverted.map(amount)).toEqual(['5.99 USD']);
    expect(u.items.find((i) => i.name === 'Spotify')).toMatchObject({
      amount: { amount: '5.99', currency: 'USD' },
      converted: null,
    });
  });

  it('[TC-REPORTING-UPCOMING-010] una tasa más vieja que la ventana de vigencia no se usa', async () => {
    mem.rates.length = 0;
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-01T13:00:00Z' });
    occ('Spotify', '2026-10-25', '5.99', {}, 'USD');
    const u = await upcoming();
    expect(u.totals.consolidated.complete).toBe(false);
    expect(mem.windowRequests.at(-1)).toBe(7);
  });

  it('[TC-REPORTING-UPCOMING-011] 3.33 + 3.33 USD a 12.005 = 79.95 BOB, no 79.96', async () => {
    mem.rates.length = 0;
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.005', asOf: '2026-10-20T13:00:00Z' });
    occ('A', '2026-10-22', '3.33', {}, 'USD');
    occ('B', '2026-10-23', '3.33', {}, 'USD');
    const u = await upcoming();
    expect(amount(u.totals.consolidated.amount)).toBe('79.95 BOB');
  });

  it('[TC-REPORTING-UPCOMING-012] de noche en La Paz (23:30) la ventana de 7 días termina el 2026-10-27', async () => {
    mem.clock.set(Instant.parse('2026-10-21T03:30:00Z'));
    occ('Agua', '2026-10-27', '60.00');
    occ('Luz', '2026-10-28', '180.00');
    const u = await upcoming({ days: 7 });
    expect(u.window).toEqual({ from: '2026-10-20', to: '2026-10-27', days: 7 });
    expect(u.items.map((i) => i.name)).toEqual(['Agua']);
  });

  it('[TC-REPORTING-UPCOMING-005] Netflix vencido (5 días) va primero y suma: total 248.00 BOB', async () => {
    occ('Internet', '2026-10-22', '199.00');
    occ('Netflix', '2026-10-15', '49.00');
    const u = await upcoming();
    expect(u.items.map((i) => [i.name, i.status, i.daysOverdue])).toEqual([
      ['Netflix', 'OVERDUE', 5],
      ['Internet', 'SCHEDULED', undefined],
    ]);
    expect(amount(u.totals.consolidated.amount)).toBe('248.00 BOB');
  });

  it('[TC-REPORTING-UPCOMING-007] Luz materializada como pendiente se cuenta una vez con 185.40: total 3184.40 BOB', async () => {
    occ('Internet', '2026-10-22', '199.00');
    occ('Alquiler', '2026-11-01', '2500.00');
    pending('Cena', '2026-10-18', '300.00');
    pending('Luz', '2026-10-20', '185.40', {
      externalRef: { namespace: 'commitments.occurrence', id: 'occ-luz' },
    });
    const u = await upcoming();
    expect(u.items.filter((i) => i.name === 'Luz')).toHaveLength(1);
    expect(u.items.find((i) => i.name === 'Luz')).toMatchObject({
      kind: 'PENDING_TRANSACTION',
      occurrenceId: 'occ-luz',
      amount: { amount: '185.40', currency: 'BOB' },
    });
    expect(amount(u.totals.consolidated.amount)).toBe('3184.40 BOB');
  });

  it('[TC-REPORTING-UPCOMING-003] los ingresos pendientes y una transferencia entre cuentas líquidas no se listan', async () => {
    mem.addAccount({ accountId: 'caja', name: 'Caja', type: 'CASH', currency: 'BOB' }, '100.00');
    pending('Sueldo', '2026-10-25', '8000.00', { kind: 'INCOME', direction: 'IN' });
    pending('Entre cajas', '2026-10-25', '90.00', { kind: 'TRANSFER', toAccountId: 'caja' });
    expect((await upcoming()).items).toEqual([]);
  });

  it('[TC-REPORTING-UPCOMING-019] omitir una ocurrencia se refleja en la siguiente consulta; la respuesta declara ventana, moneda y frescura', async () => {
    occ('Internet', '2026-10-22', '199.00');
    const luz = occ('Luz', '2026-10-28', '180.00');
    const before = await queries().getUpcomingPayments({ userId: USER, workspaceId: WS, days: 30 });
    expect(amount(before.upcoming.totals.consolidated.amount)).toBe('379.00 BOB');
    mem.occurrences.splice(mem.occurrences.indexOf(luz), 1);
    mem.version = '1';
    const after = await queries().getUpcomingPayments({ userId: USER, workspaceId: WS, days: 30 });
    expect(after.upcoming.items.map((i) => i.name)).toEqual(['Internet']);
    expect(amount(after.upcoming.totals.consolidated.amount)).toBe('199.00 BOB');
    expect(after.upcoming.window).toMatchObject({ from: '2026-10-20', to: '2026-11-19' });
    expect(after.upcoming.meta).toMatchObject({
      reportingCurrency: 'BOB',
      timeZone: 'America/La_Paz',
      generatedAt: '2026-10-20T14:00:00.000Z',
      dataFreshness: '2026-09-30T21:00:00.000Z',
    });
    expect(after.dataVersion).toBe('1');
  });

  it('una moneda de reporte no habilitada se rechaza con CURRENCY_NOT_ENABLED', async () => {
    const usd = mem.currencies.findIndex((c) => c.code === 'USD');
    mem.currencies[usd] = { ...mem.currencies[usd]!, enabled: false };
    await expect(upcoming({ reportingCurrency: 'USD' })).rejects.toMatchObject({
      code: 'CURRENCY_NOT_ENABLED',
    });
  });

  it('[TC-REPORTING-UPCOMING-022] registra la duración y las filas leídas por consulta', async () => {
    occ('Internet', '2026-10-22', '199.00');
    pending('Cena', '2026-10-18', '300.00');
    await upcoming();
    expect(mem.metricSamples.map((m) => m.name)).toEqual([
      'reporting_upcoming_payments_duration_seconds',
      'reporting_upcoming_payments_rows',
    ]);
    expect(mem.metricSamples[1]?.value).toBe(2);
    expect(mem.metricSamples[0]?.value).toBeGreaterThanOrEqual(0);
  });
});

describe('GetUpcomingPayments: comprometido del periodo (Q4)', () => {
  it('[TC-REPORTING-UPCOMING-013] el comprometido de octubre es 999.88 BOB (699.88 de compromisos y 300.00 de pendientes) con 1 pago sin monto', async () => {
    mem.committed = {
      fromCommitments: [
        { amount: '628.00', currency: 'BOB' },
        { amount: '5.99', currency: 'USD' },
      ],
      fromPending: [{ amount: '300.00', currency: 'BOB' }],
      withoutAmountCount: 1,
      overdueBefore: { count: 0, amounts: [] },
    };
    const c = (await upcoming()).committed!;
    expect(mem.committedRequests).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
    expect(c).toMatchObject({
      periodId: 'period-2026-10',
      label: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(amount(c.total.consolidated.amount)).toBe('999.88 BOB');
    expect(amount(c.fromCommitments.consolidated.amount)).toBe('699.88 BOB');
    expect(amount(c.fromPending.consolidated.amount)).toBe('300.00 BOB');
    expect(c.withoutAmountCount).toBe(1);
  });

  it('[TC-REPORTING-UPCOMING-014] el vencido de un periodo anterior (120.00) se muestra aparte y no suma al total', async () => {
    mem.committed = {
      fromCommitments: [{ amount: '628.00', currency: 'BOB' }],
      fromPending: [{ amount: '300.00', currency: 'BOB' }],
      withoutAmountCount: 0,
      overdueBefore: { count: 1, amounts: [{ amount: '120.00', currency: 'BOB' }] },
    };
    const c = (await upcoming()).committed!;
    expect(amount(c.total.consolidated.amount)).toBe('928.00 BOB');
    expect(c.overdueFromPreviousPeriods.count).toBe(1);
    expect(amount(c.overdueFromPreviousPeriods.consolidated.amount)).toBe('120.00 BOB');
  });

  it('[TC-REPORTING-UPCOMING-015] con día de inicio 25 el 2026-10-20 se consulta el periodo 2026-09 (25 sep a 24 oct)', async () => {
    mem.periods.length = 0;
    mem.addPeriod('2026-09', '2026-09-25', '2026-10-24', 'ACTIVE');
    mem.addPeriod('2026-10', '2026-10-25', '2026-11-24', 'DRAFT');
    mem.committed = {
      fromCommitments: [{ amount: '368.00', currency: 'BOB' }],
      fromPending: [{ amount: '300.00', currency: 'BOB' }],
      withoutAmountCount: 0,
      overdueBefore: { count: 0, amounts: [] },
    };
    const c = (await upcoming()).committed!;
    expect(mem.committedRequests).toEqual([{ from: '2026-09-25', to: '2026-10-24' }]);
    expect(c.label).toBe('2026-09');
    expect(amount(c.total.consolidated.amount)).toBe('668.00 BOB');
  });

  it('sin un periodo que cubra hoy el bloque comprometido es null y la lista sigue funcionando', async () => {
    mem.periods.length = 0;
    occ('Internet', '2026-10-22', '199.00');
    const u = await upcoming();
    expect(u.committed).toBeNull();
    expect(u.items).toHaveLength(1);
  });
});

describe('GetUpcomingPayments: saldo proyectado (FR-LEDGER-013)', () => {
  it('[TC-REPORTING-UPCOMING-016] Banco 4000.00 con gasto 300.00 e ingreso 150.00 pendientes proyecta 3850.00; Wallet USDT 50.000000', async () => {
    mem.addAccount(
      { accountId: 'wallet', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' },
      '50.000000',
    );
    pending('Cena', '2026-10-18', '300.00');
    pending('Reembolso seguro', '2026-10-19', '150.00', { kind: 'INCOME', direction: 'IN' });
    occ('Internet', '2026-10-22', '199.00');
    const { projectedBalances } = await upcoming({ days: 30 });
    expect(projectedBalances.map((p) => [p.accountName, amount(p.booked), amount(p.projected)])).toEqual([
      ['Banco BOB', '4000.00 BOB', '3850.00 BOB'],
      ['Wallet USDT', '50.000000 USDT', '50.000000 USDT'],
    ]);
    expect(amount(projectedBalances[0]?.pendingIn)).toBe('150.00 BOB');
    expect(amount(projectedBalances[0]?.pendingOut)).toBe('300.00 BOB');
  });

  it('el saldo proyectado incluye las pendientes con fecha fuera de la ventana de la lista', async () => {
    pending('Futuro', '2027-03-01', '100.00');
    const u = await upcoming({ days: 7 });
    expect(u.items).toEqual([]);
    expect(amount(u.projectedBalances[0]?.projected)).toBe('3900.00 BOB');
  });
});

describe('GetUpcomingPayments: hasCommitments', () => {
  it('es false sin definiciones activas ni pendientes de egreso, y true con cualquiera', async () => {
    expect((await upcoming()).hasCommitments).toBe(false);
    mem.hasActiveDefinitions = true;
    expect((await upcoming()).hasCommitments).toBe(true);
    mem.hasActiveDefinitions = false;
    pending('Cena', '2026-10-18', '300.00');
    expect((await upcoming()).hasCommitments).toBe(true);
  });
});

describe('GetSurprisePayments (SM-07)', () => {
  const resolved = (name: string, transactionDate: string, generatedAt: string, value: string) =>
    mem.resolvedOutflows.push({
      occurrenceId: `occ-${name}`,
      definitionId: `def-${name}`,
      definitionName: name,
      generatedAt,
      transactionId: `txn-${name}`,
      transactionDate,
      amount: { amount: value, currency: 'BOB' },
    });

  it('[TC-REPORTING-UPCOMING-021] Seguro auto (modelado el 12, pagado el 5) cuenta como sorpresa; Internet no; el periodo en curso es parcial', async () => {
    resolved('Seguro auto', '2026-10-05', '2026-10-12T15:00:00Z', '350.00');
    resolved('Internet', '2026-10-22', '2026-07-24T10:00:00Z', '199.00');
    const r = await queries().getSurprisePayments({ userId: USER, workspaceId: WS, period: '2026-10' });
    expect(r).toMatchObject({
      label: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
      partial: true,
      count: 1,
      note: 'UNLINKED_PAYMENTS_NOT_DETECTED',
    });
    expect(r.items).toEqual([
      expect.objectContaining({
        name: 'Seguro auto',
        date: '2026-10-05',
        amount: { amount: '350.00', currency: 'BOB' },
        generatedOn: '2026-10-12',
      }),
    ]);
  });

  it('[TC-REPORTING-UPCOMING-021] un periodo terminado sin sorpresas informa 0 sin marca de parcial', async () => {
    mem.addPeriod('2026-09', '2026-09-01', '2026-09-30');
    resolved('Internet', '2026-09-22', '2026-06-24T10:00:00Z', '199.00');
    const r = await queries().getSurprisePayments({ userId: USER, workspaceId: WS, period: '2026-09' });
    expect(r).toMatchObject({ count: 0, partial: false, items: [] });
  });

  it('[TC-REPORTING-UPCOMING-021] sin parámetro usa el periodo que contiene hoy; uno inexistente es RESOURCE_NOT_FOUND', async () => {
    const current = await queries().getSurprisePayments({ userId: USER, workspaceId: WS });
    expect(current.label).toBe('2026-10');
    await expect(
      queries().getSurprisePayments({ userId: USER, workspaceId: WS, period: '2030-01' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
