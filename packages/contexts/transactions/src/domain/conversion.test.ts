import { DomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  CCY,
  BANK_BOB,
  CASH_BOB,
  CASH_USD,
  R2,
  WALLET_BTC,
  WALLET_TRX,
  WALLET_USDT,
  acct,
  canonical,
  conversionData,
  convert,
  info,
  m,
  postingsOf,
  rate,
  sumsByCurrency,
} from './conversion.fixtures.test-support.js';
import { deriveConversion, displayOrientation, priceConversion } from './conversion.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const usdtBob = displayOrientation(info('USDT'), info('BOB'));

describe('Orientación de display (docs/09 §7.1)', () => {
  it('la moneda más fuerte/cripto es la base: USD/BOB, USDT/BOB, BTC/USDT, USDT/USD, EUR/USD', () => {
    const o = (a: string, b: string) => {
      const r = displayOrientation(info(a), info(b));
      return `${r.base.code}/${r.quote.code}`;
    };
    expect([o('BOB', 'USD'), o('BOB', 'USDT'), o('USDT', 'BTC'), o('USD', 'USDT'), o('USD', 'EUR')]).toEqual([
      'USD/BOB',
      'USDT/BOB',
      'BTC/USDT',
      'USDT/USD',
      'EUR/USD',
    ]);
    expect(o('USD', 'BOB')).toBe(o('BOB', 'USD'));
  });
});

describe('ConversionCalculator (fx/conversion-pricing)', () => {
  it('[TC-FX-PRICING-001] venta canónica: bruto 690.00, neto 685.00, efectiva 6.850000000000000000 y fees = (cotizada − efectiva) × 100', () => {
    const p = priceConversion({
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: m('685.00', 'BOB'),
      fees: [{ type: 'PROVIDER', amount: m('5.00', 'BOB'), paidFromAccountId: null }],
      quotedRate: rate('USDT', 'BOB', '6.90'),
      referenceRate: R2.rate,
      display: usdtBob,
    });
    expect(p.grossTarget.toFixed()).toBe('690.00');
    expect(p.convertedSource.toFixed()).toBe('100.000000');
    expect([p.effectiveRate.base.code, p.effectiveRate.quote.code, p.effectiveRate.toPersisted()]).toEqual([
      'USDT',
      'BOB',
      '6.850000000000000000',
    ]);
    const feesTotal = Money.roundToScale(
      rate('USDT', 'BOB', '6.90').value.minus(p.effectiveRate.value).times('100'),
      CCY.BOB,
    );
    expect(feesTotal.toFixed()).toBe('5.00');
    expect(p.spread).toEqual({ percentage: '0.719424460431654676', amount: m('5.00', 'BOB') });
    expect(p.quotedRateDeviation).toBeNull();
  });

  it('[TC-FX-PRICING-001] compra de USDT con BOB y fee en USDT: efectiva USDT/BOB = 7.007007007007007007', () => {
    const p = priceConversion({
      sourceAmount: m('700.00', 'BOB'),
      targetAmount: m('99.900000', 'USDT'),
      fees: [{ type: 'PROVIDER', amount: m('0.100000', 'USDT'), paidFromAccountId: null }],
      quotedRate: rate('USDT', 'BOB', '7.00'),
      referenceRate: R2.rate,
      display: usdtBob,
    });
    expect(p.effectiveRate.toPersisted()).toBe('7.007007007007007007');
    expect(p.grossTarget.toFixed()).toBe('100.000000');
  });

  it('[TC-FX-PRICING-002] spread de venta y de compra: 0.719424460431654676 % y 5.00 BOB (positivo = desfavorable)', () => {
    const sell = priceConversion({
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: m('690.00', 'BOB'),
      fees: [],
      quotedRate: rate('USDT', 'BOB', '6.90'),
      referenceRate: rate('USDT', 'BOB', '6.95'),
      display: usdtBob,
    });
    const buy = priceConversion({
      sourceAmount: m('700.00', 'BOB'),
      targetAmount: m('100.000000', 'USDT'),
      fees: [],
      quotedRate: rate('USDT', 'BOB', '7.00'),
      referenceRate: rate('USDT', 'BOB', '6.95'),
      display: usdtBob,
    });
    for (const p of [sell, buy]) {
      expect(p.spread?.percentage).toBe('0.719424460431654676');
      expect(p.spread?.amount.toString()).toBe('5.00 BOB');
    }
    // La misma tasa cotizada en la orientación inversa (BOB/USDT) da el mismo spread.
    const inverted = priceConversion({
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: m('690.00', 'BOB'),
      fees: [],
      quotedRate: rate('USDT', 'BOB', '6.90').inverse(),
      referenceRate: rate('USDT', 'BOB', '6.95'),
      display: usdtBob,
    });
    expect(inverted.spread?.percentage).toBe('0.719424460431654676');
    // Una cotizada mejor que la referencia da spread negativo (favorable).
    const favourable = priceConversion({
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: m('700.00', 'BOB'),
      fees: [],
      quotedRate: rate('USDT', 'BOB', '7.00'),
      referenceRate: rate('USDT', 'BOB', '6.95'),
      display: usdtBob,
    });
    expect(favourable.spread?.percentage.startsWith('-')).toBe(true);
  });

  it('[TC-FX-PRICING-003] sin referencia o sin cotizada el spread queda no determinable; la efectiva se calcula igual', () => {
    const noRef = canonical({ reference: null }).snapshot.conversion;
    expect([noRef?.referenceRate, noRef?.spread, noRef?.effectiveRate.toPersisted()]).toEqual([
      null,
      null,
      '6.850000000000000000',
    ]);
    const noQuoted = canonical({ quoted: null }).snapshot.conversion;
    expect(noQuoted?.spread).toBeNull();
    expect(noQuoted?.referenceRate?.rate.value.toFixed()).toBe('6.95');
    expect(noQuoted?.quotedRateDeviation).toBeNull();
  });

  it('[TC-FX-PRICING-005] cotizada que no cuadra (> 1 unidad mínima) se marca discrepante; los montos prevalecen', () => {
    const over = canonical({ target: m('684.00', 'BOB') }).snapshot.conversion;
    expect(over?.quotedRateDeviation?.toString()).toBe('-1.00 BOB');
    expect(over?.quotedRateDeviation?.abs().toString()).toBe('1.00 BOB');
    expect(over?.effectiveRate.toPersisted()).toBe('6.840000000000000000');
    expect(over?.grossTargetAmount.toFixed()).toBe('689.00');
    const within = canonical({ target: m('685.01', 'BOB') });
    expect(within.snapshot.conversion?.quotedRateDeviation).toBeNull();
    expect(postingsOf(within)).toContainEqual([BANK_BOB, '685.01 BOB']);
  });
});

describe('RecordConversion: patas por moneda (transactions/conversions)', () => {
  it('[TC-TRANSACTIONS-CONVERSION-001] ejemplo canónico USDT→BOB: un asiento que cuadra por moneda y detalle completo', () => {
    const tx = canonical();
    const s = tx.snapshot;
    expect([s.kind, s.amount.toString(), s.accountId]).toEqual([
      'CONVERSION',
      '100.000000 USDT',
      WALLET_USDT,
    ]);
    expect(postingsOf(tx)).toEqual([
      [WALLET_USDT, '-100.000000 USDT'],
      ['FX_TRADING:USDT', '100.000000 USDT'],
      ['FX_TRADING:BOB', '-690.00 BOB'],
      [BANK_BOB, '685.00 BOB'],
      ['EXPENSE:BOB', '5.00 BOB'],
    ]);
    expect(sumsByCurrency(tx)).toEqual({ USDT: '0.000000', BOB: '0.00' });
    expect(s.splits.map((x) => [x.categoryId, x.amount.toString()])).toEqual([['cat-fees', '5.00 BOB']]);
    const d = s.conversion;
    expect([
      d?.sourceAmount.toString(),
      d?.convertedSourceAmount.toString(),
      d?.grossTargetAmount.toString(),
      d?.targetAmount.toString(),
      d?.quotedRate?.value.toFixed(2),
      d?.effectiveRate.toPersisted(),
      d?.referenceRate?.fxRateId,
      d?.spread?.percentage,
      d?.spread?.amount.toString(),
      d?.provider.name,
    ]).toEqual([
      '100.000000 USDT',
      '100.000000 USDT',
      '690.00 BOB',
      '685.00 BOB',
      '6.90',
      '6.850000000000000000',
      'R2',
      '0.719424460431654676',
      '5.00 BOB',
      'Binance P2P',
    ]);
    expect(d?.fees.map((f) => [f.type, f.amount.toString(), f.paidFromAccountId])).toEqual([
      ['PROVIDER', '5.00 BOB', null],
    ]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-004] fiat→fiat USD→BOB: FX_TRADING:BOB −696.00, Banco +691.00, Fees +5.00 y efectiva 6.91', () => {
    const tx = convert({
      from: acct(CASH_USD, 'USD'),
      to: acct(BANK_BOB, 'BOB'),
      source: m('100.00', 'USD'),
      target: m('691.00', 'BOB'),
      fees: [{ type: 'BANK', amount: m('5.00', 'BOB') }],
      quoted: rate('USD', 'BOB', '6.96'),
    });
    expect(postingsOf(tx)).toEqual([
      [CASH_USD, '-100.00 USD'],
      ['FX_TRADING:USD', '100.00 USD'],
      ['FX_TRADING:BOB', '-696.00 BOB'],
      [BANK_BOB, '691.00 BOB'],
      ['EXPENSE:BOB', '5.00 BOB'],
    ]);
    expect(sumsByCurrency(tx)).toEqual({ USD: '0.00', BOB: '0.00' });
    expect(tx.snapshot.conversion?.effectiveRate.toPersisted()).toBe('6.910000000000000000');
  });

  it('[TC-TRANSACTIONS-CONVERSION-004] fiat→cripto BOB→USDT con 0.100000 USDT descontados del destino', () => {
    const tx = convert({
      from: acct(BANK_BOB, 'BOB'),
      to: acct(WALLET_USDT, 'USDT'),
      source: m('700.00', 'BOB'),
      target: m('99.900000', 'USDT'),
      fees: [{ type: 'PROVIDER', amount: m('0.100000', 'USDT') }],
      quoted: rate('USDT', 'BOB', '7.00'),
    });
    expect(postingsOf(tx)).toEqual([
      [BANK_BOB, '-700.00 BOB'],
      ['FX_TRADING:BOB', '700.00 BOB'],
      ['FX_TRADING:USDT', '-100.000000 USDT'],
      [WALLET_USDT, '99.900000 USDT'],
      ['EXPENSE:USDT', '0.100000 USDT'],
    ]);
    expect(sumsByCurrency(tx)).toEqual({ BOB: '0.00', USDT: '0.000000' });
  });

  it('[TC-TRANSACTIONS-CONVERSION-004] cripto→cripto USDT→BTC con fee de proveedor en USDT', () => {
    const tx = convert({
      from: acct(WALLET_USDT, 'USDT'),
      to: acct(WALLET_BTC, 'BTC'),
      source: m('1000.000000', 'USDT'),
      target: m('0.01600000', 'BTC'),
      fees: [{ type: 'PROVIDER', amount: m('2.000000', 'USDT') }],
    });
    expect(postingsOf(tx)).toEqual([
      [WALLET_USDT, '-1000.000000 USDT'],
      ['FX_TRADING:USDT', '998.000000 USDT'],
      ['FX_TRADING:BTC', '-0.01600000 BTC'],
      [WALLET_BTC, '0.01600000 BTC'],
      ['EXPENSE:USDT', '2.000000 USDT'],
    ]);
    expect(sumsByCurrency(tx)).toEqual({ USDT: '0.000000', BTC: '0.00000000' });
  });

  it('[TC-TRANSACTIONS-CONVERSION-005] fee de red de 15.000000 TRX pagado desde Wallet TRX en el mismo asiento; efectiva BTC/USDT 62500', () => {
    const tx = convert({
      from: acct(WALLET_USDT, 'USDT'),
      to: acct(WALLET_BTC, 'BTC'),
      source: m('1000.000000', 'USDT'),
      target: m('0.01600000', 'BTC'),
      fees: [
        { type: 'PROVIDER', amount: m('2.000000', 'USDT') },
        { type: 'NETWORK', amount: m('15.000000', 'TRX'), paidFrom: acct(WALLET_TRX, 'TRX') },
      ],
      quoted: rate('BTC', 'USDT', '62375'),
    });
    expect(postingsOf(tx)).toEqual([
      [WALLET_USDT, '-1000.000000 USDT'],
      ['FX_TRADING:USDT', '998.000000 USDT'],
      ['FX_TRADING:BTC', '-0.01600000 BTC'],
      [WALLET_BTC, '0.01600000 BTC'],
      ['EXPENSE:USDT', '2.000000 USDT'],
      [WALLET_TRX, '-15.000000 TRX'],
      ['EXPENSE:TRX', '15.000000 TRX'],
    ]);
    expect(sumsByCurrency(tx)).toEqual({ USDT: '0.000000', BTC: '0.00000000', TRX: '0.000000' });
    const d = tx.snapshot.conversion;
    expect(d?.effectiveRate.toPersisted()).toBe('62500.000000000000000000');
    expect([d?.effectiveRate.base.code, d?.effectiveRate.quote.code]).toEqual(['BTC', 'USDT']);
    expect(d?.quotedRateDeviation).toBeNull();
    expect(d?.fees.map((f) => [f.type, f.amount.toString(), f.paidFromAccountId])).toEqual([
      ['PROVIDER', '2.000000 USDT', null],
      ['NETWORK', '15.000000 TRX', WALLET_TRX],
    ]);
    expect(tx.snapshot.legs.map((l) => [l.role, l.amount.toString()])).toEqual([
      ['SOURCE', '-1000.000000 USDT'],
      ['TARGET', '0.01600000 BTC'],
      ['FEE', '-15.000000 TRX'],
    ]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-002] cripto→cripto BTC→USDT con fee de red descontado del activo de origen', () => {
    const tx = convert({
      from: acct(WALLET_BTC, 'BTC'),
      to: acct(WALLET_USDT, 'USDT'),
      source: m('0.01250000', 'BTC'),
      target: m('600.000000', 'USDT'),
      fees: [{ type: 'NETWORK', amount: m('0.00050000', 'BTC') }],
      quoted: rate('BTC', 'USDT', '50000'),
    });
    expect(new Set(postingsOf(tx).map((p) => p.join(' ')))).toEqual(
      new Set([
        `${WALLET_BTC} -0.01250000 BTC`,
        'FX_TRADING:BTC 0.01200000 BTC',
        'EXPENSE:BTC 0.00050000 BTC',
        'FX_TRADING:USDT -600.000000 USDT',
        `${WALLET_USDT} 600.000000 USDT`,
      ]),
    );
    expect(sumsByCurrency(tx)).toEqual({ BTC: '0.00000000', USDT: '0.000000' });
    const d = tx.snapshot.conversion;
    expect([d?.effectiveRate.toPersisted(), d?.quotedRate?.value.toFixed(), d?.quotedRateDeviation]).toEqual([
      '48000.000000000000000000',
      '50000',
      null,
    ]);
  });
});

describe('RecordConversion: validaciones', () => {
  it('[TC-TRANSACTIONS-CONVERSION-003] misma moneda ⇒ CONVERSION_SAME_CURRENCY; monto en otra moneda ⇒ CURRENCY_MISMATCH', () => {
    expect(
      codeOf(() =>
        convert({
          from: acct(BANK_BOB, 'BOB'),
          to: acct(CASH_BOB, 'BOB'),
          source: m('100.00', 'BOB'),
          target: m('100.00', 'BOB'),
        }),
      ),
    ).toBe('CONVERSION_SAME_CURRENCY');
    expect(codeOf(() => canonical({ source: m('100.00', 'USD') }))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => canonical({ target: m('685.00', 'USD') }))).toBe('CURRENCY_MISMATCH');
    expect(
      codeOf(() =>
        canonical({
          fees: [{ type: 'NETWORK', amount: m('15.000000', 'TRX'), paidFrom: acct(WALLET_BTC, 'BTC') }],
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => canonical({ quoted: rate('USD', 'BOB', '6.96') }))).toBe('CURRENCY_MISMATCH');
  });

  it('[TC-TRANSACTIONS-CONVERSION-006] fees ≥ monto entregado o en tercera moneda sin cuenta pagadora ⇒ CONVERSION_AMOUNTS_INCONSISTENT', () => {
    expect(
      codeOf(() =>
        canonical({
          source: m('1.000000', 'USDT'),
          target: m('6.85', 'BOB'),
          fees: [{ type: 'PROVIDER', amount: m('1.500000', 'USDT') }],
          quoted: null,
        }),
      ),
    ).toBe('CONVERSION_AMOUNTS_INCONSISTENT');
    expect(
      codeOf(() =>
        canonical({ fees: [{ type: 'PROVIDER', amount: m('100.000000', 'USDT') }], quoted: null }),
      ),
    ).toBe('CONVERSION_AMOUNTS_INCONSISTENT');
    expect(codeOf(() => canonical({ fees: [{ type: 'NETWORK', amount: m('15.000000', 'TRX') }] }))).toBe(
      'CONVERSION_AMOUNTS_INCONSISTENT',
    );
    expect(codeOf(() => canonical({ target: m('0.00', 'BOB') }))).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-TRANSACTIONS-CONVERSION-007] más decimales que la escala ⇒ AMOUNT_SCALE_EXCEEDED; 0.01600000 BTC se acepta exacto', () => {
    expect(codeOf(() => m('100.0000001', 'USDT'))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(codeOf(() => m('5.001', 'BOB'))).toBe('AMOUNT_SCALE_EXCEEDED');
    const tx = convert({
      from: acct(WALLET_USDT, 'USDT'),
      to: acct(WALLET_BTC, 'BTC'),
      source: m('1000.000000', 'USDT'),
      target: m('0.01600000', 'BTC'),
    });
    expect(tx.snapshot.conversion?.targetAmount.toFixed()).toBe('0.01600000');
  });

  it('[TC-TRANSACTIONS-CONVERSION-008] el ConversionDetail es inmutable (congelado; ninguna operación lo modifica)', () => {
    const d = canonical().snapshot.conversion;
    expect(d && Object.isFrozen(d) && Object.isFrozen(d.fees) && Object.isFrozen(d.fees[0])).toBe(true);
    expect(() => {
      (d as unknown as { targetAmount: Money }).targetAmount = m('1.00', 'BOB');
    }).toThrow(TypeError);
    expect(d?.targetAmount.toFixed()).toBe('685.00');
  });
});

describe('AmendConversion (reversa + revisión nueva)', () => {
  it('[TC-TRANSACTIONS-CONVERSION-010] corregir 685.00 → 686.00 BOB (fee 4.00): revisión 2, detalle nuevo con efectiva 6.86 y el anterior intacto', () => {
    const tx = canonical();
    tx.attachEntry('entry-1');
    const old = tx.snapshot.conversion;
    const result = tx.amendConversion(
      conversionData({
        from: acct(WALLET_USDT, 'USDT'),
        to: acct(BANK_BOB, 'BOB'),
        source: m('100.000000', 'USDT'),
        target: m('686.00', 'BOB'),
        fees: [{ type: 'PROVIDER', amount: m('4.00', 'BOB') }],
        quoted: rate('USDT', 'BOB', '6.90'),
        reference: R2,
      }),
    );
    expect([result.ledgerImpact, result.previousEntryId, tx.revision, tx.snapshot.activeEntryId]).toEqual([
      true,
      'entry-1',
      2,
      null,
    ]);
    expect(tx.snapshot.conversion?.revision).toBe(2);
    expect(tx.snapshot.conversion?.effectiveRate.toPersisted()).toBe('6.860000000000000000');
    expect(old?.targetAmount.toFixed()).toBe('685.00');
    expect(old?.revision).toBe(1);
    expect(postingsOf(tx)).toEqual([
      [WALLET_USDT, '-100.000000 USDT'],
      ['FX_TRADING:USDT', '100.000000 USDT'],
      ['FX_TRADING:BOB', '-690.00 BOB'],
      [BANK_BOB, '686.00 BOB'],
      ['EXPENSE:BOB', '4.00 BOB'],
    ]);
    expect(tx.splitsReplaced).toBe(true);
  });

  it('una conversión anulada no se corrige; una conciliada exige des-conciliar; PATCH financiero se rechaza', () => {
    const voided = canonical();
    voided.attachEntry('e');
    voided.void('error', '2026-10-01T00:00:00Z');
    const data = conversionData({
      from: acct(WALLET_USDT, 'USDT'),
      to: acct(BANK_BOB, 'BOB'),
      source: m('100.000000', 'USDT'),
      target: m('686.00', 'BOB'),
    });
    expect(codeOf(() => voided.amendConversion(data))).toBe('INVALID_STATUS_TRANSITION');
    const reconciled = canonical({ status: 'CLEARED' });
    reconciled.attachEntry('e');
    reconciled.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(codeOf(() => reconciled.amendConversion(data))).toBe('TRANSACTION_RECONCILED');
    const tx = canonical();
    tx.attachEntry('e');
    expect(codeOf(() => tx.amend({ amount: m('50.000000', 'USDT') }))).toBe('VALIDATION_FAILED');
    expect(tx.amend({ description: 'P2P sábado' }).ledgerImpact).toBe(false);
  });
});

describe('Vista previa (deriveConversion, FR-TRANSACTIONS-025)', () => {
  const fees = [{ type: 'PROVIDER' as const, amount: m('5.00', 'BOB'), paidFromAccountId: null }];
  const base = {
    sourceCurrency: CCY.USDT,
    targetCurrency: CCY.BOB,
    display: usdtBob,
  };

  it('entregado + cotizada ⇒ 685.00 BOB a recibir; neto + cotizada ⇒ 100.000000 USDT; montos ⇒ cotizada 6.90', () => {
    const fromSource = deriveConversion({
      ...base,
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: null,
      quotedRate: rate('USDT', 'BOB', '6.90'),
      fees,
    });
    expect(fromSource.targetAmount.toString()).toBe('685.00 BOB');
    const fromTarget = deriveConversion({
      ...base,
      sourceAmount: null,
      targetAmount: m('685.00', 'BOB'),
      quotedRate: rate('USDT', 'BOB', '6.90'),
      fees,
    });
    expect(fromTarget.sourceAmount.toString()).toBe('100.000000 USDT');
    const fromAmounts = deriveConversion({
      ...base,
      sourceAmount: m('100.000000', 'USDT'),
      targetAmount: m('690.00', 'BOB'),
      quotedRate: null,
      fees: [],
    });
    expect(fromAmounts.quotedRate?.toPersisted()).toBe('6.900000000000000000');
    expect(
      codeOf(() =>
        deriveConversion({
          ...base,
          sourceAmount: m('1.000000', 'USDT'),
          targetAmount: null,
          quotedRate: null,
          fees,
        }),
      ),
    ).toBe('CONVERSION_AMOUNTS_INCONSISTENT');
  });
});
