import { DomainError, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { NetWorthHistoryQueries } from './net-worth-history.queries.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const history = async (q: { from?: string; to?: string; reportingCurrency?: string } = {}) =>
  (
    await new NetWorthHistoryQueries(mem.historyDeps()).getNetWorthHistory({
      userId: USER,
      workspaceId: WS,
      ...q,
    })
  ).history;
const failure = async (q: Parameters<typeof history>[0]) => {
  try {
    await history(q);
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return null;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usdt = (amount: string) => ({ amount, currency: 'USDT' });

/** Ejemplo canónico de tres meses (TC-REPORTING-NETWORTH-006): Banco BOB, Wallet USDT y tarjeta Visa. */
function threeMonths() {
  mem.clock.set(Instant.parse('2026-04-12T16:00:00Z')); // 2026-04-12T12:00:00-04:00
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  mem.addAccount({ accountId: 'wallet', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' }, null);
  mem.addAccount({ accountId: 'visa', name: 'Visa', type: 'CREDIT_CARD', currency: 'BOB' }, null);
  mem.addPeriod('2026-01', '2026-01-01', '2026-01-31');
  mem.addPeriod('2026-02', '2026-02-01', '2026-02-28');
  mem.addPeriod('2026-03', '2026-03-01', '2026-03-31');
  mem.addPeriod('2026-04', '2026-04-01', '2026-04-30', 'ACTIVE');
  mem.addPeriod('2026-05', '2026-05-01', '2026-05-31', 'DRAFT');
  mem.setBalances('2026-01-31', { banco: bob('2000.00'), wallet: usdt('100.000000'), visa: bob('300.00') });
  mem.setBalances('2026-02-28', { banco: bob('2500.00'), wallet: usdt('100.000000'), visa: bob('0.00') });
  mem.setBalances('2026-03-31', { banco: bob('2400.00'), wallet: usdt('120.000000'), visa: bob('150.00') });
  mem.setBalances('2026-04-12', { banco: bob('2400.00'), wallet: usdt('120.000000'), visa: bob('150.00') });
  mem.rates.push(
    { base: 'USDT', quote: 'BOB', value: '10.00', asOf: '2026-01-31T20:00:00Z' },
    { base: 'USDT', quote: 'BOB', value: '10.50', asOf: '2026-02-28T20:00:00Z' },
    { base: 'USDT', quote: 'BOB', value: '11.00', asOf: '2026-03-31T20:00:00Z' },
    { base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-04-12T15:00:00Z' },
  );
}

beforeEach(() => {
  mem = new InMemoryReporting();
});

describe('GetNetWorthHistory — serie mensual (reporting/net-worth)', () => {
  it('[TC-REPORTING-NETWORTH-006] enero a abril: 2700.00, 3550.00 y 3570.00 BOB y abril parcial calculado a hoy', async () => {
    threeMonths();
    const h = await history({ from: '2026-01', to: '2026-04' });
    expect(h.reportingCurrency).toBe('BOB');
    expect(h.points.map((p) => [p.period, p.asOf, p.netWorth, p.partial])).toEqual([
      ['2026-01', '2026-01-31', '2700.00', false],
      ['2026-02', '2026-02-28', '3550.00', false],
      ['2026-03', '2026-03-31', '3570.00', false],
      // Abril a hoy (12.02): 2400.00 + 120 × 12.02 − 150.00 = 3692.40.
      ['2026-04', '2026-04-12', '3692.40', true],
    ]);
    expect(h.points[2]).toMatchObject({ assets: '3720.00', liabilities: '150.00', complete: true });
  });

  it('[TC-REPORTING-NETWORTH-007] cada punto usa la tasa de su fecha (10.00 y 10.50) y no la de hoy (12.02)', async () => {
    threeMonths();
    const h = await history({ from: '2026-01', to: '2026-02' });
    expect(h.points.map((p) => p.ratesUsed.map((r) => r.rate.value))).toEqual([['10.00'], ['10.50']]);
    expect(h.meta.ratesUsed.map((r) => r.rate.value)).toEqual(['10.00', '10.50']);
    expect(h.meta.ratesUsed[0]).toMatchObject({ provider: 'PARALELO_BO', rateType: 'PARALLEL' });
    expect(h.meta.attributions.map((a) => a.provider)).toEqual(['PARALELO_BO']);
    expect(mem.rateRequests.every((r) => r.at < '2026-04-01')).toBe(true);
  });

  it('[TC-REPORTING-NETWORTH-007] usa la ventana de vigencia del ajuste de Reporting (D53)', async () => {
    threeMonths();
    mem.rateValidityWindowDays = 3;
    await history({ from: '2026-01', to: '2026-01' });
    expect(mem.windowRequests).toEqual([3]);
  });

  it('[TC-REPORTING-NETWORTH-008] sin tasa dentro de la ventana el punto queda incompleto, sin 1:1, y la variación siguiente no es comparable', async () => {
    threeMonths();
    mem.addPeriod('2025-12', '2025-12-01', '2025-12-31');
    mem.setBalances('2025-12-31', { banco: bob('1800.00'), wallet: usdt('100.000000') });
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '9.90', asOf: '2025-12-20T12:00:00Z' });
    const h = await history({ from: '2025-12', to: '2026-01' });
    expect(h.points[0]).toMatchObject({
      period: '2025-12',
      netWorth: '1800.00',
      complete: false,
      unconverted: [usdt('100.000000')],
      ratesUsed: [],
    });
    expect(h.points[1]).toMatchObject({ period: '2026-01', comparable: false });
  });

  it('[TC-REPORTING-NETWORTH-009] un mes cerrado con snapshot muestra 3570.00 BOB aunque se registre otra tasa después', async () => {
    threeMonths();
    mem.periods.find((p) => p.label === '2026-03')!.status = 'CLOSED';
    mem.snapshots.push({
      periodId: 'period-2026-03',
      baseCurrency: 'BOB',
      assets: bob('3720.00'),
      liabilities: bob('150.00'),
      netWorth: { amount: bob('3570.00'), complete: true, unconverted: [] },
    });
    // Tasa manual registrada DESPUÉS del cierre con fecha 2026-03-31.
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '11.20', asOf: '2026-03-31T22:00:00Z' });
    const h = await history({ from: '2026-03', to: '2026-03' });
    expect(h.points[0]).toMatchObject({
      netWorth: '3570.00',
      source: 'SNAPSHOT',
      closed: true,
      ratesUsed: [],
    });
    expect(mem.rateRequests).toHaveLength(0);
  });

  it('[TC-REPORTING-NETWORTH-009] snapshot en otra moneda: se calcula y se marca cerrado; reabierto: se calcula y no es cerrado', async () => {
    threeMonths();
    mem.periods.find((p) => p.label === '2026-03')!.status = 'CLOSED';
    mem.periods.find((p) => p.label === '2026-02')!.status = 'REOPENED';
    mem.snapshots.push({
      periodId: 'period-2026-03',
      baseCurrency: 'USD',
      assets: { amount: '1.00', currency: 'USD' },
      liabilities: { amount: '0.00', currency: 'USD' },
      netWorth: { amount: { amount: '1.00', currency: 'USD' }, complete: true, unconverted: [] },
    });
    const h = await history({ from: '2026-02', to: '2026-03' });
    expect(h.points.map((p) => [p.period, p.netWorth, p.source, p.closed])).toEqual([
      ['2026-02', '3550.00', 'COMPUTED', false],
      ['2026-03', '3570.00', 'COMPUTED', true],
    ]);
  });

  it('[TC-REPORTING-NETWORTH-010] cuentas archivadas con saldo histórico cuentan en su fecha; las abiertas después no', async () => {
    mem.clock.set(Instant.parse('2026-04-12T16:00:00Z'));
    mem.addAccount(
      { accountId: 'vieja', name: 'Caja vieja', type: 'CASH', currency: 'BOB', status: 'ARCHIVED' },
      null,
    );
    mem.addAccount({ accountId: 'nuevo', name: 'Banco nuevo', type: 'BANK', currency: 'BOB' }, null);
    mem.addPeriod('2026-01', '2026-01-01', '2026-01-31');
    mem.addPeriod('2026-02', '2026-02-01', '2026-02-28');
    mem.addPeriod('2026-03', '2026-03-01', '2026-03-31', 'ACTIVE');
    mem.setBalances('2026-01-31', { vieja: bob('300.00') });
    mem.setBalances('2026-02-28', { vieja: bob('0.00'), nuevo: bob('500.00') });
    const h = await history({ from: '2026-01', to: '2026-02' });
    expect(h.points.map((p) => p.netWorth)).toEqual(['300.00', '500.00']);
  });

  it('[TC-REPORTING-NETWORTH-011] la variación de febrero es +850.00 y la de marzo +20.00, comparables', async () => {
    threeMonths();
    const h = await history({ from: '2026-01', to: '2026-03' });
    expect(h.points.map((p) => [p.change, p.comparable])).toEqual([
      [null, false],
      ['850.00', true],
      ['20.00', true],
    ]);
  });

  it('[TC-REPORTING-NETWORTH-006] con día de inicio 25 el punto "2026-01" se calcula al 2026-02-24', async () => {
    mem.clock.set(Instant.parse('2026-03-02T16:00:00Z'));
    mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
    mem.addPeriod('2026-01', '2026-01-25', '2026-02-24');
    mem.addPeriod('2026-02', '2026-02-25', '2026-03-24', 'ACTIVE');
    mem.setBalances('2026-02-24', { banco: bob('2000.00') });
    mem.setBalances('2026-02-28', { banco: bob('2600.00') });
    mem.setBalances('2026-03-02', { banco: bob('2600.00') });
    const h = await history({ from: '2026-01', to: '2026-01' });
    expect(h.points).toHaveLength(1);
    expect(h.points[0]).toMatchObject({ period: '2026-01', asOf: '2026-02-24', netWorth: '2000.00' });
  });

  it('[TC-REPORTING-NETWORTH-012] meses futuros, rango invertido y más de 120 meses: VALIDATION_FAILED', async () => {
    threeMonths();
    expect(await failure({ from: '2026-01', to: '2026-06' })).toBe('VALIDATION_FAILED');
    expect(await failure({ from: '2026-03', to: '2026-01' })).toBe('VALIDATION_FAILED');
    expect(await failure({ from: '2016-01', to: '2026-04' })).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-NETWORTH-012] moneda de reporte no habilitada: CURRENCY_NOT_ENABLED', async () => {
    threeMonths();
    expect(await failure({ reportingCurrency: 'EUR' })).toBe('CURRENCY_NOT_ENABLED');
  });

  it('[TC-REPORTING-NETWORTH-012] sin rango son 12 puntos de mayo de 2025 a abril de 2026 (los que tienen periodo)', async () => {
    threeMonths();
    for (let m = 5; m <= 12; m++) {
      const label = `2025-${String(m).padStart(2, '0')}`;
      mem.addPeriod(label, `${label}-01`, `${label}-28`);
    }
    const h = await history();
    expect(h.points.map((p) => p.period)).toEqual([
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    // La API entrega tantos puntos como periodos existan en el rango por defecto (12 con el historial completo).
    expect(h.points).toHaveLength(12);
  });

  it('[TC-REPORTING-NETWORTH-006] el punto del mes en curso a hoy coincide con el patrimonio actual (regresión Phase 1)', async () => {
    threeMonths();
    const h = await history({ from: '2026-04', to: '2026-04' });
    expect(h.points[0]).toMatchObject({ netWorth: '3692.40', assets: '3842.40', liabilities: '150.00' });
    // Mismo conjunto de saldos y tasas que el patrimonio actual del Home (Phase 1, TC-REPORTING-NETWORTH-001).
    for (const [id, presented] of mem.balancesByDate.get('2026-04-12') ?? []) mem.balances.set(id, presented);
    const { summary } = await new ReportSummaryQueries(mem.deps()).getReportSummary({
      userId: USER,
      workspaceId: WS,
    });
    expect(h.points[0]).toMatchObject({
      netWorth: summary.netWorth.netWorth.amount,
      assets: summary.netWorth.assets.amount,
      liabilities: summary.netWorth.liabilities.amount,
    });
  });
});
