import {
  FixedClock,
  Instant,
  LocalDate,
  Money,
  currency,
  dec,
  present,
  type Cadence,
} from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildSchedule } from '../definition-version.js';
import { SubscriptionCostCalculator, renewalsPerYear } from './cost-calculator.js';
import {
  PriceChangeDetector,
  formatSignedPercent,
  parseTolerance,
  presentImpliedRate,
} from './price-change-detector.js';
import { RenewalReminderPolicy } from './renewal-reminder-policy.js';

const USD = currency('USD', 2);
const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const usd = (a: string) => Money.parse(a, USD);
const bob = (a: string) => Money.parse(a, BOB);

describe('Detector de cambio de precio', () => {
  it('[TC-COMMITMENTS-SUBS-020] 9.99 USD → 11.99 USD es +20.02 % y supera la tolerancia de 1.00 %', () => {
    const result = PriceChangeDetector.evaluate({
      expected: usd('9.99'),
      charged: usd('11.99'),
      tolerancePercent: '1.00',
    });
    expect(result).toEqual({
      outcome: 'PRICE_CHANGE_DETECTED',
      deviationPercent: '+20.02',
      impliedRate: null,
    });
  });

  it('[TC-COMMITMENTS-SUBS-021] la tolerancia es estricta y se compara sin redondear el desvío', () => {
    const evaluate = (expected: Money, charged: Money) =>
      PriceChangeDetector.evaluate({ expected, charged, tolerancePercent: '1.00' });
    expect(evaluate(bob('250.00'), bob('252.50')).outcome).toBe('WITHIN_TOLERANCE');
    expect(evaluate(usd('9.99'), usd('10.05')).outcome).toBe('WITHIN_TOLERANCE');
    const edge = evaluate(bob('250.00'), bob('252.51'));
    expect(edge.outcome).toBe('PRICE_CHANGE_DETECTED');
    expect(edge.deviationPercent).toBe('+1.00');
    // una baja también se detecta (valor absoluto)
    expect(evaluate(bob('250.00'), bob('240.00'))).toMatchObject({
      outcome: 'PRICE_CHANGE_DETECTED',
      deviationPercent: '-4.00',
    });
    expect(evaluate(bob('250.00'), bob('250.00')).deviationPercent).toBe('+0.00');
  });

  it('[TC-COMMITMENTS-SUBS-021] la tolerancia es configurable entre 0.00 y 50.00', () => {
    const evaluate = (tolerancePercent: string) =>
      PriceChangeDetector.evaluate({ expected: usd('10.00'), charged: usd('10.50'), tolerancePercent })
        .outcome;
    expect(evaluate('0.00')).toBe('PRICE_CHANGE_DETECTED');
    expect(evaluate('5.00')).toBe('WITHIN_TOLERANCE');
    expect(evaluate('4.99')).toBe('PRICE_CHANGE_DETECTED');
    expect(parseTolerance('1')).toBe('1.00');
    expect(parseTolerance('50')).toBe('50.00');
    expect(() => parseTolerance('50.5')).toThrow();
    expect(() => parseTolerance('abc')).toThrow();
  });

  it('[TC-COMMITMENTS-SUBS-024] entre monedas distintas no compara: registra la tasa implícita 9.8726', () => {
    const result = PriceChangeDetector.evaluate({
      expected: usd('10.99'),
      charged: bob('108.50'),
      tolerancePercent: '1.00',
    });
    expect(result.outcome).toBe('NOT_COMPARABLE');
    expect(result.deviationPercent).toBeNull();
    expect(presentImpliedRate(result.impliedRate as string)).toBe('9.8726');
  });

  it('[TC-COMMITMENTS-SUBS-024] con el monto del extracto en USD se detecta +18.20 % (12.99 sobre 10.99)', () => {
    const result = PriceChangeDetector.evaluate({
      expected: usd('10.99'),
      charged: usd('12.99'),
      tolerancePercent: '1.00',
    });
    expect(result).toMatchObject({ outcome: 'PRICE_CHANGE_DETECTED', deviationPercent: '+18.20' });
  });

  it('formatea la variación con signo y HALF_EVEN', () => {
    expect(formatSignedPercent(dec('20.025'))).toBe('+20.02');
    expect(formatSignedPercent(dec('20.035'))).toBe('+20.04');
    expect(formatSignedPercent(dec('-0.004'))).toBe('+0.00');
    expect(formatSignedPercent(dec('-3.5'))).toBe('-3.50');
  });
});

describe('Costo mensualizado y anualizado', () => {
  const today = LocalDate.parse('2026-11-10');
  const schedule = (cadence: string, interval = 1) =>
    buildSchedule({
      cadence,
      interval,
      startDate: '2026-11-15',
      ...(cadence === 'SEMIMONTHLY' ? { monthDays: [1, 15] } : {}),
    });
  const rates = { USD: dec('9.80'), USDT: dec('9.70'), BOB: dec('1') } as const;

  it('[TC-COMMITMENTS-SUBS-025] las suscripciones del owner suman 487.86 BOB al mes y 5854.33 BOB al año', () => {
    const items = [
      { price: usd('10.99'), cadence: 'MONTHLY', rate: rates.USD },
      { price: usd('99.99'), cadence: 'ANNUAL', rate: rates.USD },
      { price: Money.parse('5.000000', USDT), cadence: 'MONTHLY', rate: rates.USDT },
      { price: bob('250.00'), cadence: 'MONTHLY', rate: rates.BOB },
    ];
    let monthly = dec('0');
    let annual = dec('0');
    const presented: string[][] = [];
    for (const item of items) {
      const cost = SubscriptionCostCalculator.cost(
        item.price,
        renewalsPerYear(schedule(item.cadence), today),
      );
      monthly = monthly.plus(cost.monthly.times(item.rate));
      annual = annual.plus(cost.annual.times(item.rate));
      presented.push([
        present(cost.monthly.times(item.rate), BOB).toFixed(),
        present(cost.annual.times(item.rate), BOB).toFixed(),
      ]);
    }
    expect(presented).toEqual([
      ['107.70', '1292.42'],
      ['81.66', '979.90'],
      ['48.50', '582.00'],
      ['250.00', '3000.00'],
    ]);
    expect(present(monthly, BOB).toFixed()).toBe('487.86');
    expect(present(annual, BOB).toFixed()).toBe('5854.33');
  });

  it('[TC-COMMITMENTS-SUBS-025] cadencia semanal: 1040.00 al año y 86.67 al mes', () => {
    const cost = SubscriptionCostCalculator.cost(bob('20.00'), renewalsPerYear(schedule('WEEKLY'), today));
    expect(present(cost.annual, BOB).toFixed()).toBe('1040.00');
    expect(present(cost.monthly, BOB).toFixed()).toBe('86.67');
  });

  it('[TC-COMMITMENTS-SUBS-025] renovaciones por año de cada cadencia dividen por el intervalo', () => {
    const per = (cadence: string, interval = 1) =>
      renewalsPerYear(schedule(cadence, interval), today).toString();
    expect(per('DAILY')).toBe('365');
    expect(per('BIWEEKLY')).toBe('26');
    expect(per('SEMIMONTHLY')).toBe('24');
    expect(per('BIMONTHLY')).toBe('6');
    expect(per('QUARTERLY')).toBe('4');
    expect(per('SEMIANNUAL')).toBe('2');
    expect(per('MONTHLY', 3)).toBe('4');
    expect(per('ANNUAL', 2)).toBe('0.5');
  });

  it('[TC-COMMITMENTS-SUBS-025] una regla personalizada cuenta las renovaciones de los próximos 12 meses', () => {
    const custom = buildSchedule({
      cadence: 'CUSTOM',
      rrule: 'FREQ=MONTHLY;INTERVAL=2',
      startDate: '2026-11-15',
    });
    expect(renewalsPerYear(custom, today).toString()).toBe('6');
  });

  it('[TC-COMMITMENTS-SUBS-025] PBT: mensualizado × 12 == anualizado a precisión completa', () => {
    const cadences: Cadence[] = [
      'DAILY',
      'WEEKLY',
      'BIWEEKLY',
      'SEMIMONTHLY',
      'MONTHLY',
      'BIMONTHLY',
      'QUARTERLY',
      'SEMIANNUAL',
      'ANNUAL',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...cadences),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 9_999_999 }),
        (cadence, interval, cents) => {
          const price = usd((cents / 100).toFixed(2));
          const cost = SubscriptionCostCalculator.cost(
            price,
            renewalsPerYear(
              buildSchedule({
                cadence,
                interval: cadence === 'SEMIMONTHLY' ? 1 : interval,
                startDate: '2026-11-15',
                ...(cadence === 'SEMIMONTHLY' ? { monthDays: [1, 15] } : {}),
              }),
              today,
            ),
          );
          // 40 dígitos significativos: la igualdad se verifica hasta la precisión del Decimal
          expect(cost.monthly.times(12).minus(cost.annual).abs().lt(dec('1e-25'))).toBe(true);
        },
      ),
      { numRuns: process.env['NIGHTLY'] ? 10_000 : 100 },
    );
  });
});

describe('Política del recordatorio', () => {
  const lapaz = 'America/La_Paz';
  const todayAt = (iso: string) => LocalDate.ofInstant(new FixedClock(Instant.parse(iso)).now(), lapaz);

  it('[TC-COMMITMENTS-SUBS-027] recuerda cuando faltan como máximo N días y nunca una fecha pasada', () => {
    const due = (today: string, target: string, daysBefore = 3) =>
      RenewalReminderPolicy.isDue({ today: LocalDate.parse(today), targetDate: target, daysBefore });
    expect(due('2026-11-12', '2026-11-15')).toBe(true);
    expect(due('2026-11-11', '2026-11-15')).toBe(false);
    expect(due('2026-11-15', '2026-11-15')).toBe(true);
    expect(due('2026-11-16', '2026-11-15')).toBe(false);
    expect(due('2026-11-01', '2026-11-15', 14)).toBe(true);
  });

  it('[TC-COMMITMENTS-SUBS-028] bordes de día en La Paz: 23:30 del día 11 aún es 11 y 00:05 ya es 12 (RISK-020)', () => {
    // 2026-11-12T03:30Z = 2026-11-11 23:30 en La Paz (UTC−4); 04:05Z = 2026-11-12 00:05
    const before = todayAt('2026-11-12T03:30:00Z');
    const after = todayAt('2026-11-12T04:05:00Z');
    expect(before.toString()).toBe('2026-11-11');
    expect(after.toString()).toBe('2026-11-12');
    const target = '2026-11-15';
    expect(RenewalReminderPolicy.isDue({ today: before, targetDate: target, daysBefore: 3 })).toBe(false);
    expect(RenewalReminderPolicy.isDue({ today: after, targetDate: target, daysBefore: 3 })).toBe(true);
  });
});
