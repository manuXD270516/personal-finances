import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Money, currency } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MovementRow } from '../../src/application/ports/index.js';
import { SavingsGoal, contribution, reversalOf } from '../../src/domain/index.js';
import {
  PgGoalRepository,
  PgGoalsUnitOfWork,
  PgMovementRepository,
  PgReservationStateRepository,
} from '../../src/infrastructure/pg-goals.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `goals.*` contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-savings-goals, tarea 4.2): repositorios con
// control optimista, movimientos append-only (PF003), claves únicas de aporte/retiro por transacción, `reverses_id`
// único, candado por cuenta, aislamiento entre workspaces y RLS fail-closed (PF002).
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
let uow: PgGoalsUnitOfWork;
const goals = new PgGoalRepository();
const movements = new PgMovementRepository();
const states = new PgReservationStateRepository();
const AT = '2026-10-10T16:00:00.000Z';
const BOB = currency('BOB', 2);

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const newGoal = (ws: string, name = 'Fondo de emergencia') =>
  SavingsGoal.create({
    id: randomUUID(),
    workspaceId: ws,
    name,
    type: 'EMERGENCY_FUND',
    target: { amount: '15000.00', currency: 'BOB' },
    currencyScale: 2,
    startDate: '2026-10-01',
    targetDate: '2027-03-31',
    linkedAccountIds: [randomUUID()],
    at: AT,
    by: user,
  });

const real = (
  goalId: string,
  accountId: string,
  transactionId = randomUUID(),
  revision = 1,
): MovementRow => ({
  ...contribution({
    id: randomUUID(),
    goalId,
    fund: 'REAL',
    amount: Money.parse('500.00', BOB),
    accountId,
    occurredOn: '2026-10-20',
    origin: 'USER',
    transactionId,
    transactionRevision: revision,
  }),
  recordedAt: AT,
  recordedBy: user,
});

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgGoalsUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/goals', $1, $2, 'U1') AS id`,
    [`sub-goals-${randomUUID()}`, `goals-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Goals', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgGoalRepository', () => {
  it('round-trip de la meta con control optimista por versión y cuentas vinculadas', async () => {
    const goal = newGoal(w1);
    await inWs(w1, () => goals.insert(goal));
    const loaded = (await inWs(w1, () => goals.findById(w1, goal.id)))!;
    expect(loaded.snapshot.linkedAccountIds).toEqual(goal.snapshot.linkedAccountIds);
    expect(loaded.snapshot.targetAmount).toBe('15000.00');
    loaded.update({ name: 'Emergencias' }, { hasMovements: false, currencyScale: 2, at: AT, by: user });
    expect(await inWs(w1, () => goals.save(loaded))).toBe(true);
    const stale = SavingsGoal.restore(goal.snapshot);
    stale.update({ name: 'Otro' }, { hasMovements: false, currencyScale: 2, at: AT, by: user });
    expect(await inWs(w1, () => goals.save(stale))).toBe(false);
  });

  it('el nombre es único (sin distinguir mayúsculas) entre las no archivadas', async () => {
    await inWs(w1, () => goals.insert(newGoal(w1, 'Laptop')));
    expect(await inWs(w1, () => goals.nameTaken(w1, 'laptop'))).toBe(true);
    expect(await sqlState(() => inWs(w1, () => goals.insert(newGoal(w1, 'LAPTOP'))))).toBe('23505');
  });
});

describe('PgMovementRepository', () => {
  it('[TC-GOALS-SAVINGS-029] los movimientos son append-only: UPDATE y DELETE fallan con PF003', async () => {
    const goal = newGoal(w1, 'Append only');
    await inWs(w1, () => goals.insert(goal));
    const m = real(goal.id, goal.snapshot.linkedAccountIds[0]!);
    expect(await inWs(w1, () => movements.insert(w1, m))).toBe(true);
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [user, w1],
      );
      expect(['PF003', '42501']).toContain(
        await sqlState(() =>
          client.query('UPDATE goals.goal_movement SET note = $1 WHERE id = $2', ['x', m.id]),
        ),
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [user, w1],
      );
      expect(['PF003', '42501']).toContain(
        await sqlState(() => client.query('DELETE FROM goals.goal_movement WHERE id = $1', [m.id])),
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('[TC-GOALS-SAVINGS-021] una transferencia respalda un solo aporte por revisión, de cualquier meta', async () => {
    const a = newGoal(w1, 'Meta A');
    const b = newGoal(w1, 'Meta B');
    await inWs(w1, () => goals.insert(a));
    await inWs(w1, () => goals.insert(b));
    const account = a.snapshot.linkedAccountIds[0]!;
    const tx = randomUUID();
    expect(await inWs(w1, () => movements.insert(w1, real(a.id, account, tx)))).toBe(true);
    expect(await inWs(w1, () => movements.insert(w1, real(b.id, account, tx)))).toBe(false);
    // otra revisión de la misma transferencia sí
    expect(await inWs(w1, () => movements.insert(w1, real(b.id, account, tx, 2)))).toBe(true);
  });

  it('[TC-GOALS-SAVINGS-022] un movimiento se invierte una sola vez (reverses_id único)', async () => {
    const goal = newGoal(w1, 'Inversos');
    await inWs(w1, () => goals.insert(goal));
    const original = real(goal.id, goal.snapshot.linkedAccountIds[0]!);
    await inWs(w1, () => movements.insert(w1, original));
    const inverse = (id: string): MovementRow => ({
      ...reversalOf(original, { id, occurredOn: '2026-10-21', origin: 'SYSTEM' }),
      recordedAt: AT,
      recordedBy: user,
    });
    expect(await inWs(w1, () => movements.insert(w1, inverse(randomUUID())))).toBe(true);
    expect(await inWs(w1, () => movements.insert(w1, inverse(randomUUID())))).toBe(false);
    expect(await inWs(w1, () => movements.isReversed(w1, original.id))).toBe(true);
    const sums = await inWs(w1, () => movements.sums(w1, [goal.id]));
    expect(sums).toEqual([{ goalId: goal.id, currency: 'BOB', amount: '0.00' }]);
  });

  it('[TC-GOALS-SAVINGS-041] RLS: otro workspace no ve las metas y sin contexto falla con PF002', async () => {
    const goal = newGoal(w1, 'Aislada');
    await inWs(w1, () => goals.insert(goal));
    expect(await inWs(w2, () => goals.findById(w2, goal.id))).toBeNull();
    const client = await app.connect();
    try {
      expect(await sqlState(() => client.query('SELECT 1 FROM goals.savings_goal'))).toBe('PF002');
    } finally {
      client.release();
    }
  });
});

describe('PgReservationStateRepository', () => {
  it('get-or-create con candado por cuenta y estado de episodio', async () => {
    const account = randomUUID();
    const first = await inWs(w1, () => states.lock(w1, account));
    expect(first).toMatchObject({ accountId: account, state: 'NORMAL', version: 1 });
    await inWs(w1, () =>
      states.save(
        w1,
        {
          accountId: account,
          state: 'OVER_ALLOCATED',
          episodeId: randomUUID(),
          since: '2026-10-15',
          shortfall: '1200.00',
          currency: 'BOB',
          version: 2,
        },
        AT,
      ),
    );
    const over = await inWs(w1, () => states.overAllocated(w1));
    expect(over.find((s) => s.accountId === account)).toMatchObject({
      shortfall: '1200.00',
      since: '2026-10-15',
    });
  });
});
