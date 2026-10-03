import fc from 'fast-check';
import { currency, dec, Money, MoneyDecimal } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ConsolidationService } from './consolidation-service.js';
import { present, type ExactRate } from './valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const USDT_BOB: ExactRate = { base: 'USDT', quote: 'BOB', value: dec('12.02') };

describe('ConsolidationService (docs/14 §5: agrega por moneda, convierte una vez, redondea al presentar)', () => {
  it('[TC-REPORTING-DASHBOARD-002] 805.50 BOB + 50.000000 USDT a 12.02 = 1406.50 BOB', () => {
    const r = ConsolidationService.consolidate(
      [Money.parse('685.00', BOB), Money.parse('120.50', BOB), Money.parse('50.000000', USDT)],
      BOB,
      (ccy) => (ccy === 'USDT' ? USDT_BOB : null),
    );
    expect(present(r.total, BOB).toString()).toBe('1406.50 BOB');
    expect(r.complete).toBe(true);
    expect(r.unconverted).toEqual([]);
    expect(r.convertedCurrencies).toEqual(['USDT']);
  });

  it('[TC-REPORTING-DASHBOARD-003] sin tasa BTC/BOB el BTC queda sin convertir y el consolidado incompleto (nunca 1:1)', () => {
    const balances = [
      Money.parse('805.50', BOB),
      Money.parse('50.000000', USDT),
      Money.parse('0.01000000', BTC),
    ];
    const r = ConsolidationService.consolidate(balances, BOB, (ccy) => (ccy === 'USDT' ? USDT_BOB : null));
    expect(present(r.total, BOB).toString()).toBe('1406.50 BOB');
    expect(r.complete).toBe(false);
    expect(r.unconverted.map(String)).toEqual(['0.01000000 BTC']);

    // Variante: la tasa USDT está fuera de la ventana (el resolver de FX no devuelve ninguna).
    const v = ConsolidationService.consolidate(balances, BOB, () => null);
    expect(present(v.total, BOB).toString()).toBe('805.50 BOB');
    expect(v.complete).toBe(false);
    expect(v.unconverted.map(String)).toEqual(['0.01000000 BTC', '50.000000 USDT']);
  });

  it('un saldo cero sin tasa no vuelve incompleto el consolidado', () => {
    const r = ConsolidationService.consolidate([Money.parse('10.00', BOB), Money.zero(BTC)], BOB, () => null);
    expect(r.complete).toBe(true);
    expect(r.unconverted).toEqual([]);
  });

  it('[TC-REPORTING-DASHBOARD-004] dos wallets de 33.333333 USDT a 12.02 consolidan 801.33 BOB (no 801.34)', () => {
    const r = ConsolidationService.consolidate(
      [Money.parse('33.333333', USDT), Money.parse('33.333333', USDT)],
      BOB,
      () => USDT_BOB,
    );
    expect(r.total.toFixed()).toBe('801.33332532');
    expect(present(r.total, BOB).toString()).toBe('801.33 BOB');
    const perAccount = Money.parse('33.333333', USDT);
    const roundedEach = present(perAccount.amount.times('12.02'), BOB);
    expect(roundedEach.add(roundedEach).toString()).toBe('801.34 BOB');
  });

  it('[TC-REPORTING-DASHBOARD-004] propiedad: consolidado = round_HALF_EVEN(Σ saldos × tasa), determinista', () => {
    const usdtUnits = fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n });
    const rateString = fc
      .bigInt({ min: 1n, max: 10n ** 10n })
      .map((u) => new MoneyDecimal(u.toString()).div('1000000').toFixed());
    fc.assert(
      fc.property(fc.array(usdtUnits, { minLength: 1, maxLength: 8 }), rateString, (units, r) => {
        const balances = units.map((u) => Money.ofMinorUnits(u, USDT));
        const rate: ExactRate = { base: 'USDT', quote: 'BOB', value: dec(r) };
        const sum = units.reduce((a, u) => a + u, 0n);
        const expected = Money.roundToScale(Money.ofMinorUnits(sum, USDT).amount.times(r), BOB);
        const a = present(ConsolidationService.consolidate(balances, BOB, () => rate).total, BOB);
        const b = present(
          ConsolidationService.consolidate([...balances].reverse(), BOB, () => rate).total,
          BOB,
        );
        expect(a.equals(expected)).toBe(true);
        expect(b.equals(a)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('[TC-REPORTING-KPI-003] flujos: 20.00 USD del 10-sep a 11.96 + 100.00 BOB = 339.20 BOB; una tasa posterior no cambia septiembre', () => {
    const rows = [
      { date: '2026-09-10', amount: Money.parse('20.00', USD) },
      { date: '2026-09-12', amount: Money.parse('100.00', BOB) },
    ];
    // Tasas vigentes al cierre de cada día: la del 2026-10-02 (12.02) no es vigente al cierre del 10-sep.
    const history: { asOfDate: string; rate: ExactRate }[] = [
      { asOfDate: '2026-09-10', rate: { base: 'USD', quote: 'BOB', value: dec('11.96') } },
    ];
    const rateAt = (ccy: string, date: string) =>
      history.filter((h) => h.rate.base === ccy && h.asOfDate <= date).at(-1)?.rate ?? null;
    const before = ConsolidationService.consolidateFlows(rows, BOB, rateAt);
    expect(present(before.total, BOB).toString()).toBe('339.20 BOB');
    history.push({ asOfDate: '2026-10-02', rate: { base: 'USD', quote: 'BOB', value: dec('12.02') } });
    const after = ConsolidationService.consolidateFlows(rows, BOB, rateAt);
    expect(present(after.total, BOB).toString()).toBe('339.20 BOB');
    expect(after.complete).toBe(true);
  });

  it('flujos: agrega por día y moneda antes de convertir y lista lo no convertido por moneda', () => {
    const rows = [
      { date: '2026-09-10', amount: Money.parse('10.00', USD) },
      { date: '2026-09-10', amount: Money.parse('10.00', USD) },
      { date: '2026-09-11', amount: Money.parse('1.00', USD) },
    ];
    const calls: string[] = [];
    const r = ConsolidationService.consolidateFlows(rows, BOB, (ccy, date) => {
      calls.push(`${ccy}@${date}`);
      return date === '2026-09-10' ? { base: 'BOB', quote: 'USD', value: dec('0.14367816') } : null;
    });
    expect(calls).toEqual(['USD@2026-09-10', 'USD@2026-09-11']);
    // 20.00 USD ÷ 0.14367816 (tasa inversa almacenada) = 139.20000…
    expect(present(r.total, BOB).toString()).toBe('139.20 BOB');
    expect(r.complete).toBe(false);
    expect(r.unconverted.map(String)).toEqual(['1.00 USD']);
  });
});
