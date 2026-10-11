import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CommitmentsQueries } from '../../src/application/commitments.queries.js';
import { DefinitionsService } from '../../src/application/definitions.service.js';
import { MatchingService } from '../../src/application/matching.service.js';
import { OccurrencesService } from '../../src/application/occurrences.service.js';
import { EngineRecurringDefinitionPort } from '../../src/application/recurring-definition-port.js';
import { EngineRecurringDefinitionQuery } from '../../src/application/recurring-definition-query.js';
import { BANK, CARD, InMemoryCommitments, SAVINGS } from '../../src/application/testing/in-memory.js';
import type { CreateManagedMonthlyInput } from '../../src/contracts/index.js';
import {
  PgCommitmentsUnitOfWork,
  PgDefinitionRepository,
  PgOccurrenceRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-commitments.js';
import { PgMatchSuggestionRepository } from '../../src/infrastructure/pg-matching.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// Pago de tarjeta (openspec add-credit-cards, decisión 7) contra PostgreSQL real: el puerto `RecurringDefinitionPort`
// con una definición mensual `CARD_PAYMENT` administrada por DEBT (crear, fijar el esperado FIXED/ESTIMATED/NONE,
// omitir, listar, revisar, terminar), la consulta `listActiveTransfersTo`, el comprometido, el matching como
// transferencia y los CHECK de la migración 20261012100000. Las cuentas, FX y transacciones son dobles en memoria.
let app: Pool;
let migrator: Pool;
let user: string;
const mem = new InMemoryCommitments();
const uow = () => new PgCommitmentsUnitOfWork(app);
const defs = new PgDefinitionRepository();
const occs = new PgOccurrenceRepository();
const matchingRepo = new PgMatchSuggestionRepository();
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const CARD_REF = randomUUID();

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function inCtx<T>(workspaceId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      workspaceId,
    ]);
    const result = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** Un workspace nuevo por prueba (aislado por RLS) con su membresía. */
async function workspace(now = '2026-10-17'): Promise<string> {
  const ws = randomUUID();
  await inCtx(
    ws,
    async (c) => {
      await c.query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
         VALUES ($1, 'Card', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
        [ws],
      );
      await c.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    },
    true,
  );
  mem.setNow(noon(now));
  return ws;
}

function services() {
  const real = mem.deps({
    uow: uow(),
    definitions: defs,
    occurrences: occs,
    matching: matchingRepo,
    ids: uuidV7Ids,
  });
  const definitions = new DefinitionsService(real);
  const occurrences = new OccurrencesService(real);
  return {
    port: new EngineRecurringDefinitionPort(real, definitions),
    query: new EngineRecurringDefinitionQuery(real),
    definitions,
    occurrences,
    queries: new CommitmentsQueries(real),
    matching: new MatchingService(real, occurrences),
    real,
  };
}
type Svc = ReturnType<typeof services>;

const plan = (svc: Svc, ws: string, over: Partial<CreateManagedMonthlyInput> = {}) =>
  asUser(() =>
    svc.port.createManaged({
      workspaceId: ws,
      userId: user,
      managedBy: 'DEBT',
      managedRef: CARD_REF,
      name: 'Pago de tarjeta · Visa Oro BOB',
      kind: 'CARD_PAYMENT',
      accountId: BANK,
      toAccountId: CARD,
      currency: 'BOB',
      monthlyRule: { monthDays: [15], startDate: '2026-11-15', weekendAdjustment: 'NONE' },
      materialization: { mode: 'PENDING_APPROVAL' },
      ...over,
    }),
  );

const rowsOf = (ws: string, definitionId: string) =>
  asUser(() => uow().run(ws, () => occs.listForDefinition(ws, definitionId)));

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/card', $1, $2, 'card') AS id`,
    [`sub-${randomUUID()}`, `card-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('Pago de tarjeta sobre PostgreSQL', () => {
  it('[TC-DEBT-CARD-029] crea la definición mensual CARD_PAYMENT de DEBT y la relee con su regla y sus ocurrencias por fecha nominal', async () => {
    const ws = await workspace();
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    const def = await asUser(() =>
      svc.real.uow.run(ws, async () => (await defs.findById(ws, definitionId))!),
    );
    expect(def.snapshot).toMatchObject({ kind: 'CARD_PAYMENT', managedBy: 'DEBT', managedRef: CARD_REF });
    expect(def.current).toMatchObject({
      accountId: BANK,
      toAccountId: CARD,
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'MONTHLY', monthDays: [15], startDate: '2026-11-15', weekendAdjustment: 'NONE' },
      materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null },
    });
    const rows = await rowsOf(ws, definitionId);
    expect(
      rows.map((o) => [o.snapshot.occurrenceDate, o.snapshot.expected.type, o.snapshot.scheduleKey]),
    ).toEqual([
      ['2026-11-15', 'VARIABLE', null],
      ['2026-12-15', 'VARIABLE', null],
      ['2027-01-15', 'VARIABLE', null],
    ]);
    // INV-013: re-listar no duplica (el listado genera solo lo que falta)
    await asUser(() =>
      svc.port.listOccurrences({ workspaceId: ws, definitionId, from: '2026-11-01', to: '2027-01-31' }),
    );
    expect(await rowsOf(ws, definitionId)).toHaveLength(3);
  });

  it('[TC-DEBT-CARD-030] fija el esperado FIXED, ESTIMATED y NONE sobre la base sin marcar la edición del usuario', async () => {
    const ws = await workspace();
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    const set = (key: string, expectation: { type: 'FIXED' | 'ESTIMATED' | 'NONE'; amount?: string }) =>
      asUser(() => svc.port.setExpected({ workspaceId: ws, userId: user, definitionId, key, expectation }));
    const columns = async (date: string) =>
      (
        await inCtx(ws, (c) =>
          c.query(
            `SELECT expected_type, expected_amount::text AS amount, amount_overridden
               FROM commitments.recurring_occurrence WHERE definition_id = $1 AND occurrence_date = $2`,
            [definitionId, date],
          ),
        )
      ).rows[0];
    await set('2026-11-15', { type: 'FIXED', amount: '1120.50' });
    expect(await columns('2026-11-15')).toMatchObject({
      expected_type: 'FIXED',
      amount: expect.stringMatching(/^1120\.5/),
      amount_overridden: false,
    });
    await set('2026-12-15', { type: 'ESTIMATED', amount: '300.00' });
    expect(await columns('2026-12-15')).toMatchObject({
      expected_type: 'ESTIMATED',
      amount_overridden: false,
    });
    await set('2026-12-15', { type: 'NONE' });
    expect(await columns('2026-12-15')).toMatchObject({ expected_type: 'VARIABLE', amount: null });
    // sin cambios no hay hechos nuevos
    const events = mem.events.length;
    await set('2026-11-15', { type: 'FIXED', amount: '1120.50' });
    expect(mem.events.length).toBe(events);
    // una ocurrencia resuelta no cambia
    const first = (await rowsOf(ws, definitionId))[0]!;
    const txn = mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
      businessDate: '2026-11-14',
    });
    await asUser(() =>
      svc.occurrences.link({ workspaceId: ws, userId: user, occurrenceId: first.id, transactionId: txn }),
    );
    await set('2026-11-15', { type: 'FIXED', amount: '1165.50' });
    expect(await columns('2026-11-15')).toMatchObject({
      expected_type: 'FIXED',
      amount: expect.stringMatching(/^1120\.5/),
    });
    const listed = await asUser(() =>
      svc.port.listOccurrences({ workspaceId: ws, definitionId, from: '2026-11-01', to: '2026-11-30' }),
    );
    expect(listed[0]).toMatchObject({ status: 'MATCHED', transactionId: txn, editedByUser: false });
  });

  it('[TC-DEBT-CARD-030] omite con motivo conservando la fecha nominal; no se regenera', async () => {
    const ws = await workspace();
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    await asUser(() =>
      svc.port.skip({
        workspaceId: ws,
        userId: user,
        definitionId,
        key: '2026-11-15',
        reason: 'NOTHING_BILLED',
      }),
    );
    const found = (await rowsOf(ws, definitionId)).find((o) => o.snapshot.occurrenceDate === '2026-11-15')!;
    expect(found.snapshot).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'NOTHING_BILLED',
      resolution: 'SKIPPED',
    });
    // omitida: sigue existiendo una sola fila para esa fecha nominal (INV-013)
    expect(
      (await rowsOf(ws, definitionId)).filter((o) => o.snapshot.occurrenceDate === '2026-11-15'),
    ).toHaveLength(1);
  });

  it('[TC-DEBT-CARD-029] revise cambia día, ajuste y modo; end cancela las no resueltas con ENDED', async () => {
    const ws = await workspace();
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    const first = (await rowsOf(ws, definitionId))[0]!;
    await asUser(() =>
      svc.occurrences.materialize({
        workspaceId: ws,
        userId: user,
        occurrenceId: first.id,
        amount: bob('1120.50'),
      }),
    );
    await asUser(() =>
      svc.port.revise({
        workspaceId: ws,
        userId: user,
        definitionId,
        effectiveFrom: '2026-12-01',
        monthDays: [20],
        weekendAdjustment: 'NEXT',
        materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED', leadDays: 2 },
      }),
    );
    const def = await asUser(() =>
      svc.real.uow.run(ws, async () => (await defs.findById(ws, definitionId))!),
    );
    expect(def.versions.map((v) => v.versionNo)).toEqual([1, 2]);
    expect(def.current).toMatchObject({
      effectiveFrom: '2026-12-01',
      schedule: { monthDays: [20], weekendAdjustment: 'NEXT' },
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'POSTED', leadDays: 2 },
    });
    const rows = await rowsOf(ws, definitionId);
    expect(
      rows.filter((o) => o.snapshot.status !== 'CANCELLED').map((o) => o.snapshot.occurrenceDate),
    ).toEqual(['2026-11-15', '2026-12-20']);
    expect(rows.find((o) => o.snapshot.occurrenceDate === '2026-11-15')?.snapshot.status).toBe(
      'MATERIALIZED',
    );
    await asUser(() => svc.port.end({ workspaceId: ws, userId: user, definitionId, from: '2026-12-01' }));
    const ended = await rowsOf(ws, definitionId);
    expect(ended.find((o) => o.snapshot.occurrenceDate === '2026-11-15')?.snapshot.status).toBe(
      'MATERIALIZED',
    );
    expect(
      ended
        .filter((o) => o.snapshot.status === 'CANCELLED')
        .every((o) => o.snapshot.cancelReason === 'ENDED' || o.snapshot.cancelReason === 'SUPERSEDED'),
    ).toBe(true);
    expect((await asUser(() => svc.real.uow.run(ws, () => defs.findById(ws, definitionId))))?.status).toBe(
      'ENDED',
    );
  });

  it('[TC-DEBT-CARD-029] listActiveTransfersTo: solo TRANSFER activas del usuario hacia la cuenta, aisladas por workspace', async () => {
    const ws = await workspace();
    const other = await workspace();
    const svc = services();
    const mk = (workspaceId: string, name: string, toAccountId: string) =>
      asUser(() =>
        svc.definitions.create({
          workspaceId,
          userId: user,
          name,
          kind: 'TRANSFER',
          template: {
            accountId: BANK,
            toAccountId,
            amount: { type: 'FIXED', amount: bob('1450.00') },
            schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
          },
        }),
      );
    const pago = await mk(ws, 'Pago Visa', CARD);
    const viejo = await mk(ws, 'Pago viejo', CARD);
    await mk(ws, 'Ahorro', SAVINGS);
    await mk(other, 'Pago ajeno', CARD);
    await plan(svc, ws);
    await asUser(() =>
      svc.definitions.pause({
        workspaceId: ws,
        userId: user,
        definitionId: viejo.id,
        expectedVersion: viejo.version,
      }),
    );
    expect(await asUser(() => svc.query.listActiveTransfersTo({ workspaceId: ws, accountId: CARD }))).toEqual(
      [{ definitionId: pago.id, name: 'Pago Visa' }],
    );
    expect(await asUser(() => svc.query.listActiveTransfersTo({ workspaceId: ws, accountId: BANK }))).toEqual(
      [],
    );
  });

  it('[TC-DEBT-CARD-031] el pago de 1120.50 BOB y el Internet de 199.00 BOB suman 1319.50 BOB; el ciclo sin monto cuenta como pago sin monto', async () => {
    const ws = await workspace('2026-11-01');
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    await asUser(() =>
      svc.definitions.create({
        workspaceId: ws,
        userId: user,
        name: 'Internet',
        kind: 'EXPENSE',
        template: {
          accountId: BANK,
          amount: { type: 'FIXED', amount: bob('199.00') },
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
        },
      }),
    );
    await asUser(() =>
      svc.port.setExpected({
        workspaceId: ws,
        userId: user,
        definitionId,
        key: '2026-11-15',
        expectation: { type: 'FIXED', amount: '1120.50' },
      }),
    );
    const november = await asUser(() =>
      svc.queries.getForRange({ workspaceId: ws, from: '2026-11-01', to: '2026-11-30' }),
    );
    expect(november.fromCommitments).toEqual([bob('1319.50')]);
    expect(november.withoutAmountCount).toBe(0);
    const january = await asUser(() =>
      svc.queries.getForRange({ workspaceId: ws, from: '2027-01-01', to: '2027-01-31' }),
    );
    // el pago sin monto no suma: en enero solo queda el Internet
    expect(january.fromCommitments).toEqual([bob('199.00')]);
    expect(january.withoutAmountCount).toBe(1);
  });

  it('[TC-DEBT-CARD-029] una transferencia manual a la tarjeta se sugiere para la ocurrencia del 2026-11-15 sin vincularla', async () => {
    const ws = await workspace('2026-11-01');
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    await asUser(() =>
      svc.port.setExpected({
        workspaceId: ws,
        userId: user,
        definitionId,
        key: '2026-11-15',
        expectation: { type: 'FIXED', amount: '1120.50' },
      }),
    );
    const txn = mem.addTransaction({
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: CARD,
      amount: bob('1120.50'),
      businessDate: '2026-11-14',
    });
    await asUser(() =>
      svc.matching.onTransactionChanged({ workspaceId: ws, transactionId: txn, eventId: randomUUID() }),
    );
    const { rows } = await inCtx(ws, (c) =>
      c.query(
        `SELECT status, occurrence_id FROM commitments.occurrence_match_suggestion WHERE transaction_id = $1`,
        [txn],
      ),
    );
    const target = (await rowsOf(ws, definitionId)).find((o) => o.snapshot.occurrenceDate === '2026-11-15')!;
    expect(rows).toEqual([{ status: 'PROPOSED', occurrence_id: target.id }]);
    expect(target.snapshot).toMatchObject({ status: 'SCHEDULED', transactionId: null });
  });

  it('[TC-DEBT-CARD-029] CHECK: CARD_PAYMENT solo con managed_by DEBT y tipos desconocidos rechazados', async () => {
    const ws = await workspace();
    const insertDefinition = (kind: string, managedBy: string, ref: string | null) => () =>
      inCtx(ws, (c) =>
        c.query(
          `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status, managed_by, managed_ref)
           VALUES ($1, $2, 'x', $3, 'ACTIVE', $4, $5)`,
          [randomUUID(), ws, kind, managedBy, ref],
        ),
      );
    expect(await sqlState(insertDefinition('CARD_PAYMENT', 'DEBT', randomUUID()))).toBeUndefined();
    expect(await sqlState(insertDefinition('CARD_PAYMENT', 'USER', null))).toBe('23514');
    expect(await sqlState(insertDefinition('CARD_PAYMENT', 'SUBSCRIPTION', randomUUID()))).toBe('23514');
    expect(await sqlState(insertDefinition('LOAN_PAYMENT', 'DEBT', randomUUID()))).toBeUndefined();
    expect(await sqlState(insertDefinition('UNKNOWN_KIND', 'DEBT', randomUUID()))).toBe('23514');
  });

  it('[TC-DEBT-CARD-029] CHECK: AUTO_CREATE con monto VARIABLE solo en una definición de transferencia', async () => {
    const ws = await workspace();
    const svc = services();
    const { definitionId } = await plan(svc, ws);
    const insertVersion =
      (toAccount: string | null, mode: string, status: string | null, amountType = 'VARIABLE') =>
      () =>
        inCtx(ws, (c) =>
          c.query(
            `INSERT INTO commitments.recurring_definition_version
             (workspace_id, definition_id, version_no, effective_from, account_id, to_account_id, currency, amount_type,
              amount, cadence, interval, month_days, dtstart, materialization_mode, auto_create_status)
           VALUES ($1, $2, 9, '2026-11-15', $3, $4, 'BOB', $5, $6, 'MONTHLY', 1, '[15]', '2026-11-15', $7, $8)`,
            [
              ws,
              definitionId,
              randomUUID(),
              toAccount,
              amountType,
              amountType === 'FIXED' ? '10.00' : null,
              mode,
              status,
            ],
          ),
        );
    expect(await sqlState(insertVersion(randomUUID(), 'AUTO_CREATE', 'POSTED'))).toBeUndefined();
    expect(await sqlState(insertVersion(null, 'AUTO_CREATE', 'POSTED'))).toBe('23514');
    expect(await sqlState(insertVersion(null, 'AUTO_CREATE', 'POSTED', 'FIXED'))).toBeUndefined();
    expect(await sqlState(insertVersion(randomUUID(), 'AUTO_CREATE', null))).toBe('23514');
    expect(await sqlState(insertVersion(randomUUID(), 'PENDING_APPROVAL', 'POSTED'))).toBe('23514');
  });
});
