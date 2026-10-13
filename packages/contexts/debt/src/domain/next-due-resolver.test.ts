import { LocalDate, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveNextDue, type DueCycle } from './next-due-resolver.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
const d = (s: string) => LocalDate.parse(s);

const standing = (
  status: 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE',
  remaining: string,
  minimum = '0.00',
) => ({ status, remainingNoInterest: bob(remaining), remainingMinimum: bob(minimum) });

describe('NextDueResolver (fix-phase-4-gaps, decisión 2)', () => {
  it('[TC-DEBT-CARD-038] tarjeta recién registrada con deuda previa: el ciclo cerrado sin estado emitido no cuenta', () => {
    const cycles: DueCycle[] = [
      {
        closingDate: d('2026-09-25'),
        dueDate: d('2026-10-15'),
        open: false,
        issued: false,
        standing: standing('OVERDUE', '1200.00', '60.00'),
      },
      { closingDate: d('2026-10-25'), dueDate: d('2026-11-15'), open: true, issued: false, standing: null },
    ];
    const r = resolveNextDue({ cycles, today: d('2026-10-20') });
    expect(r.nextDueDate.toString()).toBe('2026-11-15');
    expect(r.overdue).toEqual([]);
  });

  it('[TC-DEBT-CARD-039] estado emitido aún no vencido: es el próximo vencimiento', () => {
    const cycles: DueCycle[] = [
      {
        closingDate: d('2026-10-25'),
        dueDate: d('2026-11-15'),
        open: false,
        issued: true,
        standing: standing('ISSUED', '1120.50', '56.02'),
      },
      { closingDate: d('2026-11-25'), dueDate: d('2026-12-15'), open: true, issued: false, standing: null },
    ];
    const r = resolveNextDue({ cycles, today: d('2026-10-28') });
    expect(r.nextDueDate.toString()).toBe('2026-11-15');
    expect(r.overdue).toEqual([]);
  });

  it('[TC-DEBT-CARD-039] estado vencido con saldo pendiente: se informa atrasado y el próximo pasa al ciclo abierto', () => {
    const cycles: DueCycle[] = [
      {
        closingDate: d('2026-10-25'),
        dueDate: d('2026-11-15'),
        open: false,
        issued: true,
        standing: standing('PARTIALLY_PAID', '620.50', '0.00'),
      },
      { closingDate: d('2026-11-25'), dueDate: d('2026-12-15'), open: true, issued: false, standing: null },
    ];
    const r = resolveNextDue({ cycles, today: d('2026-11-20') });
    expect(r.nextDueDate.toString()).toBe('2026-12-15');
    expect(r.overdue).toHaveLength(1);
    expect(r.overdue[0]?.closingDate.toString()).toBe('2026-10-25');
    expect(r.overdue[0]?.status).toBe('PARTIALLY_PAID');
    expect(r.overdue[0]?.remainingNoInterest.toFixed()).toBe('620.50');
  });

  it('[TC-DEBT-CARD-039] un estado pagado no cuenta ni como próximo ni como atrasado; el vencimiento de hoy es el próximo', () => {
    const cycles: DueCycle[] = [
      {
        closingDate: d('2026-09-25'),
        dueDate: d('2026-10-15'),
        open: false,
        issued: true,
        standing: standing('PAID', '0.00'),
      },
      {
        closingDate: d('2026-10-25'),
        dueDate: d('2026-11-15'),
        open: false,
        issued: true,
        standing: standing('ISSUED', '100.00', '50.00'),
      },
      { closingDate: d('2026-11-25'), dueDate: d('2026-12-15'), open: true, issued: false, standing: null },
    ];
    const r = resolveNextDue({ cycles, today: d('2026-11-15') });
    expect(r.nextDueDate.toString()).toBe('2026-11-15');
    expect(r.overdue).toEqual([]);
  });

  it('[TC-DEBT-CARD-038] PBT: el próximo vencimiento nunca es anterior a hoy y los atrasados siempre vencieron antes', () => {
    const base = d('2026-01-01').toEpochDay();
    const cycleArb = fc.record({
      close: fc.integer({ min: 0, max: 400 }),
      lag: fc.integer({ min: 5, max: 30 }),
      issued: fc.boolean(),
      remaining: fc.integer({ min: 0, max: 5_000 }),
    });
    fc.assert(
      fc.property(
        fc.array(cycleArb, { maxLength: 12 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 30 }),
        (items, todayOffset, openLag) => {
          const today = LocalDate.ofEpochDay(base + todayOffset);
          const cycles: DueCycle[] = items.map((i) => ({
            closingDate: LocalDate.ofEpochDay(base + i.close),
            dueDate: LocalDate.ofEpochDay(base + i.close + i.lag),
            open: false,
            issued: i.issued,
            standing: standing('ISSUED', (i.remaining / 100).toFixed(2)),
          }));
          cycles.push({
            closingDate: today.plusDays(openLag),
            dueDate: today.plusDays(openLag + 15),
            open: true,
            issued: false,
            standing: null,
          });
          const r = resolveNextDue({ cycles, today });
          expect(r.nextDueDate.compare(today)).toBeGreaterThanOrEqual(0);
          for (const o of r.overdue) expect(o.dueDate.compare(today)).toBeLessThan(0);
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
