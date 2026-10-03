import { currency, DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CurrencyDefinition } from './currency-definition.js';
import { ExchangeRate } from './exchange-rate.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);

const record = (over: Partial<Parameters<typeof ExchangeRate.record>[0]> = {}) =>
  ExchangeRate.record({
    id: 'r1',
    workspaceId: 'ws',
    base: USDT,
    quote: BOB,
    value: '6.95',
    rateType: 'P2P',
    sourceLabel: 'Mediana Binance P2P',
    asOf: '2026-09-29T19:00:00Z',
    effectiveDate: '2026-09-29',
    createdAt: '2026-09-29T19:01:00.000Z',
    createdBy: 'u1',
    ...over,
  });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

describe('ExchangeRate (fx/market-rates)', () => {
  it('[TC-FX-RATE-001] registra USDT/BOB 6.95 P2P con origen manual, valor exacto, fuente e instante', () => {
    const r = record();
    expect(r.snapshot.source).toBe('MANUAL');
    expect(r.valueText).toBe('6.95');
    expect(r.snapshot.rateType).toBe('P2P');
    expect(r.snapshot.sourceLabel).toBe('Mediana Binance P2P');
    expect(r.snapshot.asOf).toBe('2026-09-29T19:00:00.000Z');
    expect([r.rate.base.code, r.rate.quote.code]).toEqual(['USDT', 'BOB']);
  });

  it('[TC-FX-RATE-001] una tasa con 18 decimales se guarda sin pérdida (no se redondea a la escala de la moneda)', () => {
    const r = record({ base: USD, value: '6.965432109876543210', rateType: 'PARALLEL' });
    expect(r.rate.toPersisted()).toBe('6.965432109876543210');
    expect(codeOf(() => record({ value: '6.9654321098765432101' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-FX-RATE-002] tasa cero, negativa o con base = quote se rechaza con VALIDATION_FAILED', () => {
    expect(codeOf(() => record({ value: '0.00' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => record({ value: '0' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => record({ value: '-6.95' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => record({ base: BOB, value: '1.00' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => record({ value: '6,95' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-FX-HISTORICAL-002] el reemplazo crea una versión nueva con la misma vigencia y no altera la original', () => {
    const r1 = record({ value: '9.65' });
    const r2 = r1.supersede(
      {
        id: 'r2',
        value: '6.95',
        reason: 'error de tipeo',
        createdAt: '2026-09-30T12:00:00.000Z',
        createdBy: 'u1',
      },
      null,
    );
    expect(r2.snapshot.supersedesId).toBe('r1');
    expect(r2.snapshot.supersedeReason).toBe('error de tipeo');
    expect([r2.snapshot.asOf, r2.snapshot.rateType, r2.valueText]).toEqual([r1.snapshot.asOf, 'P2P', '6.95']);
    expect(r1.valueText).toBe('9.65');
    expect(Object.isFrozen(r1)).toBe(true);
    expect(Object.isFrozen(r1.rate)).toBe(true);
  });

  it('[TC-FX-HISTORICAL-002] reemplazar dos veces la misma versión se rechaza con FX_RATE_ALREADY_SUPERSEDED', () => {
    const r1 = record({ value: '9.65' });
    const input = { id: 'r3', value: '6.94', reason: 'otra vez', createdAt: 'x', createdBy: 'u1' };
    expect(codeOf(() => r1.supersede(input, 'r2'))).toBe('FX_RATE_ALREADY_SUPERSEDED');
    expect(codeOf(() => r1.supersede({ ...input, reason: ' x ' }, null))).toBe('VALIDATION_FAILED');
  });

  it('la escala de una moneda es inmutable una vez usada (FR-FX-001)', () => {
    const base = {
      code: 'USDT',
      kind: 'CRYPTO' as const,
      name: 'Tether',
      scale: 6,
      symbol: null,
      isActive: true,
    };
    expect(CurrencyDefinition.of({ ...base, inUse: false }).withScale(8).scale).toBe(8);
    expect(codeOf(() => CurrencyDefinition.of({ ...base, inUse: true }).withScale(8))).toBe(
      'VALIDATION_FAILED',
    );
    expect(CurrencyDefinition.of({ ...base, inUse: true }).toCurrency()).toEqual({ code: 'USDT', scale: 6 });
  });
});
