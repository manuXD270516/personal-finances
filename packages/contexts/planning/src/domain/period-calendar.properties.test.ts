import { LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PeriodCalendar,
  labelOf,
  planCoverage,
  planReschedule,
  plusDays,
  type DateRange,
} from './period-calendar.js';

/** 100 corridas por PR (semilla fija); `NIGHTLY=1` → 10 000 (Financial Regression Suite). */
const NIGHTLY = Boolean(process.env['NIGHTLY']);
const runs = { numRuns: NIGHTLY ? 10_000 : 100, ...(NIGHTLY ? {} : { seed: 20261008 }) };
const TIMEOUT = NIGHTLY ? 600_000 : 30_000;

interface Row {
  label: string;
  range: DateRange;
  status: 'DRAFT' | 'ACTIVE';
}

const startDay = fc.integer({ min: 1, max: 28 });
const anyDate = fc
  .record({
    y: fc.integer({ min: 2020, max: 2035 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => LocalDate.of(y, m, d));

/** Contigüidad, no solapamiento, etiquetas únicas = mes de inicio y pertenencia de cada fecha a exactamente uno. */
function assertCalendar(rows: readonly { label: string; range: DateRange }[]): void {
  const labels = new Set<string>();
  for (const [i, r] of rows.entries()) {
    expect(r.range.start.compare(r.range.end)).toBeLessThanOrEqual(0);
    expect(labelOf(r.range.start)).toBe(r.label);
    expect(labels.has(r.label)).toBe(false);
    labels.add(r.label);
    const next = rows[i + 1];
    if (next) expect(plusDays(r.range.end, 1).toString()).toBe(next.range.start.toString());
  }
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return;
  // Muestra de fechas de la ventana (todas si es corta): cada una pertenece a exactamente un periodo.
  for (let day = first.range.start; day.compare(last.range.end) <= 0; day = plusDays(day, 7)) {
    const owners = rows.filter((r) => PeriodCalendar.contains(r.range, day));
    expect(owners).toHaveLength(1);
  }
}

describe('Propiedades del calendario financiero (INV-015)', () => {
  it(
    '[TC-PLANNING-PERIOD-002] ∀ día de inicio y ∀ secuencia de cambios aplicados hacia adelante: contiguos, sin solapes, etiquetas únicas y cada fecha en exactamente un periodo',
    () => {
      fc.assert(
        fc.property(
          startDay,
          anyDate,
          fc.integer({ min: 1, max: 36 }),
          fc.array(fc.record({ advance: fc.integer({ min: 0, max: 6 }), day: startDay }), { maxLength: 5 }),
          (initialDay, today0, windowMonths, changes) => {
            let today = today0;
            let rows: Row[] = [];
            // Mismo orden que la aplicación: activar los DRAFT iniciados → recalcular DRAFT → crear los que falten.
            const activate = () => {
              rows = rows.map((r) => (r.range.start.compare(today) <= 0 ? { ...r, status: 'ACTIVE' } : r));
            };
            const create = (s: number, lookahead: number) => {
              const plan = planCoverage({
                existing: rows,
                startDay: s,
                today,
                from: today,
                through: today,
                lookahead,
              });
              for (const p of plan) {
                const status = p.range.start.compare(today) <= 0 ? 'ACTIVE' : 'DRAFT';
                rows = [...rows, { label: p.label, range: p.range, status } as Row].sort((a, b) =>
                  a.range.start.compare(b.range.start),
                );
              }
            };
            create(initialDay, windowMonths);
            assertCalendar(rows);
            for (const change of changes) {
              today = plusDays(today, change.advance * 15);
              activate();
              for (const c of planReschedule(rows, change.day)) {
                const target = rows.find((r) => r.label === c.label);
                expect(target?.status).toBe('DRAFT');
                if (target) target.range = c.after.range;
              }
              create(change.day, 3);
              assertCalendar(rows);
            }
            // Con día 25: 2026-11-24 es de "2026-10" y 2026-11-25 de "2026-11".
            expect(PeriodCalendar.periodContaining(LocalDate.parse('2026-11-24'), 25).label).toBe('2026-10');
            expect(PeriodCalendar.periodContaining(LocalDate.parse('2026-11-25'), 25).label).toBe('2026-11');
          },
        ),
        runs,
      );
    },
    TIMEOUT,
  );

  it(
    '[TC-PLANNING-PERIOD-002] periodContaining(date) contiene la fecha y coincide con rangeFor(label)',
    () => {
      fc.assert(
        fc.property(startDay, anyDate, fc.integer({ min: 0, max: 3 }), (s, date, extra) => {
          const day = plusDays(date, extra);
          const p = PeriodCalendar.periodContaining(day, s);
          expect(PeriodCalendar.contains(p.range, day)).toBe(true);
          const r = PeriodCalendar.rangeFor(p.label, s);
          expect(`${r.start.toString()}..${r.end.toString()}`).toBe(
            `${p.range.start.toString()}..${p.range.end.toString()}`,
          );
        }),
        runs,
      );
    },
    TIMEOUT,
  );
});
