import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { roundForDisplay, trimRate } from '../common/money';
import type { ConversionDetail, FxRate } from '../common/types';
import { rateHref } from '../dashboard/LiquidBalanceCard';
import { esContext, textOf } from '../test-support';
import { ConversionDetailView, PricingSummary } from './ConversionDetailView';
import { groupRatesByPair, pairOrientation, withPreference } from './logic';

const f = esContext('Fx');
const WALLET = '0190a000-0000-7000-8000-0000000000c3';
const BANK = '0190a000-0000-7000-8000-0000000000c1';
const R1 = '0190a000-0000-7000-8000-0000000000f1';
const R2 = '0190a000-0000-7000-8000-0000000000f2';
const bob = (amount: string) => ({ amount, currency: 'BOB' });

/** Conversión canónica (ARCHITECTURE §4.2): 100.000000 USDT → 690.00 BOB bruto, fee 5.00 BOB, 685.00 neto. */
const CANONICAL: ConversionDetail = {
  revision: 1,
  sourceAccountId: WALLET,
  targetAccountId: BANK,
  sourceAmount: { amount: '100.000000', currency: 'USDT' },
  convertedSourceAmount: { amount: '100.000000', currency: 'USDT' },
  grossTargetAmount: bob('690.00'),
  targetAmount: bob('685.00'),
  quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
  effectiveRate: { base: 'USDT', quote: 'BOB', value: '6.850000000000000000' },
  referenceRate: {
    rate: { base: 'USDT', quote: 'BOB', value: '6.95' },
    fxRateId: R2,
    source: 'MANUAL',
    rateType: 'P2P',
  },
  spread: { percentage: '0.719424460431654676', amount: bob('5.00') },
  quotedRateDeviation: null,
  totalCost: { amount: bob('10.00'), complete: true },
  fees: [{ type: 'PROVIDER', amount: bob('5.00'), paidFromAccountId: null }],
  executedAt: '2026-09-30T18:42:00Z',
};

describe('formulario y detalle de conversión (add-manual-conversions 6.2, 6.3)', () => {
  it('[TC-FX-PRICING-001] el resumen muestra tasa efectiva 6,85, referencia P2P 6,95, spread 0,72 % y costo total en es-BO', () => {
    const html = renderToStaticMarkup(<PricingSummary pricing={CANONICAL} f={f} fees={CANONICAL.fees} />);
    const text = textOf(html);
    expect(text).toContain('Entregas100,000000 USDT');
    expect(text).toContain('Recibes685,00 BOB (bruto 690,00 BOB)');
    expect(text).toContain('Tasa efectiva6,85 BOB/USDT');
    expect(text).toContain('Tasa cotizada6,90 BOB/USDT');
    expect(text).toContain('Tasa de referencia6,95 BOB/USDT · P2P · manual');
    expect(text).toContain('Spread contra la referencia0,72 % · 5,00 BOB');
    expect(text).toContain('ComisionesComisión del proveedor 5,00 BOB');
    expect(text).toContain('Costo total (comisiones + spread)10,00 BOB');
    expect(html).not.toContain('pricing-deviation');
  });

  it('sin referencia lo dice; una cotizada que no cuadra se advierte (los montos mandan)', () => {
    const html = renderToStaticMarkup(
      <PricingSummary
        pricing={{
          ...CANONICAL,
          referenceRate: null,
          spread: null,
          quotedRateDeviation: bob('3.00'),
          totalCost: { amount: bob('5.00'), complete: false },
        }}
        f={f}
      />,
    );
    expect(textOf(html)).toContain('Sin tasa de referencia disponible');
    expect(textOf(html)).toContain('No se puede calcular sin referencia');
    expect(textOf(html)).toContain('incompleto: hay montos sin valorar');
    expect(html).toContain('data-testid="pricing-deviation"');
    expect(textOf(html)).toContain('(diferencia 3,00 BOB)');
  });

  it('el detalle muestra la revisión vigente, el historial de revisiones y el detalle contable plegado', () => {
    const html = renderToStaticMarkup(
      <ConversionDetailView
        detail={{ ...CANONICAL, revision: 2, targetAmount: bob('680.00') }}
        revisions={[
          {
            revision: 1,
            journalEntryId: R1,
            active: false,
            createdAt: '2026-09-30T18:45:00Z',
            detail: CANONICAL,
          },
          {
            revision: 2,
            journalEntryId: R2,
            active: true,
            createdAt: '2026-10-01T12:00:00Z',
            detail: { ...CANONICAL, revision: 2, targetAmount: bob('680.00') },
          },
        ]}
        legs={[
          { accountId: WALLET, amount: { amount: '-100.000000', currency: 'USDT' }, role: 'SOURCE' },
          { accountId: BANK, amount: bob('680.00'), role: 'TARGET' },
        ]}
        f={f}
        accountName={(id) => (id === WALLET ? 'Wallet USDT' : 'Banco BOB')}
      />,
    );
    expect(textOf(html)).toContain('Detalle de la conversión (revisión 2)');
    expect(textOf(html)).toContain('Wallet USDT → Banco BOB');
    expect(html.match(/<tr data-active=/g)).toHaveLength(2);
    expect(html).toMatch(/<tr data-active="false">[\s\S]*?685,00 BOB/);
    expect(html).toMatch(/<tr data-active="true">[\s\S]*?680,00 BOB/);
    expect(html).toContain('<details data-testid="accounting-detail"><summary>Detalle contable</summary>');
  });

  it('orientación del par, tasas sin ceros de persistencia y redondeo solo de presentación', () => {
    expect(pairOrientation('USDT', 'BOB', 'BOB')).toEqual({ base: 'USDT', quote: 'BOB' });
    expect(pairOrientation('BOB', 'USDT', 'BOB')).toEqual({ base: 'USDT', quote: 'BOB' });
    expect(pairOrientation('USDT', 'BTC', 'BOB')).toEqual({ base: 'USDT', quote: 'BTC' });
    expect(trimRate('6.850000000000000000')).toBe('6.85');
    expect(trimRate('62375')).toBe('62375.00');
    expect(trimRate('0.000016030000000000')).toBe('0.00001603');
    expect(roundForDisplay('0.719424460431654676', 2)).toBe('0.72');
    expect(roundForDisplay('0.725', 2)).toBe('0.72');
  });
});

describe('pantalla de tasas (6.1)', () => {
  const rate = (over: Partial<FxRate>): FxRate => ({
    id: R1,
    base: 'USDT',
    quote: 'BOB',
    value: '6.95',
    rateType: 'P2P',
    source: 'MANUAL',
    asOf: '2026-09-29T19:00:00Z',
    effectiveDate: '2026-09-29',
    createdAt: '2026-09-29T19:00:00Z',
    ...over,
  });

  it('agrupa por par con las vigentes primero, las reemplazadas al final y la preferencia del par', () => {
    const groups = groupRatesByPair(
      [
        rate({ id: R1, value: '6.59', supersededByRateId: R2 }),
        rate({ id: R2, value: '6.95', supersedesRateId: R1 }),
        rate({ id: 'u', base: 'USD', value: '6.96' }),
      ],
      [{ base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' }],
    );
    expect(groups.map((g) => g.pair)).toEqual(['USD/BOB', 'USDT/BOB']);
    expect(groups[1]!.rates.map((r) => r.value)).toEqual(['6.95', '6.59']);
    expect(groups[1]!.preferred).toBe('PARALLEL');
    expect(groups[0]!.preferred).toBeNull();
  });

  it('cambiar la preferencia de un par reemplaza solo ese par en la lista completa', () => {
    const prefs = [
      { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' as const },
      { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' as const },
    ];
    expect(withPreference(prefs, 'USDT', 'BOB', 'P2P')).toEqual([
      { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' },
      { base: 'USDT', quote: 'BOB', rateType: 'P2P' },
    ]);
    expect(withPreference(prefs, 'BOB', 'USD', '')).toEqual([
      { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' },
    ]);
  });

  it('"Registrar tasa X/BOB" del Home lleva a la pantalla de tasas con el par prellenado', () => {
    expect(rateHref('/fx', 'BTC', 'BOB')).toBe('/fx?base=BTC&quote=BOB');
    expect(rateHref('/en/fx?x=1', 'BTC', 'BOB')).toBe('/en/fx?x=1&base=BTC&quote=BOB');
  });
});
