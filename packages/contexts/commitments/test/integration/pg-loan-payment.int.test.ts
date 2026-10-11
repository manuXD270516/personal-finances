import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  PgCommitmentsUnitOfWork,
  PgDefinitionRepository,
  PgOccurrenceRepository,
} from '../../src/infrastructure/pg-commitments.js';
import { RecurringDefinition, RecurringOccurrence, buildDefinitionVersion } from '../../src/domain/index.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// Cuotas de préstamo (openspec add-loans, N2-N5) contra PostgreSQL real: calendario explícito persistido y releído,
// generación idempotente por fecha nominal (INV-013), índice único parcial de vinculación 1:N solo para LOAN_PAYMENT,
// CHECK de tipo/administrador y de calendario XOR regla, y serialización de `settle` con el candado de la definición.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
let uow: PgCommitmentsUnitOfWork;
const defs = new PgDefinitionRepository();
const occs = new PgOccurrenceRepository();
const AT = '2026-11-16T16:00:00.000Z';

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

const SCHEDULE = [
  { key: '1', dueDate: '2026-11-15', amount: '2342.02' },
  { key: '2', dueDate: '2026-12-15', amount: '2342.02' },
  { key: '3', dueDate: '2027-01-15', amount: '2341.90' },
];

const loanVersion = () =>
  buildDefinitionVersion({
    kind: 'LOAN_PAYMENT',
    versionNo: 1,
    effectiveFrom: '2026-11-15',
    currency: { code: 'BOB', scale: 2 },
    allowExplicit: true,
    template: {
      accountId: randomUUID(),
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'EXPLICIT', startDate: '2026-11-15', explicit: SCHEDULE },
      materialization: { mode: 'NOTIFY_ONLY', leadDays: 3 },
    },
  });

const loanDefinition = () =>
  RecurringDefinition.create({
    id: randomUUID(),
    workspaceId: w1,
    name: 'Préstamo vehicular',
    kind: 'LOAN_PAYMENT',
    managedBy: 'DEBT',
    managedRef: randomUUID(),
    version1: loanVersion(),
    at: AT,
    by: user,
  });

const occurrenceOf = (def: RecurringDefinition, item: (typeof SCHEDULE)[number], shares = true) =>
  RecurringOccurrence.generate({
    id: randomUUID(),
    workspaceId: def.workspaceId,
    definitionId: def.id,
    occurrenceDate: item.dueDate,
    dueDate: item.dueDate,
    definitionVersionNo: 1,
    expected: { type: 'FIXED', amount: item.amount, min: null, max: null },
    currency: 'BOB',
    at: AT,
    scheduleKey: item.key,
    sharesTransaction: shares,
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/loan', $1, $2, 'loan') AS id`,
    [`sub-${randomUUID()}`, `loan-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  await inCtx(
    w1,
    async (c) => {
      await c.query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
         VALUES ($1, 'Loan', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
        [w1],
      );
      await c.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w1, user],
      );
    },
    true,
  );
  uow = new PgCommitmentsUnitOfWork(app);
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('Cuotas de préstamo sobre PostgreSQL', () => {
  it('[TC-DEBT-LOAN-035] el calendario explícito se persiste en la versión y se relee igual; la generación es idempotente por fecha nominal', async () => {
    const def = loanDefinition();
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const reread = await asUser(() => uow.run(w1, async () => (await defs.findById(w1, def.id))!));
    expect(reread.kind).toBe('LOAN_PAYMENT');
    expect(reread.snapshot).toMatchObject({ managedBy: 'DEBT', managedRef: def.snapshot.managedRef });
    expect(reread.current.schedule).toMatchObject({
      cadence: 'EXPLICIT',
      startDate: '2026-11-15',
      explicit: SCHEDULE,
    });
    expect(reread.current.amount.type).toBe('VARIABLE');
    expect(reread.current.materialization.mode).toBe('NOTIFY_ONLY');

    const attempt = () =>
      asUser(() =>
        uow.run(w1, async () => {
          await defs.findById(w1, def.id, { lock: 'update' });
          return occs.insertIfAbsent(SCHEDULE.map((item) => occurrenceOf(def, item)));
        }),
      );
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect(a.length + b.length).toBe(3);
    const rows = await asUser(() => uow.run(w1, () => occs.listForDefinition(w1, def.id)));
    expect(
      rows.map((o) => [o.snapshot.occurrenceDate, o.snapshot.scheduleKey, o.snapshot.sharesTransaction]),
    ).toEqual(SCHEDULE.map((i) => [i.dueDate, i.key, true]));
    expect(rows[2]!.snapshot.expected.amount).toBe('2341.90');
    // la clave del ítem es única por definición
    const clash = occurrenceOf(def, { key: '1', dueDate: '2027-02-15', amount: '1.00' });
    expect(await sqlState(() => asUser(() => uow.run(w1, () => occs.insertIfAbsent([clash]))))).toBe('23505');
  });

  it('[TC-DEBT-LOAN-025] una transacción resuelve varias ocurrencias de cuota (1:N) pero sigue siendo 1:1 para las demás', async () => {
    const def = loanDefinition();
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const rows = SCHEDULE.map((item) => occurrenceOf(def, item));
    await asUser(() => uow.run(w1, () => occs.insertIfAbsent(rows)));
    const txn = randomUUID();
    await asUser(() =>
      uow.run(w1, async () => {
        for (const row of rows.slice(0, 2)) {
          const o = (await occs.findById(w1, row.id))!;
          o.settle({ transactionId: txn, at: AT, by: user });
          expect(await occs.save(o)).toBe(true);
        }
      }),
    );
    const linked = await asUser(() => uow.run(w1, () => occs.findByTransaction(w1, txn)));
    expect(linked?.snapshot.transactionId).toBe(txn);
    const resolved = await asUser(() =>
      uow.run(w1, () => occs.listForDefinition(w1, def.id, { statuses: ['MATCHED'] })),
    );
    expect(resolved).toHaveLength(2);
    expect(resolved.every((o) => o.snapshot.matchedBy === null && o.snapshot.resolution === 'MATCHED')).toBe(
      true,
    );

    // sin la marca de cuota, la base sigue exigiendo una ocurrencia por transacción
    const a = occurrenceOf(def, { key: 'x', dueDate: '2027-02-15', amount: '10.00' }, false);
    const b = occurrenceOf(def, { key: 'y', dueDate: '2027-03-15', amount: '10.00' }, false);
    await asUser(() => uow.run(w1, () => occs.insertIfAbsent([a, b])));
    const shared = randomUUID();
    const code = await asUser(async () => {
      try {
        await uow.run(w1, async () => {
          for (const row of [a, b]) {
            const o = (await occs.findById(w1, row.id))!;
            o.settle({ transactionId: shared, at: AT, by: user });
            await occs.save(o);
          }
        });
      } catch (err) {
        return (err as { code?: string }).code;
      }
      return undefined;
    });
    expect(code).toBe('TRANSACTION_ALREADY_LINKED');
  });

  it('settle concurrente sobre la misma cuota: el candado de la definición serializa y solo una transacción la resuelve', async () => {
    const def = loanDefinition();
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const row = occurrenceOf(def, SCHEDULE[0]!);
    await asUser(() => uow.run(w1, () => occs.insertIfAbsent([row])));
    const settle = (txn: string) =>
      asUser(async () => {
        try {
          await uow.run(w1, async () => {
            await defs.findById(w1, def.id, { lock: 'update' });
            const o = (await occs.findById(w1, row.id))!;
            o.settle({ transactionId: txn, at: AT, by: user });
            if (!(await occs.save(o))) throw new Error('version conflict');
          });
          return 'ok';
        } catch (err) {
          return (err as { code?: string }).code ?? (err as Error).message;
        }
      });
    const results = await Promise.all([settle(randomUUID()), settle(randomUUID())]);
    expect(results.sort()).toEqual(['OCCURRENCE_ALREADY_MATERIALIZED', 'ok']);
  });

  it('LOAN_PAYMENT solo se admite con managed_by DEBT y un calendario explícito va con la cadencia EXPLICIT y el modo solo aviso', async () => {
    const insertDefinition = (kind: string, managedBy: string, ref: string | null) => () =>
      inCtx(w1, (c) =>
        c.query(
          `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status, managed_by, managed_ref)
           VALUES ($1, $2, 'x', $3, 'ACTIVE', $4, $5)`,
          [randomUUID(), w1, kind, managedBy, ref],
        ),
      );
    expect(await sqlState(insertDefinition('LOAN_PAYMENT', 'DEBT', randomUUID()))).toBeUndefined();
    expect(await sqlState(insertDefinition('LOAN_PAYMENT', 'SUBSCRIPTION', randomUUID()))).toBe('23514');
    expect(await sqlState(insertDefinition('LOAN_PAYMENT', 'USER', null))).toBe('23514');
    expect(await sqlState(insertDefinition('CARD_PAYMENT', 'DEBT', randomUUID()))).toBe('23514');

    const def = loanDefinition();
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const insertVersion =
      (cadence: string, explicit: string | null, mode: string, rrule: string | null) => () =>
        inCtx(w1, (c) =>
          c.query(
            `INSERT INTO commitments.recurring_definition_version
               (workspace_id, definition_id, version_no, effective_from, account_id, currency, amount_type, cadence,
                interval, month_days, rrule, dtstart, materialization_mode, explicit_schedule)
             VALUES ($1, $2, 2, '2026-11-15', $3, 'BOB', 'VARIABLE', $4, 1, '[]', $5, '2026-11-15', $6, $7::jsonb)`,
            [w1, def.id, randomUUID(), cadence, rrule, mode, explicit],
          ),
        );
    const items = JSON.stringify(SCHEDULE);
    expect(await sqlState(insertVersion('EXPLICIT', items, 'NOTIFY_ONLY', null))).toBeUndefined();
    expect(await sqlState(insertVersion('EXPLICIT', null, 'NOTIFY_ONLY', null))).toBe('23514');
    expect(await sqlState(insertVersion('MONTHLY', items, 'NOTIFY_ONLY', null))).toBe('23514');
    expect(await sqlState(insertVersion('EXPLICIT', items, 'PENDING_APPROVAL', null))).toBe('23514');
    expect(await sqlState(insertVersion('EXPLICIT', items, 'NOTIFY_ONLY', 'FREQ=MONTHLY'))).toBe('23514');
    expect(await sqlState(insertVersion('EXPLICIT', '{"a":1}', 'NOTIFY_ONLY', null))).toBe('23514');
  });
});
