import { DomainError, LocalDate, type StateTransition } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_PERIOD_LIFECYCLE,
  type FinancialPeriodStatus,
  type FinancialPeriodTransition,
} from './financial-period-lifecycle.js';
import { FinancialPeriod } from './financial-period.js';
import { PeriodCalendar } from './period-calendar.js';

const d = (s: string) => LocalDate.parse(s);
const AT = '2026-10-05T14:00:00.000Z';
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const create = (label: string, today: string, startDay = 1) =>
  FinancialPeriod.create({
    id: `p-${label}`,
    workspaceId: 'w1',
    planned: { label, range: PeriodCalendar.rangeFor(label, startDay), startDay, isTransition: false },
    today: d(today),
    at: AT,
  });
const reload = (p: FinancialPeriod) => FinancialPeriod.restore(p.snapshot);

describe('Máquina FINANCIAL_PERIOD_LIFECYCLE y agregado FinancialPeriod', () => {
  it('la máquina declara DRAFT/ACTIVE/CLOSED/REOPENED sin terminales y CREATE, ACTIVATE, CLOSE, REOPEN', () => {
    const def = FINANCIAL_PERIOD_LIFECYCLE.definition;
    expect(def.aggregateType).toBe('FinancialPeriod');
    expect(def.states.map((s) => [s.code, s.terminal])).toEqual([
      ['DRAFT', false],
      ['ACTIVE', false],
      ['CLOSED', false],
      ['REOPENED', false],
    ]);
    expect(def.transitions.map((t) => [t.code, t.from, t.to])).toEqual([
      ['CREATE', [], ['DRAFT', 'ACTIVE']],
      ['ACTIVATE', ['DRAFT'], ['ACTIVE']],
      ['CLOSE', ['ACTIVE', 'REOPENED'], ['CLOSED']],
      ['REOPEN', ['CLOSED'], ['REOPENED']],
    ]);
  });

  it('se crea ACTIVE si ya empezó (contiene hoy o terminó) y DRAFT si es futuro; versión 1 y transición CREATE', () => {
    const current = create('2026-10', '2026-10-05');
    expect(current.status).toBe('ACTIVE');
    expect(current.snapshot.activatedAt).toBe(AT);
    expect(current.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'ACTIVE' });
    const past = create('2026-07', '2026-10-05');
    expect(past.status).toBe('ACTIVE');
    expect(past.pendingClosure(d('2026-10-05'))).toBe(true);
    expect(current.pendingClosure(d('2026-10-05'))).toBe(false);
    const future = create('2026-11', '2026-10-05');
    expect(future.status).toBe('DRAFT');
    expect(future.snapshot.activatedAt).toBeNull();
    expect(future.version).toBe(1);
    expect(future.lastTransition).toEqual({ transition: 'CREATE', from: null, to: 'DRAFT' });
  });

  it('[TC-PLANNING-STATE-001] cerrar un DRAFT, reabrir un ACTIVE o activar un CLOSED ⇒ INVALID_STATUS_TRANSITION sin cambios', () => {
    const draft = reload(create('2026-12', '2026-10-05'));
    expect(code(() => draft.close(AT))).toBe('INVALID_STATUS_TRANSITION');
    expect(draft.status).toBe('DRAFT');
    expect(draft.lastTransition).toBeNull();

    const active = reload(create('2026-10', '2026-10-05'));
    expect(code(() => active.reopen(AT))).toBe('INVALID_STATUS_TRANSITION');
    expect(active.status).toBe('ACTIVE');
    expect(active.lastTransition).toBeNull();

    const closing = reload(create('2026-09', '2026-10-05'));
    closing.close(AT);
    const closed = reload(closing);
    expect(code(() => closed.activate(d('2026-10-05'), AT))).toBe('INVALID_STATUS_TRANSITION');
    expect(closed.status).toBe('CLOSED');
    expect(closed.version).toBe(2);
    expect(closed.lastTransition).toBeNull();
  });

  it('[TC-PLANNING-ACTIVATION-002] (dominio) activar un DRAFT iniciado lo pasa a ACTIVE una vez; uno futuro ⇒ PERIOD_NOT_STARTED', () => {
    const nov = reload(create('2026-11', '2026-10-31'));
    nov.activate(d('2026-11-01'), '2026-11-01T04:05:00.000Z');
    expect(nov.status).toBe('ACTIVE');
    expect(nov.version).toBe(2);
    expect(nov.snapshot.activatedAt).toBe('2026-11-01T04:05:00.000Z');
    expect(nov.lastTransition).toEqual({ transition: 'ACTIVATE', from: 'DRAFT', to: 'ACTIVE' });
    expect(code(() => reload(nov).activate(d('2026-11-01'), AT))).toBe('INVALID_STATUS_TRANSITION');

    const dec = reload(create('2026-12', '2026-10-31'));
    expect(code(() => dec.activate(d('2026-11-01'), AT))).toBe('PERIOD_NOT_STARTED');
    expect(dec.status).toBe('DRAFT');
    expect(dec.version).toBe(1);
  });

  it('[TC-PLANNING-FISCALDAY-001] (dominio) solo un DRAFT cambia de rango: conserva id y etiqueta y sube de versión', () => {
    const dec = reload(create('2026-12', '2026-10-05'));
    const before = dec.reschedule({
      label: '2026-12',
      range: PeriodCalendar.rangeFor('2026-12', 25),
      startDay: 25,
      isTransition: false,
    });
    expect(before.start.toString()).toBe('2026-12-01');
    expect(dec.snapshot).toMatchObject({
      id: 'p-2026-12',
      label: '2026-12',
      periodStart: '2026-12-25',
      periodEnd: '2027-01-24',
      startDay: 25,
      version: 2,
    });
    const oct = reload(create('2026-10', '2026-10-05'));
    expect(
      code(() =>
        oct.reschedule({
          label: '2026-10',
          range: PeriodCalendar.rangeFor('2026-10', 25),
          startDay: 25,
          isTransition: false,
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
    // Otra etiqueta nunca: la identidad y la etiqueta se conservan.
    expect(
      code(() =>
        reload(dec).reschedule({
          label: '2027-01',
          range: PeriodCalendar.rangeFor('2027-01', 25),
          startDay: 25,
          isTransition: false,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('el recorrido de cualquier secuencia de comandos se reproduce con la máquina y termina en su estado', () => {
    type Op = 'activate' | 'close' | 'reopen';
    const ops: Op[] = ['activate', 'close', 'reopen'];
    let sequences: Op[][] = [[]];
    for (let n = 0; n < 5; n += 1)
      sequences = [
        ...sequences,
        ...sequences.filter((s) => s.length === n).flatMap((s) => ops.map((o) => [...s, o])),
      ];
    for (const start of ['2026-10-05', '2026-11-05']) {
      for (const seq of sequences) {
        let p = create('2026-11', '2026-10-05');
        const path: StateTransition<FinancialPeriodStatus, FinancialPeriodTransition>[] = [p.lastTransition!];
        for (const op of seq) {
          p = reload(p);
          try {
            if (op === 'activate') p.activate(d(start), AT);
            else if (op === 'close') p.close(AT);
            else p.reopen(AT);
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect(p.lastTransition).toBeNull();
            continue;
          }
          path.push(p.lastTransition!);
        }
        expect(FINANCIAL_PERIOD_LIFECYCLE.replay(path)).toBe(p.status);
      }
    }
  });
});
