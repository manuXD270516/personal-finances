import { currency as makeCurrency, dec, LocalDate, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PredictedSpendingBand, type BandMainDay, type BandPeriodInput } from './predicted-spending-band.js';

const BOB = makeCurrency('BOB', 2);
const bob = (a: string) => Money.parse(a, BOB);
const text = (m: Money) => m.toFixed();

/** Serie principal constante entre `from` y `to` (ambos incluidos). */
const flat = (from: string, to: string, balance: string, low = balance): BandMainDay[] => {
  const out: BandMainDay[] = [];
  for (let e = LocalDate.parse(from).toEpochDay(); e <= LocalDate.parse(to).toEpochDay(); e += 1) {
    out.push({ date: LocalDate.ofEpochDay(e).toString(), balance: bob(balance), low: bob(low) });
  }
  return out;
};

const NOVEMBER: BandPeriodInput = {
  start: '2026-11-01',
  end: '2026-11-30',
  expected: dec('1500.00'),
  high: dec('1900.00'),
  low: dec('1200.00'),
};
const DECEMBER: BandPeriodInput = {
  start: '2026-12-01',
  end: '2026-12-31',
  expected: dec('1550.00'),
  high: dec('1900.00'),
  low: dec('1200.00'),
};

const pointOn = (band: ReturnType<typeof PredictedSpendingBand.compute>, date: string) =>
  band.series.find((p) => p.date === date);

describe('PredictedSpendingBand', () => {
  it('[TC-REPORTING-PREDICTED-001] reparte lo que falta del periodo en curso: 4640.00 esperado, 4320.00 alto y 4880.00 bajo el 2026-11-28', () => {
    const main = flat('2026-11-21', '2026-11-28', '5000.00');
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('0.00'),
      main,
      periods: [NOVEMBER],
      spent: dec('1050.00'),
    });
    const day = pointOn(band, '2026-11-28');
    expect(text((day as NonNullable<typeof day>).expected)).toBe('4640.00');
    expect(text((day as NonNullable<typeof day>).high)).toBe('4320.00');
    expect(text((day as NonNullable<typeof day>).low)).toBe('4880.00');
    // La serie principal no se toca.
    expect(text((main.at(-1) as BandMainDay).balance)).toBe('5000.00');
  });

  it('[TC-REPORTING-PREDICTED-001] con hoy dentro del periodo, hoy ya lleva su parte (45.00 el 2026-11-21)', () => {
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('0.00'),
      main: flat('2026-11-21', '2026-11-23', '5000.00'),
      periods: [NOVEMBER],
      spent: dec('1050.00'),
    });
    expect(text(band.series[0]?.expected as Money)).toBe('4955.00');
    expect(text(band.series[1]?.expected as Money)).toBe('4910.00');
  });

  it('[TC-REPORTING-PREDICTED-002] con el gasto ya superado lo que falta es 0.00 y las series coinciden con la principal', () => {
    expect(PredictedSpendingBand.remaining(dec('1500.00'), dec('2000.00')).toFixed(2)).toBe('0.00');
    expect(PredictedSpendingBand.remaining(dec('1900.00'), dec('2000.00')).toFixed(2)).toBe('0.00');
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('0.00'),
      main: flat('2026-11-21', '2026-11-30', '5000.00'),
      periods: [NOVEMBER],
      spent: dec('2000.00'),
    });
    expect(band.series.every((p) => text(p.expected) === '5000.00' && text(p.high) === '5000.00')).toBe(true);
    expect(band.series.every((p) => text(p.low) === '5000.00')).toBe(true);
  });

  it('[TC-REPORTING-PREDICTED-003] el periodo siguiente se reparte entre todos sus días: 50.00 por día de diciembre', () => {
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('0.00'),
      main: flat('2026-11-20', '2026-12-20', '5000.00'),
      periods: [NOVEMBER, DECEMBER],
      spent: dec('0.00'),
    });
    const dec01 = pointOn(band, '2026-12-01') as NonNullable<ReturnType<typeof pointOn>>;
    const dec02 = pointOn(band, '2026-12-02') as NonNullable<ReturnType<typeof pointOn>>;
    expect(dec02.expected.toDecimal().minus(dec01.expected.toDecimal()).toFixed(2)).toBe('-50.00');
    const nov30 = pointOn(band, '2026-11-30') as NonNullable<ReturnType<typeof pointOn>>;
    expect(dec01.expected.toDecimal().minus(nov30.expected.toDecimal()).toFixed(2)).toBe('-50.00');
  });

  it('[TC-REPORTING-PREDICTED-003] el reparto cuantiza a la escala de la moneda y el residuo va al último día', () => {
    const parts = PredictedSpendingBand.split(dec('100.00'), 3, BOB);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
    const parts2 = PredictedSpendingBand.split(dec('0.05'), 10, BOB);
    expect(parts2.reduce((a, p) => a.plus(p), dec('0')).toFixed(2)).toBe('0.05');
  });

  it('[TC-REPORTING-PREDICTED-004] el déficit es posible si solo la serie con gasto alto baja del umbral (2026-12-14)', () => {
    const verdict = PredictedSpendingBand.likelihood({
      threshold: bob('1500.00'),
      expected: [
        { date: '2026-12-13', low: bob('2300.00') },
        { date: '2026-12-14', low: bob('2150.00') },
      ],
      high: [
        { date: '2026-12-13', low: bob('1700.00') },
        { date: '2026-12-14', low: bob('1380.00') },
        { date: '2026-12-15', low: bob('1380.00') },
      ],
    });
    expect(verdict).toEqual({ likelihood: 'POSSIBLE', firstShortfallDate: '2026-12-14' });
  });

  it('[TC-REPORTING-PREDICTED-005] el déficit es probable si la serie con gasto esperado baja del umbral (2026-12-10)', () => {
    const verdict = PredictedSpendingBand.likelihood({
      threshold: bob('1500.00'),
      expected: [
        { date: '2026-12-09', low: bob('1900.00') },
        { date: '2026-12-10', low: bob('1420.00') },
      ],
      high: [
        { date: '2026-12-08', low: bob('1480.00') },
        { date: '2026-12-10', low: bob('1100.00') },
      ],
    });
    expect(verdict).toEqual({ likelihood: 'LIKELY', firstShortfallDate: '2026-12-10' });
  });

  it('[TC-REPORTING-PREDICTED-005] improbable si ninguna serie baja del umbral y el umbral se compara con el mínimo del día', () => {
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('1500.00'),
      main: flat('2026-11-21', '2026-11-30', '5000.00'),
      periods: [NOVEMBER],
      spent: dec('0.00'),
    });
    expect(band.shortfallLikelihood).toBe('UNLIKELY');
    expect(band.firstShortfallDate).toBeNull();
    expect(text(band.lowest.expected.amount)).toBe('3500.00');
    expect(band.lowest.expected.date).toBe('2026-11-30');
  });

  it('[TC-REPORTING-PREDICTED-005] con la reserva mínima como umbral, el primer día bajo la reserva con gasto esperado da probable', () => {
    const band = PredictedSpendingBand.compute({
      currency: BOB,
      threshold: bob('3000.00'),
      main: flat('2026-11-21', '2026-11-30', '5000.00'),
      periods: [{ ...NOVEMBER, expected: dec('4000.00'), high: dec('5000.00'), low: dec('3000.00') }],
      spent: dec('0.00'),
    });
    // 4000.00 / 10 días = 400.00 por día: 5000 − 400×k < 3000 desde el sexto día (k = 6 → 2600.00).
    expect(band.shortfallLikelihood).toBe('LIKELY');
    expect(band.firstShortfallDate).toBe('2026-11-26');
  });

  it('[TC-REPORTING-PREDICTED-001] PBT: Σ del reparto del periodo = q y serie alta ≤ esperada ≤ baja en cada día', () => {
    const amount = fc.integer({ min: 0, max: 5_000_000 }).map((c) => dec(String(c)).div(100));
    fc.assert(
      fc.property(amount, amount, amount, amount, fc.integer({ min: 1, max: 40 }), (a, b, c, spent, days) => {
        const [low, expected, high] = [a, b, c].sort((x, y) => x.comparedTo(y));
        for (const q of [low, expected, high] as const) {
          const parts = PredictedSpendingBand.split(q as ReturnType<typeof dec>, days, BOB);
          expect(parts.reduce((s, p) => s.plus(p), dec('0')).toFixed(2)).toBe(
            (q as ReturnType<typeof dec>).toFixed(2),
          );
        }
        const band = PredictedSpendingBand.compute({
          currency: BOB,
          threshold: bob('0.00'),
          main: flat('2026-11-21', '2026-12-10', '100000.00'),
          periods: [
            {
              start: '2026-11-01',
              end: '2026-11-30',
              expected: expected as ReturnType<typeof dec>,
              high: high as ReturnType<typeof dec>,
              low: low as ReturnType<typeof dec>,
            },
            {
              start: '2026-12-01',
              end: '2026-12-31',
              expected: expected as ReturnType<typeof dec>,
              high: high as ReturnType<typeof dec>,
              low: low as ReturnType<typeof dec>,
            },
          ],
          spent,
        });
        for (const p of band.series) {
          expect(p.high.compare(p.expected)).toBeLessThanOrEqual(0);
          expect(p.expected.compare(p.low)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});
