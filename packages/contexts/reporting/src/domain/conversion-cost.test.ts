import fc from 'fast-check';
import { currency, dec, Money, Rate, type Decimal, type ExactRate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  channelOf,
  ConversionCostAggregator,
  percentage,
  type ConversionChannel,
  type CostConversion,
  type CostValuation,
} from './conversion-cost.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const TRX = currency('TRX', 6);

const OCT = { label: '2026-10', from: '2026-10-01', to: '2026-10-31' };
const BINANCE: ConversionChannel = {
  kind: 'COUNTERPARTY',
  counterpartyId: 'cp-binance',
  name: 'Binance P2P',
};
const NONE = channelOf({ counterpartyId: null, name: null });

/** Valoración a BOB: USDT→BOB 12.00 vigente (o ninguna); BTC/TRX sin tasa. */
const valuation = (usdtBob: string | null = '12.00'): CostValuation => ({
  reporting: BOB,
  rateFor: (code): ExactRate | null =>
    code === 'USDT' && usdtBob ? { base: 'USDT', quote: 'BOB', value: dec(usdtBob) } : null,
});

interface Base {
  id: string;
  channel?: ConversionChannel;
  source?: [string, string];
  target?: [string, string];
  period?: typeof OCT;
  executedAt?: string;
  fees?: Money[];
}

/** Venta de `qty` USDT a `quoted` con referencia `ref` (USDT/BOB): spread = (ref − quoted)/ref, desfavorable positivo. */
function sale(b: Base, qty: string, quoted: string, ref: string | null): CostConversion {
  const m = dec(ref ?? '0');
  const q = dec(quoted);
  return {
    id: b.id,
    period: b.period ?? OCT,
    executedAt: b.executedAt ?? '2026-10-05T14:00:00Z',
    channel: b.channel ?? BINANCE,
    sourceAccountId: (b.source ?? ['a-usdt', 'Wallet USDT'])[0],
    sourceAccountName: (b.source ?? ['a-usdt', 'Wallet USDT'])[1],
    targetAccountId: (b.target ?? ['a-bob', 'Banco BOB'])[0],
    targetAccountName: (b.target ?? ['a-bob', 'Banco BOB'])[1],
    pair: { base: USDT, quote: BOB },
    side: 'SELL',
    baseQty: Money.parse(qty, USDT),
    reference: ref ? Rate.of(USDT, BOB, ref) : null,
    spread: ref
      ? {
          pct: m.minus(q).div(m).times(100),
          amount: Money.roundToScale(m.minus(q).abs().times(dec(qty)), BOB, 'HALF_EVEN'),
        }
      : null,
    fees: b.fees ?? [],
  };
}

const ten = (id: string, fees: Money[] = []) => sale({ id, fees }, '100.000000', '11.90', '12.00');
const thirty = (id: string, fees: Money[] = []) => sale({ id, fees }, '300.000000', '11.94', '12.00');

describe('ConversionCostAggregator (fx/conversion-pricing, D244–D247)', () => {
  it('[TC-FX-COST-001] el costo por canal pondera el spread por el monto convertido en la moneda de reporte', () => {
    const { groups, totals } = ConversionCostAggregator.aggregate(
      [ten('c1'), thirty('c2', [Money.parse('2.00', BOB)])],
      valuation(),
    );
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.channel.name).toBe('Binance P2P');
    expect([g?.sourceAccountName, g?.targetAccountName, g?.pair]).toEqual([
      'Wallet USDT',
      'Banco BOB',
      { base: 'USDT', quote: 'BOB' },
    ]);
    expect(g?.conversions).toBe(2);
    expect(g?.converted.toFixed()).toBe('4800.00');
    // Ponderado (28 / 4800), no el simple (0.8333 y 0.5 darían 0.6667).
    expect(g?.spreadPct).toBe('0.5833');
    expect(g?.spreadAmount.toFixed()).toBe('28.00');
    expect(g?.fees.toFixed()).toBe('2.00');
    expect(g?.costTotal.toFixed()).toBe('30.00');
    expect(g?.costComplete).toBe(true);
    expect(totals.costTotal.toFixed()).toBe('30.00');
  });

  it('[TC-FX-COST-010] solo cuenta la revisión vigente: venta de 300 revisada a 250 USDT', () => {
    const revised = sale({ id: 'c2' }, '250.000000', '11.94', '12.00');
    const g = ConversionCostAggregator.aggregate([ten('c1'), revised], valuation()).groups[0];
    expect(g?.converted.toFixed()).toBe('4200.00');
    expect(g?.spreadAmount.toFixed()).toBe('25.00');
  });

  it('[TC-FX-COST-010] con la venta de 100 USDT anulada (fuera de la lista) queda 1 conversión, 3600.00 BOB y 0.5000 %', () => {
    const g = ConversionCostAggregator.aggregate([thirty('c2')], valuation()).groups[0];
    expect([g?.conversions, g?.converted.toFixed(), g?.spreadPct]).toEqual([1, '3600.00', '0.5000']);
  });

  it('[TC-FX-COST-002] la compra sin contraparte queda en Sin canal con sus cuentas y su propio grupo por cuentas', () => {
    const buy: CostConversion = {
      id: 'b1',
      period: OCT,
      executedAt: '2026-10-06T14:00:00Z',
      channel: NONE,
      sourceAccountId: 'a-bob',
      sourceAccountName: 'Banco BOB',
      targetAccountId: 'a-usdt',
      targetAccountName: 'Wallet USDT',
      pair: { base: USDT, quote: BOB },
      side: 'BUY',
      baseQty: Money.parse('50.000000', USDT),
      reference: Rate.of(USDT, BOB, '12.00'),
      // (q − m)/m con q = 12.20 y m = 12.00; |q − m| × 50 = 10.00 BOB.
      spread: { pct: dec('12.20').minus('12.00').div('12.00').times(100), amount: Money.parse('10.00', BOB) },
      fees: [],
    };
    const other = { ...buy, id: 'b2', sourceAccountId: 'a-usd', sourceAccountName: 'Caja USD' };
    const { groups } = ConversionCostAggregator.aggregate([buy, other], valuation());
    expect(groups).toHaveLength(2);
    const g = groups.find((x) => x.sourceAccountName === 'Banco BOB');
    expect(g?.channel).toEqual({ kind: 'NONE', counterpartyId: null, name: null });
    expect([g?.conversions, g?.converted.toFixed(), g?.spreadPct, g?.spreadAmount.toFixed()]).toEqual([
      1,
      '600.00',
      '1.6667',
      '10.00',
    ]);
    expect(groups.find((x) => x.sourceAccountName === 'Caja USD')?.conversions).toBe(1);
  });

  it('[TC-FX-COST-002] con nombre libre y sin contraparte registrada el canal es ese nombre; sin nombre, Sin canal', () => {
    expect(channelOf({ counterpartyId: null, name: '  Casa Pérez ' })).toEqual({
      kind: 'NAMED',
      counterpartyId: null,
      name: 'Casa Pérez',
    });
    expect(channelOf({ counterpartyId: 'cp1', name: 'Binance P2P' }).kind).toBe('COUNTERPARTY');
    expect(channelOf({ counterpartyId: null, name: '   ' }).kind).toBe('NONE');
    // El mismo nombre libre con distinta capitalización es un solo canal.
    const a = sale(
      { id: 'n1', channel: channelOf({ counterpartyId: null, name: 'Casa Pérez' }) },
      '10.000000',
      '11.90',
      '12.00',
    );
    const b = sale(
      { id: 'n2', channel: channelOf({ counterpartyId: null, name: 'casa pérez' }) },
      '10.000000',
      '11.90',
      '12.00',
    );
    expect(ConversionCostAggregator.aggregate([a, b], valuation()).groups).toHaveLength(1);
  });

  it('[TC-FX-COST-003] las conversiones sin referencia o sin tasa cotizada se excluyen y se cuentan aparte sin estimar un spread', () => {
    const noReference = sale({ id: 'x1' }, '20.000000', '11.90', null);
    const noQuoted: CostConversion = { ...ten('x2'), spread: null };
    const base = ConversionCostAggregator.aggregate(
      [ten('c1'), thirty('c2', [Money.parse('2.00', BOB)])],
      valuation(),
    );
    const withExcluded = ConversionCostAggregator.aggregate(
      [ten('c1'), thirty('c2', [Money.parse('2.00', BOB)]), noReference, noQuoted],
      valuation(),
    );
    const g = withExcluded.groups[0];
    expect(g?.converted).toEqual(base.groups[0]?.converted);
    expect([
      g?.spreadPct,
      g?.spreadAmount.toFixed(),
      g?.fees.toFixed(),
      g?.costTotal.toFixed(),
      g?.conversions,
    ]).toEqual(['0.5833', '28.00', '2.00', '30.00', 2]);
    expect(g?.excluded.map((b) => [b.reason, b.count, b.amounts.map((m) => m.toString())])).toEqual([
      ['NO_REFERENCE', 1, ['20.000000 USDT']],
      ['NO_QUOTED_RATE', 1, ['100.000000 USDT']],
    ]);
  });

  it('[TC-FX-COST-003] un grupo con todo excluido informa 0 conversiones y sin porcentaje', () => {
    const g = ConversionCostAggregator.aggregate(
      [sale({ id: 'x1' }, '20.000000', '11.90', null)],
      valuation(),
    ).groups[0];
    expect([g?.conversions, g?.converted.toFixed(), g?.spreadPct, g?.excluded[0]?.count]).toEqual([
      0,
      '0.00',
      null,
      1,
    ]);
  });

  it('[TC-FX-COST-007] un swap de un par sin la moneda de reporte se valora con la tasa del instante; el fee sin tasa deja el costo incompleto', () => {
    const swap: CostConversion = {
      id: 's1',
      period: OCT,
      executedAt: '2026-10-07T14:00:00Z',
      channel: BINANCE,
      sourceAccountId: 'a-usdt',
      sourceAccountName: 'Wallet USDT',
      targetAccountId: 'a-btc',
      targetAccountName: 'Wallet BTC',
      pair: { base: BTC, quote: USDT },
      side: 'BUY',
      baseQty: Money.parse('0.01600000', BTC),
      reference: Rate.of(BTC, USDT, '62500'),
      // (q − m)/m con q = 63000: 0.8 %; |q − m| × 0.016 = 8.000000 USDT.
      spread: {
        pct: dec('63000').minus('62500').div('62500').times(100),
        amount: Money.parse('8.000000', USDT),
      },
      fees: [Money.parse('15.000000', TRX)],
    };
    const g = ConversionCostAggregator.aggregate([swap], valuation('12.00')).groups[0];
    // 0.016 BTC × 62500 = 1000 USDT; × 12.00 = 12000.00 BOB; spread 8 USDT × 12 = 96.00 BOB.
    expect([g?.converted.toFixed(), g?.spreadAmount.toFixed(), g?.spreadPct]).toEqual([
      '12000.00',
      '96.00',
      '0.8000',
    ]);
    expect(g?.costComplete).toBe(false);
    expect(g?.unvaluedFees.map((m) => m.toString())).toEqual(['15.000000 TRX']);
    // Sin tasa USDT/BOB en la ventana se excluye con NO_REPORTING_RATE, sin usar 1:1.
    const none = ConversionCostAggregator.aggregate([swap], valuation(null)).groups[0];
    expect(none?.conversions).toBe(0);
    expect(none?.excluded.map((b) => [b.reason, b.count])).toEqual([['NO_REPORTING_RATE', 1]]);
  });

  it('[TC-FX-COST-007] un fee en la moneda del par se valora con la referencia de la conversión', () => {
    const withFee = sale({ id: 'f1', fees: [Money.parse('1.000000', USDT)] }, '100.000000', '11.90', '12.00');
    const g = ConversionCostAggregator.aggregate([withFee], valuation(null)).groups[0];
    // Quote = BOB = moneda de reporte: no necesita otra tasa; el fee en USDT usa la referencia 12.00.
    expect(g?.fees.toFixed()).toBe('12.00');
    expect(g?.costComplete).toBe(true);
  });

  it('[TC-FX-COST-008] el spread alternativo contra la venta paralela no altera el spread contra la referencia', () => {
    const base = sale({ id: 'a1' }, '100.000000', '11.90', '12.00');
    const withAlt: CostConversion = {
      ...base,
      alternative: { quoted: Rate.of(USDT, BOB, '11.90'), parallel: Rate.of(USDT, BOB, '11.92') },
    };
    const g = ConversionCostAggregator.aggregate([withAlt], valuation()).groups[0];
    expect(g?.spreadPct).toBe('0.8333');
    expect(g?.alternative).toEqual({ spreadPct: '0.1678', excludedCount: 0 });
    // Una conversión sin tasa paralela del lado queda solo fuera del alternativo.
    const noSide: CostConversion = {
      ...thirty('a2'),
      alternative: { quoted: Rate.of(USDT, BOB, '11.94'), parallel: null },
    };
    const both = ConversionCostAggregator.aggregate([withAlt, noSide], valuation()).groups[0];
    expect(both?.alternative).toEqual({ spreadPct: '0.1678', excludedCount: 1 });
    expect(both?.conversions).toBe(2);
    // Sin pedir el alternativo no hay bloque.
    expect(ConversionCostAggregator.aggregate([base], valuation()).groups[0]?.alternative).toBeNull();
  });

  it('un spread favorable (porcentaje negativo) resta del costo en lugar de sumar', () => {
    const favorable = sale({ id: 'v1' }, '100.000000', '12.10', '12.00');
    const g = ConversionCostAggregator.aggregate([favorable], valuation()).groups[0];
    expect(g?.spreadAmount.toFixed()).toBe('-10.00');
    expect(g?.spreadPct).toBe('-0.8333');
  });

  it('agrupa por periodo, canal, cuentas y par; los grupos salen ordenados por periodo y canal', () => {
    const nov = { label: '2026-11', from: '2026-11-01', to: '2026-11-30' };
    const rows = [
      sale({ id: '1', period: nov }, '10.000000', '11.90', '12.00'),
      sale({ id: '2', channel: NONE }, '10.000000', '11.90', '12.00'),
      sale({ id: '3' }, '10.000000', '11.90', '12.00'),
    ];
    const { groups } = ConversionCostAggregator.aggregate(rows, valuation());
    expect(groups.map((g) => [g.period.label, g.channel.kind])).toEqual([
      ['2026-10', 'COUNTERPARTY'],
      ['2026-10', 'NONE'],
      ['2026-11', 'COUNTERPARTY'],
    ]);
  });

  it('percentage redondea HALF_EVEN a 4 decimales solo al presentar y no divide por cero', () => {
    expect(percentage(dec('28'), dec('4800'))).toBe('0.5833');
    expect(percentage(dec('1'), dec('8'))).toBe('12.5000');
    expect(percentage(dec('1'), dec('0'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------- propiedades

const qty = fc.integer({ min: 1, max: 5_000_000 }).map((n) => (n / 1000).toFixed(6));
const money2 = (cents: number) => (cents / 100).toFixed(2);
interface RawSale {
  readonly channel: string;
  readonly qty: string;
  readonly ref: number;
  readonly delta: number;
  readonly extra: number | undefined;
}
const arbSale: fc.Arbitrary<RawSale> = fc.record({
  channel: fc.constantFrom('cp1', 'cp2', 'cp3'),
  qty,
  ref: fc.integer({ min: 100, max: 3000 }),
  delta: fc.integer({ min: -50, max: 50 }),
  extra: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
});

describe('ConversionCostAggregator: propiedades (TC-FX-COST-001)', () => {
  const build = (x: RawSale, id: string): CostConversion => {
    const ref = money2(x.ref);
    const quoted = money2(Math.max(1, x.ref + x.delta));
    const channel: ConversionChannel = { kind: 'COUNTERPARTY', counterpartyId: x.channel, name: x.channel };
    return sale(
      { id, channel, fees: x.extra ? [Money.parse(money2(x.extra), BOB)] : [] },
      x.qty,
      quoted,
      ref,
    );
  };

  /** Referencia independiente: Σ spread valorado / Σ convertido valorado × 100, redondeado una sola vez. */
  const expected = (
    rows: readonly CostConversion[],
  ): { pct: string | null; converted: Decimal; spread: Decimal } => {
    let converted = dec('0');
    let spread = dec('0');
    for (const r of rows) {
      const m = (r.reference as Rate).value;
      converted = converted.plus(r.baseQty.toDecimal().times(m));
      const s = (r.spread as NonNullable<CostConversion['spread']>).amount.toDecimal();
      spread = spread.plus(
        (r.spread as NonNullable<CostConversion['spread']>).pct.isNegative() ? s.neg() : s,
      );
    }
    return { pct: percentage(spread, converted), converted, spread };
  };

  it('[TC-FX-COST-001] el spread promedio de cada grupo es Σ monto del spread / Σ monto convertido × 100 y excluir conversiones no altera los demás', () => {
    fc.assert(
      fc.property(
        fc.array(arbSale, { minLength: 1, maxLength: 25 }),
        fc.array(qty, { maxLength: 6 }),
        (raw, noReferenceQtys) => {
          const rows = raw.map((r, i) => build(r, `c${i}`));
          const excluded = noReferenceQtys.map((q, i) => sale({ id: `x${i}` }, q, '11.90', null));
          const analysis = ConversionCostAggregator.aggregate(rows, valuation());
          const withExcluded = ConversionCostAggregator.aggregate([...rows, ...excluded], valuation());
          // Promedio ponderado por grupo contra el cálculo independiente.
          const byChannel = new Map<string, CostConversion[]>();
          for (const r of rows) {
            byChannel.set(r.channel.counterpartyId ?? '', [
              ...(byChannel.get(r.channel.counterpartyId ?? '') ?? []),
              r,
            ]);
          }
          for (const g of analysis.groups) {
            const own = byChannel.get(g.channel.counterpartyId ?? '') ?? [];
            const e = expected(own);
            expect(g.spreadPct).toBe(e.pct);
            expect(g.conversions).toBe(own.length);
            expect(g.converted.toFixed()).toBe(Money.roundToScale(e.converted, BOB, 'HALF_EVEN').toFixed());
          }
          // Excluir (agregar conversiones sin referencia) no cambia ninguna cifra contada.
          expect(withExcluded.groups.length).toBeGreaterThanOrEqual(analysis.groups.length);
          for (const g of analysis.groups) {
            const same = withExcluded.groups.find(
              (x) =>
                x.channel.counterpartyId === g.channel.counterpartyId &&
                x.sourceAccountId === g.sourceAccountId,
            );
            expect(same?.spreadPct).toBe(g.spreadPct);
            expect(same?.converted.toFixed()).toBe(g.converted.toFixed());
            expect(same?.costTotal.toFixed()).toBe(g.costTotal.toFixed());
            expect(same?.conversions).toBe(g.conversions);
          }
          // Los totales cuadran con la suma exacta de los grupos (cuantizada una vez).
          expect(analysis.totals.conversions).toBe(rows.length);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});
