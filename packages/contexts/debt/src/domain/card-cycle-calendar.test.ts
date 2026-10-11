import { LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CardCycleCalendar } from './card-cycle-calendar.js';
import type { CardTerms } from './card-types.js';

const d = (s: string) => LocalDate.parse(s);
const terms = (
  statementDay: number,
  dueDay: number,
  dueWeekendAdjustment: CardTerms['dueWeekendAdjustment'] = 'NONE',
): CardTerms => ({ statementDay, dueDay, dueWeekendAdjustment });
const calendar = (t: CardTerms) => CardCycleCalendar.single(t);

describe('CardCycleCalendar (add-credit-cards, decisión 2)', () => {
  it('[TC-DEBT-CARD-006] cierre 25 y vencimiento 15: el ciclo de octubre de 2026 va del 26-09 al 25-10 y vence el 15-11', () => {
    const cycle = calendar(terms(25, 15)).cycleClosingAt(d('2026-10-25'));
    expect(cycle.start.toString()).toBe('2026-09-26');
    expect(cycle.closing.toString()).toBe('2026-10-25');
    expect(cycle.nominalDue.toString()).toBe('2026-11-15');
    expect(cycle.dueDate.toString()).toBe('2026-11-15');
  });

  it('[TC-DEBT-CARD-006] cierre 31 y vencimiento 20: cierres de enero a marzo de 2027 en meses cortos', () => {
    const cal = calendar(terms(31, 20));
    expect(cal.closingsBetween(d('2027-01-01'), d('2027-03-31')).map(String)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    const march = cal.cycleClosingAt(d('2027-03-31'));
    expect(march.start.toString()).toBe('2027-03-01');
    expect(march.dueDate.toString()).toBe('2027-04-20');
  });

  it('[TC-DEBT-CARD-006] cierre 30 en año bisiesto: febrero cierra el 29 y marzo va del 01 al 30', () => {
    const cal = calendar(terms(30, 10));
    expect(cal.closingsBetween(d('2028-02-01'), d('2028-03-31')).map(String)).toEqual([
      '2028-02-29',
      '2028-03-30',
    ]);
    const march = cal.cycleClosingAt(d('2028-03-30'));
    expect(march.start.toString()).toBe('2028-03-01');
  });

  it('[TC-DEBT-CARD-006] vencimiento el día 31: octubre vence el 31 y noviembre el 30', () => {
    const cal = calendar(terms(10, 31));
    expect(cal.cycleClosingAt(d('2026-10-10')).dueDate.toString()).toBe('2026-10-31');
    expect(cal.cycleClosingAt(d('2026-11-10')).dueDate.toString()).toBe('2026-11-30');
  });

  it('[TC-DEBT-CARD-007] vencimiento en domingo con ajuste NEXT pasa al lunes 16-11 y PREVIOUS al viernes 13-11', () => {
    const next = calendar(terms(25, 15, 'NEXT')).cycleClosingAt(d('2026-10-25'));
    expect(next.nominalDue.toString()).toBe('2026-11-15');
    expect(next.dueDate.toString()).toBe('2026-11-16');
    const previous = calendar(terms(25, 15, 'PREVIOUS')).cycleClosingAt(d('2026-10-25'));
    expect(previous.dueDate.toString()).toBe('2026-11-13');
    expect(previous.nominalDue.toString()).toBe('2026-11-15');
  });

  it('PREVIOUS no deja el vencimiento antes del cierre', () => {
    // cierre sábado 2026-09-26 (día 26) con vencimiento el día 27 (domingo) y PREVIOUS ⇒ viernes 25 < cierre ⇒ se recorta.
    const cycle = calendar(terms(26, 27, 'PREVIOUS')).cycleClosingAt(d('2026-09-26'));
    expect(cycle.nominalDue.toString()).toBe('2026-09-27');
    expect(cycle.dueDate.toString()).toBe('2026-09-26');
  });

  it('cycleClosingAt rechaza una fecha que no es un cierre', () => {
    expect(() => calendar(terms(25, 15)).cycleClosingAt(d('2026-10-24'))).toThrow();
  });

  it('ciclo abierto: el de menor cierre >= hoy; un ciclo está cerrado si closing < hoy', () => {
    const cal = calendar(terms(25, 15));
    expect(cal.openCycle(d('2026-10-25')).closing.toString()).toBe('2026-10-25');
    expect(cal.openCycle(d('2026-10-26')).closing.toString()).toBe('2026-11-25');
    expect(cal.lastClosedCycle(d('2026-10-25')).closing.toString()).toBe('2026-09-25');
    expect(cal.lastClosedCycle(d('2026-10-26')).closing.toString()).toBe('2026-10-25');
    expect(cal.cycleContaining(d('2026-10-26')).closing.toString()).toBe('2026-11-25');
    expect(cal.cycleContaining(d('2026-10-25')).closing.toString()).toBe('2026-10-25');
  });

  it('closedCycles devuelve del más reciente al más antiguo hasta el límite', () => {
    const cal = calendar(terms(25, 15));
    expect(cal.closedCycles(d('2026-11-01'), 3).map((c) => c.closing.toString())).toEqual([
      '2026-10-25',
      '2026-09-25',
      '2026-08-25',
    ]);
  });

  it('[TC-DEBT-CARD-026] cambiar cierre 25→20 y vencimiento 15→10 el 2026-10-27 aplica desde el ciclo abierto', () => {
    const base = CardCycleCalendar.single(terms(25, 15));
    const changed = base.withTerms(terms(20, 10), {
      lastIssuedClosing: d('2026-10-25'),
      today: d('2026-10-27'),
    });
    // El estado emitido conserva su vencimiento.
    expect(changed.cycleClosingAt(d('2026-10-25')).dueDate.toString()).toBe('2026-11-15');
    const open = changed.openCycle(d('2026-10-27'));
    expect(open.start.toString()).toBe('2026-10-26');
    expect(open.closing.toString()).toBe('2026-11-20');
    expect(open.dueDate.toString()).toBe('2026-12-10');
    // Los ciclos anteriores siguen con los términos viejos.
    expect(changed.cycleClosingAt(d('2026-09-25')).dueDate.toString()).toBe('2026-10-15');
  });

  it('un cambio de términos el mismo día reemplaza al anterior', () => {
    const base = CardCycleCalendar.single(terms(25, 15));
    const a = base.withTerms(terms(20, 10), { lastIssuedClosing: d('2026-10-25'), today: d('2026-10-27') });
    const b = a.withTerms(terms(28, 12), { lastIssuedClosing: d('2026-10-25'), today: d('2026-10-27') });
    expect(b.versions).toHaveLength(2);
    expect(b.openCycle(d('2026-10-27')).closing.toString()).toBe('2026-10-28');
  });

  it('cyclesDueOn agrupa los ciclos con el mismo vencimiento nominal (cierre 28 y vencimiento 31 en febrero)', () => {
    const cal = calendar(terms(28, 31));
    const dueOnMarch31 = cal.cyclesDueOn(d('2027-03-31'));
    expect(dueOnMarch31.map((c) => c.closing.toString())).toEqual(['2027-02-28', '2027-03-28']);
    expect(cal.cyclesDueOn(d('2027-01-31')).map((c) => c.closing.toString())).toEqual(['2027-01-28']);
  });

  it('[TC-DEBT-CARD-008] "hoy" depende de la zona del workspace, no de la del proceso', () => {
    // 2026-10-26T03:30Z = 23:30 del 25-10 en La Paz ⇒ el ciclo que cierra el 25-10 sigue abierto.
    const cal = calendar(terms(25, 15));
    const todayAt = (iso: string) => CardCycleCalendar.todayOf(new Date(iso), 'America/La_Paz');
    expect(cal.openCycle(todayAt('2026-10-26T03:30:00Z')).closing.toString()).toBe('2026-10-25');
    expect(cal.openCycle(todayAt('2026-10-26T04:05:00Z')).closing.toString()).toBe('2026-11-25');
  });

  it('[TC-DEBT-CARD-006] PBT: ciclos contiguos sin huecos ni solapes, un cierre por mes y vencimiento posterior al cierre', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('NONE', 'PREVIOUS', 'NEXT'),
        (statementDay, dueDay, adj) => {
          const cal = calendar(terms(statementDay, dueDay, adj));
          const closings = cal.closingsBetween(d('2025-01-01'), d('2027-12-31'));
          // 36 meses ⇒ 36 cierres, uno por mes calendario.
          expect(closings).toHaveLength(36);
          const months = new Set(closings.map((c) => `${c.year}-${c.month}`));
          expect(months.size).toBe(36);
          let previous: LocalDate | null = null;
          for (const closing of closings) {
            const cycle = cal.cycleClosingAt(closing);
            // contigüidad: el ciclo empieza el día siguiente al cierre anterior
            if (previous) expect(cycle.start.toString()).toBe(previous.plusDays(1).toString());
            expect(cycle.start.compare(cycle.closing)).toBeLessThanOrEqual(0);
            // vencimiento nominal posterior al cierre; con PREVIOUS el ajustado puede quedar en o antes del nominal
            expect(cycle.nominalDue.compare(cycle.closing)).toBe(1);
            if (adj !== 'PREVIOUS') expect(cycle.dueDate.compare(cycle.closing)).toBe(1);
            // con PREVIOUS el ajuste nunca lleva el vencimiento antes del cierre (se recorta al día del cierre)
            else expect(cycle.dueDate.compare(cycle.closing)).toBeGreaterThanOrEqual(0);
            // una fecha cualquiera del ciclo pertenece a él
            expect(cal.cycleContaining(cycle.start).closing.toString()).toBe(closing.toString());
            expect(cal.cycleContaining(cycle.closing).closing.toString()).toBe(closing.toString());
            previous = closing;
          }
        },
      ),
      { numRuns: 400 },
    );
  }, 60_000);
});
