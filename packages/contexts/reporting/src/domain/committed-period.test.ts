import { currency, dec, Money, type ExactRate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CommittedPeriod } from './committed-period.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const usd12 = (code: string): ExactRate | null =>
  code === 'USD' ? { base: 'USD', quote: 'BOB', value: dec('12.00') } : null;
const TODAY = '2026-10-20';

const period = (label: string, periodStart: string, periodEnd: string) => ({
  id: `p-${label}`,
  label,
  periodStart,
  periodEnd,
});

describe('CommittedPeriod (Q4, FR-COMMITMENTS-011)', () => {
  // Octubre: Netflix 49 + Internet 199 + Luz 180 + Gimnasio (máx.) 200 BOB y Spotify 5.99 USD; pendiente Cena 300 BOB.
  const october = {
    fromCommitments: [bob('628.00'), usd('5.99')],
    fromPending: [bob('300.00')],
    withoutAmountCount: 1,
    today: TODAY,
    target: BOB,
    rateFor: usd12,
  };

  it('[TC-REPORTING-UPCOMING-013] el comprometido de octubre es 999.88 BOB: 699.88 de compromisos y 300.00 de pendientes', () => {
    const v = CommittedPeriod.value({ ...october, overdueBefore: { count: 0, amounts: [] } });
    expect(v.total.consolidated.amount.toFixed()).toBe('999.88');
    expect(v.fromCommitments.consolidated.amount.toFixed()).toBe('699.88');
    expect(v.fromPending.consolidated.amount.toFixed()).toBe('300.00');
    expect(v.total.byCurrency.map((m) => m.toString())).toEqual(['928.00 BOB', '5.99 USD']);
    expect(v.withoutAmountCount).toBe(1);
    expect(v.total.consolidated.complete).toBe(true);
  });

  it('[TC-REPORTING-UPCOMING-014] el vencido de un periodo anterior (120.00) se informa aparte y no suma', () => {
    const v = CommittedPeriod.value({
      ...october,
      overdueBefore: { count: 1, amounts: [bob('120.00')] },
    });
    expect(v.total.consolidated.amount.toFixed()).toBe('999.88');
    expect(v.overdueFromPreviousPeriods.count).toBe(1);
    expect(v.overdueFromPreviousPeriods.consolidated.amount.toFixed()).toBe('120.00');
  });

  it('[TC-REPORTING-UPCOMING-013] sin tasa el USD queda sin convertir y el total, incompleto', () => {
    const v = CommittedPeriod.value({
      ...october,
      rateFor: () => null,
      overdueBefore: { count: 0, amounts: [] },
    });
    expect(v.total.consolidated.complete).toBe(false);
    expect(v.total.consolidated.amount.toFixed()).toBe('928.00');
    expect(v.total.consolidated.unconverted.map((m) => m.toString())).toEqual(['5.99 USD']);
  });

  it('[TC-REPORTING-UPCOMING-015] con día de inicio 25 el 2026-10-20 el periodo vigente es 2026-09 (25 sep a 24 oct)', () => {
    const periods = [
      period('2026-08', '2026-08-25', '2026-09-24'),
      period('2026-09', '2026-09-25', '2026-10-24'),
      period('2026-10', '2026-10-25', '2026-11-24'),
    ];
    expect(CommittedPeriod.locate(periods, TODAY)?.label).toBe('2026-09');
    // Seguro 120 + Netflix 49 + Cena 300 + Internet 199 = 668.00; Spotify (2026-10-25) cae en el periodo siguiente.
    const v = CommittedPeriod.value({
      fromCommitments: [bob('368.00')],
      fromPending: [bob('300.00')],
      withoutAmountCount: 0,
      overdueBefore: { count: 0, amounts: [] },
      today: TODAY,
      target: BOB,
      rateFor: usd12,
    });
    expect(v.total.consolidated.amount.toFixed()).toBe('668.00');
  });

  it('[TC-REPORTING-UPCOMING-015] los bordes del periodo son inclusivos y sin periodo devuelve null', () => {
    const periods = [period('2026-10', '2026-10-01', '2026-10-31')];
    expect(CommittedPeriod.locate(periods, '2026-10-01')?.label).toBe('2026-10');
    expect(CommittedPeriod.locate(periods, '2026-10-31')?.label).toBe('2026-10');
    expect(CommittedPeriod.locate(periods, '2026-11-01')).toBeNull();
  });
});
