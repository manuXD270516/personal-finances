import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Budget, BudgetLine, currencyOf } from './support.js';
import { PgBudgetRepository, PgThresholdCrossingRepository } from '../../src/infrastructure/pg-budgets.js';
import { PgPlanningUnitOfWork } from '../../src/infrastructure/pg-planning.js';

const deps = inject('deps');

// Tablas de presupuestos contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-budgets tarea 4.1): un plan
// por periodo, aislamiento entre workspaces, CHECKs de forma por tipo, cruces de umbral append-only y
// `INSERT … ON CONFLICT DO NOTHING` bajo concurrencia.
let app: Pool;
let migrator: Pool;
let uow: PgPlanningUnitOfWork;
let user: string;
const budgets = new PgBudgetRepository();
const crossings = new PgThresholdCrossingRepository();
const w1 = randomUUID();
const w2 = randomUUID();
const periods: Record<string, string> = { [w1]: randomUUID(), [w2]: randomUUID() };
const BOB = currencyOf('BOB', 2);
const category = randomUUID();

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

/** Transacción directa como `pf_app` con contexto RLS LOCAL (rollback salvo `commit`). */
async function inCtx<T>(
  workspaceId: string | null,
  fn: (c: PoolClient) => Promise<T>,
  commit = false,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      user,
      workspaceId ?? '',
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

function newBudget(ws: string, periodId: string): Budget {
  return Budget.create({
    id: randomUUID(),
    workspaceId: ws,
    periodId,
    currency: BOB,
    at: new Date().toISOString(),
  });
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  uow = new PgPlanningUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/bud', $1, $2, 'bud') AS id`,
    [`sub-${randomUUID()}`, `bud-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Bud', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
          [ws],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
        await c.query(
          `INSERT INTO planning.financial_period (id, workspace_id, label, period_start, period_end, start_day, status, activated_at)
           VALUES ($1, $2, '2026-11', '2026-11-01', '2026-11-30', 1, 'ACTIVE', now())`,
          [periods[ws], ws],
        );
      },
      true,
    );
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('planning.budget / planning.budget_line (PG real)', () => {
  it('[TC-PLANNING-BUDGET-001] UNIQUE (workspace, periodo): el segundo plan del periodo no se inserta (ON CONFLICT DO NOTHING)', async () => {
    const first = newBudget(w1, periods[w1]!);
    const second = newBudget(w1, periods[w1]!);
    const result = await asUser(() =>
      uow.run(w1, async () => [await budgets.insertIfAbsent(first), await budgets.insertIfAbsent(second)]),
    );
    expect(result).toEqual([true, false]);
    const stored = await asUser(() => uow.run(w1, () => budgets.findByPeriod(w1, periods[w1]!)));
    expect(stored?.id).toBe(first.id);
    expect(stored?.snapshot).toMatchObject({
      currency: 'BOB',
      origin: 'EMPTY',
      version: 1,
      zeroBased: false,
    });
  });

  it('las líneas se guardan con su escala, se leen a la escala de la moneda y respetan el control optimista', async () => {
    const budget = (await asUser(() => uow.run(w1, () => budgets.findByPeriod(w1, periods[w1]!))))!;
    const line = BudgetLine.create({
      id: randomUUID(),
      workspaceId: w1,
      budgetId: budget.id,
      target: { kind: 'CATEGORY', id: category },
      nature: 'EXPENSE',
      spec: {
        kind: 'MAXIMUM',
        planned: '600.00',
        min: null,
        max: null,
        percent: null,
        incomeBasis: null,
        rolloverPolicy: 'NONE',
        rolloverCap: null,
        thresholds: ['50', '75', '90', '100'],
      },
    });
    await asUser(() => uow.run(w1, () => budgets.insertLine(line)));
    const loaded = (await asUser(() => uow.run(w1, () => budgets.findById(w1, budget.id))))!;
    expect(loaded.lines).toHaveLength(1);
    expect(loaded.lines[0]!.snapshot).toMatchObject({
      planned: '600.00',
      thresholds: ['50', '75', '90', '100'],
      rolloverStatus: 'NONE',
      version: 1,
    });
    const changed = loaded.lines[0]!.withSpec({ ...loaded.lines[0]!.spec, planned: '500.00' });
    expect(await asUser(() => uow.run(w1, () => budgets.updateLine(changed)))).toBe(true);
    // La misma versión persistida otra vez: la fila ya está en la versión 2 => rechazo optimista.
    expect(await asUser(() => uow.run(w1, () => budgets.updateLine(changed)))).toBe(false);
  });

  it('aislamiento: otro workspace no ve los planes ni sus líneas (RLS forzada) y sin contexto falla con PF002', async () => {
    const visible = await asUser(() => uow.run(w2, () => budgets.findByPeriod(w1, periods[w1]!)));
    expect(visible).toBeNull();
    const seen = await inCtx(
      w2,
      async (c) => (await c.query('SELECT count(*)::int AS n FROM planning.budget')).rows[0]!.n,
    );
    expect(seen).toBe(0);
    const own = await inCtx(
      w1,
      async (c) => (await c.query('SELECT count(*)::int AS n FROM planning.budget_line')).rows[0]!.n,
    );
    expect(own).toBe(1);
    expect(await sqlState(() => inCtx(null, (c) => c.query('SELECT 1 FROM planning.budget')))).toBe('PF002');
    // Un plan con el workspace de otro no se inserta (WITH CHECK).
    expect(
      await sqlState(() =>
        inCtx(w2, (c) =>
          c.query(
            `INSERT INTO planning.budget (id, workspace_id, period_id, currency) VALUES ($1, $2, $3, 'BOB')`,
            [randomUUID(), w1, periods[w1]],
          ),
        ),
      ),
    ).toBeDefined();
  });

  it('CHECKs de forma: ingreso solo FIXED sin umbrales, MINIMUM sin umbrales, monto negativo, min > max y más de 10 umbrales', async () => {
    const budget = (await asUser(() => uow.run(w1, () => budgets.findByPeriod(w1, periods[w1]!))))!;
    const insert = (cols: Record<string, unknown>) =>
      inCtx(w1, (c) => {
        const base: Record<string, unknown> = {
          id: randomUUID(),
          workspace_id: w1,
          budget_id: budget.id,
          target_kind: 'CATEGORY',
          target_id: randomUUID(),
          nature: 'EXPENSE',
          kind: 'MAXIMUM',
          planned_amount: '100',
          ...cols,
        };
        const keys = Object.keys(base);
        return c.query(
          `INSERT INTO planning.budget_line (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
          keys.map((k) => base[k]),
        );
      });
    expect(await sqlState(() => insert({ planned_amount: '100' }))).toBeUndefined();
    expect(await sqlState(() => insert({ nature: 'INCOME', kind: 'MAXIMUM' }))).toBe('23514');
    expect(await sqlState(() => insert({ nature: 'INCOME', kind: 'FIXED', thresholds: [50] }))).toBe('23514');
    expect(
      await sqlState(() =>
        insert({ kind: 'MINIMUM', planned_amount: null, min_amount: '10', thresholds: [50] }),
      ),
    ).toBe('23514');
    expect(await sqlState(() => insert({ planned_amount: '-1' }))).toBe('23514');
    expect(
      await sqlState(() =>
        insert({ kind: 'RANGE', planned_amount: null, min_amount: '10', max_amount: '5' }),
      ),
    ).toBe('23514');
    expect(await sqlState(() => insert({ thresholds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }))).toBe('23514');
    expect(await sqlState(() => insert({ target_kind: 'TAG', nature: 'INCOME', kind: 'FIXED' }))).toBe(
      '23514',
    );
    expect(
      await sqlState(() => insert({ kind: 'PERCENT_OF_INCOME', planned_amount: null, percent: '10' })),
    ).toBe('23514');
    expect(await sqlState(() => insert({ target_id: category }))).toBe('23505');
  });
});

describe('planning.budget_threshold_crossing (append-only)', () => {
  const row = (threshold: string, eventId = randomUUID()) => ({
    workspaceId: w1,
    periodId: periods[w1]!,
    targetKind: 'CATEGORY' as const,
    targetId: category,
    threshold,
    budgetId: randomUUID(),
    budgetLineId: randomUUID(),
    reference: '600.00',
    actual: '310.00',
    currency: 'BOB',
    crossedAt: '2026-11-10T15:00:00.000Z',
    eventId,
  });

  it('[TC-PLANNING-THRESHOLD-005] dos evaluaciones concurrentes del mismo umbral registran UN cruce (ON CONFLICT DO NOTHING)', async () => {
    const budget = (await asUser(() => uow.run(w1, () => budgets.findByPeriod(w1, periods[w1]!))))!;
    const attempt = () =>
      asUser(() =>
        uow.run(w1, () =>
          crossings.insertIfAbsent([
            { ...row('50'), budgetId: budget.id, budgetLineId: budget.lines[0]!.id },
          ]),
        ),
      );
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.flat()).toEqual(['50']);
    const listed = await asUser(() => uow.run(w1, () => crossings.list(w1, periods[w1]!)));
    expect(listed).toEqual([{ targetKind: 'CATEGORY', targetId: category, threshold: '50' }]);
  });

  it('el cruce es inmutable (UPDATE/DELETE bloqueados por grants y por forbid_mutation) y los de otro workspace no se ven', async () => {
    expect(
      await sqlState(() =>
        inCtx(w1, (c) => c.query(`UPDATE planning.budget_threshold_crossing SET actual_amount = 1`)),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() => inCtx(w1, (c) => c.query(`DELETE FROM planning.budget_threshold_crossing`))),
    ).toBe('42501');
    expect(await asUser(() => uow.run(w2, () => crossings.list(w1, periods[w1]!)))).toEqual([]);
  });

  it('las tablas de presupuestos están registradas en el catálogo de purga, hijas antes que padres', async () => {
    const { rows } = await migrator.query<{ table_name: string; purge_order: number }>(
      `SELECT table_name, purge_order FROM platform.workspace_scoped_table
        WHERE schema_name = 'planning' ORDER BY purge_order, table_name`,
    );
    const order = Object.fromEntries(rows.map((r) => [r.table_name, r.purge_order]));
    expect(order['budget_threshold_crossing']).toBeLessThan(order['budget']!);
    expect(order['budget_line']).toBeLessThan(order['budget']!);
    expect(order['budget']).toBeLessThan(order['financial_period']!);
  });
});
