import { describe, expect, it } from 'vitest';
import { currency } from '../money/currency.js';
import { dec } from '../money/decimal.js';
import { Money } from '../money/money.js';
import { Instant } from '../time/instant.js';
import { present, type ExactRate } from './exact-rate.js';
import { FlowValuation } from './flow-valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const EUR = currency('EUR', 2);
const USD_BOB: ExactRate = { base: 'USD', quote: 'BOB', value: dec('12.05') };

describe('FlowValuation (extraída de Reporting, docs/33 D109)', () => {
  it('[TC-PLANNING-ACTUAL-004] 20.00 USD a 12.05 + 100.00 BOB = 341.00 BOB, una conversión por (moneda, día)', () => {
    const r = FlowValuation.consolidate(
      [
        { date: '2026-11-12', amount: Money.parse('20.00', USD) },
        { date: '2026-11-13', amount: Money.parse('100.00', BOB) },
      ],
      BOB,
      (code) => (code === 'USD' ? USD_BOB : null),
    );
    expect(present(r.total, BOB).toString()).toBe('341.00 BOB');
    expect(r.complete).toBe(true);
    expect(r.convertedCurrencies).toEqual(['USD']);
  });

  it('[TC-PLANNING-ACTUAL-006] 5.00 EUR sin tasa queda sin convertir y el resultado incompleto (nunca 1:1)', () => {
    const r = FlowValuation.consolidate(
      [
        { date: '2026-11-12', amount: Money.parse('20.00', USD) },
        { date: '2026-11-14', amount: Money.parse('5.00', EUR) },
      ],
      BOB,
      (code) => (code === 'USD' ? USD_BOB : null),
    );
    expect(present(r.total, BOB).toString()).toBe('241.00 BOB');
    expect(r.complete).toBe(false);
    expect(r.unconverted.map(String)).toEqual(['5.00 EUR']);
  });

  it('la tasa de un flujo se pide al cierre de su día en la zona del workspace, acotada a "ahora"', () => {
    const now = Instant.parse('2026-11-20T15:00:00Z');
    const requests = FlowValuation.rateRequests(
      [
        { date: '2026-11-12', amount: Money.parse('20.00', USD) },
        { date: '2026-11-12', amount: Money.parse('1.00', USD) },
        { date: '2026-11-20', amount: Money.parse('3.00', USD) },
        { date: '2026-11-13', amount: Money.parse('100.00', BOB) },
      ],
      BOB,
      'America/La_Paz',
      now,
    );
    expect(requests).toEqual([
      { key: 'USD|2026-11-12', base: 'USD', quote: 'BOB', at: '2026-11-13T03:59:59.999Z' },
      { key: 'USD|2026-11-20', base: 'USD', quote: 'BOB', at: '2026-11-20T15:00:00.000Z' },
    ]);
  });

  it('resolveRates resuelve en una llamada y el colector informa cada tasa usada una sola vez', async () => {
    let calls = 0;
    const rates = await FlowValuation.resolveRates<{ id: string }>({
      flows: [
        { date: '2026-11-12', amount: Money.parse('20.00', USD) },
        { date: '2026-11-14', amount: Money.parse('5.00', EUR) },
      ],
      target: BOB,
      timeZone: 'America/La_Paz',
      now: Instant.parse('2026-11-20T15:00:00Z'),
      windowDays: 7,
      resolve: async ({ requests, windowDays }) => {
        calls += 1;
        expect(windowDays).toBe(7);
        return requests.map((r) =>
          r.base === 'USD'
            ? { exact: { base: 'USD', quote: 'BOB', value: '12.05' }, resolved: { id: 'r1' } }
            : null,
        );
      },
      keyOf: (r) => r.id,
    });
    const collector = rates.collector();
    expect(collector.rateFor('USD', '2026-11-12')?.value.toFixed()).toBe('12.05');
    collector.rateFor('USD', '2026-11-12');
    expect(collector.rateFor('EUR', '2026-11-14')).toBeNull();
    expect(collector.used()).toEqual([{ id: 'r1' }]);
    expect(calls).toBe(1);
  });
});
