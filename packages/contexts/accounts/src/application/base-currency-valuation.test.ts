import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { describe, expect, it } from 'vitest';
import { baseCurrencyBalanceOf } from './base-currency-valuation.js';

const BOB = { code: 'BOB', scale: 2 };
const LA_PAZ = 'America/La_Paz';
const RATE_ID = '0190a000-0000-7000-8000-000000000001';

function resolved(over: Partial<ResolvedRateDto> = {}): ResolvedRateDto {
  return {
    rate: { base: 'USD', quote: 'BOB', value: '6.96' },
    fxRateId: RATE_ID,
    derivation: 'DIRECT',
    components: [],
    rateType: 'PARALLEL',
    requestedRateType: 'PARALLEL',
    source: 'MANUAL',
    sourceLabel: null,
    asOf: '2026-03-14T16:00:00.000Z',
    ageDays: 0,
    ageSeconds: 79200,
    approx: false,
    provider: null,
    selection: 'MANUAL',
    stale: false,
    attribution: null,
    ...over,
  };
}

const valuation = (
  exact: { base: string; quote: string; value: string },
  over: Partial<ResolvedRateDto> = {},
): ValuationRateDto => ({ resolved: resolved(over), exact });

describe('baseCurrencyBalanceOf (equivalente en moneda base, FR-ACCOUNTS-010)', () => {
  it('[TC-ACCOUNTS-LIST-001] 500.00 USD a la tasa manual 6.96 del 2026-03-14 ⇒ 3480.00 BOB con fecha, fuente y versión de la tasa', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '500.00', currency: 'USD' },
      base: BOB,
      valuation: valuation({ base: 'USD', quote: 'BOB', value: '6.96' }),
      timeZone: LA_PAZ,
    });
    expect(r).toEqual({
      amount: { amount: '3480.00', currency: 'BOB' },
      rateDate: '2026-03-14',
      rateSource: 'MANUAL',
      fxRateId: RATE_ID,
      rate: resolved(),
    });
  });

  it('[TC-ACCOUNTS-LIST-001] sin tasa (p. ej. BTC→BOB) no inventa un equivalente: null (nunca 1:1)', () => {
    expect(
      baseCurrencyBalanceOf({
        balance: { amount: '0.01250000', currency: 'BTC' },
        base: BOB,
        valuation: null,
        timeZone: LA_PAZ,
      }),
    ).toBeNull();
  });

  it('una cuenta en la moneda base no lleva equivalente (contrato: null)', () => {
    expect(
      baseCurrencyBalanceOf({
        balance: { amount: '350.00', currency: 'BOB' },
        base: BOB,
        valuation: null,
        timeZone: LA_PAZ,
      }),
    ).toBeNull();
  });

  it('con la inversa usa la tasa ORIGINAL exacta (divide; nunca una inversa redondeada, INV-032)', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '100.00', currency: 'USD' },
      base: BOB,
      valuation: valuation(
        { base: 'BOB', quote: 'USD', value: '0.1436781609195402298850574712643678160920' },
        { derivation: 'INVERSE', rate: { base: 'USD', quote: 'BOB', value: '6.96' } },
      ),
      timeZone: LA_PAZ,
    });
    expect(r?.amount).toEqual({ amount: '696.00', currency: 'BOB' });
  });

  it('[TC-ACCOUNTS-LIST-001] redondeo HALF_EVEN una sola vez al presentar (0.501250 USDT × 2 = 1.0025 ⇒ 1.00)', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '0.501250', currency: 'USDT' },
      base: BOB,
      valuation: valuation(
        { base: 'USDT', quote: 'BOB', value: '2' },
        { rate: { base: 'USDT', quote: 'BOB', value: '2' } },
      ),
      timeZone: LA_PAZ,
    });
    expect(r?.amount).toEqual({ amount: '1.00', currency: 'BOB' });
  });

  it('pasivo adeudado se valora con su signo presentado (negativo = a favor del usuario)', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '-10.00', currency: 'USD' },
      base: BOB,
      valuation: valuation({ base: 'USD', quote: 'BOB', value: '6.96' }),
      timeZone: LA_PAZ,
    });
    expect(r?.amount).toEqual({ amount: '-69.60', currency: 'BOB' });
  });

  it('rateDate es la fecha de negocio del asOf en la zona del workspace', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '1.00', currency: 'USD' },
      base: BOB,
      valuation: valuation(
        { base: 'USD', quote: 'BOB', value: '6.96' },
        { asOf: '2026-03-15T02:00:00.000Z' },
      ),
      timeZone: LA_PAZ,
    });
    expect(r?.rateDate).toBe('2026-03-14');
  });

  it('cruzada por pivote (approx): fxRateId = primera tasa almacenada usada y la tasa resuelta completa', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '0.01000000', currency: 'BTC' },
      base: BOB,
      valuation: valuation(
        { base: 'BTC', quote: 'BOB', value: '696000' },
        {
          rate: { base: 'BTC', quote: 'BOB', value: '696000' },
          fxRateId: null,
          derivation: 'CROSS',
          components: [{ id: 'btc-usd' }, { id: 'usd-bob' }],
          approx: true,
        },
      ),
      timeZone: LA_PAZ,
    });
    expect(r?.amount).toEqual({ amount: '6960.00', currency: 'BOB' });
    expect(r?.fxRateId).toBe('btc-usd');
    expect(r?.rate.approx).toBe(true);
  });

  it('tasa de provider obsoleta: conserva stale, selección y atribución para mostrarlas', () => {
    const attribution = {
      provider: 'PARALELO_BO' as const,
      text: 'Fuente: proveedor',
      url: 'https://example.org',
      license: null,
      licenseUrl: null,
    };
    const r = baseCurrencyBalanceOf({
      balance: { amount: '1.00', currency: 'USD' },
      base: BOB,
      valuation: valuation(
        { base: 'USD', quote: 'BOB', value: '6.96' },
        {
          source: 'PROVIDER',
          provider: 'PARALELO_BO',
          selection: 'LAST_KNOWN_STALE',
          stale: true,
          attribution,
        },
      ),
      timeZone: LA_PAZ,
    });
    expect(r?.rateSource).toBe('PROVIDER');
    expect(r?.rate).toMatchObject({ stale: true, selection: 'LAST_KNOWN_STALE', attribution });
  });

  it('saldo cero con tasa ⇒ 0.00 en la moneda base', () => {
    const r = baseCurrencyBalanceOf({
      balance: { amount: '0.00', currency: 'USD' },
      base: BOB,
      valuation: valuation({ base: 'USD', quote: 'BOB', value: '6.96' }),
      timeZone: LA_PAZ,
    });
    expect(r?.amount).toEqual({ amount: '0.00', currency: 'BOB' });
  });

  it('una tasa que no es del par se rechaza (CURRENCY_MISMATCH), nunca se aplica 1:1', () => {
    expect(() =>
      baseCurrencyBalanceOf({
        balance: { amount: '1.00', currency: 'EUR' },
        base: BOB,
        valuation: valuation({ base: 'USD', quote: 'BOB', value: '6.96' }),
        timeZone: LA_PAZ,
      }),
    ).toThrow(/CURRENCY_MISMATCH|cannot convert/);
  });
});
