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

describe('FlowValuation: ramas de consolidate y resolveRates', () => {
  const rateOf = (code: string) => (code === 'USD' ? USD_BOB : null);

  it('agrega por (día, moneda), omite los netos en cero y suma la moneda de reporte sin convertir', () => {
    const r = FlowValuation.consolidate(
      [
        { date: '2026-11-12', amount: Money.parse('20.00', USD) },
        { date: '2026-11-12', amount: Money.parse('-20.00', USD) },
        { date: '2026-11-12', amount: Money.parse('10.00', BOB) },
        { date: '2026-11-13', amount: Money.parse('5.50', BOB) },
      ],
      BOB,
      () => {
        throw new Error('no debe pedir tasa de un neto en cero ni de la moneda de reporte');
      },
    );
    expect(present(r.total, BOB).toString()).toBe('15.50 BOB');
    expect(r).toMatchObject({ complete: true, unconverted: [], convertedCurrencies: [] });
  });

  it('una tasa por día: la misma moneda en días distintos se convierte con la tasa de cada día', () => {
    const byDay = (code: string, date: string): ExactRate | null =>
      code === 'USD' ? { base: 'USD', quote: 'BOB', value: dec(date === '2026-11-12' ? '10' : '20') } : null;
    const r = FlowValuation.consolidate(
      [
        { date: '2026-11-12', amount: Money.parse('1.00', USD) },
        { date: '2026-11-13', amount: Money.parse('1.00', USD) },
      ],
      BOB,
      byDay,
    );
    expect(present(r.total, BOB).toString()).toBe('30.00 BOB');
    expect(r.convertedCurrencies).toEqual(['USD']);
  });

  it('con una tasa inversa (BOB/USD almacenada) convierte dividiendo sin redondear antes de presentar', () => {
    const inverse: ExactRate = { base: 'BOB', quote: 'USD', value: dec('0.083') };
    const r = FlowValuation.consolidate(
      [{ date: '2026-11-12', amount: Money.parse('8.30', USD) }],
      BOB,
      () => inverse,
    );
    expect(present(r.total, BOB).toString()).toBe('100.00 BOB');
  });

  it('lo no convertido se suma por moneda, ordenado por código, y los netos en cero no se informan', () => {
    const r = FlowValuation.consolidate(
      [
        { date: '2026-11-14', amount: Money.parse('5.00', EUR) },
        { date: '2026-11-15', amount: Money.parse('2.00', EUR) },
        { date: '2026-11-15', amount: Money.parse('3.00', currency('BRL', 2)) },
        { date: '2026-11-16', amount: Money.parse('1.00', currency('BRL', 2)) },
        { date: '2026-11-16', amount: Money.parse('-1.00', currency('BRL', 2)) },
        { date: '2026-11-12', amount: Money.parse('1.00', USD) },
      ],
      BOB,
      rateOf,
    );
    expect(r.unconverted.map(String)).toEqual(['3.00 BRL', '7.00 EUR']);
    expect(r.complete).toBe(false);
    expect(present(r.total, BOB).toString()).toBe('12.05 BOB');
  });

  it('sin flujos el total es 0 y está completo', () => {
    const r = FlowValuation.consolidate([], BOB, rateOf);
    expect(r.total.toFixed()).toBe('0');
    expect(r.complete).toBe(true);
  });

  it('resolveRates sin flujos en otra moneda no llama al resolutor y el buscador devuelve null', async () => {
    let calls = 0;
    const rates = await FlowValuation.resolveRates<{ id: string }>({
      flows: [{ date: '2026-11-12', amount: Money.parse('1.00', BOB) }],
      target: BOB,
      timeZone: 'America/La_Paz',
      now: Instant.parse('2026-11-20T15:00:00Z'),
      windowDays: 7,
      resolve: async () => {
        calls += 1;
        return [];
      },
      keyOf: (r) => r.id,
    });
    expect(calls).toBe(0);
    expect(rates.rateFor('USD', '2026-11-12')).toBeNull();
    expect(rates.collector().used()).toEqual([]);
  });

  it('resolveRates trata undefined y null como "sin tasa" y el colector distingue versiones por keyOf', async () => {
    const rates = await FlowValuation.resolveRates<{ id: string }>({
      flows: [
        { date: '2026-11-12', amount: Money.parse('1.00', USD) },
        { date: '2026-11-13', amount: Money.parse('1.00', USD) },
        { date: '2026-11-14', amount: Money.parse('1.00', EUR) },
        { date: '2026-11-15', amount: Money.parse('1.00', currency('BRL', 2)) },
      ],
      target: BOB,
      timeZone: 'America/La_Paz',
      now: Instant.parse('2026-11-20T15:00:00Z'),
      windowDays: 3,
      resolve: async ({ requests }) =>
        requests.map((req) => {
          if (req.base === 'USD') {
            const id = req.at.startsWith('2026-11-13') ? 'v1' : 'v2';
            return { exact: { base: 'USD', quote: 'BOB', value: '12.05' }, resolved: { id } };
          }
          return req.base === 'EUR' ? null : undefined;
        }),
      keyOf: (r) => r.id,
    });
    const collector = rates.collector();
    collector.rateFor('USD', '2026-11-12');
    collector.rateFor('USD', '2026-11-13');
    expect(collector.rateFor('EUR', '2026-11-14')).toBeNull();
    expect(collector.rateFor('BRL', '2026-11-15')).toBeNull();
    expect(rates.rateFor('USD', '2026-11-99')).toBeNull();
    expect(
      collector
        .used()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['v1', 'v2']);
    // `rateFor` directo (sin colector) devuelve la tasa exacta como Decimal.
    expect(rates.rateFor('USD', '2026-11-12')?.value.toFixed()).toBe('12.05');
  });
});
