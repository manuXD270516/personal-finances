import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService } from './definitions.service.js';
import { GenerateOccurrencesService } from './generate-occurrences.service.js';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { EngineRecurringDefinitionPort } from './recurring-definition-port.js';
import { BANK, CASH, CATEGORY, InMemoryCommitments, USER, WS } from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;
const LOAN = '0190a000-0000-7000-8000-0000000d0001';
const LENDER = '0190a000-0000-7000-8000-0000000c1001';

function setup(now = '2026-10-17') {
  const mem = new InMemoryCommitments();
  const deps = mem.deps();
  const defs = new DefinitionsService(deps);
  const occs = new OccurrencesService(deps);
  const port = new EngineRecurringDefinitionPort(deps, defs);
  const job = new GenerateOccurrencesService(deps, occs);
  const queries = new CommitmentsQueries(deps);
  const matching = new MatchingService(deps, occs);
  mem.setNow(noon(now));
  return { mem, deps, defs, occs, port, job, queries, matching };
}
type S = ReturnType<typeof setup>;

/** Cuota mensual desde 2026-11-15: 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB). */
function schedule(count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const month = 10 + i; // 0-based desde noviembre de 2026
    const year = 2026 + Math.floor(month / 12);
    const mm = String((month % 12) + 1).padStart(2, '0');
    return {
      key: String(i + 1),
      dueDate: `${year}-${mm}-15`,
      amount: i === count - 1 ? '2341.90' : '2342.02',
    };
  });
}

const createLoan = (s: S, over: Partial<Parameters<S['port']['createManaged']>[0]> = {}) =>
  s.port.createManaged({
    workspaceId: WS,
    userId: USER,
    managedBy: 'DEBT',
    managedRef: LOAN,
    name: 'Préstamo vehicular',
    kind: 'LOAN_PAYMENT',
    accountId: BANK,
    counterpartyId: LENDER,
    currency: 'BOB',
    explicitSchedule: schedule(),
    materialization: 'NOTIFY_ONLY',
    ...over,
  });

const occsOf = (s: S, definitionId: string) => s.mem.forDefinition(definitionId);
const byKey = (s: S, definitionId: string, key: string) => {
  const found = occsOf(s, definitionId).find((o) => o.scheduleKey === key);
  if (!found) throw new Error(`no occurrence for key ${key}`);
  return found;
};

/** El pago del préstamo que registra DEBT (la transacción ya existe cuando se resuelven las cuotas). */
const payment = (s: S, amount: string, businessDate = '2026-11-15', kind = 'LOAN_PAYMENT') =>
  s.mem.addTransaction({ kind, accountId: BANK, amount: bob(amount), businessDate });

async function code(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

describe('Calendario explícito de cuotas (N3)', () => {
  it('[TC-DEBT-LOAN-035] genera una ocurrencia por cuota dentro del horizonte y la siguiente cuando el horizonte la alcanza', async () => {
    const s = setup('2026-10-17');
    const { definitionId } = await createLoan(s);
    const dates = occsOf(s, definitionId).map((o) => o.occurrenceDate);
    expect(dates).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    for (const o of occsOf(s, definitionId)) {
      expect(o).toMatchObject({
        status: 'SCHEDULED',
        expected: { type: 'FIXED', amount: '2342.02' },
        currency: 'BOB',
        sharesTransaction: true,
      });
    }
    expect(occsOf(s, definitionId).map((o) => o.scheduleKey)).toEqual(['1', '2', '3']);
    // con hoy = 2026-10-17 el horizonte (90 días) llega al 2027-01-15; el 2027-02-15 entra el 2026-11-17
    s.mem.setNow(noon('2026-11-17'));
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId).map((o) => o.occurrenceDate)).toEqual([
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
    ]);
  });

  it('[TC-DEBT-LOAN-035] INV-013: re-ejecutar la generación no duplica ni emite hechos nuevos', async () => {
    const s = setup('2026-10-17');
    const { definitionId } = await createLoan(s);
    const events = s.mem.events.length;
    await s.job.runWorkspace(WS);
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId)).toHaveLength(3);
    expect(s.mem.eventsOf('commitments.OccurrencesGenerated')).toHaveLength(1);
    expect(s.mem.events.length).toBe(events);
    expect(s.mem.eventsOf('commitments.OccurrencesGenerated')[0]?.payload['occurrences']).toHaveLength(3);
  });

  it('[TC-DEBT-LOAN-035] nunca crea transacciones y no entra en la bandeja de aprobación (D114)', async () => {
    const s = setup('2026-11-14');
    const { definitionId } = await createLoan(s);
    s.mem.setNow(noon('2026-11-16'));
    await s.job.runWorkspace(WS);
    expect(s.mem.recordAttempts).toBe(0);
    expect(byKey(s, definitionId, '1').status).toBe('OVERDUE');
    const approval = await s.queries.listOccurrences(WS, { requiresApproval: true, limit: 50 });
    expect(approval).toEqual([]);
    expect((await s.queries.pendingApprovalCount(WS)) as number).toBe(0);
  });

  it('el job no termina por sí solo la definición administrada al pasar la última cuota', async () => {
    const s = setup('2026-10-17');
    const { definitionId } = await createLoan(s, { explicitSchedule: schedule(2) });
    s.mem.setNow(noon('2027-03-01'));
    await s.job.runWorkspace(WS);
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ACTIVE');
  });

  it('valida el calendario: claves y fechas únicas, montos positivos y en la escala de la moneda', async () => {
    const s = setup();
    const items = schedule(2);
    const dup = await code(
      createLoan(s, { explicitSchedule: [items[0]!, { ...items[1]!, key: items[0]!.key }] }),
    );
    expect(dup.code).toBe('RECURRING_INVALID_SCHEDULE');
    const sameDay = await code(
      createLoan(s, { explicitSchedule: [items[0]!, { ...items[1]!, dueDate: items[0]!.dueDate }] }),
    );
    expect(sameDay.code).toBe('RECURRING_INVALID_SCHEDULE');
    const scale = await code(createLoan(s, { explicitSchedule: [{ ...items[0]!, amount: '10.123' }] }));
    expect(scale.code).toBe('RECURRING_INVALID_AMOUNT');
    const empty = await code(createLoan(s, { explicitSchedule: [] }));
    expect(empty.code).toBe('RECURRING_INVALID_SCHEDULE');
    const usd = await code(createLoan(s, { currency: 'USD' }));
    expect(usd.code).toBe('CURRENCY_MISMATCH');
    expect(s.mem.all()).toEqual([]);
  });
});

describe('LOAN_PAYMENT solo para el administrador (N2)', () => {
  it('[TC-DEBT-LOAN-036] crear LOAN_PAYMENT desde la API de recurrentes sigue en RECURRING_KIND_NOT_AVAILABLE', async () => {
    const s = setup();
    const err = await code(
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name: 'Cuota a mano',
        kind: 'LOAN_PAYMENT',
        template: {
          accountId: BANK,
          amount: { type: 'FIXED', amount: bob('1200.00') },
          categoryId: CATEGORY,
          schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-01' },
        },
      }),
    );
    expect(err.code).toBe('RECURRING_KIND_NOT_AVAILABLE');
    expect(s.mem.all()).toEqual([]);
  });

  it('[TC-DEBT-LOAN-036] ni otro administrador ni la cadencia EXPLICIT del usuario sortean la reserva', async () => {
    const s = setup();
    const other = await code(
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name: 'Cuota',
        kind: 'LOAN_PAYMENT',
        managedBy: 'SUBSCRIPTION',
        managedRef: LOAN,
        template: {
          accountId: BANK,
          amount: { type: 'VARIABLE' },
          schedule: {
            cadence: 'EXPLICIT',
            startDate: '2026-11-15',
            explicit: [{ key: '1', dueDate: '2026-11-15', amount: '10.00' }],
          },
          materialization: { mode: 'NOTIFY_ONLY' },
        },
      }),
    );
    expect(other.code).toBe('RECURRING_KIND_NOT_AVAILABLE');
    const explicit = await code(
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name: 'Gasto',
        kind: 'EXPENSE',
        template: {
          accountId: BANK,
          amount: { type: 'VARIABLE' },
          schedule: {
            cadence: 'EXPLICIT',
            startDate: '2026-11-15',
            explicit: [{ key: '1', dueDate: '2026-11-15', amount: '10.00' }],
          },
          materialization: { mode: 'NOTIFY_ONLY' },
        },
      }),
    );
    expect(explicit.code).toBe('RECURRING_INVALID_SCHEDULE');
    expect(s.mem.all()).toEqual([]);
  });

  it('una definición LOAN_PAYMENT solo puede administrarla DEBT y exige modo solo aviso', async () => {
    const s = setup();
    const mode = await code(
      s.defs.create({
        workspaceId: WS,
        userId: USER,
        name: 'Cuota',
        kind: 'LOAN_PAYMENT',
        managedBy: 'DEBT',
        managedRef: LOAN,
        template: {
          accountId: BANK,
          amount: { type: 'VARIABLE' },
          schedule: {
            cadence: 'EXPLICIT',
            startDate: '2026-11-15',
            explicit: [{ key: '1', dueDate: '2026-11-15', amount: '10.00' }],
          },
          materialization: { mode: 'PENDING_APPROVAL' },
        },
      }),
    );
    expect(mode.code).toBe('RECURRING_MODE_NOT_ALLOWED');
  });
});

describe('Guardas de la API de recurrentes (N4)', () => {
  it('[TC-DEBT-LOAN-023] pausar, reanudar, terminar o revisar el compromiso desde recurrentes se rechaza y sigue activo', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    const base = { workspaceId: WS, userId: USER, definitionId, expectedVersion: def.version };
    for (const attempt of [
      s.defs.pause(base),
      s.defs.resume(base),
      s.defs.end(base),
      s.defs.updateDetails({ ...base, name: 'Otro' }),
      s.defs.revise({ ...base, effectiveFrom: '2026-12-01', changes: { accountId: CASH } }),
    ]) {
      const err = await code(attempt);
      expect(err.code).toBe('RECURRING_MANAGED_EXTERNALLY');
      expect(err.details).toMatchObject({ managedBy: 'DEBT', managedRef: LOAN });
    }
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ACTIVE');
  });

  it('[TC-DEBT-LOAN-037] aprobar, editar, omitir o vincular una cuota desde recurrentes indica el préstamo y no crea transacción', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const first = byKey(s, definitionId, '1');
    const txn = payment(s, '2342.02', '2026-11-15', 'EXPENSE');
    const attempts = [
      s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: first.id }),
      s.occs.edit({
        workspaceId: WS,
        userId: USER,
        occurrenceId: first.id,
        expectedVersion: first.version,
        expectedAmount: bob('100.00'),
      }),
      s.occs.skip({ workspaceId: WS, userId: USER, occurrenceId: first.id }),
      s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: first.id, transactionId: txn }),
    ];
    for (const attempt of attempts) {
      const err = await code(attempt);
      expect(err.code).toBe('RECURRING_MANAGED_EXTERNALLY');
      expect(err.details).toMatchObject({ managedBy: 'DEBT', managedRef: LOAN, scheduleKey: '1' });
    }
    expect(s.mem.recordAttempts).toBe(0);
    expect(byKey(s, definitionId, '1').status).toBe('SCHEDULED');
  });

  it('la guarda depende del tipo, no del administrador: una ocurrencia de gasto sigue pudiéndose aprobar', async () => {
    const s = setup();
    await createLoan(s);
    const def = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: bob('3500.00') },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-05' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    const occurrence = s.mem.forDefinition(def.id)[0]!;
    const done = await s.occs.materialize({ workspaceId: WS, userId: USER, occurrenceId: occurrence.id });
    expect(done.transactionId).toBeTruthy();
  });
});

describe('Resolución de cuotas por el administrador (N5, N6, N9)', () => {
  it('[TC-DEBT-LOAN-025] un pago resuelve dos cuotas con la misma transacción (1:N) sin matchedBy', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '4684.04');
    await s.port.settle({
      workspaceId: WS,
      userId: USER,
      definitionId,
      keys: ['1', '2'],
      transactionId: txn,
    });
    for (const key of ['1', '2']) {
      expect(byKey(s, definitionId, key)).toMatchObject({
        status: 'MATCHED',
        transactionId: txn,
        resolution: 'MATCHED',
        matchedBy: null,
      });
    }
    expect(byKey(s, definitionId, '3').status).toBe('SCHEDULED');
    const events = s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized');
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({
      mode: 'MATCHED',
      matchedBy: null,
      managedBy: 'DEBT',
      transactionId: txn,
      amount: bob('4684.04'),
    });
    // repetir el mismo pago es inocuo (idempotente)
    await s.port.settle({
      workspaceId: WS,
      userId: USER,
      definitionId,
      keys: ['1', '2'],
      transactionId: txn,
    });
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')).toHaveLength(2);
  });

  it('[TC-DEBT-LOAN-025] genera las ocurrencias fuera del horizonte que el pago resuelve', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    expect(occsOf(s, definitionId)).toHaveLength(3);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['6'], transactionId: txn });
    expect(occsOf(s, definitionId)).toHaveLength(4);
    expect(byKey(s, definitionId, '6')).toMatchObject({
      occurrenceDate: '2027-04-15',
      status: 'MATCHED',
      transactionId: txn,
    });
    // la generación posterior por horizonte no duplica esa fecha (INV-013)
    s.mem.setNow(noon('2027-03-01'));
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId).filter((o) => o.occurrenceDate === '2027-04-15')).toHaveLength(1);
  });

  it('rechaza claves inexistentes, transacciones anuladas o ajenas a la moneda y la que ya resuelve otra ocurrencia', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    const unknown = await code(
      s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['99'], transactionId: txn }),
    );
    expect(unknown.code).toBe('RESOURCE_NOT_FOUND');
    s.mem.voidTransaction(txn);
    const voided = await code(
      s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn }),
    );
    expect(voided.code).toBe('OCCURRENCE_LINK_MISMATCH');
    const usd = s.mem.addTransaction({
      kind: 'LOAN_PAYMENT',
      accountId: BANK,
      amount: { amount: '1.00', currency: 'USD' },
    });
    const cur = await code(
      s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: usd }),
    );
    expect(cur.code).toBe('CURRENCY_MISMATCH');
    const ok = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: ok });
    const other = payment(s, '2342.02');
    const resolved = await code(
      s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: other }),
    );
    expect(resolved.code).toBe('OCCURRENCE_ALREADY_MATERIALIZED');
  });

  it('una transacción que resuelve una cuota no puede resolver además una ocurrencia de otra definición', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02', '2026-11-15', 'EXPENSE');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    const rent = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: bob('2342.02') },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-15' },
      },
    });
    const occurrence = s.mem.forDefinition(rent.id)[0]!;
    const err = await code(
      s.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occurrence.id, transactionId: txn }),
    );
    expect(err.code).toBe('TRANSACTION_ALREADY_LINKED');
  });

  it('[TC-DEBT-LOAN-024] un pago parcial deja la ocurrencia sin resolver esperando el pendiente', async () => {
    const s = setup('2026-11-02');
    const { definitionId } = await createLoan(s, {
      explicitSchedule: [{ key: '1', dueDate: '2026-11-15', amount: '2372.02' }],
    });
    await s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key: '1', amount: '372.02' });
    const first = byKey(s, definitionId, '1');
    expect(first).toMatchObject({
      status: 'SCHEDULED',
      expected: { type: 'FIXED', amount: '372.02' },
      amountOverridden: true,
    });
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceChanged')[0]?.payload).toMatchObject({
      transition: 'EDIT',
      managedBy: 'DEBT',
    });
    const committed = await s.queries.getCommitted(WS);
    expect(committed.byCurrency[0]?.total).toEqual(bob('372.02'));
  });

  it('setExpected rechaza una cuota ya resuelta y montos inválidos', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    const resolved = await code(
      s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key: '1', amount: '10.00' }),
    );
    expect(resolved.code).toBe('INVALID_STATUS_TRANSITION');
    const zero = await code(
      s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key: '2', amount: '0.00' }),
    );
    expect(zero.code).toBe('RECURRING_INVALID_AMOUNT');
  });

  it('[TC-DEBT-LOAN-026] anular el pago devuelve la cuota vencida a atrasada con su monto y sin transacción', async () => {
    const s = setup('2026-11-14');
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    s.mem.setNow(noon('2026-11-20'));
    await s.port.unsettle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'] });
    expect(byKey(s, definitionId, '1')).toMatchObject({
      status: 'OVERDUE',
      transactionId: null,
      resolution: null,
      matchedBy: null,
      expected: { type: 'FIXED', amount: '2342.02' },
    });
    expect(s.mem.eventsOf('commitments.RecurringOccurrenceChanged').at(-1)?.payload).toMatchObject({
      transition: 'RELEASE',
      releasedTransactionId: txn,
      status: 'OVERDUE',
    });
    // idempotente: devolver una cuota ya no resuelta no hace nada
    const events = s.mem.events.length;
    await s.port.unsettle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'] });
    expect(s.mem.events.length).toBe(events);
  });

  it('unsettle devuelve a programada, próxima o atrasada según el vencimiento y restituye el monto indicado', async () => {
    const s = setup('2026-11-14');
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '7026.06');
    await s.port.settle({
      workspaceId: WS,
      userId: USER,
      definitionId,
      keys: ['1', '2', '3'],
      transactionId: txn,
    });
    s.mem.setNow(noon('2026-12-13'));
    await s.port.unsettle({
      workspaceId: WS,
      userId: USER,
      definitionId,
      keys: ['1', '2', '3'],
      restoreExpected: [{ key: '2', amount: '372.02' }],
    });
    expect(byKey(s, definitionId, '1').status).toBe('OVERDUE');
    expect(byKey(s, definitionId, '2')).toMatchObject({
      status: 'DUE',
      expected: { amount: '372.02' },
      amountOverridden: true,
    });
    expect(byKey(s, definitionId, '3')).toMatchObject({
      status: 'SCHEDULED',
      expected: { amount: '2342.02' },
      amountOverridden: false,
    });
  });

  it('[TC-DEBT-LOAN-037] anular la transacción desde Transacciones no libera la cuota (la libera DEBT con unsettle)', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    s.mem.voidTransaction(txn);
    expect(await s.occs.onTransactionVoided({ workspaceId: WS, transactionId: txn })).toBe(false);
    expect(byKey(s, definitionId, '1')).toMatchObject({ status: 'MATCHED', transactionId: txn });
  });

  it('[TC-DEBT-LOAN-026] el comprometido vuelve a incluir la cuota al devolverla', async () => {
    const s = setup('2026-11-02');
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    expect((await s.queries.getCommitted(WS)).byCurrency).toEqual([]);
    await s.port.unsettle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'] });
    expect((await s.queries.getCommitted(WS)).byCurrency[0]?.total).toEqual(bob('2342.02'));
  });

  it('end(from) termina la definición y cancela las no resueltas con vencimiento >= from; las resueltas no cambian', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2026-12-15' });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.status).toBe('ENDED');
    expect(byKey(s, definitionId, '1').status).toBe('MATCHED');
    expect(byKey(s, definitionId, '2')).toMatchObject({ status: 'CANCELLED', cancelReason: 'ENDED' });
    expect(byKey(s, definitionId, '3')).toMatchObject({ status: 'CANCELLED', cancelReason: 'ENDED' });
    // idempotente
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2026-12-15' });
    // el generador ya no produce ocurrencias de una definición terminada
    s.mem.setNow(noon('2027-06-01'));
    await s.job.runWorkspace(WS);
    expect(occsOf(s, definitionId)).toHaveLength(3);
  });

  it('end con una fecha futura también deja la definición terminada', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    await s.port.end({ workspaceId: WS, userId: USER, definitionId, from: '2027-03-01' });
    expect((await s.deps.definitions.findById(WS, definitionId))?.status).toBe('ENDED');
    expect(occsOf(s, definitionId).every((o) => o.status === 'SCHEDULED')).toBe(true);
  });

  it('las operaciones del puerto no actúan sobre definiciones de usuario', async () => {
    const s = setup();
    const def = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: bob('3500.00') },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-05' },
      },
    });
    const err = await code(
      s.port.end({ workspaceId: WS, userId: USER, definitionId: def.id, from: '2026-11-05' }),
    );
    expect(err.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('settle es atómico: si una cuota falla no se resuelve ninguna', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const first = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['2'], transactionId: first });
    const second = payment(s, '4684.04');
    await code(
      s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1', '2'], transactionId: second }),
    );
    expect(byKey(s, definitionId, '1').status).toBe('SCHEDULED');
  });
});

describe('Comprometido y próximos pagos (N8)', () => {
  async function november(s: S) {
    const rent = await s.defs.create({
      workspaceId: WS,
      userId: USER,
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: BANK,
        amount: { type: 'FIXED', amount: bob('3500.00') },
        categoryId: CATEGORY,
        schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-11-05' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    const { definitionId } = await createLoan(s);
    return { rent, definitionId };
  }

  it('[TC-DEBT-LOAN-022] la cuota suma al comprometido de noviembre y aparece en próximos pagos con su número', async () => {
    const s = setup('2026-11-02');
    const { definitionId } = await createLoan(s, {
      explicitSchedule: [{ key: '1', dueDate: '2026-11-15', amount: '2342.02' }],
    });
    const committed = await s.queries.getCommitted(WS);
    expect(committed.byCurrency).toEqual([
      { currency: 'BOB', occurrences: bob('2342.02'), pending: bob('0.00'), total: bob('2342.02') },
    ]);
    expect(committed.items).toMatchObject([
      {
        source: 'OCCURRENCE',
        kind: 'LOAN_PAYMENT',
        name: 'Préstamo vehicular — cuota 1',
        date: '2026-11-15',
      },
    ]);
    const upcoming = await s.queries.listUpcoming({ workspaceId: WS, through: '2026-12-02' });
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({
      definitionId,
      definitionName: 'Préstamo vehicular — cuota 1',
      scheduleKey: '1',
      kind: 'LOAN_PAYMENT',
      dueDate: '2026-11-15',
      status: 'SCHEDULED',
      requiresApproval: false,
      projected: bob('2342.02'),
      accountId: BANK,
    });
  });

  it('[TC-DEBT-LOAN-038] alquiler más cuota suman 5842.02 y al pagar la cuota el comprometido baja a 3500.00 sin doble conteo', async () => {
    const s = setup('2026-11-02');
    const { definitionId } = await november(s);
    const committed = await s.queries.getCommitted(WS);
    expect(committed.byCurrency[0]?.total).toEqual(bob('5842.02'));
    // el pago de la cuota existe como transacción POSTED y resuelve la ocurrencia
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    expect((await s.queries.getCommitted(WS)).byCurrency[0]?.total).toEqual(bob('3500.00'));
    // un pago PENDING de la cuota aún no resuelta no se cuenta dos veces: la cuota resuelta ya no suma
    const pending = s.mem.addTransaction({
      kind: 'EXPENSE',
      status: 'PENDING',
      accountId: BANK,
      amount: bob('100.00'),
      businessDate: '2026-11-10',
    });
    expect(pending).toBeTruthy();
    expect((await s.queries.getCommitted(WS)).byCurrency[0]?.total).toEqual(bob('3600.00'));
  });

  it('los egresos resueltos por una cuota no figuran como pagos esperados para el análisis de sorpresas', async () => {
    const s = setup('2026-11-02');
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    expect(
      await s.queries.listResolvedOutflows({ workspaceId: WS, from: '2026-11-01', to: '2026-11-30' }),
    ).toEqual([]);
  });
});

describe('Matching ignora cuotas de préstamo (N7)', () => {
  it('[TC-DEBT-LOAN-039] un gasto manual de 2342.02 BOB el 2026-11-15 no genera sugerencia contra la cuota 1', async () => {
    const s = setup('2026-11-10');
    await createLoan(s);
    const manual = s.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: bob('2342.02'),
      businessDate: '2026-11-15',
    });
    await s.matching.onTransactionChanged({ workspaceId: WS, transactionId: manual, eventId: null });
    expect(s.mem.suggestions()).toEqual([]);
  });

  it('[TC-DEBT-LOAN-039] el backfill de ocurrencias nuevas tampoco propone gastos ya registrados para cuotas', async () => {
    const s = setup('2026-11-10');
    s.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: BANK,
      amount: bob('2342.02'),
      businessDate: '2026-11-15',
    });
    const { definitionId } = await createLoan(s);
    const ids = occsOf(s, definitionId).map((o) => o.id);
    await s.matching.onOccurrencesAvailable({ workspaceId: WS, occurrenceIds: ids, eventId: null });
    expect(s.mem.suggestions()).toEqual([]);
  });
});

describe('Revisión de la plantilla administrada', () => {
  it('cambia nombre, prestamista y cuenta de pago: versión nueva desde la fecha efectiva, calendario intacto', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const NEW_LENDER = '0190a000-0000-7000-8000-0000000c1002';
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      name: 'Préstamo auto',
      counterpartyId: NEW_LENDER,
      accountId: CASH,
      effectiveFrom: '2026-12-01',
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.name).toBe('Préstamo auto');
    expect(def.versions).toHaveLength(2);
    expect(def.current).toMatchObject({
      accountId: CASH,
      counterpartyId: NEW_LENDER,
      effectiveFrom: '2026-12-01',
    });
    expect(def.current.schedule.explicit).toHaveLength(24);
    expect(def.versions[0]).toMatchObject({ accountId: BANK, counterpartyId: LENDER });
    const views = await s.queries.listOccurrences(WS, { definitionId, limit: 50 });
    expect(views.map((v) => [v.occurrenceDate, v.accountId])).toEqual([
      ['2026-11-15', BANK],
      ['2026-12-15', CASH],
      ['2027-01-15', CASH],
    ]);
    expect(views.every((v) => v.expected.amount?.amount === '2342.02')).toBe(true);
    expect(s.mem.eventsOf('commitments.RecurringDefinitionChanged').at(-1)?.payload).toMatchObject({
      transition: 'REVISE',
      managedBy: 'DEBT',
    });
  });

  it('adelanta la fecha efectiva tras la última cuota resuelta y conserva el monto ajustado por un pago parcial', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    const txn = payment(s, '2342.02');
    await s.port.settle({ workspaceId: WS, userId: USER, definitionId, keys: ['1'], transactionId: txn });
    await s.port.setExpected({ workspaceId: WS, userId: USER, definitionId, key: '2', amount: '372.02' });
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      accountId: CASH,
      effectiveFrom: '2026-10-20',
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.current.effectiveFrom).toBe('2026-11-16');
    expect(byKey(s, definitionId, '1').status).toBe('MATCHED');
    expect(byKey(s, definitionId, '2')).toMatchObject({
      expected: { amount: '372.02' },
      definitionVersionNo: 2,
    });
    expect(byKey(s, definitionId, '3')).toMatchObject({ expected: { amount: '2342.02' } });
  });

  it('solo el nombre es una anotación: no crea versión de plantilla', async () => {
    const s = setup();
    const { definitionId } = await createLoan(s);
    await s.port.revise({
      workspaceId: WS,
      userId: USER,
      definitionId,
      name: 'Auto',
      effectiveFrom: '2026-12-01',
    });
    const def = (await s.deps.definitions.findById(WS, definitionId))!;
    expect(def.name).toBe('Auto');
    expect(def.versions).toHaveLength(1);
  });
});
