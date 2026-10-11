import { LocalDate, Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateTracking, type GoalTrackingInput } from './goal-tracking-evaluator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);
const auto = (progress: string, over: Partial<GoalTrackingInput> = {}): GoalTrackingInput => ({
  lifecycleStatus: 'ACTIVE',
  target: Money.parse('10000.00', BOB),
  progress: dec(progress),
  startDate: d('2026-01-01'),
  targetDate: d('2026-04-11'),
  today: d('2026-02-20'),
  tolerancePercent: '5.00',
  ...over,
});

describe('GoalTrackingEvaluator (FR-GOALS-003)', () => {
  it('[TC-GOALS-SAVINGS-034] "Auto" a mitad de camino: 4800 ON_TRACK (−4.00 %), 4700 BEHIND (−6.00 %), 5300 AHEAD (+6.00 %)', () => {
    const on = evaluateTracking(auto('4800.00'));
    expect(on).toMatchObject({ status: 'ON_TRACK', deviationPercent: '-4.00' });
    expect(on.expected?.toFixed()).toBe('5000.00');
    expect(evaluateTracking(auto('4700.00'))).toMatchObject({ status: 'BEHIND', deviationPercent: '-6.00' });
    expect(evaluateTracking(auto('5300.00'))).toMatchObject({ status: 'AHEAD', deviationPercent: '6.00' });
  });

  it('[TC-GOALS-SAVINGS-034] la tolerancia es inclusiva en ambos extremos: 4750 (−5.00 %) y 5250 (+5.00 %) son ON_TRACK', () => {
    expect(evaluateTracking(auto('4750.00'))).toMatchObject({
      status: 'ON_TRACK',
      deviationPercent: '-5.00',
    });
    expect(evaluateTracking(auto('5250.00'))).toMatchObject({ status: 'ON_TRACK', deviationPercent: '5.00' });
    expect(evaluateTracking(auto('4749.99')).status).toBe('BEHIND');
    expect(evaluateTracking(auto('5250.01')).status).toBe('AHEAD');
  });

  it('[TC-GOALS-SAVINGS-034] una meta pausada no informa estado de avance sino su estado de ciclo de vida', () => {
    const t = evaluateTracking(auto('4800.00', { lifecycleStatus: 'PAUSED' }));
    expect(t).toEqual({ status: null, lifecycleStatus: 'PAUSED', expected: null, deviationPercent: null });
    for (const s of ['ACHIEVED', 'CLOSED', 'CANCELLED'] as const) {
      expect(evaluateTracking(auto('0', { lifecycleStatus: s })).status).toBeNull();
    }
  });

  it('[TC-GOALS-SAVINGS-034] sin fecha objetivo no informa estado de avance', () => {
    expect(evaluateTracking(auto('100.00', { targetDate: null })).status).toBeNull();
  });

  it('[TC-GOALS-SAVINGS-034] hoy = inicio: esperado 0 ⇒ ON_TRACK sin desvío', () => {
    const t = evaluateTracking(auto('0', { today: d('2026-01-01') }));
    expect(t).toMatchObject({ status: 'ON_TRACK', deviationPercent: null });
    expect(t.expected?.toFixed()).toBe('0.00');
    // un día antes del inicio tampoco divide por cero
    expect(evaluateTracking(auto('0', { today: d('2025-12-31') })).status).toBe('ON_TRACK');
  });

  it('[TC-GOALS-SAVINGS-034] fecha objetivo vencida sin alcanzar ⇒ BEHIND aunque esté dentro de la tolerancia', () => {
    const t = evaluateTracking(auto('9700.00', { today: d('2026-04-12') }));
    expect(t.status).toBe('BEHIND');
    expect(t.expected?.toFixed()).toBe('10000.00');
    // el mismo día de la fecha objetivo aún se evalúa linealmente
    expect(evaluateTracking(auto('9700.00', { today: d('2026-04-11') })).status).toBe('ON_TRACK');
  });

  it('[TC-GOALS-SAVINGS-034] una tolerancia por meta distinta de 5.00', () => {
    expect(evaluateTracking(auto('4800.00', { tolerancePercent: '3.00' })).status).toBe('BEHIND');
    expect(evaluateTracking(auto('4800.00', { tolerancePercent: '0.00' })).status).toBe('BEHIND');
    expect(evaluateTracking(auto('5000.00', { tolerancePercent: '0.00' })).status).toBe('ON_TRACK');
  });

  it('PBT: el estado es coherente con el signo del desvío y la tolerancia', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (progressCents, elapsed) => {
          const t = evaluateTracking(
            auto(dec(String(progressCents)).div(100).toFixed(2), {
              startDate: d('2026-01-01'),
              targetDate: d('2026-04-11'),
              today: d('2026-01-01').plusDays(elapsed),
            }),
          );
          const dev = dec(t.deviationPercent as string);
          if (t.status === 'ON_TRACK') expect(dev.abs().lte(dec('5.005'))).toBe(true);
          if (t.status === 'BEHIND') expect(dev.lt(0)).toBe(true);
          if (t.status === 'AHEAD') expect(dev.gt(0)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);
});
