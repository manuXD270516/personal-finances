import { randomUUID } from 'node:crypto';
import type { AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPlanningRuntime, type PlanningRuntime } from '../../src/interface/planning.module.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `planning.financial_period` contra PostgreSQL 18 real (rol pf_app, RLS forzada; tarea 4.2): concurrencia de la
// creación, barreras de BD (exclusión diferible, únicos, CHECK de etiqueta, rango congelado), recálculo en sitio,
// aislamiento por workspace y activación con reloj fijo en la zona del workspace.
let app: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
const w3 = randomUUID();
const clock = new FixedClock(Instant.parse('2026-10-05T14:00:00Z'));
const calendars = new Map<string, { timeZone: string; fiscalMonthStartDay: number }>();
const audits: AuditEntry[] = [];
const steps: LifecycleStepInput[] = [];
let runtime: PlanningRuntime;

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

const rows = (ws: string) =>
  inCtx(ws, async (c) => {
    const { rows: r } = await c.query<{
      id: string;
      label: string;
      range: string;
      status: string;
      version: number;
      is_transition: boolean;
    }>(
      `SELECT id, label, period_start::text || '..' || period_end::text AS range, status, version, is_transition
         FROM planning.financial_period ORDER BY period_start`,
    );
    return r;
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const { rows: u } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/plan', $1, $2, 'plan') AS id`,
    [`sub-${randomUUID()}`, `plan-${randomUUID()}@demo.pfos.test`],
  );
  user = u[0]!.id;
  for (const [ws, day] of [
    [w1, 1],
    [w2, 25],
    [w3, 1],
  ] as const) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Plan', 'BOB', 'America/La_Paz', 'es-BO', $2)`,
          [ws, day],
        );
        await c.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
      },
      true,
    );
    calendars.set(ws, { timeZone: 'America/La_Paz', fiscalMonthStartDay: day });
  }
  runtime = createPlanningRuntime({
    pool: app,
    clock,
    audit: { append: async (e) => void audits.push(e) },
    lifecycle: {
      record: async (entry, s) => {
        requireSqlExecutor();
        audits.push(entry);
        steps.push(...s);
      },
    },
    outbox: { append: async () => undefined },
    calendar: { calendarOf: async (ws) => calendars.get(ws)! },
    activity: { getActivityRange: async () => null },
  });
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('planning.financial_period con PostgreSQL 18 real (pf_app, RLS forzada)', () => {
  it('[TC-PLANNING-AUTOCREATE-002] dos creaciones concurrentes en conexiones distintas dejan exactamente "2026-10".."2027-01" sin errores', async () => {
    const results = await Promise.all([
      asUser(() => runtime.service.ensurePeriods({ workspaceId: w1 })),
      asUser(() => runtime.service.ensurePeriods({ workspaceId: w1 })),
    ]);
    expect(results.map((r) => r.created.length).sort()).toEqual([0, 4]);
    const r = await rows(w1);
    expect(r.map((p) => `${p.label}:${p.status}:${p.range}`)).toEqual([
      '2026-10:ACTIVE:2026-10-01..2026-10-31',
      '2026-11:DRAFT:2026-11-01..2026-11-30',
      '2026-12:DRAFT:2026-12-01..2026-12-31',
      '2027-01:DRAFT:2027-01-01..2027-01-31',
    ]);
    // El recorrido se escribe en la transacción del comando (CREATE por periodo insertado, una sola vez).
    expect(steps.filter((s) => s.kind === 'TRANSITION' && s.transition === 'CREATE')).toHaveLength(4);
  });

  it('[TC-PLANNING-PERIOD-002] la BD rechaza un periodo que solapa (etiqueta repetida o rango que se cruza, al COMMIT) y los periodos no cambian', async () => {
    const before = await rows(w1);
    const insert = (c: PoolClient, label: string, start: string, end: string) =>
      c.query(
        `INSERT INTO planning.financial_period (id, workspace_id, label, period_start, period_end, start_day, status)
         VALUES ($1, $2, $3, $4, $5, 15, 'DRAFT')`,
        [randomUUID(), w1, label, start, end],
      );
    // El caso del escenario: "2026-10" del 2026-10-15 al 2026-11-14 sobre "2026-10" del 2026-10-01 al 2026-10-31.
    expect(
      await sqlState(() => inCtx(w1, (c) => insert(c, '2026-10', '2026-10-15', '2026-11-14'), true)),
    ).toBe('23505');
    // Otra etiqueta, mismo cruce de rangos: la exclusión gist (diferible) lo rechaza al COMMIT.
    expect(
      await sqlState(() => inCtx(w1, (c) => insert(c, '2026-09', '2026-09-15', '2026-10-14'), true)),
    ).toBe('23P01');
    // La etiqueta debe ser el mes del inicio.
    expect(
      await sqlState(() => inCtx(w1, (c) => insert(c, '2026-08', '2026-07-15', '2026-07-31'), true)),
    ).toBe('23514');
    expect(await rows(w1)).toEqual(before);
  });

  it('rango congelado fuera de DRAFT (23514 financial_period_range_frozen); un DRAFT sí puede moverse; pf_app no puede borrar (42501)', async () => {
    const [oct, nov] = await rows(w1);
    const frozen = await inCtx(w1, async (c) => {
      try {
        await c.query(`UPDATE planning.financial_period SET period_end = '2026-10-30' WHERE id = $1`, [
          oct!.id,
        ]);
        return null;
      } catch (err) {
        return err as { code?: string; constraint?: string };
      }
    });
    expect([frozen?.code, frozen?.constraint]).toEqual(['23514', 'financial_period_range_frozen']);
    // El cambio de estado de un periodo ACTIVE sí se admite (lo usará add-month-closing).
    await inCtx(w1, (c) =>
      c.query(`UPDATE planning.financial_period SET status = 'CLOSED', version = version + 1 WHERE id = $1`, [
        oct!.id,
      ]),
    );
    await inCtx(w1, (c) =>
      c.query(`UPDATE planning.financial_period SET period_end = '2026-11-29' WHERE id = $1`, [nov!.id]),
    );
    expect(
      await sqlState(() =>
        inCtx(w1, (c) => c.query(`DELETE FROM planning.financial_period WHERE id = $1`, [nov!.id])),
      ),
    ).toBe('42501');
  });

  it('[TC-PLANNING-ACTIVATION-001] (integración, reloj fijo) a las 03:30Z "2026-11" sigue DRAFT en La Paz y a las 04:05Z queda ACTIVE en la BD', async () => {
    clock.set(Instant.parse('2026-11-01T03:30:00Z'));
    await asUser(() => runtime.service.ensurePeriods({ workspaceId: w1 }));
    expect((await rows(w1)).find((p) => p.label === '2026-11')?.status).toBe('DRAFT');
    clock.set(Instant.parse('2026-11-01T04:05:00Z'));
    await asUser(() => runtime.service.ensurePeriods({ workspaceId: w1 }));
    const nov = (await rows(w1)).find((p) => p.label === '2026-11');
    expect([nov?.status, nov?.version]).toEqual(['ACTIVE', 2]);
    const active = await asUser(() =>
      runtime.periodQuery.listPeriods({ workspaceId: w1, statuses: ['ACTIVE'] }),
    );
    expect(active.map((p) => `${p.label}:${String(p.pendingClosure)}`)).toEqual([
      '2026-10:true',
      '2026-11:false',
    ]);
    clock.set(Instant.parse('2026-10-05T14:00:00Z'));
  });

  it('[TC-PLANNING-FISCALDAY-001] (BD) de día 1 a 25 los DRAFT se recalculan en sitio en una transacción (exclusión diferible) conservando su id', async () => {
    const before = await rows(w3);
    expect(before).toEqual([]);
    await asUser(() => runtime.service.ensurePeriods({ workspaceId: w3 }));
    const ids = new Map((await rows(w3)).map((p) => [p.label, p.id]));
    calendars.set(w3, { timeZone: 'America/La_Paz', fiscalMonthStartDay: 25 });
    await asUser(() => runtime.service.ensurePeriods({ workspaceId: w3 }));
    const after = await rows(w3);
    expect(after.map((p) => `${p.label}:${p.range}:${String(p.is_transition)}`)).toEqual([
      '2026-10:2026-10-01..2026-10-31:false',
      '2026-11:2026-11-01..2026-12-24:true',
      '2026-12:2026-12-25..2027-01-24:false',
      '2027-01:2027-01-25..2027-02-24:false',
    ]);
    for (const p of after) expect(p.id).toBe(ids.get(p.label));
  });

  it('[TC-PLANNING-ISOLATION-001] W1 (día 1) y W2 (día 25) tienen calendarios independientes; desde W1 nunca se ve W2; sin contexto la consulta falla (PF002)', async () => {
    await asUser(() => runtime.service.ensurePeriods({ workspaceId: w2 }));
    expect((await rows(w2)).find((p) => p.label === '2026-10')?.range).toBe('2026-10-25..2026-11-24');
    const seen = await inCtx(
      w1,
      async (c) =>
        (
          await c.query<{ ws: string }>(
            `SELECT DISTINCT workspace_id::text AS ws FROM planning.financial_period`,
          )
        ).rows,
    );
    expect(seen).toEqual([{ ws: w1 }]);
    expect((await rows(w1)).find((p) => p.label === '2026-10')?.range).toBe('2026-10-01..2026-10-31');
    // Por el repositorio: el periodo de W2 pedido desde W1 no existe.
    const w2Oct = (await rows(w2)).find((p) => p.label === '2026-10')!;
    expect(
      await asUser(() => runtime.periodQuery.getPeriod({ workspaceId: w1, periodId: w2Oct.id })),
    ).toBeNull();
    expect(await sqlState(() => inCtx(null, (c) => c.query('SELECT * FROM planning.financial_period')))).toBe(
      'PF002',
    );
  });

  it('[TC-PLANNING-PLANGUARD-001] (BD) el guard toma FOR SHARE: closed ⇒ PERIOD_CLOSED; draft ⇒ ok; inexistente ⇒ REFERENCE_NOT_FOUND', async () => {
    const draft = (await rows(w1)).find((p) => p.status === 'DRAFT')!;
    const code = async (periodId: string) => {
      try {
        await asUser(() =>
          new PgUnitOfWork(app).run({ userId: user, workspaceId: w1 }, () =>
            runtime.editGuard.assertPlanEditable({ workspaceId: w1, periodId }),
          ),
        );
        return 'OK';
      } catch (err) {
        if (err instanceof DomainError) return err.code;
        throw err;
      }
    };
    // Cierre simulado (el comando real llega con add-month-closing): solo cambia el estado, el rango sigue igual.
    await inCtx(
      w1,
      (c) =>
        c.query(
          `UPDATE planning.financial_period SET status = 'CLOSED', version = version + 1 WHERE label = '2026-10'`,
        ),
      true,
    );
    const oct = (await rows(w1)).find((p) => p.label === '2026-10')!;
    expect(await code(oct.id)).toBe('PERIOD_CLOSED');
    expect(await code(draft.id)).toBe('OK');
    expect(await code(randomUUID())).toBe('REFERENCE_NOT_FOUND');
  });
});
