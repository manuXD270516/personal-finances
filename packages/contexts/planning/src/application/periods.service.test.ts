import { DomainError, Instant } from '@pf/shared-kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { PeriodQueries } from './period.queries.js';
import { PeriodsService } from './periods.service.js';
import { InMemoryPlanning } from './testing/in-memory.js';

const W1 = '0190a000-0000-7000-8000-00000000a001';
const W2 = '0190a000-0000-7000-8000-00000000a002';

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

function setup(timeZone = 'America/La_Paz', startDay = 1) {
  const mem = new InMemoryPlanning();
  mem.workspace(W1, timeZone, startDay);
  const deps = mem.deps({ onPeriodCreated: [mem.hook] });
  return { mem, svc: new PeriodsService(deps), queries: new PeriodQueries(deps) };
}
const at = (mem: InMemoryPlanning, iso: string) => mem.clock.set(Instant.parse(iso));
const range = (mem: InMemoryPlanning, label: string, ws = W1) => {
  const r = mem.byLabel(ws, label);
  return r ? `${r.periodStart}..${r.periodEnd}` : undefined;
};

describe('EnsurePeriods: creación automática e idempotente (planning/financial-periods)', () => {
  it('[TC-PLANNING-AUTOCREATE-001] hoy 2026-10-05 en La Paz: "2026-10" active y 3 draft; repetir no cambia nada; el 2026-11-02 solo se activa "2026-11" y se crea "2027-02"', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1)).toEqual(['2026-10:ACTIVE', '2026-11:DRAFT', '2026-12:DRAFT', '2027-01:DRAFT']);
    const first = new Map([...mem.rows.values()].map((r) => [r.label, `${r.id}@${r.version}`]));

    await svc.ensurePeriods({ workspaceId: W1 });
    expect(new Map([...mem.rows.values()].map((r) => [r.label, `${r.id}@${r.version}`]))).toEqual(first);

    at(mem, '2026-11-02T14:00:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1)).toEqual([
      '2026-10:ACTIVE',
      '2026-11:ACTIVE',
      '2026-12:DRAFT',
      '2027-01:DRAFT',
      '2027-02:DRAFT',
    ]);
    const after = new Map([...mem.rows.values()].map((r) => [r.label, `${r.id}@${r.version}`]));
    for (const label of ['2026-10', '2026-12', '2027-01']) expect(after.get(label)).toBe(first.get(label));
    expect(after.get('2026-11')).toBe(first.get('2026-11')!.replace('@1', '@2'));
    expect(mem.locks).toBe(3);
  });

  it('[TC-PLANNING-COVERAGE-001] un saldo inicial del 2026-07-01 crea "2026-07".."2026-09" active; un gasto del 2027-06-10 crea hasta "2027-06" en draft; uno del 2029-01-15 no pasa de "2028-10"', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    mem.entries(W1, '2026-07-01');
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1).slice(0, 4)).toEqual([
      '2026-07:ACTIVE',
      '2026-08:ACTIVE',
      '2026-09:ACTIVE',
      '2026-10:ACTIVE',
    ]);
    expect(range(mem, '2026-07')).toBe('2026-07-01..2026-07-31');

    mem.entries(W1, '2027-06-10');
    await svc.ensurePeriods({ workspaceId: W1 });
    const labels = mem.labels(W1);
    expect(labels.slice(labels.indexOf('2027-02:DRAFT'))).toEqual([
      '2027-02:DRAFT',
      '2027-03:DRAFT',
      '2027-04:DRAFT',
      '2027-05:DRAFT',
      '2027-06:DRAFT',
    ]);

    mem.entries(W1, '2029-01-15');
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1).at(-1)).toBe('2028-10:DRAFT');
    expect(mem.labels(W1)).toHaveLength(28);
  });

  it('[TC-PLANNING-COVERAGE-001] con un periodo cerrado ya no hay cobertura hacia atrás (el primer periodo queda fijo)', async () => {
    const { mem, svc } = setup();
    mem.seed(W1, '2026-09', 'CLOSED');
    mem.seed(W1, '2026-10', 'ACTIVE');
    mem.entries(W1, '2026-03-15');
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1)[0]).toBe('2026-09:CLOSED');
  });

  it('[TC-PLANNING-AUTOCREATE-003] (aplicación) pedir hasta 2027-12-31 crea "2027-02".."2027-12" en draft; repetir no crea más; hasta 2029-01-01 ⇒ VALIDATION_FAILED sin crear', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    const res = await svc.ensurePeriods({ workspaceId: W1, through: '2027-12-31' });
    expect(res.created.map((p) => p.label)).toEqual([
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
      '2027-11',
      '2027-12',
    ]);
    expect(res.created.every((p) => p.status === 'DRAFT')).toBe(true);
    expect(res.periods.at(0)?.label).toBe('2026-10');
    expect(res.periods.at(-1)?.label).toBe('2027-12');
    const again = await svc.ensurePeriods({ workspaceId: W1, through: '2027-12-31' });
    expect(again.created).toEqual([]);
    const count = mem.rows.size;
    expect(await codeOf(svc.ensurePeriods({ workspaceId: W1, through: '2029-01-01' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(svc.ensurePeriods({ workspaceId: W1, through: '2027-13-01' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(mem.rows.size).toBe(count);
  });

  it('[TC-PLANNING-AUTOCREATE-004] el participante recibe cada periodo creado una vez, en la transacción; si falla, nada se crea y la siguiente ejecución lo reintenta', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    mem.hookCalls.length = 0;
    at(mem, '2026-11-02T14:00:00Z');
    mem.failHook = true;
    await expect(svc.ensurePeriods({ workspaceId: W1 })).rejects.toThrow('participant failed on 2027-02');
    expect(mem.byLabel(W1, '2027-02')).toBeUndefined();
    expect(mem.byLabel(W1, '2026-11')?.status).toBe('DRAFT');
    expect(mem.hookCalls).toEqual([]);
    expect(mem.events).toEqual([]);

    mem.failHook = false;
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.byLabel(W1, '2027-02')?.status).toBe('DRAFT');
    expect(mem.hookCalls).toEqual([{ label: '2027-02', inTransaction: true }]);

    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.hookCalls).toEqual([{ label: '2027-02', inTransaction: true }]);
  });

  it('sin participantes registrados la creación no cambia', async () => {
    const mem = new InMemoryPlanning();
    mem.workspace(W1);
    await new PeriodsService(mem.deps()).ensurePeriods({ workspaceId: W1 });
    expect(mem.labels(W1)).toHaveLength(4);
  });
});

describe('Activación según la zona horaria del workspace (RISK-020)', () => {
  const ORIGINAL_TZ = process.env['TZ'];
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ORIGINAL_TZ;
  });

  it.each(['UTC', 'America/La_Paz'])(
    '[TC-PLANNING-ACTIVATION-001] (TZ del proceso %s) a las 03:30Z "2026-11" sigue draft en La Paz; a las 04:05Z se activa y "2026-10" queda pendiente de cierre; en UTC se activa a las 00:05Z',
    async (tz) => {
      process.env['TZ'] = tz;
      const { mem, svc, queries } = setup();
      mem.workspace(W2, 'UTC');
      at(mem, '2026-10-20T12:00:00Z');
      await svc.ensurePeriods({ workspaceId: W1 });
      await svc.ensurePeriods({ workspaceId: W2 });

      at(mem, '2026-11-01T00:05:00Z');
      await svc.ensurePeriods({ workspaceId: W2 });
      expect(mem.byLabel(W2, '2026-11')?.status).toBe('ACTIVE');

      at(mem, '2026-11-01T03:30:00Z');
      await svc.ensurePeriods({ workspaceId: W1 });
      expect(mem.byLabel(W1, '2026-11')?.status).toBe('DRAFT');

      at(mem, '2026-11-01T04:05:00Z');
      await svc.ensurePeriods({ workspaceId: W1 });
      expect(mem.byLabel(W1, '2026-11')?.status).toBe('ACTIVE');
      const active = await queries.listPeriods({ workspaceId: W1, statuses: ['ACTIVE'] });
      expect(active.map((p) => [p.label, p.pendingClosure])).toEqual([
        ['2026-10', true],
        ['2026-11', false],
      ]);
    },
  );

  it('[TC-PLANNING-AUDIT-001] la activación automática se audita con su transición draft → active y un único evento; la ejecución siguiente no escribe nada', async () => {
    const { mem, svc } = setup();
    at(mem, '2026-10-20T12:00:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    const audits = mem.audits.length;
    const steps = mem.lifecycleSteps.length;

    at(mem, '2026-11-01T04:05:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    const nov = mem.byLabel(W1, '2026-11')!;
    const activation = mem.audits.slice(audits).filter((a) => a.action === 'planning.period.activated');
    expect(activation).toHaveLength(1);
    expect(activation[0]).toMatchObject({
      aggregateType: 'FinancialPeriod',
      aggregateId: nov.id,
      aggregateVersion: 2,
      changes: [
        { field: 'status', before: 'DRAFT', after: 'ACTIVE' },
        { field: 'activation', before: null, after: 'AUTOMATIC' },
      ],
    });
    const transition = mem.lifecycleSteps.slice(steps).filter((s) => s.aggregateId === nov.id);
    expect(transition).toMatchObject([
      {
        kind: 'TRANSITION',
        transition: 'ACTIVATE',
        fromState: 'DRAFT',
        toState: 'ACTIVE',
        machineVersion: 1,
      },
    ]);
    const events = mem.events.filter((e) => e.eventType === 'planning.PeriodActivated');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateType: 'FinancialPeriod',
      aggregateId: nov.id,
      aggregateVersion: 2,
      payload: {
        label: '2026-11',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        activation: 'AUTOMATIC',
        activatedAt: '2026-11-01T04:05:00.000Z',
      },
    });

    const total = { audits: mem.audits.length, steps: mem.lifecycleSteps.length, events: mem.events.length };
    await svc.ensurePeriods({ workspaceId: W1 });
    expect({
      audits: mem.audits.length,
      steps: mem.lifecycleSteps.length,
      events: mem.events.length,
    }).toEqual(total);
  });

  it('[TC-PLANNING-AUDIT-001] la creación se audita (planning.period.created) con su transición CREATE y sin evento', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    const created = mem.audits.filter((a) => a.action === 'planning.period.created');
    expect(created).toHaveLength(4);
    expect(created[0]).toMatchObject({
      aggregateType: 'FinancialPeriod',
      aggregateVersion: 1,
      changes: expect.arrayContaining([
        { field: 'label', before: null, after: '2026-10' },
        { field: 'periodStart', before: null, after: '2026-10-01' },
        { field: 'periodEnd', before: null, after: '2026-10-31' },
        { field: 'status', before: null, after: 'ACTIVE' },
      ]),
    });
    expect(mem.lifecycleSteps.map((s) => [s.kind, s.kind === 'TRANSITION' ? s.toState : null])).toEqual([
      ['TRANSITION', 'ACTIVE'],
      ['TRANSITION', 'DRAFT'],
      ['TRANSITION', 'DRAFT'],
      ['TRANSITION', 'DRAFT'],
    ]);
    expect(mem.events).toEqual([]);
  });
});

describe('Activación manual (ActivatePeriod)', () => {
  it('[TC-PLANNING-ACTIVATION-002] (aplicación) el 2026-11-01 el EDITOR activa "2026-11" una sola vez (MANUAL) y el proceso posterior no lo toca; "2026-12" ⇒ PERIOD_NOT_STARTED', async () => {
    const { mem, svc } = setup();
    at(mem, '2026-10-20T12:00:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    at(mem, '2026-11-01T10:00:00Z');
    const nov = mem.byLabel(W1, '2026-11')!;
    const view = await svc.activatePeriod({ workspaceId: W1, periodId: nov.id, expectedVersion: 1 });
    expect(view).toMatchObject({ status: 'ACTIVE', version: 2, activatedAt: '2026-11-01T10:00:00.000Z' });
    expect(mem.events.map((e) => (e.payload as { activation: string }).activation)).toEqual(['MANUAL']);

    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.byLabel(W1, '2026-11')?.version).toBe(2);
    expect(mem.events.filter((e) => e.eventType === 'planning.PeriodActivated')).toHaveLength(1);

    const dec = mem.byLabel(W1, '2026-12')!;
    expect(await codeOf(svc.activatePeriod({ workspaceId: W1, periodId: dec.id, expectedVersion: 1 }))).toBe(
      'PERIOD_NOT_STARTED',
    );
    expect(mem.byLabel(W1, '2026-12')?.status).toBe('DRAFT');
    expect(await codeOf(svc.activatePeriod({ workspaceId: W1, periodId: dec.id, expectedVersion: 7 }))).toBe(
      'PRECONDITION_FAILED',
    );
    expect(
      await codeOf(
        svc.activatePeriod({
          workspaceId: W1,
          periodId: '0190a000-0000-7000-8000-0000000000ff',
          expectedVersion: 1,
        }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    expect(await codeOf(svc.activatePeriod({ workspaceId: W1, periodId: nov.id, expectedVersion: 2 }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('Cambio del día de inicio (RescheduleDraftPeriods)', () => {
  it('[TC-PLANNING-FISCALDAY-001] de 1 a 25: "2026-10" no cambia, "2026-11" es de transición, "2026-12" y "2027-01" se recalculan con su id; su plan se conserva y cada recálculo se audita con el rango anterior y el nuevo', async () => {
    const { mem, svc, queries } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    const ids = new Map([...mem.rows.values()].map((r) => [r.label, r.id]));
    // Doble del plan mensual de pf-p2b: cuelga de periodId.
    const plans = new Map<string, { line: string; amount: string; currency: string }>([
      [ids.get('2026-12')!, { line: 'Supermercado', amount: '1500.00', currency: 'BOB' }],
    ]);
    const audits = mem.audits.length;

    mem.workspace(W1, 'America/La_Paz', 25);
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(range(mem, '2026-10')).toBe('2026-10-01..2026-10-31');
    expect(range(mem, '2026-11')).toBe('2026-11-01..2026-12-24');
    expect(mem.byLabel(W1, '2026-11')?.isTransition).toBe(true);
    expect(range(mem, '2026-12')).toBe('2026-12-25..2027-01-24');
    expect(range(mem, '2027-01')).toBe('2027-01-25..2027-02-24');
    for (const label of ['2026-10', '2026-11', '2026-12', '2027-01'])
      expect(mem.byLabel(W1, label)?.id).toBe(ids.get(label));

    const dec = await queries.getPeriod({ workspaceId: W1, periodId: ids.get('2026-12')! });
    expect(dec).toMatchObject({ label: '2026-12', periodStart: '2026-12-25', periodEnd: '2027-01-24' });
    expect(plans.get(dec!.id)).toEqual({ line: 'Supermercado', amount: '1500.00', currency: 'BOB' });

    const rescheduled = mem.audits.slice(audits).filter((a) => a.action === 'planning.period.rescheduled');
    expect(rescheduled.map((a) => a.aggregateId)).toEqual([
      ids.get('2026-11'),
      ids.get('2026-12'),
      ids.get('2027-01'),
    ]);
    expect(rescheduled[1]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'periodStart', before: '2026-12-01', after: '2026-12-25' },
        { field: 'periodEnd', before: '2026-12-31', after: '2027-01-24' },
        {
          field: 'range',
          before: '{"periodStart":"2026-12-01","periodEnd":"2026-12-31"}',
          after: '{"periodStart":"2026-12-25","periodEnd":"2027-01-24"}',
        },
        { field: 'startDay', before: 1, after: 25 },
      ]),
    );
    const annotations = mem.lifecycleSteps.filter((s) => s.action === 'planning.period.rescheduled');
    expect(annotations.every((s) => s.kind === 'ANNOTATION')).toBe(true);

    // Idempotente: sin cambios nuevos.
    const total = mem.audits.length;
    await svc.ensurePeriods({ workspaceId: W1 });
    expect(mem.audits.length).toBe(total);
  });

  it('[TC-PLANNING-TZ-001] (aplicación) cambiar la zona horaria de La Paz a UTC no cambia rangos ni pertenencias', async () => {
    const { mem, svc, queries } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    const before = [...mem.rows.values()].map((r) => `${r.label}:${r.periodStart}..${r.periodEnd}`);
    mem.workspace(W1, 'UTC', 1);
    await svc.ensurePeriods({ workspaceId: W1 });
    expect([...mem.rows.values()].map((r) => `${r.label}:${r.periodStart}..${r.periodEnd}`)).toEqual(before);
    expect((await queries.getPeriodContaining({ workspaceId: W1, date: '2026-10-31' }))?.label).toBe(
      '2026-10',
    );
  });
});

describe('Consultas y guard de planificación', () => {
  it('[TC-PLANNING-QUERY-001] (aplicación) periodo de una fecha, pendientes de cierre, anterior y fecha sin periodo', async () => {
    const { mem, svc, queries } = setup();
    at(mem, '2026-10-20T12:00:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    at(mem, '2026-11-03T12:00:00Z');
    await svc.ensurePeriods({ workspaceId: W1 });
    const oct = await queries.getPeriodContaining({ workspaceId: W1, date: '2026-10-31' });
    expect(oct).toMatchObject({
      label: '2026-10',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      status: 'ACTIVE',
    });
    const active = await queries.listPeriods({ workspaceId: W1, statuses: ['ACTIVE'] });
    expect(active.map((p) => `${p.label}:${String(p.pendingClosure)}`)).toEqual([
      '2026-10:true',
      '2026-11:false',
    ]);
    expect(await queries.getPeriodContaining({ workspaceId: W1, date: '2031-01-01' })).toBeNull();
    const nov = active[1]!;
    expect((await queries.getPrevious({ workspaceId: W1, periodId: nov.id }))?.label).toBe('2026-10');
    expect(await queries.getPrevious({ workspaceId: W1, periodId: oct!.id })).toBeNull();
    expect(await codeOf(queries.periodContaining(W1, '2031-01-01'))).toBe('RESOURCE_NOT_FOUND');
    expect(await codeOf(queries.periodContaining(W1, '2031-02-30'))).toBe('VALIDATION_FAILED');
  });

  it('[TC-PLANNING-PLANGUARD-001] (guard) plan de un periodo closed ⇒ PERIOD_CLOSED sin cambios; tras reabrir o en draft se acepta', async () => {
    const { mem, queries } = setup();
    const sep = mem.seed(W1, '2026-09', 'CLOSED');
    const dec = mem.seed(W1, '2026-12', 'DRAFT');
    // Doble del plan mensual de pf-p2b: toda mutación pasa primero por el guard.
    const plan = new Map([
      [sep.id, '1500.00'],
      [dec.id, '1500.00'],
    ]);
    const edit = async (periodId: string, amount: string) => {
      await queries.assertPlanEditable({ workspaceId: W1, periodId });
      plan.set(periodId, amount);
    };
    expect(await codeOf(edit(sep.id, '1800.00'))).toBe('PERIOD_CLOSED');
    expect(plan.get(sep.id)).toBe('1500.00');
    mem.rows.set(sep.id, { ...sep, status: 'REOPENED', reopenCount: 1 });
    await edit(sep.id, '1800.00');
    expect(plan.get(sep.id)).toBe('1800.00');
    await edit(dec.id, '1600.00');
    expect(plan.get(dec.id)).toBe('1600.00');
    expect(await codeOf(edit('0190a000-0000-7000-8000-0000000000ff', '1.00'))).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('Consumidor de asientos (JournalEntryPosted)', () => {
  it('solo actúa si la fecha del asiento cae fuera del rango cubierto', async () => {
    const { mem, svc } = setup();
    await svc.ensurePeriods({ workspaceId: W1 });
    const locks = mem.locks;
    expect(await svc.onJournalEntryPosted({ workspaceId: W1, entryDate: '2026-10-15' })).toBe(false);
    expect(mem.locks).toBe(locks);
    mem.entries(W1, '2026-08-10');
    expect(await svc.onJournalEntryPosted({ workspaceId: W1, entryDate: '2026-08-10' })).toBe(true);
    expect(mem.labels(W1)[0]).toBe('2026-08:ACTIVE');
  });
});
