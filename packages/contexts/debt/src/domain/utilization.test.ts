import { Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeUtilization,
  creditUsed,
  evaluateThresholds,
  initialThresholdStates,
  type ThresholdState,
} from './utilization.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);

describe('UtilizationCalculator (add-credit-cards, decisión 10)', () => {
  it('[TC-DEBT-CARD-020] límite compartido: usado 4580.00 BOB, 30.53 %, disponible 10420.00 BOB', () => {
    // 3600.00 BOB + 100.00 USD × 9.80 = 4580.00 BOB (la consolidación la hace la aplicación con FlowValuation).
    const u = computeUtilization({ limit: bob('15000.00'), used: bob('4580.00') });
    expect(u.used.toFixed()).toBe('4580.00');
    expect(u.display).toBe('30.53');
    expect(u.available.toFixed()).toBe('10420.00');
    expect(u.overdrawn).toBe(false);
  });

  it('[TC-DEBT-CARD-020] crédito usado = saldo adeudado + compras pendientes: 1195.50 BOB, 11.96 %, disponible 8804.50 BOB', () => {
    const used = creditUsed({ presentedBalance: bob('1120.50'), pendingOut: bob('75.00') });
    expect(used.toFixed()).toBe('1195.50');
    const u = computeUtilization({ limit: bob('10000.00'), used });
    expect(u.display).toBe('11.96');
    expect(u.available.toFixed()).toBe('8804.50');
  });

  it('[TC-DEBT-CARD-020] saldo a favor sin pendientes ⇒ utilización 0; el crédito no se resta de otras cuentas', () => {
    expect(creditUsed({ presentedBalance: usd('-30.00'), pendingOut: usd('0.00') }).toFixed()).toBe('0.00');
    const u = computeUtilization({ limit: usd('1000.00'), used: usd('0.00') });
    expect(u.display).toBe('0.00');
    expect(u.available.toFixed()).toBe('1000.00');
  });

  it('una tarjeta sobregirada informa disponible negativo', () => {
    const u = computeUtilization({ limit: bob('1000.00'), used: bob('1200.00') });
    expect(u.overdrawn).toBe(true);
    expect(u.available.toFixed()).toBe('-200.00');
    expect(u.display).toBe('120.00');
  });

  it('[TC-DEBT-CARD-024] utilización con el saldo adeudado completo (no el facturado): 1000.00 / 10000.00 = 10.00 %', () => {
    expect(computeUtilization({ limit: bob('10000.00'), used: bob('1000.00') }).display).toBe('10.00');
  });
});

describe('UtilizationThresholdTracker (add-credit-cards, decisión 11)', () => {
  const states = (...pairs: [string, boolean, number?][]): ThresholdState[] =>
    pairs.map(([threshold, armed, crossingNo]) => ({ threshold, armed, crossingNo: crossingNo ?? 0 }));
  const pct = (v: string) => dec(v);

  it('[TC-DEBT-CARD-021] cruce del 30 %: de 26.53 % a 30.53 % publica el umbral 30.00', () => {
    const r = evaluateThresholds(states(['30.00', true], ['80.00', true]), pct('30.5333'));
    expect(r.event).toEqual({ threshold: '30.00', alsoCrossed: [], crossingNo: 1 });
    expect(r.states).toEqual(states(['30.00', false, 1], ['80.00', true]));
  });

  it('[TC-DEBT-CARD-021] dos umbrales en un solo cambio: 85.00 % publica 80.00 y también cruzado el 30.00', () => {
    const r = evaluateThresholds(states(['30.00', true], ['80.00', true]), pct('85'));
    expect(r.event).toEqual({ threshold: '80.00', alsoCrossed: ['30.00'], crossingNo: 1 });
    expect(r.crossings).toEqual([
      { threshold: '30.00', crossingNo: 1 },
      { threshold: '80.00', crossingNo: 1 },
    ]);
  });

  it('[TC-DEBT-CARD-021] sin repetir mientras sigue arriba: 30.53 % → 31.20 % no publica nada', () => {
    const after = evaluateThresholds(states(['30.00', true], ['80.00', true]), pct('30.5333')).states;
    const r = evaluateThresholds(after, pct('31.20'));
    expect(r.event).toBeNull();
    expect(r.states).toEqual(after);
  });

  it('[TC-DEBT-CARD-021] vuelve a avisar tras bajar: 12.00 % rearma y 30.10 % publica de nuevo con crossingNo 2', () => {
    const crossed = evaluateThresholds(states(['30.00', true], ['80.00', true]), pct('30.5333')).states;
    const down = evaluateThresholds(crossed, pct('12.00'));
    expect(down.event).toBeNull();
    expect(down.states).toEqual(states(['30.00', true, 1], ['80.00', true]));
    const up = evaluateThresholds(down.states, pct('30.10'));
    expect(up.event).toEqual({ threshold: '30.00', alsoCrossed: [], crossingNo: 2 });
  });

  it('[TC-DEBT-CARD-020] sin utilización calculable (falta de tasa) no se evalúa ningún umbral', () => {
    const initial = states(['30.00', true], ['80.00', false, 1]);
    const r = evaluateThresholds(initial, null);
    expect(r.event).toBeNull();
    expect(r.states).toEqual(initial);
  });

  it('el estado inicial de un alta no dispara: arma solo los umbrales aún no alcanzados', () => {
    expect(initialThresholdStates(['30.00', '80.00'], pct('45'))).toEqual(
      states(['30.00', false], ['80.00', true]),
    );
    expect(initialThresholdStates(['30.00', '80.00'], null)).toEqual(
      states(['30.00', true], ['80.00', true]),
    );
  });

  it('[TC-DEBT-CARD-021] PBT: nunca hay dos eventos seguidos sin bajar del umbral, y el evento siempre lleva el umbral más alto cruzado', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 12_000 }), { minLength: 1, maxLength: 60 }),
        (series) => {
          let current: readonly ThresholdState[] = initialThresholdStates(
            ['30.00', '80.00', '95.50'],
            pct('0'),
          );
          let lastEventAt = new Map<string, number>();
          series.forEach((basis, index) => {
            const value = pct(String(basis / 100));
            const r = evaluateThresholds(current, value);
            if (r.event) {
              const crossed = [r.event.threshold, ...r.event.alsoCrossed];
              for (const t of crossed) {
                expect(value.gte(dec(t))).toBe(true);
                // Entre dos eventos del mismo umbral hubo un valor por debajo.
                const previous = lastEventAt.get(t);
                if (previous !== undefined) {
                  const between = series
                    .slice(previous + 1, index)
                    .some((b) => dec(String(b / 100)).lt(dec(t)));
                  expect(between).toBe(true);
                }
                lastEventAt.set(t, index);
              }
              const highest = crossed.map((t) => dec(t)).reduce((a, b) => (a.gt(b) ? a : b));
              expect(dec(r.event.threshold).eq(highest)).toBe(true);
            }
            current = r.states;
          });
          lastEventAt = new Map();
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000);
});
