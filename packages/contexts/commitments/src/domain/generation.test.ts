import { LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OccurrenceClock } from './occurrence-clock.js';
import { OccurrenceGenerator, candidates, seriesEnd } from './occurrence-generator.js';
import { RecurringOccurrence } from './recurring-occurrence.js';
import { RevisionPlanner, assertRevisionDate } from './revision-planner.js';
import { d, definition, version } from './test-fixtures.js';

const dates = (list: readonly { occurrenceDate: LocalDate }[]) =>
  list.map((c) => c.occurrenceDate.toString());
const win = (from: string, to: string) => ({ from: d(from), to: d(to) });

describe('Generación de candidatos (INV-013)', () => {
  it('[TC-COMMITMENTS-RECUR-001] el alquiler mensual desde 2026-10-05 produce 4 fechas hasta 2027-01-07', () => {
    const def = definition('d1');
    const out = candidates(def, win('2026-10-09', '2027-01-07'));
    expect(dates(out)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(dates(candidates(def, win('2026-10-05', '2027-01-07')))).toEqual([
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-013] el ajuste de fin de semana mueve solo el vencimiento y conserva la fecha nominal', () => {
    const internet = definition('d2', {
      schedule: { startDate: '2026-10-10', weekendAdjustment: 'PREVIOUS' },
    });
    const [first] = candidates(internet, win('2026-10-01', '2026-10-31'));
    expect(first?.occurrenceDate.toString()).toBe('2026-10-10');
    expect(first?.dueDate.toString()).toBe('2026-10-09');
    const sueldo = definition('d3', { schedule: { startDate: '2026-10-25', weekendAdjustment: 'NEXT' } });
    const [pay] = candidates(sueldo, win('2026-10-01', '2026-10-31'));
    expect([pay?.occurrenceDate.toString(), pay?.dueDate.toString()]).toEqual(['2026-10-25', '2026-10-26']);
  });

  it('[TC-COMMITMENTS-RECUR-014] caso fijo: ejecutar 5 veces el plan sobre el mismo estado deja 4 ocurrencias', () => {
    const def = definition('d4');
    const store = new Set<string>();
    for (let run = 0; run < 5; run += 1) {
      for (const c of OccurrenceGenerator.plan(def, win('2026-10-05', '2027-01-07'), store)) {
        store.add(c.occurrenceDate.toString());
      }
    }
    expect([...store].sort()).toEqual(['2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05']);
  });

  it('[TC-COMMITMENTS-RECUR-014] propiedad: ventanas solapadas y repetidas nunca duplican fechas nominales', () => {
    const base = LocalDate.of(2026, 1, 1).toEpochDay();
    const windowArb = fc
      .tuple(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 400 }))
      .map(([from, len]) => ({
        from: LocalDate.ofEpochDay(base + from),
        to: LocalDate.ofEpochDay(base + from + len),
      }));
    const defArb = fc
      .tuple(
        fc.constantFrom('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('NONE', 'PREVIOUS', 'NEXT'),
      )
      .map(([cadence, interval, day, weekendAdjustment]) =>
        definition('p', {
          schedule: {
            cadence,
            interval,
            startDate: `2026-01-${String(Math.min(day, 28)).padStart(2, '0')}`,
            weekendAdjustment,
          },
        }),
      );
    fc.assert(
      fc.property(defArb, fc.array(windowArb, { minLength: 1, maxLength: 6 }), (def, windows) => {
        const store = new Map<string, string>();
        for (const w of [...windows, ...windows]) {
          for (const c of OccurrenceGenerator.plan(def, w, new Set(store.keys()))) {
            store.set(c.occurrenceDate.toString(), c.dueDate.toString());
          }
        }
        const union = new Set<string>();
        for (const w of windows) for (const c of candidates(def, w)) union.add(c.occurrenceDate.toString());
        expect([...store.keys()].sort()).toEqual([...union].sort());
      }),
      { numRuns: process.env['NIGHTLY'] ? 10_000 : 100 },
    );
  });

  it('[TC-COMMITMENTS-RECUR-033] el máximo de 12 ocurrencias termina en 2027-09-15 y la serie es finita', () => {
    const def = definition('d5', { schedule: { startDate: '2026-10-15', maxOccurrences: 12 } });
    const all = candidates(def, win('2026-01-01', '2035-01-01'));
    expect(all).toHaveLength(12);
    expect(all.at(-1)?.occurrenceDate.toString()).toBe('2027-09-15');
    expect(seriesEnd(def)).toEqual({ finite: true, last: d('2027-09-15') });
    expect(seriesEnd(definition('d6'))).toEqual({ finite: false });
  });

  it('la primera ventana empieza en max(dtstart, inicio del periodo que contiene hoy) (D131)', () => {
    expect(OccurrenceGenerator.initialStart('2026-01-05', d('2026-10-01')).toString()).toBe('2026-10-01');
    expect(OccurrenceGenerator.initialStart('2026-10-20', d('2026-10-01')).toString()).toBe('2026-10-20');
  });

  it('una fecha de fin fijada corta la serie (terminar)', () => {
    const def = definition('d7', { schedule: { startDate: '2026-10-20' } });
    const capped = { versions: def.versions, endDate: '2026-11-30' };
    expect(dates(candidates(capped, win('2026-10-01', '2027-03-01')))).toEqual(['2026-10-20', '2026-11-20']);
  });

  it('con versiones, cada fecha usa la versión vigente en esa fecha', () => {
    const v1 = version(1, '2026-10-05');
    const v2 = version(2, '2027-01-05', { amount: { type: 'FIXED', amount: '3800.00' } });
    const out = candidates({ versions: [v1, v2], endDate: null }, win('2026-12-01', '2027-02-28'));
    expect(out.map((c) => [c.occurrenceDate.toString(), c.versionNo, c.expected.amount])).toEqual([
      ['2026-12-05', 1, '3500.00'],
      ['2027-01-05', 2, '3800.00'],
      ['2027-02-05', 2, '3800.00'],
    ]);
  });
});

describe('Reloj de ocurrencias (RISK-020)', () => {
  const next = (status: 'SCHEDULED' | 'DUE', today: string) =>
    OccurrenceClock.next({ status, dueDate: d('2026-10-20'), leadDays: 3, today: d(today) });

  it('[TC-COMMITMENTS-RECUR-018] próxima según la anticipación y atrasada tras el vencimiento', () => {
    expect(next('SCHEDULED', '2026-10-16')).toBeNull();
    expect(next('SCHEDULED', '2026-10-17')).toBe('BECOME_DUE');
    expect(next('DUE', '2026-10-17')).toBeNull();
    expect(next('DUE', '2026-10-20')).toBeNull();
    expect(next('DUE', '2026-10-21')).toBe('MARK_OVERDUE');
    expect(next('SCHEDULED', '2026-10-21')).toBe('MARK_OVERDUE');
    expect(
      OccurrenceClock.next({
        status: 'OVERDUE',
        dueDate: d('2026-10-20'),
        leadDays: 3,
        today: d('2026-12-01'),
      }),
    ).toBeNull();
  });

  it('[TC-COMMITMENTS-RECUR-009] atrasa al cambiar el día en America/La_Paz aunque el proceso corra en UTC', async () => {
    const { Instant } = await import('@pf/shared-kernel');
    const t1 = LocalDate.ofInstant(Instant.parse('2026-10-21T03:30:00Z'), 'America/La_Paz');
    const t2 = LocalDate.ofInstant(Instant.parse('2026-10-21T04:05:00Z'), 'America/La_Paz');
    expect(
      OccurrenceClock.next({ status: 'DUE', dueDate: d('2026-10-20'), leadDays: 3, today: t1 }),
    ).toBeNull();
    expect(OccurrenceClock.next({ status: 'DUE', dueDate: d('2026-10-20'), leadDays: 3, today: t2 })).toBe(
      'MARK_OVERDUE',
    );
  });

  it('[TC-COMMITMENTS-RECUR-046] la fecha por omisión al aprobar es min(vencimiento, hoy)', () => {
    expect(OccurrenceClock.defaultBusinessDate(d('2026-11-05'), d('2026-10-30')).toString()).toBe(
      '2026-10-30',
    );
    expect(OccurrenceClock.defaultBusinessDate(d('2026-10-20'), d('2026-10-25')).toString()).toBe(
      '2026-10-20',
    );
  });
});

describe('Ocurrencia: acciones y máquina de estados', () => {
  const fresh = () => {
    const def = definition('o1', { amount: { type: 'FIXED', amount: '3500.00' } });
    const [c] = candidates(def, win('2026-11-05', '2026-11-05'));
    return RecurringOccurrence.generate({
      id: 'occ-1',
      workspaceId: def.workspaceId,
      definitionId: def.id,
      occurrenceDate: '2026-11-05',
      dueDate: '2026-11-05',
      definitionVersionNo: 1,
      expected: c!.expected,
      currency: 'BOB',
      at: '2026-10-09T12:00:00.000Z',
    });
  };

  it('[TC-COMMITMENTS-RECUR-027] editar monto y fecha es una anotación que conserva la fecha nominal', () => {
    const occ = fresh();
    occ.edit({ expected: { type: 'FIXED', amount: '3650.00', min: null, max: null }, dueDate: '2026-11-07' });
    const s = occ.snapshot;
    expect(s.expected.amount).toBe('3650.00');
    expect([s.occurrenceDate, s.dueDate, s.amountOverridden, s.dateOverridden]).toEqual([
      '2026-11-05',
      '2026-11-07',
      true,
      true,
    ]);
    expect(occ.lastTransition).toEqual({ transition: 'GENERATE', from: null, to: 'SCHEDULED' });
    expect(occ.changedFields).toEqual(['expected', 'dueDate']);
  });

  it('[TC-COMMITMENTS-RECUR-028] omitir es terminal: no se aprueba, vincula ni edita después', () => {
    const occ = fresh();
    occ.skip({ reason: 'vacaciones', at: '2026-10-10T00:00:00.000Z', by: 'u' });
    expect(occ.status).toBe('SKIPPED');
    expect(occ.snapshot.skipReason).toBe('vacaciones');
    expect(() => occ.edit({ dueDate: '2026-11-09' })).toThrowError(/cannot be edited/);
    expect(() => occ.materialize({ transactionId: 't', at: 'x', by: null })).toThrowError(/SKIPPED|cannot/);
  });

  it('[TC-COMMITMENTS-RECUR-042] omitir una materializada ⇒ INVALID_STATUS_TRANSITION; resolverla dos veces ⇒ ALREADY_MATERIALIZED', () => {
    const occ = fresh();
    occ.materialize({ transactionId: 'txn-1', at: '2026-11-05T12:00:00.000Z', by: 'u' });
    expect(occ.status).toBe('MATERIALIZED');
    expect(() => occ.skip({ reason: null, at: 'x', by: null })).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
    expect(() => occ.materialize({ transactionId: 't2', at: 'x', by: null })).toThrowError(
      expect.objectContaining({ code: 'OCCURRENCE_ALREADY_MATERIALIZED' }),
    );
  });

  it('[TC-COMMITMENTS-RECUR-031] liberar vuelve a próxima o atrasada según hoy y limpia la transacción', () => {
    const occ = fresh();
    occ.link({ transactionId: 'txn-1', matchedBy: 'USER_LINK', at: '2026-11-04T12:00:00.000Z', by: 'u' });
    expect(occ.status).toBe('MATCHED');
    expect(occ.release(d('2026-11-06'))).toBe('txn-1');
    expect(occ.status).toBe('OVERDUE');
    expect(occ.snapshot.transactionId).toBeNull();
    const early = fresh();
    early.materialize({ transactionId: 'txn-2', at: 'x', by: null });
    early.release(d('2026-11-01'));
    expect(early.status).toBe('DUE');
    expect(() => fresh().release(d('2026-11-01'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
  });

  it('cancelar y reinstaurar: CANCELLED no es terminal', () => {
    const occ = fresh();
    occ.cancel('SUPERSEDED');
    expect(occ.snapshot.cancelReason).toBe('SUPERSEDED');
    occ.reinstate();
    expect(occ.status).toBe('SCHEDULED');
    expect(occ.snapshot.cancelReason).toBeNull();
  });

  it('una reescritura descarta las ediciones individuales e informa si las había', () => {
    const occ = fresh();
    occ.edit({ dueDate: '2026-11-07' });
    const { resetOverrides } = occ.rewrite({
      dueDate: '2026-11-05',
      definitionVersionNo: 2,
      expected: { type: 'FIXED', amount: '3800.00', min: null, max: null },
      currency: 'BOB',
    });
    expect(resetOverrides).toBe(true);
    expect(occ.snapshot).toMatchObject({
      dueDate: '2026-11-05',
      definitionVersionNo: 2,
      dateOverridden: false,
    });
  });
});

describe('Pausar, reanudar, terminar y revisar (RevisionPlanner)', () => {
  const ex = (id: string, occurrenceDate: string, status: string, cancelReason: string | null = null) =>
    ({
      id,
      occurrenceDate,
      status,
      cancelReason,
      dueDate: occurrenceDate,
      amountOverridden: false,
      dateOverridden: false,
    }) as Parameters<typeof RevisionPlanner.planPause>[0][number];

  it('[TC-COMMITMENTS-RECUR-032] pausar cancela las no resueltas desde hoy y reanudar reinstaura solo las posteriores', () => {
    const existing = [
      ex('a', '2026-10-28', 'SCHEDULED'),
      ex('b', '2026-11-28', 'SCHEDULED'),
      ex('c', '2026-12-28', 'SCHEDULED'),
      ex('z', '2026-09-28', 'OVERDUE'),
    ];
    expect(RevisionPlanner.planPause(existing, d('2026-10-10'))).toEqual(['a', 'b', 'c']);
    const paused = [
      ex('a', '2026-10-28', 'CANCELLED', 'PAUSED'),
      ex('b', '2026-11-28', 'CANCELLED', 'PAUSED'),
      ex('c', '2026-12-28', 'CANCELLED', 'PAUSED'),
      ex('e', '2027-01-28', 'CANCELLED', 'PAUSED'),
    ];
    expect(RevisionPlanner.planResume(paused, d('2026-12-01'))).toEqual(['c', 'e']);
  });

  it('[TC-COMMITMENTS-RECUR-047] terminar con fecha cancela las no resueltas posteriores', () => {
    const existing = [
      ex('a', '2026-10-20', 'OVERDUE'),
      ex('b', '2026-11-20', 'SCHEDULED'),
      ex('c', '2026-12-20', 'SCHEDULED'),
      ex('d', '2027-01-20', 'SCHEDULED'),
      ex('r', '2026-12-25', 'MATERIALIZED'),
    ];
    expect(RevisionPlanner.planEnd(existing, d('2026-11-30'))).toEqual(['c', 'd']);
  });

  it('[TC-COMMITMENTS-RECUR-034] la revisión reescribe solo las no resueltas desde la fecha efectiva', () => {
    const def = definition('r1');
    def.revise(
      version(2, '2027-01-05', { amount: { type: 'FIXED', amount: '3800.00' } }),
      '2026-10-09T12:00:00.000Z',
      'u',
    );
    const existing = [
      ex('o', '2026-10-05', 'MATERIALIZED'),
      ex('n', '2026-11-05', 'MATERIALIZED'),
      ex('dd', '2026-12-05', 'MATCHED'),
      ex('j', '2027-01-05', 'SCHEDULED'),
    ];
    const plan = RevisionPlanner.planRevision({
      source: def,
      effectiveFrom: d('2027-01-05'),
      through: d('2027-01-07'),
      existing,
    });
    expect(plan.rewrite.map((r) => [r.id, r.candidate.versionNo, r.candidate.expected.amount])).toEqual([
      ['j', 2, '3800.00'],
    ]);
    expect(plan.cancel).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it('[TC-COMMITMENTS-RECUR-035] una fecha efectiva anterior a una resuelta se rechaza', () => {
    const existing = [ex('n', '2026-11-05', 'MATERIALIZED'), ex('j', '2026-12-05', 'SCHEDULED')];
    const guard = (from: string) => () =>
      assertRevisionDate({
        effectiveFrom: d(from),
        seriesStart: d('2026-10-05'),
        currentEffectiveFrom: d('2026-10-05'),
        existing,
      });
    expect(guard('2026-10-05')).toThrowError(
      expect.objectContaining({ code: 'RECURRING_REVISION_DATE_INVALID' }),
    );
    expect(guard('2026-11-05')).toThrowError(
      expect.objectContaining({ code: 'RECURRING_REVISION_DATE_INVALID' }),
    );
    expect(guard('2026-09-01')).toThrowError(
      expect.objectContaining({ code: 'RECURRING_REVISION_DATE_INVALID' }),
    );
    expect(guard('2026-11-06')).not.toThrow();
  });

  it('[TC-COMMITMENTS-RECUR-048] cambiar el día cancela la vieja, genera la nueva y volver al 20 reinstaura sin duplicar', () => {
    const def = definition('r2', { schedule: { startDate: '2026-10-20' } });
    def.revise(
      version(2, '2026-11-01', { schedule: { startDate: '2026-10-20', monthDays: [10] } }),
      'x',
      'u',
    );
    let plan = RevisionPlanner.planRevision({
      source: def,
      effectiveFrom: d('2026-11-01'),
      through: d('2026-11-30'),
      existing: [ex('n20', '2026-11-20', 'SCHEDULED')],
    });
    expect(plan.cancel).toEqual(['n20']);
    expect(plan.insert.map((c) => [c.occurrenceDate.toString(), c.versionNo])).toEqual([['2026-11-10', 2]]);
    // Vuelta al día 20: la cancelada (SUPERSEDED) se reinstaura y la del 10 se cancela.
    def.revise(version(3, '2026-11-01', { schedule: { startDate: '2026-10-20' } }), 'y', 'u');
    plan = RevisionPlanner.planRevision({
      source: def,
      effectiveFrom: d('2026-11-01'),
      through: d('2026-11-30'),
      existing: [ex('n20', '2026-11-20', 'CANCELLED', 'SUPERSEDED'), ex('n10', '2026-11-10', 'SCHEDULED')],
    });
    expect(plan.reinstate.map((r) => r.id)).toEqual(['n20']);
    expect(plan.cancel).toEqual(['n10']);
    expect(plan.insert).toEqual([]);
  });
});
