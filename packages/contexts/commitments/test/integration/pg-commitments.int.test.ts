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

// `commitments.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; tarea 4.2): unicidad nominal (INV-013),
// `ON CONFLICT DO NOTHING RETURNING` bajo concurrencia, versiones inmutables, control optimista, índice único por
// transacción y aislamiento por workspace.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgCommitmentsUnitOfWork;
const defs = new PgDefinitionRepository();
const occs = new PgOccurrenceRepository();

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

const version = (startDate = '2026-10-20') =>
  buildDefinitionVersion({
    kind: 'EXPENSE',
    versionNo: 1,
    effectiveFrom: startDate,
    currency: { code: 'BOB', scale: 2 },
    template: {
      accountId: randomUUID(),
      amount: { type: 'FIXED', amount: '199.00' },
      schedule: { cadence: 'MONTHLY', interval: 1, startDate },
    },
  });

const newDefinition = (workspaceId: string) =>
  RecurringDefinition.create({
    id: randomUUID(),
    workspaceId,
    name: 'Internet',
    kind: 'EXPENSE',
    version1: version(),
    at: '2026-10-09T16:00:00.000Z',
    by: user,
  });

const occurrence = (def: RecurringDefinition, date: string) =>
  RecurringOccurrence.generate({
    id: randomUUID(),
    workspaceId: def.workspaceId,
    definitionId: def.id,
    occurrenceDate: date,
    dueDate: date,
    definitionVersionNo: 1,
    expected: { type: 'FIXED', amount: '199.00', min: null, max: null },
    currency: 'BOB',
    at: '2026-10-09T16:00:00.000Z',
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/rec', $1, $2, 'rec') AS id`,
    [`sub-${randomUUID()}`, `rec-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Rec', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
          [ws],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
      },
      true,
    );
  }
  uow = new PgCommitmentsUnitOfWork(app);
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('Repositorios de COMMITMENTS sobre PostgreSQL', () => {
  it('[TC-COMMITMENTS-RECUR-015] insertIfAbsent concurrente: cada fecha nominal se inserta una sola vez y solo quien inserta la ve', async () => {
    const def = newDefinition(w1);
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const dates = ['2026-10-20', '2026-11-20', '2026-12-20'];
    const attempt = () =>
      asUser(() =>
        uow.run(w1, async () => {
          await defs.findById(w1, def.id, { lock: 'update' });
          return occs.insertIfAbsent(dates.map((d) => occurrence(def, d)));
        }),
      );
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect(a.length + b.length).toBe(3);
    const all = await asUser(() => uow.run(w1, () => occs.listExisting(w1, def.id)));
    expect(all.map((o) => o.occurrenceDate)).toEqual(dates);
    // Sin el candado de la definición el árbitro es el ON CONFLICT: tampoco hay error al cliente.
    const raw = () =>
      asUser(() => uow.run(w1, () => occs.insertIfAbsent(dates.map((d) => occurrence(def, d)))));
    const [c, d] = await Promise.all([raw(), raw()]);
    expect(c.length + d.length).toBe(0);
  });

  it('versiones inmutables: sin UPDATE ni DELETE para la app (42501) y el control optimista rechaza una versión vieja', async () => {
    const def = newDefinition(w1);
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(
            `UPDATE commitments.recurring_definition_version SET lead_days = 9 WHERE definition_id = $1`,
            [def.id],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(`DELETE FROM commitments.recurring_definition_version WHERE definition_id = $1`, [def.id]),
        ),
      ),
    ).toBe('42501');
    const stale = await asUser(() => uow.run(w1, async () => (await defs.findById(w1, def.id))!));
    const fresh = await asUser(() => uow.run(w1, async () => (await defs.findById(w1, def.id))!));
    fresh.annotate({ name: 'Internet fibra' }, '2026-10-10T00:00:00.000Z', user);
    expect(await asUser(() => uow.run(w1, () => defs.save(fresh)))).toBe(true);
    stale.annotate({ name: 'Otro' }, '2026-10-10T00:00:00.000Z', user);
    expect(await asUser(() => uow.run(w1, () => defs.save(stale)))).toBe(false);
    const reread = await asUser(() => uow.run(w1, async () => (await defs.findById(w1, def.id))!));
    expect(reread.name).toBe('Internet fibra');
    expect(reread.versions).toHaveLength(1);
    expect(reread.current.amount).toEqual({ type: 'FIXED', amount: '199.00', min: null, max: null });
  });

  it('una transacción resuelve a lo sumo una ocurrencia (TC-COMMITMENTS-RECUR-049) y la base exige coherencia estado ↔ transacción', async () => {
    const def = newDefinition(w1);
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    const first = occurrence(def, '2026-10-20');
    const second = occurrence(def, '2026-11-20');
    await asUser(() => uow.run(w1, () => occs.insertIfAbsent([first, second])));
    const txn = randomUUID();
    const code = await asUser(async () => {
      try {
        await uow.run(w1, async () => {
          const a = (await occs.findById(w1, first.id))!;
          a.link({ transactionId: txn, matchedBy: 'USER_LINK', at: '2026-10-19T12:00:00.000Z', by: user });
          expect(await occs.save(a)).toBe(true);
          const b = (await occs.findById(w1, second.id))!;
          b.link({ transactionId: txn, matchedBy: 'USER_LINK', at: '2026-10-19T12:00:00.000Z', by: user });
          await occs.save(b);
        });
      } catch (err) {
        return (err as { code?: string }).code;
      }
      return undefined;
    });
    expect(code).toBe('TRANSACTION_ALREADY_LINKED');
    // CHECK: un estado resuelto exige transaction_id.
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(`UPDATE commitments.recurring_occurrence SET status = 'MATERIALIZED' WHERE id = $1`, [
            first.id,
          ]),
        ),
      ),
    ).toBe('23514');
  });

  it('RLS: otro workspace no ve ni modifica las filas, y sin contexto de workspace la consulta falla (PF002)', async () => {
    const def = newDefinition(w1);
    await asUser(() => uow.run(w1, () => defs.insert(def)));
    expect(await asUser(() => uow.run(w2, () => defs.findById(w2, def.id)))).toBeNull();
    const foreign = await asUser(() => uow.run(w2, () => defs.list(w2, {})));
    expect(foreign).toEqual([]);
    const insertForeign = () =>
      inCtx(w2, (c) =>
        c.query(
          `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status)
           VALUES ($1, $2, 'x', 'EXPENSE', 'ACTIVE')`,
          [randomUUID(), w1],
        ),
      );
    expect(await sqlState(insertForeign)).toBe('42501');
    const client = await app.connect();
    try {
      expect(await sqlState(() => client.query(`SELECT 1 FROM commitments.recurring_definition`))).toBe(
        'PF002',
      );
    } finally {
      client.release();
    }
  });

  it('los tipos reservados no existen en la base: LOAN_PAYMENT y managed_by distinto de USER violan su CHECK', async () => {
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(
            `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status)
             VALUES ($1, $2, 'x', 'LOAN_PAYMENT', 'ACTIVE')`,
            [randomUUID(), w1],
          ),
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlState(() =>
        inCtx(w1, (c) =>
          c.query(
            `INSERT INTO commitments.recurring_definition (id, workspace_id, name, kind, status, managed_by)
             VALUES ($1, $2, 'x', 'EXPENSE', 'ACTIVE', 'DEBT')`,
            [randomUUID(), w1],
          ),
        ),
      ),
    ).toBe('23514');
  });
});
