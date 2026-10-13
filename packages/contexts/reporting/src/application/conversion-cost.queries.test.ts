import { DomainError, Instant } from '@pf/shared-kernel';
import type { ConversionCostRowDto } from '@pf/transactions/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConversionCostQueries, type GetConversionCostAnalysisQuery } from './conversion-cost.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';
const BINANCE = '0190a000-0000-7000-8000-0000000000c1';

let mem: InMemoryReporting;
const queries = () => new ConversionCostQueries(mem.conversionCostDeps());
const analyze = (q: Partial<GetConversionCostAnalysisQuery> = {}) =>
  queries().getAnalysis({ userId: USER, workspaceId: WS, from: '2026-10-01', to: '2026-10-31', ...q });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return null;
};

let seq = 0;
/** Venta de `qty` USDT por la contraparte Binance P2P con referencia 12.00 (USDT/BOB), de Wallet USDT a Banco BOB. */
function sale(
  qty: string,
  quoted: string,
  over: Partial<ConversionCostRowDto> & { fee?: string; reference?: string | null } = {},
): ConversionCostRowDto {
  seq += 1;
  const ref = over.reference === undefined ? '12.00' : over.reference;
  const q = Number(quoted);
  const m = Number(ref ?? '0');
  const pct = ref ? (((m - q) / m) * 100).toFixed(18) : null;
  const spreadAmount = ref ? (Math.abs(m - q) * Number(qty)).toFixed(2) : null;
  const { fee: _fee, reference: _reference, ...rest } = over;
  return {
    transactionId: `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    revision: 1,
    businessDate: '2026-10-05',
    executedAt: '2026-10-05T14:00:00Z',
    voided: false,
    sourceAccountId: 'a-usdt',
    targetAccountId: 'a-bob',
    counterparty: { counterpartyId: BINANCE, name: 'Binance P2P (nombre histórico)' },
    sourceAmount: { amount: qty, currency: 'USDT' },
    convertedSourceAmount: { amount: qty, currency: 'USDT' },
    grossTargetAmount: { amount: (q * Number(qty)).toFixed(2), currency: 'BOB' },
    targetAmount: { amount: (q * Number(qty)).toFixed(2), currency: 'BOB' },
    quotedRate: { base: 'USDT', quote: 'BOB', value: quoted },
    effectiveRate: { base: 'USDT', quote: 'BOB', value: quoted },
    referenceRate: ref
      ? {
          rate: { base: 'USDT', quote: 'BOB', value: ref },
          fxRateId: 'fx-1',
          source: 'MANUAL',
          rateType: 'P2P',
          asOf: '2026-10-05T13:00:00Z',
        }
      : null,
    spread:
      ref && pct && spreadAmount
        ? { percentage: pct, amount: { amount: spreadAmount, currency: 'BOB' } }
        : null,
    fees: over.fee
      ? [{ type: 'PROVIDER', amount: { amount: over.fee, currency: 'BOB' }, paidFromAccountId: null }]
      : [],
    ...rest,
  };
}

beforeEach(() => {
  seq = 0;
  mem = new InMemoryReporting();
  mem.clock.set(Instant.parse('2026-10-20T16:00:00Z'));
  mem.addAccount({ accountId: 'a-usdt', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' }, null);
  mem.addAccount({ accountId: 'a-bob', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  mem.counterpartyNames.set(BINANCE, 'Binance P2P');
});

describe('GetConversionCostAnalysis (fx/conversion-pricing)', () => {
  it('[TC-FX-COST-001] el canal Binance P2P en octubre: 2 conversiones, 4800.00 BOB, 0.5833 %, spread 28.00 y costo total 30.00', async () => {
    mem.conversionRows.push(sale('100.000000', '11.90'), sale('300.000000', '11.94', { fee: '2.00' }));
    const a = await analyze();
    expect(a.reportingCurrency).toBe('BOB');
    expect(a.groups).toHaveLength(1);
    const g = a.groups[0];
    expect(g?.period).toEqual({ label: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    // El nombre del canal es el vigente de CLASSIFICATION, no el histórico de la conversión.
    expect(g?.channel).toEqual({ kind: 'COUNTERPARTY', counterpartyId: BINANCE, name: 'Binance P2P' });
    expect([g?.sourceAccountName, g?.targetAccountName]).toEqual(['Wallet USDT', 'Banco BOB']);
    expect(g?.pair).toEqual({ base: 'USDT', quote: 'BOB' });
    expect(g?.conversions).toBe(2);
    expect(g?.converted).toEqual({ amount: '4800.00', currency: 'BOB' });
    expect(g?.spreadPct).toBe('0.5833');
    expect(g?.spreadAmount.amount).toBe('28.00');
    expect(g?.fees.amount).toBe('2.00');
    expect(g?.costTotal.amount).toBe('30.00');
    expect(a.totals.costTotal.amount).toBe('30.00');
    expect(a.meta.ratesUsed).toEqual([]);
  });

  it('[TC-FX-COST-002] la compra sin contraparte queda en Sin canal con sus cuentas y la venta con nombre libre en su canal', async () => {
    const buy = sale('50.000000', '12.20', {
      sourceAccountId: 'a-bob',
      targetAccountId: 'a-usdt',
      counterparty: { counterpartyId: null, name: null },
      sourceAmount: { amount: '610.00', currency: 'BOB' },
      convertedSourceAmount: { amount: '610.00', currency: 'BOB' },
      grossTargetAmount: { amount: '50.000000', currency: 'USDT' },
      targetAmount: { amount: '50.000000', currency: 'USDT' },
      // Compra de la base: (q − m)/m = 1.6667 %; |q − m| × 50 = 10.00 BOB.
      spread: { percentage: '1.666666666666666667', amount: { amount: '10.00', currency: 'BOB' } },
    });
    const named = sale('10.000000', '11.90', { counterparty: { counterpartyId: null, name: 'Casa Pérez' } });
    mem.conversionRows.push(buy, named);
    const a = await analyze();
    const none = a.groups.find((g) => g.channel.kind === 'NONE');
    expect([
      none?.sourceAccountName,
      none?.targetAccountName,
      none?.converted.amount,
      none?.spreadPct,
    ]).toEqual(['Banco BOB', 'Wallet USDT', '600.00', '1.6667']);
    expect(a.groups.find((g) => g.channel.kind === 'NAMED')?.channel.name).toBe('Casa Pérez');
  });

  it('[TC-FX-COST-003] la venta sin referencia se excluye de promedios y totales y se cuenta aparte con su monto original', async () => {
    mem.conversionRows.push(
      sale('100.000000', '11.90'),
      sale('300.000000', '11.94', { fee: '2.00' }),
      sale('20.000000', '11.90', { reference: null }),
    );
    const g = (await analyze()).groups[0];
    expect([g?.conversions, g?.converted.amount, g?.spreadPct, g?.costTotal.amount]).toEqual([
      2,
      '4800.00',
      '0.5833',
      '30.00',
    ]);
    expect(g?.excluded).toEqual([
      { reason: 'NO_REFERENCE', count: 1, amounts: [{ amount: '20.000000', currency: 'USDT' }] },
    ]);
  });

  it('[TC-FX-COST-004] asigna por la fecha de negocio en la zona del workspace: periodo financiero desde el 25 o mes calendario', async () => {
    mem.fiscalMonthStartDay = 25;
    mem.conversionRows.push(
      sale('10.000000', '11.90', { businessDate: '2026-10-27', executedAt: '2026-10-28T02:30:00Z' }),
    );
    const financial = await analyze({ from: '2026-10-01', to: '2026-11-30', grouping: 'FINANCIAL_PERIOD' });
    expect(financial.groups[0]?.period).toEqual({ label: '2026-10', from: '2026-10-25', to: '2026-11-24' });
    const calendar = await analyze({ from: '2026-10-01', to: '2026-11-30', grouping: 'CALENDAR_MONTH' });
    expect(calendar.groups[0]?.period).toEqual({ label: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(calendar.grouping).toBe('CALENDAR_MONTH');
  });

  it('[TC-FX-COST-004] sin rango consulta los últimos 12 periodos hasta hoy y respeta los periodos existentes', async () => {
    mem.addPeriod('2026-10', '2026-10-01', '2026-10-31', 'ACTIVE');
    mem.conversionRows.push(sale('10.000000', '11.90', { businessDate: '2025-11-15' }));
    const a = await queries().getAnalysis({ userId: USER, workspaceId: WS });
    expect(a.to).toBe('2026-10-20');
    expect(a.from).toBe('2025-11-01');
    expect(a.groups[0]?.period.label).toBe('2025-11');
  });

  it('[TC-FX-COST-005] un rango de más de 24 periodos, invertido o mal formado se rechaza con VALIDATION_FAILED', async () => {
    expect(await codeOf(analyze({ from: '2024-01-01', to: '2026-10-31' }))).toBe('VALIDATION_FAILED');
    expect(await codeOf(analyze({ from: '2026-10-31', to: '2026-10-01' }))).toBe('VALIDATION_FAILED');
    expect(await codeOf(analyze({ from: '2026-13-01', to: '2026-10-01' }))).toBe('VALIDATION_FAILED');
    expect(await codeOf(analyze({ grouping: 'WEEK' as never }))).toBe('VALIDATION_FAILED');
    // Exactamente 24 periodos es válido.
    expect(
      await codeOf(analyze({ from: '2024-11-01', to: '2026-10-31', grouping: 'CALENDAR_MONTH' })),
    ).toBeNull();
  });

  it('[TC-FX-COST-007] un par sin la moneda de reporte se valora con la tasa del instante y el fee sin tasa deja el costo incompleto', async () => {
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-10-07T13:00:00Z' });
    const swap = sale('0.01600000', '63000', {
      businessDate: '2026-10-07',
      executedAt: '2026-10-07T14:00:00Z',
      sourceAccountId: 'a-usdt',
      targetAccountId: 'a-btc',
      sourceAmount: { amount: '1000.000000', currency: 'USDT' },
      convertedSourceAmount: { amount: '1000.000000', currency: 'USDT' },
      grossTargetAmount: { amount: '0.01600000', currency: 'BTC' },
      targetAmount: { amount: '0.01600000', currency: 'BTC' },
      quotedRate: { base: 'BTC', quote: 'USDT', value: '63000' },
      effectiveRate: { base: 'BTC', quote: 'USDT', value: '62500' },
      referenceRate: {
        rate: { base: 'BTC', quote: 'USDT', value: '62500' },
        fxRateId: 'fx-2',
        source: 'MANUAL',
        rateType: 'P2P',
        asOf: '2026-10-07T13:00:00Z',
      },
      spread: { percentage: '0.8', amount: { amount: '8.000000', currency: 'USDT' } },
      fees: [{ type: 'NETWORK', amount: { amount: '15.000000', currency: 'TRX' }, paidFromAccountId: null }],
    });
    mem.conversionRows.push(swap);
    mem.addAccount({ accountId: 'a-btc', name: 'Wallet BTC', type: 'CRYPTO_WALLET', currency: 'BTC' }, null);
    mem.currencies.push({ code: 'TRX', kind: 'CRYPTO', scale: 6, enabled: true });
    const a = await analyze();
    const g = a.groups[0];
    expect([g?.converted.amount, g?.spreadAmount.amount, g?.spreadPct]).toEqual([
      '12000.00',
      '96.00',
      '0.8000',
    ]);
    expect(g?.costComplete).toBe(false);
    expect(g?.unvaluedFees).toEqual([{ amount: '15.000000', currency: 'TRX' }]);
    expect(a.totals.costComplete).toBe(false);
    expect(a.meta.ratesUsed.map((r) => `${r.rate.base}/${r.rate.quote}`)).toEqual(['USDT/BOB']);
    expect(a.meta.attributions.map((x) => x.provider)).toEqual(['PARALELO_BO']);
    // Una sola resolución por lote: USDT→BOB y TRX→BOB al instante.
    expect(mem.rateRequests.map((r) => `${r.base}→${r.quote}@${r.at}`).sort()).toEqual([
      'TRX→BOB@2026-10-07T14:00:00Z',
      'USDT→BOB@2026-10-07T14:00:00Z',
    ]);
    // Sin tasa USDT/BOB en la ventana la conversión se excluye con NO_REPORTING_RATE (nunca 1:1).
    mem.rates.length = 0;
    const none = (await analyze()).groups[0];
    expect(none?.conversions).toBe(0);
    expect(none?.excluded.map((b) => b.reason)).toEqual(['NO_REPORTING_RATE']);
  });

  it('[TC-FX-COST-008] el spread alternativo contra la venta paralela del día no altera el spread contra la referencia', async () => {
    mem.parallelRates = [
      { base: 'USDT', quote: 'BOB', side: 'PARALLEL_SELL', value: '11.92', asOf: '2026-10-05T13:50:00Z' },
      { base: 'USDT', quote: 'BOB', side: 'PARALLEL_BUY', value: '12.12', asOf: '2026-10-05T13:50:00Z' },
    ];
    mem.conversionRows.push(sale('100.000000', '11.90'));
    const withAlt = (await analyze({ compareWith: 'PARALLEL_SIDE' })).groups[0];
    expect(withAlt?.spreadPct).toBe('0.8333');
    expect(withAlt?.alternative).toEqual({ spreadPct: '0.1678', excludedCount: 0 });
    // Sin pedirlo no hay bloque alternativo.
    expect((await analyze()).groups[0]?.alternative).toBeNull();
    // Sin tasa paralela del lado de la conversión queda fuera del alternativo y se cuenta aparte.
    mem.parallelRates = [];
    const none = (await analyze({ compareWith: 'PARALLEL_SIDE' })).groups[0];
    expect(none?.alternative).toEqual({ spreadPct: null, excludedCount: 1 });
    expect(none?.spreadPct).toBe('0.8333');
  });

  it('un workspace sin conversiones devuelve el análisis vacío con totales en cero', async () => {
    const a = await analyze();
    expect(a.groups).toEqual([]);
    expect(a.totals).toMatchObject({ conversions: 0, excludedCount: 0, costComplete: true });
    expect(a.totals.costTotal).toEqual({ amount: '0.00', currency: 'BOB' });
  });
});

describe('ExportConversionCostAnalysis (CSV)', () => {
  it('[TC-FX-COST-006] una fila por grupo con montos decimales, encabezado estable y conversiones excluidas', async () => {
    mem.conversionRows.push(
      sale('100.000000', '11.90'),
      sale('300.000000', '11.94', { fee: '2.00' }),
      sale('20.000000', '11.90', { reference: null }),
      sale('50.000000', '12.20', { counterparty: { counterpartyId: null, name: null } }),
    );
    const file = await queries().exportCsv({
      userId: USER,
      workspaceId: WS,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.fileName).toBe('conversion-costs-2026-10-01-2026-10-31.csv');
    const text = file.body.toString('utf8');
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'periodo,canal,cuenta_origen,cuenta_destino,par,conversiones,monto_convertido,spread_promedio_pct,monto_spread,fees,costo_total,conversiones_excluidas,moneda_reporte',
    );
    expect(lines).toHaveLength(3);
    const binance = lines.find((l) => l.includes('Binance P2P'));
    expect(binance).toBe(
      '2026-10,Binance P2P,Wallet USDT,Banco BOB,USDT/BOB,2,4800.00,0.5833,28.00,2.00,30.00,1,BOB',
    );
    expect(lines.some((l) => l.startsWith('2026-10,Sin canal,'))).toBe(true);
  });

  it('[TC-FX-COST-006] una contraparte con fórmula queda como texto, no como fórmula', async () => {
    mem.counterpartyNames.set(BINANCE, '=HYPERLINK(1)');
    mem.conversionRows.push(sale('100.000000', '11.90'));
    const file = await queries().exportCsv({
      userId: USER,
      workspaceId: WS,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const row = file.body.toString('utf8').trimEnd().split('\r\n')[1];
    expect(row?.startsWith("2026-10,'=HYPERLINK(1),")).toBe(true);
  });
});
