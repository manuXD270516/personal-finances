import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { CreateManagedMonthlyInput } from '../contracts/index.js';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { EngineRecurringDefinitionPort } from './recurring-definition-port.js';
import { EngineRecurringDefinitionQuery } from './recurring-definition-query.js';
import {
  BANK,
  CARD,
  CASH,
  CATEGORY,
  InMemoryCommitments,
  SAVINGS,
  USD_BANK,
  USER,
  VISA_USD,
  WS,
} from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;
const VISA_CARD = '0190a000-0000-7000-8000-0000000d0c01';

function setup(now = '2026-10-17') {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const port = new EngineRecurringDefinitionPort(deps, defs);
  const query = new EngineRecurringDefinitionQuery(deps);
  const job = new GenerateOccurrencesService(deps, occs);
  const queries = new CommitmentsQueries(deps);
  const matching = new MatchingService(deps, occs);
  mem.setNow(noon(now));
  return { mem, deps, defs, occs, port, query, job, queries, matching };
}
type S = ReturnType<typeof setup>;

/** Plan de pago de "Visa Oro BOB": de "Banco BOB" a la tarjeta, mensual el día 15 desde el 2026-11-15. */
const createPlan = (s: S, over: Partial<CreateManagedMonthlyInput> = {}) =>
  s.port.createManaged({
    workspaceId: WS,
    userId: USER,
    managedBy: 'DEBT',
    managedRef: VISA_CARD,
    name: 'Pago de tarjeta · Visa Oro BOB',
    kind: 'CARD_PAYMENT',
    accountId: BANK,
    toAccountId: CARD,
    currency: 'BOB',
    monthlyRule: { monthDays: [15], startDate: '2026-11-15', weekendAdjustment: 'NONE' },
    materialization: { mode: 'PENDING_APPROVAL' },
    ...over,
  });

const occsOf = (s: S, definitionId: string) => s.mem.forDefinition(definitionId);
const onDate = (s: S, definitionId: string, date: string) => {
  const found = occsOf(s, definitionId).find((o) => o.occurrenceDate === date);
  if (!found) throw new Error(`no occurrence on ${date}`);
  return found;
};
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

describe('CARD_PAYMENT solo en definiciones administradas por la tarjeta', () => {
  it('[TC-DEBT-CARD-029] el usuario no puede crear un CARD_PAYMENT desde Pagos recurrentes y no se crea nada', async () => {
    const s = setup();
    const err = await code(
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name: 'Pago tarjeta',
        kind: 'CARD_PAYMENT',
        template: {
          accountId: BANK,
          toAccountId: CARD,
          amount: { type: 'FIXED', amount: bob('1450.00') },
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-15' },
        },
      }),
    );
    expect(err.code).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(s.mem.all()).toEqual([]);
    expect(s.mem.events).toEqual([]);
  });

  it('[TC-DEBT-CARD-029] solo lo admite quien administra como DEBT: SUBSCRIPTION lo rechaza', async () => {
    const s = setup();
    const err = await code(createPlan(s, { managedBy: 'SUBSCRIPTION' }));
    expect(err.code).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(s.mem.all()).toEqual([]);
  });

  it('[TC-DEBT-CARD-029] plan de pago: definición CARD_PAYMENT de DEBT, mensual el día 15, monto VARIABLE', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.snapshot).toMatchObject({
      kind: 'CARD_PAYMENT',
      managedBy: 'DEBT',
      managedRef: VISA_CARD,
      status: 'ACTIVE',
    });
    expect(def.current).toMatchObject({
      accountId: BANK,
      toAccountId: CARD,
      currency: 'BOB',
      amount: { type: 'VARIABLE', amount: null },
      schedule: { cadence: 'MONTHLY', monthDays: [15], startDate: '2026-11-15', weekendAdjustment: 'NONE' },
      materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null },
    });
    // hoy 2026-10-17 + 90 días de horizonte: 11-15, 12-15 y 01-15, con clave = fecha nominal
    expect(occsOf(s, definitionId).map((o) => o.occurrenceDate)).toEqual([
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ]);
    for (const o of occsOf(s, definitionId)) {
      expect(o).toMatchObject({ status: 'SCHEDULED', expected: { type: 'VARIABLE' }, scheduleKey: null });
    }
    const generated = s.mem.eventsOf('commitments.OccurrencesGenerated')[0]?.payload;
    expect(generated).toMatchObject({ definitionId });
    expect((generated?.['occurrences'] as { kind: string }[]).map((o) => o.kind)).toEqual([
      'CARD_PAYMENT',
      'CARD_PAYMENT',
      'CARD_PAYMENT',
    ]);
  });

  it('[TC-DEBT-CARD-029] origen activo y destino pasivo, misma moneda y cuentas distintas', async () => {
    const s = setup();
    expect((await code(createPlan(s, { accountId: CARD, toAccountId: BANK }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await code(createPlan(s, { toAccountId: SAVINGS }))).code).toBe('VALIDATION_FAILED');
    expect((await code(createPlan(s, { toAccountId: VISA_USD }))).code).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect((await code(createPlan(s, { accountId: USD_BANK, currency: 'USD' }))).code).toBe(
      'TRANSFER_CURRENCY_MISMATCH',
    );
    expect((await code(createPlan(s, { accountId: CARD, toAccountId: CARD }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await code(createPlan(s, { currency: 'USD' }))).code).toBe('CURRENCY_MISMATCH');
    expect(s.mem.all()).toEqual([]);
  });

  it('[TC-DEBT-CARD-029] valida la regla mensual: uno o dos días entre 1 y 31', async () => {
    const s = setup();
    for (const monthDays of [[], [0], [32], [1, 2, 3], [15.5]]) {
      const err = await code(
        createPlan(s, { monthlyRule: { monthDays, startDate: '2026-11-15', weekendAdjustment: 'NONE' } }),
      );
      expect(err.code).toBe('RECURRING_INVALID_SCHEDULE');
    }
    expect(s.mem.all()).toEqual([]);
  });

  it('[TC-DEBT-CARD-029] el día 31 cae en el último día de los meses cortos y el ajuste de fin de semana mueve el vencimiento', async () => {
    const s = setup('2027-01-20');
    const { definitionId } = await createPlan(s, {
      monthlyRule: { monthDays: [31], startDate: '2027-01-31', weekendAdjustment: 'PREVIOUS' },
    });
    const rows = occsOf(s, definitionId).map((o) => [o.occurrenceDate, o.dueDate]);
    // 2027-01-31 es domingo ⇒ viernes 29; 2027-02-28 es domingo ⇒ viernes 26; 2027-03-31 es miércoles
    expect(rows).toEqual([
      ['2027-01-31', '2027-01-29'],
      ['2027-02-28', '2027-02-26'],
      ['2027-03-31', '2027-03-31'],
    ]);
  });

  it('[TC-DEBT-CARD-029] aprobar la ocurrencia del 2026-11-15 por 1120.50 BOB crea una transferencia entre las cuentas', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const occ = onDate(s, definitionId, '2026-11-15');
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    const approved = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occ.id });
    expect(s.mem.recordCalls).toHaveLength(1);
    expect(s.mem.recordCalls[0]).toMatchObject({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
    });
    expect(s.mem.transactionsStore.get(approved.transactionId)).toMatchObject({
      kind: 'TRANSFER',
      toAccountId: CARD,
    });
    expect(s.mem.occurrence(occ.id)).toMatchObject({ status: 'MATERIALIZED', occurrenceDate: '2026-11-15' });
  });

  it('[TC-DEBT-CARD-029] con AUTO_CREATE el modo se admite sobre un monto VARIABLE: sin monto no crea, con monto sí', async () => {
    const s = setup('2026-11-10');
    const { definitionId } = await createPlan(s, {
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED', leadDays: 3 },
    });
    s.mem.setNow(noon('2026-11-15'));
    await s.job.runWorkspace(WS);
    expect(s.mem.recordAttempts).toBe(0);
    expect(onDate(s, definitionId, '2026-11-15')).toMatchObject({
      status: 'DUE',
      lastAutoCreateError: 'OCCURRENCE_AMOUNT_REQUIRED',
    });
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    s.mem.setNow(noon('2026-11-16'));
    await s.job.runWorkspace(WS);
    expect(s.mem.recordCalls[0]).toMatchObject({
      kind: 'TRANSFER',
      status: 'POSTED',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
    });
    expect(onDate(s, definitionId, '2026-11-15').status).toBe('MATERIALIZED');
  });

  it('[TC-DEBT-CARD-029] pausar, reanudar, terminar, revisar y editar datos desde el usuario: RECURRING_MANAGED_EXTERNALLY', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const a = await act(s, definitionId);
    expect((await code(s.defs.pause(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await code(s.defs.resume(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await code(s.defs.end(a))).code).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await code(s.defs.updateDetails({ ...a, name: 'Otro' }))).code).toBe(
      'RECURRING_MANAGED_EXTERNALLY',
    );
    expect(
      (await code(s.defs.revise({ ...a, effectiveFrom: '2026-12-01', changes: { accountId: CASH } }))).code,
    ).toBe('RECURRING_MANAGED_EXTERNALLY');
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ACTIVE');
  });

  it('[TC-DEBT-CARD-029] aprobar, editar, omitir y vincular ocurrencias CARD_PAYMENT sigue permitido al usuario', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    for (const date of ['2026-11-15', '2026-12-15']) {
      await s.port.setExpected({
        workspaceId: WS,
        userId: USER,
        definitionId,
        key: date,
        expectation: { type: 'ESTIMATED', amount: '900.00' },
      });
    }
    // editar
    const nov = onDate(s, definitionId, '2026-11-15');
    const edited = await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: nov.id,
      expectedVersion: nov.version,
      expectedAmount: bob('950.00'),
    });
    expect(edited).toMatchObject({ expected: { amount: bob('950.00') } });
    // omitir
    const dec = onDate(s, definitionId, '2026-12-15');
    await s.occs.skip({ workspaceId: WS, userId: USER, occurrenceId: dec.id, reason: 'Pagué por otro lado' });
    expect(s.mem.occurrence(dec.id).status).toBe('SKIPPED');
    // vincular una transferencia ya registrada
    const txn = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('950.00'),
      businessDate: '2026-11-14',
    });
    await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: nov.id, transactionId: txn });
    expect(s.mem.occurrence(nov.id)).toMatchObject({ status: 'MATCHED', transactionId: txn });
    // aprobar la tercera
    const jan = onDate(s, definitionId, '2027-01-15');
    await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: jan.id,
      amount: bob('800.00'),
    });
    expect(s.mem.occurrence(jan.id).status).toBe('MATERIALIZED');
  });

  it('[TC-DEBT-CARD-029] vincular exige una transferencia entre las mismas cuentas', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const occ = onDate(s, definitionId, '2026-11-15');
    const expense = s.mem.addTransaction({ kind: 'EXPENSE', accountId: BANK, amount: bob('10.00') });
    const otherCard = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: bob('10.00'),
    });
    for (const transactionId of [expense, otherCard]) {
      const err = await code(
        s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occ.id, transactionId }),
      );
      expect(err.code).toBe('OCCURRENCE_LINK_MISMATCH');
    }
  });

  it('[TC-DEBT-CARD-029] una transferencia manual de 1120.50 BOB el 2026-11-14 se sugiere para la ocurrencia del 2026-11-15 sin vincularla', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    const occ = onDate(s, definitionId, '2026-11-15');
    const txn = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
      businessDate: '2026-11-14',
    });
    await s.matching.onTransactionChanged({
      workspaceId: WS,
      transactionId: txn,
      eventId: '0190a000-0000-7000-8000-000000900001',
    });
    const suggestion = s.mem.suggestionFor(occ.id, txn);
    expect(suggestion).toMatchObject({ status: 'PROPOSED', definitionId });
    expect(s.mem.occurrence(occ.id)).toMatchObject({ status: 'SCHEDULED', transactionId: null });
    // no se sugiere para una transferencia a otra cuenta
    const other = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: bob('1120.50'),
      businessDate: '2026-11-14',
    });
    await s.matching.onTransactionChanged({
      workspaceId: WS,
      transactionId: other,
      eventId: '0190a000-0000-7000-8000-000000900002',
    });
    expect(s.mem.suggestionFor(occ.id, other)).toBeUndefined();
  });

  it('[TC-DEBT-CARD-029] anular la transacción libera la ocurrencia de pago de tarjeta como a cualquier otra', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const occ = onDate(s, definitionId, '2026-11-15');
    const { transactionId } = await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      amount: bob('1120.50'),
    });
    s.mem.voidTransaction(transactionId);
    expect(await s.occs.onTransactionVoided({ workspaceId: WS, transactionId })).toBe(true);
    expect(s.mem.occurrence(occ.id)).toMatchObject({ transactionId: null, resolution: null });
    expect(['DUE', 'OVERDUE', 'SCHEDULED']).toContain(s.mem.occurrence(occ.id).status);
  });

  it('[TC-DEBT-CARD-029] la transferencia del usuario "Pago Visa" sigue siendo TRANSFER, del usuario y editable', async () => {
    const s = setup();
    await createPlan(s);
    const user = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Pago Visa',
      kind: 'TRANSFER',
      template: {
        accountId: BANK,
        toAccountId: CARD,
        amount: { type: 'FIXED', amount: bob('1450.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
      },
    });
    expect(user.kind).toBe('TRANSFER');
    expect(user.managedBy).toBe('USER');
    const renamed = await s.defs.updateDetails({
      workspaceId: WS,
      userId: USER,
      definitionId: user.id,
      expectedVersion: user.version,
      name: 'Pago Visa Oro',
    });
    expect(renamed.name).toBe('Pago Visa Oro');
  });
});

describe('RecurringDefinitionQuery.listActiveTransfersTo', () => {
  it('[TC-DEBT-CARD-029] devuelve las TRANSFER activas del usuario hacia la cuenta, no las pausadas ni las de DEBT', async () => {
    const s = setup();
    const mk = (name: string, toAccountId: string) =>
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name,
        kind: 'TRANSFER',
        template: {
          accountId: BANK,
          toAccountId,
          amount: { type: 'FIXED', amount: bob('100.00') },
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
        },
      });
    const pago = await mk('Pago Visa', CARD);
    const paused = await mk('Pago viejo', CARD);
    await mk('Ahorro', SAVINGS);
    await createPlan(s);
    await s.defs.pause({
      workspaceId: WS,
      userId: USER,
      definitionId: paused.id,
      expectedVersion: paused.version,
    });
    expect(await s.query.listActiveTransfersTo({ workspaceId: WS, accountId: CARD })).toEqual([
      { definitionId: pago.id, name: 'Pago Visa' },
    ]);
    expect(await s.query.listActiveTransfersTo({ workspaceId: WS, accountId: BANK })).toEqual([]);
  });
});

describe('Monto esperado fijado por el administrador', () => {
  const set = (
    s: S,
    definitionId: string,
    key: string,
    expectation: NonNullable<Parameters<EngineRecurringDefinitionPort['setExpected']>[0]['expectation']>,
  ) => s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key, expectation });

  it('[TC-DEBT-CARD-030] de estimación a monto exacto: conserva la fecha nominal y publica el hecho de ocurrencia editada', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await set(s, definitionId, '2026-11-15', { type: 'ESTIMATED', amount: '1120.50' });
    const before = s.mem.eventsOf('commitments.RecurringOccurrenceChanged').length;
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1120.50' });
    const occ = onDate(s, definitionId, '2026-11-15');
    expect(occ).toMatchObject({
      occurrenceDate: '2026-11-15',
      dueDate: '2026-11-15',
      expected: { type: 'FIXED', amount: '1120.50', min: null, max: null },
      amountOverridden: false,
    });
    const events = s.mem.eventsOf('commitments.RecurringOccurrenceChanged');
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)?.payload).toMatchObject({
      occurrenceId: occ.id,
      managedBy: 'DEBT',
      transition: 'EDIT',
      expected: { type: 'FIXED', amount: '1120.50' },
      currency: 'BOB',
    });
    // auditoría de la edición (el actor lo resuelve el contexto de proceso del llamador)
    const audits = s.mem.recordedFor(occ.id).map((r) => r.entry.action);
    expect(audits).toContain('commitments.recurring_occurrence.updated');
    expect(s.mem.recordedFor(occ.id).at(-1)?.steps).toEqual([
      expect.objectContaining({ kind: 'ANNOTATION', changedFields: ['expected'] }),
    ]);
  });

  it('[TC-DEBT-CARD-030] ESTIMATED, FIXED y NONE (sin monto ⇒ VARIABLE) y vuelta a un monto', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await set(s, definitionId, '2026-11-15', { type: 'ESTIMATED', amount: '300' });
    expect(onDate(s, definitionId, '2026-11-15').expected).toEqual({
      type: 'ESTIMATED',
      amount: '300.00',
      min: null,
      max: null,
    });
    await set(s, definitionId, '2026-11-15', { type: 'NONE' });
    expect(onDate(s, definitionId, '2026-11-15').expected).toEqual({
      type: 'VARIABLE',
      amount: null,
      min: null,
      max: null,
    });
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '87.30' });
    expect(onDate(s, definitionId, '2026-11-15').expected).toMatchObject({ type: 'FIXED', amount: '87.30' });
  });

  it('[TC-DEBT-CARD-030] no publica hechos redundantes si nada cambia', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1120.50' });
    const events = s.mem.events.length;
    const audits = s.mem.recorded.length;
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1120.50' });
    await set(s, definitionId, '2026-12-15', { type: 'NONE' }); // ya está sin monto
    expect(s.mem.events.length).toBe(events);
    expect(s.mem.recorded.length).toBe(audits);
  });

  it('[TC-DEBT-CARD-030] una ocurrencia resuelta no cambia, sin error ni hechos', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1120.50' });
    const occ = onDate(s, definitionId, '2026-11-15');
    const txn = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
      businessDate: '2026-11-14',
    });
    await s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occ.id, transactionId: txn });
    const events = s.mem.events.length;
    const snapshot = s.mem.occurrence(occ.id);
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1165.50' });
    await s.port.skip({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      reason: 'NOTHING_BILLED',
    });
    expect(s.mem.occurrence(occ.id)).toEqual(snapshot);
    expect(s.mem.events.length).toBe(events);
  });

  it('[TC-DEBT-CARD-030] las ediciones del administrador no marcan la ocurrencia como editada por el usuario; las del usuario sí', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await set(s, definitionId, '2026-11-15', { type: 'ESTIMATED', amount: '900.00' });
    const range = { workspaceId: WS, definitionId, from: '2026-11-01', to: '2026-11-30' };
    expect((await s.port.listOccurrences(range))[0]).toMatchObject({ editedByUser: false });
    const occ = onDate(s, definitionId, '2026-11-15');
    await s.occs.edit({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      expectedVersion: occ.version,
      expectedAmount: bob('950.00'),
    });
    expect((await s.port.listOccurrences(range))[0]).toMatchObject({
      editedByUser: true,
      expected: { type: 'ESTIMATED', amount: '950.00' },
    });
    // el administrador (p. ej. al emitir) fija el monto vigente y la marca se limpia
    await set(s, definitionId, '2026-11-15', { type: 'FIXED', amount: '1120.50' });
    expect((await s.port.listOccurrences(range))[0]).toMatchObject({
      editedByUser: false,
      expected: { type: 'FIXED', amount: '1120.50' },
    });
  });

  it('[TC-DEBT-CARD-030] valida montos y tipo; el contrato legado con amount sigue marcando el ajuste', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    for (const expectation of [
      { type: 'FIXED' as const },
      { type: 'FIXED' as const, amount: '0.00' },
      { type: 'ESTIMATED' as const, amount: '-3' },
      { type: 'FIXED' as const, amount: '10.123' },
      { type: 'NONE' as const, amount: '10.00' },
      { type: 'MIN_MAX' as never, amount: '10.00' },
    ]) {
      expect((await code(set(s, definitionId, '2026-11-15', expectation))).code).toBe(
        'RECURRING_INVALID_AMOUNT',
      );
    }
    expect(
      (await code(s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key: '2026-11-15' })))
        .code,
    ).toBe('VALIDATION_FAILED');
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      amount: '55.00',
    });
    expect(onDate(s, definitionId, '2026-11-15')).toMatchObject({
      expected: { type: 'FIXED', amount: '55.00' },
      amountOverridden: true,
    });
  });

  it('la clave es la fecha nominal: formato inválido, fecha que la regla no produce o definición ajena', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    expect((await code(set(s, definitionId, '15/11/2026', { type: 'NONE' }))).code).toBe('VALIDATION_FAILED');
    expect((await code(set(s, definitionId, '2026-11-16', { type: 'NONE' }))).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
    // antes de la primera ventana nunca existió ocurrencia
    expect((await code(set(s, definitionId, '2026-10-15', { type: 'NONE' }))).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
    const user = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Gimnasio',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        categoryId: CATEGORY,
        amount: { type: 'FIXED', amount: bob('10.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
      },
    });
    expect((await code(set(s, user.id, '2026-11-20', { type: 'NONE' }))).code).toBe('RESOURCE_NOT_FOUND');
  });

  it('una fecha futura de la regla fuera del horizonte se genera al fijarla y el generador no la duplica', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    expect(occsOf(s, definitionId)).toHaveLength(3);
    await set(s, definitionId, '2027-03-15', { type: 'ESTIMATED', amount: '640.00' });
    expect(onDate(s, definitionId, '2027-03-15')).toMatchObject({
      expected: { type: 'ESTIMATED', amount: '640.00' },
    });
    s.mem.setNow(noon('2027-01-10'));
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId).filter((o) => o.occurrenceDate === '2027-03-15')).toHaveLength(1);
    expect(occsOf(s, definitionId).map((o) => o.occurrenceDate)).toEqual([
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
      '2027-03-15',
    ]);
  });
});

describe('Omitir con motivo', () => {
  it('[TC-DEBT-CARD-030] omite la ocurrencia con su motivo y conserva la fecha nominal', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.skip({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      reason: 'NOTHING_BILLED',
    });
    const occ = onDate(s, definitionId, '2026-11-15');
    expect(occ).toMatchObject({
      status: 'SKIPPED',
      occurrenceDate: '2026-11-15',
      skipReason: 'NOTHING_BILLED',
      resolution: 'SKIPPED',
    });
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceChanged').at(-1)?.payload).toMatchObject({
      occurrenceId: occ.id,
      transition: 'SKIP',
      managedBy: 'DEBT',
      status: 'SKIPPED',
      reason: 'NOTHING_BILLED',
    });
    expect(s.mem.recordedFor(occ.id).at(-1)?.entry).toMatchObject({
      action: 'commitments.recurring_occurrence.skipped',
      reason: 'NOTHING_BILLED',
    });
    // omitida no vuelve a generarse ni cuenta como comprometida
    s.mem.setNow(noon('2026-11-01'));
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId).filter((o) => o.occurrenceDate === '2026-11-15')).toHaveLength(1);
  });

  it('[TC-DEBT-CARD-030] omitir otra vez no publica nada y el motivo es obligatorio', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const input = {
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      reason: 'STATEMENT_PAID',
    };
    expect((await code(s.port.skip({ ...input, reason: '  ' }))).code).toBe('VALIDATION_FAILED');
    await s.port.skip(input);
    const events = s.mem.events.length;
    await s.port.skip(input);
    expect(s.mem.events.length).toBe(events);
  });

  it('omitir expira las sugerencias propuestas de la ocurrencia', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    const occ = onDate(s, definitionId, '2026-11-15');
    const txn = s.mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
      businessDate: '2026-11-15',
    });
    await s.matching.onTransactionChanged({
      workspaceId: WS,
      transactionId: txn,
      eventId: '0190a000-0000-7000-8000-000000900010',
    });
    expect(s.mem.suggestionFor(occ.id, txn)?.status).toBe('PROPOSED');
    await s.port.skip({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      reason: 'NOTHING_BILLED',
    });
    expect(s.mem.suggestionFor(occ.id, txn)).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'OCCURRENCE_RESOLVED',
    });
  });
});

describe('listOccurrences', () => {
  it('lista por rango de fecha nominal con la clave, el estado y el monto esperado', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-12-15',
      expectation: { type: 'ESTIMATED', amount: '700.00' },
    });
    const rows = await s.port.listOccurrences({
      workspaceId: WS,
      definitionId,
      from: '2026-12-01',
      to: '2027-01-31',
    });
    expect(rows.map((r) => [r.key, r.occurrenceDate, r.status, r.expected.type, r.expected.amount])).toEqual([
      ['2026-12-15', '2026-12-15', 'SCHEDULED', 'ESTIMATED', '700.00'],
      ['2027-01-15', '2027-01-15', 'SCHEDULED', 'VARIABLE', null],
    ]);
    expect(rows[0]).toMatchObject({ transactionId: null, skipReason: null, editedByUser: false });
    expect(rows[0]?.expected.currency).toBe('BOB');
  });

  it('genera las ocurrencias del horizonte que falten antes de listar', async () => {
    const s = setup('2026-10-17');
    const { definitionId } = await createPlan(s);
    s.mem.setNow(noon('2026-12-20')); // el horizonte llega ahora hasta el 2027-03-20 sin haber corrido el job
    const rows = await s.port.listOccurrences({
      workspaceId: WS,
      definitionId,
      from: '2027-02-01',
      to: '2027-03-31',
    });
    expect(rows.map((r) => r.key)).toEqual(['2027-02-15', '2027-03-15']);
    expect(occsOf(s, definitionId)).toHaveLength(5);
  });

  it('refleja una ocurrencia resuelta con su transacción', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const occ = onDate(s, definitionId, '2026-11-15');
    const { transactionId } = await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: occ.id,
      amount: bob('1120.50'),
    });
    const [row] = await s.port.listOccurrences({
      workspaceId: WS,
      definitionId,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(row).toMatchObject({ status: 'MATERIALIZED', transactionId });
  });
});

describe('revise de la regla mensual', () => {
  it('cambia el día, el ajuste y el modo desde la fecha efectiva; lo resuelto y lo anterior no cambian', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const nov = onDate(s, definitionId, '2026-11-15');
    await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: nov.id, amount: bob('1000.00') });
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      effectiveFrom: '2026-12-01',
      monthDays: [20],
      weekendAdjustment: 'NEXT',
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING', leadDays: 5 },
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.current).toMatchObject({
      versionNo: 2,
      effectiveFrom: '2026-12-01',
      schedule: { cadence: 'MONTHLY', monthDays: [20], weekendAdjustment: 'NEXT' },
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING', leadDays: 5 },
    });
    expect(s.mem.occurrence(nov.id)).toMatchObject({ status: 'MATERIALIZED', occurrenceDate: '2026-11-15' });
    const live = occsOf(s, definitionId).filter((o) => o.status !== 'CANCELLED');
    // 2026-12-20 es domingo ⇒ lunes 21 (NEXT); el horizonte (hasta el 2027-01-15) aún no llega al 2027-01-20
    expect(live.map((o) => [o.occurrenceDate, o.dueDate])).toEqual([
      ['2026-11-15', '2026-11-15'],
      ['2026-12-20', '2026-12-21'],
    ]);
    expect(occsOf(s, definitionId).find((o) => o.occurrenceDate === '2026-12-15')?.status).toBe('CANCELLED');
    expect(s.mem.eventsOf('commitments.RecurringDefinitionChanged').at(-1)?.payload).toMatchObject({
      managedBy: 'DEBT',
      kind: 'CARD_PAYMENT',
      transition: 'REVISE',
    });
  });

  it('pasar de AUTO_CREATE a aprobación limpia el estado de la creación automática', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s, {
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED' },
    });
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      effectiveFrom: '2026-11-15',
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    expect((await s.deps.definitions.findById(WS, definitionId))!.current.materialization).toMatchObject({
      mode: 'PENDING_APPROVAL',
      autoCreateStatus: null,
    });
  });

  it('dos días del mes ⇒ semimensual; la cuenta de origen se revisa y valida como activo', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      effectiveFrom: '2026-12-01',
      monthDays: [5, 20],
      accountId: CASH,
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.current).toMatchObject({
      accountId: CASH,
      schedule: { cadence: 'SEMIMONTHLY', monthDays: [5, 20] },
    });
    expect(
      occsOf(s, definitionId)
        .filter((o) => o.status !== 'CANCELLED' && o.occurrenceDate >= '2026-12-01')
        .map((o) => o.occurrenceDate),
    ).toEqual(['2026-12-05', '2026-12-20', '2027-01-05']);
    expect(
      (
        await code(
          s.port.revise({
            workspaceId: WS,
            userId: USER,
            definitionId,
            effectiveFrom: '2027-02-01',
            accountId: CARD,
          }),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
  });

  it('sin cambios no escribe nada', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const events = s.mem.events.length;
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      effectiveFrom: '2026-12-01',
      monthDays: [15],
      weekendAdjustment: 'NONE',
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    expect(s.mem.events.length).toBe(events);
    expect((await s.deps.definitions.findById(WS, definitionId))!.current.versionNo).toBe(1);
  });
});

describe('end de la definición del plan', () => {
  it('cancela las no resueltas desde la fecha (ENDED) sin tocar las resueltas ni sus transacciones', async () => {
    const s = setup();
    const { definitionId } = await createPlan(s);
    const nov = onDate(s, definitionId, '2026-11-15');
    const { transactionId } = await s.occs.materialize({
      workspaceId: WS,
      userId: USER,
      occurrenceId: nov.id,
      amount: bob('1120.50'),
    });
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2026-12-01' });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.status).toBe('ENDED');
    expect(s.mem.occurrence(nov.id)).toMatchObject({ status: 'MATERIALIZED', transactionId });
    for (const date of ['2026-12-15', '2027-01-15']) {
      expect(onDate(s, definitionId, date)).toMatchObject({ status: 'CANCELLED', cancelReason: 'ENDED' });
    }
    expect(s.mem.transactionsStore.get(transactionId)?.status).toBe('POSTED');
    // terminar otra vez es idempotente
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2026-12-01' });
  });
});

describe('Pago de tarjeta en el comprometido y en próximos pagos', () => {
  const internet = (s: S) =>
    s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Internet',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        categoryId: CATEGORY,
        amount: { type: 'FIXED', amount: bob('199.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
      },
    });

  it('[TC-DEBT-CARD-031] el pago de la tarjeta de 1120.50 BOB suma con el Internet de 199.00 BOB: 1319.50 BOB', async () => {
    const s = setup('2026-11-01');
    const { definitionId } = await createPlan(s);
    await internet(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    const committed = await s.queries.getCommitted(WS);
    expect(committed).toMatchObject({ periodLabel: expect.any(String), withoutAmountCount: 0 });
    expect(committed.byCurrency).toEqual([
      { currency: 'BOB', occurrences: bob('1319.50'), pending: bob('0.00'), total: bob('1319.50') },
    ]);
    const card = committed.items.find((i) => i.kind === 'CARD_PAYMENT');
    expect(card).toMatchObject({ date: '2026-11-15', amount: bob('1120.50'), source: 'OCCURRENCE' });
  });

  it('[TC-DEBT-CARD-031] una estimación suma con su monto y se lista como próximo pago de tipo CARD_PAYMENT', async () => {
    const s = setup('2026-11-01');
    const { definitionId } = await createPlan(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'ESTIMATED', amount: '800.00' },
    });
    const upcoming = await s.queries.listUpcoming({ workspaceId: WS, through: '2026-11-30' });
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({
      kind: 'CARD_PAYMENT',
      definitionId,
      dueDate: '2026-11-15',
      expected: { type: 'ESTIMATED', amount: '800.00', currency: 'BOB' },
      projected: bob('800.00'),
      accountId: BANK,
      toAccountId: CARD,
    });
    expect(
      await s.queries.getForRange({ workspaceId: WS, from: '2026-11-01', to: '2026-11-30' }),
    ).toMatchObject({
      fromCommitments: [bob('800.00')],
    });
  });

  it('[TC-DEBT-CARD-031] sin monto no suma y se cuenta como pago sin monto (periodo 2027-01)', async () => {
    const s = setup('2026-11-01');
    await createPlan(s);
    const range = await s.queries.getForRange({ workspaceId: WS, from: '2027-01-01', to: '2027-01-31' });
    expect(range.fromCommitments).toEqual([]);
    expect(range.withoutAmountCount).toBe(1);
    expect(range.items).toEqual([
      expect.objectContaining({ kind: 'CARD_PAYMENT', date: '2027-01-15', amount: null }),
    ]);
  });

  it('[TC-DEBT-CARD-031] solo cuenta si sale de una cuenta líquida hacia una no líquida (D127)', async () => {
    const s = setup('2026-11-01');
    // desde ahorro (semi líquida) hacia la tarjeta: no reduce el dinero disponible
    const { definitionId } = await createPlan(s, { accountId: SAVINGS });
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '500.00' },
    });
    const range = await s.queries.getForRange({ workspaceId: WS, from: '2026-11-01', to: '2026-11-30' });
    expect(range.fromCommitments).toEqual([]);
    expect(range.items).toEqual([]);
    expect(await s.queries.listUpcoming({ workspaceId: WS, through: '2026-11-30' })).toEqual([]);
  });

  it('[TC-DEBT-CARD-031] una ocurrencia omitida o resuelta deja de comprometerse', async () => {
    const s = setup('2026-11-01');
    const { definitionId } = await createPlan(s);
    await s.port.setExpected({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      expectation: { type: 'FIXED', amount: '1120.50' },
    });
    await s.port.skip({
      workspaceId: WS,
      userId: USER,
      definitionId,
      key: '2026-11-15',
      reason: 'STATEMENT_PAID',
    });
    const range = await s.queries.getForRange({ workspaceId: WS, from: '2026-11-01', to: '2026-11-30' });
    expect(range.fromCommitments).toEqual([]);
    expect(range.withoutAmountCount).toBe(0);
  });
});
