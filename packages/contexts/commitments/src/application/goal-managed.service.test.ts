import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { CreateManagedMonthlyInput } from '../contracts/index.js';
import { DefinitionsService } from './definitions.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { EngineRecurringDefinitionPort } from './recurring-definition-port.js';
import { BANK, InMemoryCommitments, SAVINGS, USER, WS } from './testing/in-memory.js';

/**
 * Aporte recurrente de una meta (openspec add-savings-goals, decisión 18, N5): definición `TRANSFER` mensual de monto
 * fijo administrada por `GOAL` sobre el `RecurringDefinitionPort` público.
 */
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const noon = (date: string) => `${date}T16:00:00Z`;
const GOAL_ID = '0190a000-0000-7000-8000-0000000d0901';

function setup(now = '2026-10-17') {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const port = new EngineRecurringDefinitionPort(deps, defs);
  mem.setNow(noon(now));
  return { mem, deps, defs, occs, port };
}
type S = ReturnType<typeof setup>;

const createPlan = (s: S, over: Partial<CreateManagedMonthlyInput> = {}) =>
  s.port.createManaged({
    workspaceId: WS,
    userId: USER,
    managedBy: 'GOAL',
    managedRef: GOAL_ID,
    name: 'Aporte Fondo de emergencia',
    kind: 'TRANSFER',
    accountId: BANK,
    toAccountId: SAVINGS,
    currency: 'BOB',
    amount: '1500.00',
    monthlyRule: { monthDays: [5], startDate: '2026-11-05', weekendAdjustment: 'NONE' },
    materialization: { mode: 'PENDING_APPROVAL' },
    ...over,
  });

const occsOf = (s: S, definitionId: string) => s.mem.forDefinition(definitionId);
const act = async (s: S, definitionId: string) => ({
  workspaceId: WS,
  userId: USER,
  definitionId,
  expectedVersion: (await s.deps.definitions.findById(WS, definitionId))!.version,
});

async function code(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

describe('aporte recurrente administrado por una meta (managedBy = GOAL)', () => {
  it('[TC-GOALS-SAVINGS-039] crea una definición TRANSFER mensual de 1500.00 BOB administrada por la meta', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.snapshot).toMatchObject({
      kind: 'TRANSFER',
      managedBy: 'GOAL',
      managedRef: GOAL_ID,
      status: 'ACTIVE',
    });
    expect(def.current).toMatchObject({
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: { type: 'FIXED', amount: '1500.00' },
      schedule: { cadence: 'MONTHLY', monthDays: [5], startDate: '2026-11-05' },
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    expect(occsOf(s, definitionId).map((o) => o.occurrenceDate)).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('[TC-GOALS-SAVINGS-039] aprobar la ocurrencia del 2026-11-05 crea la transferencia y publica la materialización con managedBy GOAL', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const occ = occsOf(s, definitionId).find((o) => o.occurrenceDate === '2026-11-05')!;
    const approved = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id });
    expect(s.mem.recordCalls[0]).toMatchObject({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: bob('1500.00'),
    });
    const materialized = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')[0]?.payload;
    expect(materialized).toMatchObject({
      managedBy: 'GOAL',
      definitionId,
      transactionId: approved.transactionId,
      mode: 'CREATED',
    });
  });

  it('[TC-GOALS-SAVINGS-039] las acciones de usuario sobre la definición se rechazan con RECURRING_MANAGED_EXTERNALLY', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const a = await act(s, definitionId);
    expect((await code(s.defs.pause(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await code(s.defs.resume(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await code(s.defs.end(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ACTIVE');
  });

  it('[TC-GOALS-SAVINGS-039] pauseManaged cancela las ocurrencias futuras y resumeManaged las reinstaura', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.pauseManaged({ workspaceId: WS, userId: USER, definitionId });
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('PAUSED');
    expect(occsOf(s, definitionId).every((o) => o.status === 'CANCELLED')).toBe(true);
    // idempotente
    await s.port.pauseManaged({ workspaceId: WS, userId: USER, definitionId });
    await s.port.resumeManaged({ workspaceId: WS, userId: USER, definitionId });
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ACTIVE');
    expect(occsOf(s, definitionId).filter((o) => o.status !== 'CANCELLED').length).toBeGreaterThan(0);
    await s.port.resumeManaged({ workspaceId: WS, userId: USER, definitionId });
  });

  it('[TC-GOALS-SAVINGS-038] reviseManaged cambia el monto fijo desde la fecha efectiva y reescribe las ocurrencias no resueltas', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.reviseManaged({
      workspaceId: WS,
      userId: USER,
      definitionId,
      amount: '2000.00',
      effectiveFrom: '2026-12-01',
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.current.amount).toMatchObject({ type: 'FIXED', amount: '2000.00' });
    const byDate = new Map(occsOf(s, definitionId).map((o) => [o.occurrenceDate, o]));
    expect(byDate.get('2026-11-05')?.expected).toMatchObject({ amount: '1500.00' });
    expect(byDate.get('2026-12-05')?.expected).toMatchObject({ amount: '2000.00' });
  });

  it('[TC-GOALS-SAVINGS-038] reviseManaged sin cambios no escribe nada', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const versionBefore = (await s.deps.definitions.findById(WS, definitionId))!.version;
    await s.port.reviseManaged({
      workspaceId: WS,
      userId: USER,
      definitionId,
      amount: '1500.00',
      effectiveFrom: '2026-12-01',
    });
    expect((await s.deps.definitions.findById(WS, definitionId))!.version).toBe(versionBefore);
  });

  it('[TC-GOALS-SAVINGS-039] endManaged: end termina la definición y cancela las no resueltas', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2026-10-17' });
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ENDED');
    expect(occsOf(s, definitionId).every((o) => o.status === 'CANCELLED')).toBe(true);
  });

  it('[TC-GOALS-SAVINGS-039] valida cuentas de la misma moneda y origen activo', async () => {
    const s = setup();
    const err = await code(createPlan(s, { currency: 'USD' }));
    expect(['CURRENCY_MISMATCH', 'REFERENCE_NOT_FOUND', 'ACCOUNT_CURRENCY_MISMATCH']).toContain(err.code);
    expect(s.mem.all()).toEqual([]);
  });
});
