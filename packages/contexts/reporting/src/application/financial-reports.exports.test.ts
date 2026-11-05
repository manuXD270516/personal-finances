import { DomainError, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { FinancialReportsService } from './financial-reports.exports.js';
import { InMemoryFinancialReports, type PortionFact } from './testing/in-memory-reports.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';
const BANCO = '0190a000-0000-7000-8000-0000000000b1';
const EFECTIVO = '0190a000-0000-7000-8000-0000000000b2';
const TARJETA = '0190a000-0000-7000-8000-0000000000b3';
const SUPER = '0190a000-0000-7000-8000-0000000000c1';
const FARMACIA = '0190a000-0000-7000-8000-0000000000c3';
const GROUP = '0190a000-0000-7000-8000-0000000000d1';

let mem: InMemoryFinancialReports;
let svc: FinancialReportsService;
const base = { userId: USER, workspaceId: WS };
const bob = (amount: string) => ({ amount, currency: 'BOB' });

let seq = 0;
function portion(date: string, categoryId: string, amount: string, over: Partial<PortionFact> = {}) {
  seq += 1;
  mem.portions.push({
    transactionId: `0190a111-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    splitId: `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    businessDate: date,
    nature: 'EXPENSE',
    categoryId,
    accountId: BANCO,
    counterpartyId: null,
    description: null,
    amount: bob(amount),
    tagIds: [],
    ...over,
  });
}

beforeEach(() => {
  seq = 0;
  mem = new InMemoryFinancialReports();
  mem.clock.set(Instant.parse('2026-11-15T16:00:00Z'));
  mem.addAccount({ accountId: BANCO, name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  mem.addAccount({ accountId: EFECTIVO, name: 'Efectivo', type: 'CASH', currency: 'BOB' }, null);
  mem.addAccount({ accountId: TARJETA, name: 'Tarjeta Andina', type: 'CREDIT_CARD', currency: 'BOB' }, null);
  mem.tree = {
    groups: [{ groupId: GROUP, name: 'Alimentación', kind: 'EXPENSE', archived: false }],
    categories: [
      {
        categoryId: SUPER,
        name: 'Supermercado',
        kind: 'EXPENSE',
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: FARMACIA,
        name: 'Farmacia',
        kind: 'EXPENSE',
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
    ],
    tags: [],
  };
  svc = new FinancialReportsService(mem.financialDeps());
});

describe('GetReportDrillDown', () => {
  it('[TC-REPORTING-REPORTS-018] "Supermercado" de octubre lista 2 porciones de 3500.00 y −200.00 que suman 3300.00 BOB (la cifra de la celda)', async () => {
    portion('2026-10-10', SUPER, '3500.00');
    portion('2026-10-12', SUPER, '-200.00');
    const page = await svc.getDrillDown({
      ...base,
      report: 'EXPENSES_BY_CATEGORY',
      from: '2026-10-01',
      to: '2026-10-31',
      categoryIds: [SUPER],
    });
    expect(page.report.kind).toBe('PORTION');
    expect(page.report.rows.map((r) => r.amount.amount)).toEqual(['-200.00', '3500.00']);
    expect(page.report.totals.consolidated).toEqual(bob('3300.00'));
    expect(page.report.count).toBe(2);
    const cell = await svc.getExpensesByCategory({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(cell.report.groups[0]?.categories[0]?.amount.consolidated).toEqual(
      page.report.totals.consolidated,
    );
    expect(page.report.rows[0]?.valued).toEqual(bob('-200.00'));
  });

  it('[TC-REPORTING-REPORTS-018] una compra de 600.00 repartida lista solo la porción de 400.00 con el enlace a su transacción', async () => {
    portion('2026-11-03', SUPER, '400.00');
    portion('2026-11-03', FARMACIA, '200.00');
    const page = await svc.getDrillDown({
      ...base,
      report: 'EXPENSES_BY_CATEGORY',
      from: '2026-11-01',
      to: '2026-11-30',
      categoryIds: [SUPER],
    });
    expect(page.report.rows).toHaveLength(1);
    expect(page.report.rows[0]).toMatchObject({
      amount: bob('400.00'),
      transactionId: expect.stringMatching(/^0190a111/u),
    });
  });

  it('[TC-REPORTING-REPORTS-019] la celda filtrada por "Tarjeta Andina" lista solo sus porciones, que suman 500.00', async () => {
    portion('2026-10-10', SUPER, '3300.00');
    portion('2026-10-18', SUPER, '500.00', { accountId: TARJETA });
    const page = await svc.getDrillDown({
      ...base,
      report: 'INCOME_EXPENSES',
      nature: 'EXPENSE',
      from: '2026-10-01',
      to: '2026-10-31',
      accountIds: [TARJETA],
    });
    expect(page.report.rows.every((r) => r.accountId === TARJETA)).toBe(true);
    expect(page.report.totals.consolidated).toEqual(bob('500.00'));
  });

  it('[TC-REPORTING-REPORTS-019] 120 porciones en páginas de 50 dan 50, 50 y 20 filas sin repetidos y con los mismos totales', async () => {
    for (let i = 0; i < 120; i += 1)
      portion(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`, SUPER, '10.00');
    const seen = new Set<string>();
    const sizes: number[] = [];
    const totals = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await svc.getDrillDown({
        ...base,
        report: 'EXPENSES_BY_CATEGORY',
        from: '2026-10-01',
        to: '2026-10-31',
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      sizes.push(page.report.rows.length);
      page.report.rows.forEach((r) => seen.add(r.splitId as string));
      totals.add(page.report.totals.consolidated.amount);
      cursor = page.report.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.size).toBe(120);
    expect([...totals]).toEqual(['1200.00']);
  });

  it('[TC-REPORTING-REPORTS-019] limit fuera de 1..200 es VALIDATION_FAILED', async () => {
    await expect(
      svc.getDrillDown({
        ...base,
        report: 'EXPENSES_BY_CATEGORY',
        from: '2026-10-01',
        to: '2026-10-31',
        limit: 201,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('[TC-REPORTING-REPORTS-020] el componente deuda lista el pago de tarjeta de −500.00 y el día 10 del historial lista el movimiento de −3500.00', async () => {
    mem.entry('t1', '2026-10-20', [
      { account: BANCO, currency: 'BOB', amount: '-500.00' },
      { account: TARJETA, currency: 'BOB', amount: '500.00' },
    ]);
    mem.entry('g1', '2026-10-10', [
      { account: BANCO, currency: 'BOB', amount: '-3500.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '3500.00' },
    ]);
    const debt = await svc.getDrillDown({
      ...base,
      report: 'CASH_FLOW',
      component: 'debt',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(debt.report.kind).toBe('LIQUIDITY_MOVEMENT');
    expect(debt.report.rows.map((r) => [r.amount.amount, r.transactionId])).toEqual([['-500.00', 't1']]);
    expect(debt.report.totals.consolidated).toEqual(bob('-500.00'));
    const day = await svc.getDrillDown({
      ...base,
      report: 'ACCOUNT_BALANCE_HISTORY',
      accountId: BANCO,
      date: '2026-10-10',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(day.report.kind).toBe('ACCOUNT_MOVEMENT');
    expect(day.report.rows.map((r) => r.amount.amount)).toEqual(['-3500.00']);
  });
});

describe('Exportación CSV', () => {
  const income = { ...base, from: '2026-10-01', to: '2026-10-31' };

  it('[TC-REPORTING-REPORTS-021] ingresos y gastos de octubre: fila BOB nativa, fila USD nativa y fila consolidada con 8200.00 y 68.3', async () => {
    mem.portions.push(
      { ...basePortion('2026-10-05'), nature: 'INCOME', amount: bob('12000.00') },
      { ...basePortion('2026-10-10'), amount: bob('3300.00') },
      { ...basePortion('2026-10-15'), amount: { amount: '50.00', currency: 'USD' } },
    );
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-10-15T20:00:00Z' });
    const file = await svc.exportIncomeExpenses(income);
    const text = file.body.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'period_label,period_from,period_to,partial,row_kind,currency,income,expenses,savings,savings_rate,conversion_policy,reporting_currency,complete',
    );
    expect(lines[1]).toContain(',NATIVE,BOB,12000.00,3300.00,8700.00,');
    expect(lines[2]).toContain(',NATIVE,USD,0.00,50.00,-50.00,');
    expect(lines[3]).toContain(',CONSOLIDATED,BOB,12000.00,3800.00,8200.00,68.3,TRANSACTION_DATE,BOB,true');
    expect(file.fileName).toBe('income-expenses-2026-10-01-2026-10-31.csv');
  });

  it('[TC-REPORTING-REPORTS-021] una exportación de más de 50 000 filas se rechaza con REPORT_EXPORT_TOO_LARGE y no deja auditoría', async () => {
    for (let i = 0; i < 50_001; i += 1) {
      mem.entry(
        `e${i}`,
        '2026-10-10',
        [
          { account: BANCO, currency: 'BOB', amount: '1.00' },
          { account: 'SYSTEM:INCOME', currency: 'BOB', amount: '-1.00' },
        ],
        null,
      );
    }
    let thrown: unknown;
    try {
      await svc.exportDrillDown({
        ...income,
        report: 'ACCOUNT_BALANCE_HISTORY',
        accountId: BANCO,
        date: '2026-10-10',
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('REPORT_EXPORT_TOO_LARGE');
    expect(mem.auditLog).toEqual([]);
  }, 60_000);

  it('[TC-REPORTING-REPORTS-022] el CSV del drill-down neutraliza la fórmula de la descripción y conserva el monto "-200.00"', async () => {
    mem.portions.push({
      ...basePortion('2026-10-12'),
      amount: bob('-200.00'),
      description: '=HYPERLINK(1)',
      categoryId: SUPER,
    });
    const file = await svc.exportDrillDown({ ...income, report: 'EXPENSES_BY_CATEGORY' });
    const text = file.body.toString('utf8');
    expect(text).toContain("'=HYPERLINK(1)");
    expect(text).toContain(',BOB,-200.00,');
    expect(text).not.toContain(',=HYPERLINK(1)');
  });

  it('[TC-REPORTING-REPORTS-023] la exportación se audita con el reporte, el rango y la cantidad de filas, sin montos ni descripciones', async () => {
    mem.portions.push({
      ...basePortion('2026-10-12'),
      amount: bob('77.00'),
      description: 'secreto',
      categoryId: SUPER,
    });
    await svc.exportExpensesByCategory(income);
    expect(mem.auditLog).toHaveLength(1);
    expect(mem.auditLog[0]).toMatchObject({ reportId: 'EXPENSES_BY_CATEGORY' });
    expect(mem.auditLog[0]?.filters).toContain('2026-10-01');
    expect(JSON.stringify(mem.auditLog)).not.toMatch(/77\.00|secreto/u);
    expect(mem.auditLog[0]?.rowCount).toBeGreaterThan(0);
  });

  function basePortion(date: string): PortionFact {
    seq += 1;
    return {
      transactionId: `0190a111-0000-7000-8000-${String(seq).padStart(12, '0')}`,
      splitId: `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
      businessDate: date,
      nature: 'EXPENSE',
      categoryId: SUPER,
      accountId: BANCO,
      counterpartyId: null,
      description: null,
      amount: bob('0.00'),
      tagIds: [],
    };
  }
});

describe('Drill-down del patrimonio (reporting/net-worth)', () => {
  it('[TC-REPORTING-REPORTS-037] la revalorización de activos de octubre lista "Wallet USDT" con 1000.000000 USDT y 500.00 BOB', async () => {
    const WALLET = '0190a000-0000-7000-8000-0000000000b6';
    mem.addAccount({ accountId: WALLET, name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' }, null);
    mem.entry('o1', '2026-09-01', [
      { account: BANCO, currency: 'BOB', amount: '10000.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '-10000.00' },
    ]);
    mem.entry('o2', '2026-09-01', [
      { account: WALLET, currency: 'USDT', amount: '1000.000000' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'USDT', amount: '-1000.000000' },
    ]);
    mem.rates.push(
      { base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-09-30T20:00:00Z' },
      { base: 'USDT', quote: 'BOB', value: '12.50', asOf: '2026-10-31T20:00:00Z' },
    );
    const page = await svc.getDrillDown({
      ...base,
      report: 'NET_WORTH',
      component: 'assetRevaluation',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(page.report.kind).toBe('NET_WORTH_ACCOUNT');
    expect(page.report.rows).toHaveLength(1);
    expect(page.report.rows[0]).toMatchObject({
      description: 'Wallet USDT',
      accountId: WALLET,
      amount: { amount: '1000.000000', currency: 'USDT' },
      valued: bob('500.00'),
    });
    expect(page.report.totals.consolidated).toEqual(bob('500.00'));
    await expect(
      svc.getDrillDown({ ...base, report: 'NET_WORTH', from: '2026-10-01', to: '2026-10-31' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
