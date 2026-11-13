import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService, type CreateDefinitionCommand } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { BANK, CATEGORY, InMemoryCommitments, USER, WS } from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;

function setup() {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const job = new GenerateOccurrencesService(deps, occs);
  const queries = new CommitmentsQueries(deps);
  mem.setNow(noon('2026-11-05'));
  return { mem, defs, job, queries };
}

type S = ReturnType<typeof setup>;

function create(
  s: S,
  name: string,
  over: Partial<CreateDefinitionCommand['template']> = {},
  kind = 'EXPENSE',
) {
  return s.defs.create({
    workspaceId: WS,
    userId: USER,
    name,
    kind,
    template: {
      accountId: BANK,
      amount: { type: 'FIXED', amount: bob('100.00') },
      categoryId: CATEGORY,
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-10' },
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      ...over,
    },
  });
}

describe('UpcomingPaymentsQuery.projectForForecast (add-expense-forecasts, S1)', () => {
  it('[TC-FORECAST-EXPENSE-004] un seguro anual fuera del horizonte de generación (hasta 2027-02-03) se proyecta en 2027-03 sin guardar nada', async () => {
    const s = setup();
    await create(s, 'Seguro anual', {
      amount: { type: 'FIXED', amount: bob('900.00') },
      schedule: { cadence: 'ANNUAL', interval: 1, startDate: '2026-03-15' },
    });
    const before = [s.mem.all().length, s.mem.events.length];
    const r = await s.queries.projectForForecast({ workspaceId: WS, from: '2026-11-01', to: '2027-10-31' });
    const seguro = r.filter((o) => o.label === 'Seguro anual');
    expect(seguro).toHaveLength(1);
    expect(seguro[0]).toMatchObject({
      date: '2027-03-15',
      projected: true,
      occurrenceId: null,
      kind: 'EXPENSE',
      direction: 'OUTFLOW',
      amountType: 'FIXED',
      amount: { amount: '900.00', currency: 'BOB' },
      categoryId: CATEGORY,
      managedBy: 'USER',
    });
    // Sin escrituras: ni ocurrencias nuevas ni hechos.
    expect([s.mem.all().length, s.mem.events.length]).toEqual(before);
  });

  it('[TC-FORECAST-EXPENSE-004] una definición mensual combina las generadas (no proyectadas) y las posteriores al horizonte (proyectadas), sin repetir fechas', async () => {
    const s = setup();
    await create(s, 'Internet', { amount: { type: 'FIXED', amount: bob('199.00') } });
    const r = await s.queries.projectForForecast({ workspaceId: WS, from: '2026-11-01', to: '2027-04-30' });
    const dates = r.filter((o) => o.label === 'Internet').map((o) => o.date);
    expect(dates).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
      '2027-03-10',
      '2027-04-10',
    ]);
    expect(new Set(dates).size).toBe(dates.length);
    const generated = r.filter((o) => o.label === 'Internet' && !o.projected);
    const projected = r.filter((o) => o.label === 'Internet' && o.projected);
    expect(generated.length).toBeGreaterThanOrEqual(3);
    expect(generated.every((o) => o.occurrenceId !== null)).toBe(true);
    expect(projected.every((o) => o.occurrenceId === null && o.date > '2027-02-03')).toBe(true);
  });

  it('[TC-FORECAST-EXPENSE-004] respeta el fin de la definición y no proyecta definiciones terminadas', async () => {
    const s = setup();
    const def = await create(s, 'Gimnasio', {
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-10' },
    });
    await s.defs.end({
      workspaceId: WS,
      userId: USER,
      definitionId: def.id,
      expectedVersion: def.version,
      endDate: '2027-01-31',
    });
    const r = await s.queries.projectForForecast({ workspaceId: WS, from: '2026-11-01', to: '2027-06-30' });
    const dates = r.filter((o) => o.label === 'Gimnasio').map((o) => o.date);
    expect(dates.every((d) => d <= '2027-01-31')).toBe(true);
  });

  it('[TC-FORECAST-EXPENSE-004] los ingresos se informan como entradas y los montos MIN_MAX con mínimo y máximo', async () => {
    const s = setup();
    await create(
      s,
      'Extras',
      {
        amount: { type: 'MIN_MAX', min: bob('300.00'), max: bob('900.00') },
        categoryId: null,
      },
      'INCOME',
    );
    const r = await s.queries.projectForForecast({ workspaceId: WS, from: '2026-11-01', to: '2026-12-31' });
    expect(r.find((o) => o.label === 'Extras')).toMatchObject({
      kind: 'INCOME',
      direction: 'INFLOW',
      amountType: 'MIN_MAX',
      amount: null,
      minAmount: { amount: '300.00' },
      maxAmount: { amount: '900.00' },
    });
  });
});

describe('ResolvedOccurrencesQuery.listResolved (add-expense-forecasts, S2)', () => {
  it('[TC-FORECAST-EXPENSE-002] informa tipo, administrador y categoría de las resueltas por la fecha de su transacción', async () => {
    const s = setup();
    const def = await create(s, 'Alquiler', {
      amount: { type: 'FIXED', amount: bob('2500.00') },
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-05' },
    });
    const occurrence = s.mem.forDefinition(def.id)[0];
    await new OccurrencesService(s.mem.deps()).materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occurrence?.id as string,
    });
    const out = await s.queries.listResolved({
      workspaceId: WS,
      from: '2026-11-01',
      to: '2026-11-30',
      direction: 'OUTFLOW',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'EXPENSE',
      managedBy: 'USER',
      direction: 'OUTFLOW',
      categoryId: CATEGORY,
      amount: bob('2500.00'),
    });
    const inflow = await s.queries.listResolved({
      workspaceId: WS,
      from: '2026-11-01',
      to: '2026-11-30',
      direction: 'INFLOW',
    });
    expect(inflow).toEqual([]);
    const other = await s.queries.listResolved({
      workspaceId: WS,
      from: '2026-12-01',
      to: '2026-12-31',
      direction: 'OUTFLOW',
    });
    expect(other).toEqual([]);
  });
});
