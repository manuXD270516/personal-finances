import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@pf/platform/api';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TemplatesService } from '../../src/application/templates.service.js';
import type { BudgetsDeps } from '../../src/application/ports/index.js';
import { PgBudgetRepository } from '../../src/infrastructure/pg-budgets.js';
import { PgBudgetTemplateRepository } from '../../src/infrastructure/pg-templates.js';
import { PgPlanningUnitOfWork } from '../../src/infrastructure/pg-planning.js';
import { Budget, BudgetLine, BudgetTemplate, currencyOf } from './support.js';

const deps = inject('deps');

// Templates versionados contra PostgreSQL 18 real (rol pf_app, RLS forzada; openspec add-budget-templates tarea 4.1):
// versiones y líneas inmutables (PF003), un solo predeterminado bajo concurrencia, nombre único entre activos, FKs
// plan -> template y aislamiento entre workspaces.
let app: Pool;
let migrator: Pool;
let uow: PgPlanningUnitOfWork;
let user: string;
const templates = new PgBudgetTemplateRepository();
const budgets = new PgBudgetRepository();
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

const spec = (planned: string) => ({
  kind: 'MAXIMUM' as const,
  planned,
  min: null,
  max: null,
  percent: null,
  incomeBasis: null,
  rolloverPolicy: 'NONE' as const,
  rolloverCap: null,
  thresholds: ['50', '100'],
});

function newTemplate(ws: string, name: string, planned = '1500.00'): BudgetTemplate {
  return BudgetTemplate.create({
    id: randomUUID(),
    workspaceId: ws,
    name,
    description: null,
    at: new Date().toISOString(),
    firstVersion: {
      id: randomUUID(),
      versionNo: 1,
      basedOnVersionNo: null,
      changeNote: null,
      createdAt: new Date().toISOString(),
      createdBy: null,
      lines: [
        {
          id: randomUUID(),
          target: { kind: 'CATEGORY', id: category },
          nature: 'EXPENSE',
          spec: spec(planned),
          currency: 'BOB',
        },
      ],
    },
  });
}

const service = () =>
  new TemplatesService({
    uow,
    templates,
    audit: { append: async () => undefined },
  } as unknown as BudgetsDeps);

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 8 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  uow = new PgPlanningUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/tpl', $1, $2, 'tpl') AS id`,
    [`sub-${randomUUID()}`, `tpl-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  for (const ws of [w1, w2]) {
    await inCtx(
      ws,
      async (c) => {
        await c.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day)
           VALUES ($1, 'Tpl', 'BOB', 'America/La_Paz', 'es-BO', 1)`,
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

describe('planning.budget_template* (PG real)', () => {
  it('[TC-PLANNING-TEMPLATE-002] las versiones y sus líneas son inmutables: UPDATE/DELETE fallan con PF003 y la versión 1 conserva su monto', async () => {
    const t = newTemplate(w1, 'Mes estándar');
    await asUser(() =>
      uow.run(w1, async () => {
        await templates.insert(t);
        t.markPersisted();
        const next = t.publishVersion({
          baseVersionNo: 1,
          versionId: randomUUID(),
          lines: [{ ...t.currentVersion.lines[0]!, id: randomUUID(), spec: spec('1600.00') }],
          changeNote: 'Inflación',
          by: user,
          at: new Date().toISOString(),
        });
        expect(next.versionNo).toBe(2);
        expect(await templates.save(t)).toBe(true);
        await templates.insertCurrentVersion(t);
      }),
    );
    const read = await asUser(() => uow.run(w1, () => templates.findById(w1, t.id)));
    expect(read?.currentVersionNo).toBe(2);
    expect(read?.currentVersion.changeNote).toBe('Inflación');
    expect(read?.currentVersion.lines[0]?.spec.planned).toBe('1600.00');
    const v1 = await asUser(() => uow.run(w1, () => templates.findVersion(w1, t.id, 1)));
    expect(v1?.lines[0]?.spec).toMatchObject({ planned: '1500.00', thresholds: ['50', '100'] });
    const headers = await asUser(() => uow.run(w1, () => templates.listVersions(w1, t.id)));
    expect(headers.map((h) => [h.versionNo, h.lineCount])).toEqual([
      [2, 1],
      [1, 1],
    ]);
    // pf_app no tiene UPDATE/DELETE (42501); el owner, aun con RLS saltada, topa con forbid_mutation (PF003).
    for (const statement of [
      `UPDATE planning.budget_template_version SET change_note = 'x' WHERE template_id = '${t.id}'`,
      `DELETE FROM planning.budget_template_version WHERE template_id = '${t.id}'`,
      `UPDATE planning.budget_template_line SET planned_amount = 1 WHERE template_version_id = '${v1!.id}'`,
      `DELETE FROM planning.budget_template_line WHERE template_version_id = '${v1!.id}'`,
    ]) {
      expect(await sqlState(() => inCtx(w1, (c) => c.query(statement))), statement).toBe('42501');
    }
    for (const table of ['budget_template_version', 'budget_template_line']) {
      expect(await sqlState(() => migrator.query(`TRUNCATE planning.${table} CASCADE`)), table).toBe('PF003');
    }
    const c = await migrator.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `CREATE POLICY tmp_owner ON planning.budget_template_version TO CURRENT_USER USING (true)`,
      );
      await c.query(`CREATE POLICY tmp_owner ON planning.budget_template_line TO CURRENT_USER USING (true)`);
      await c.query('SAVEPOINT s');
      expect(
        await sqlState(() =>
          c.query(`UPDATE planning.budget_template_version SET change_note = 'x' WHERE workspace_id = $1`, [
            w1,
          ]),
        ),
      ).toBe('PF003');
      await c.query('ROLLBACK TO SAVEPOINT s');
      expect(
        await sqlState(() =>
          c.query(`DELETE FROM planning.budget_template_line WHERE workspace_id = $1`, [w1]),
        ),
      ).toBe('PF003');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('el nombre es único entre los templates activos sin distinguir mayúsculas y se libera al archivar', async () => {
    const a = newTemplate(w1, 'Único');
    await asUser(() => uow.run(w1, () => templates.insert(a)));
    const dup = newTemplate(w1, 'ÚNICO');
    const error = await asUser(() => uow.run(w1, () => templates.insert(dup))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NAME_TAKEN' });
    // en otro workspace el mismo nombre es válido
    await asUser(() => uow.run(w2, () => templates.insert(newTemplate(w2, 'Único'))));
    // archivado, el nombre queda libre
    const stored = (await asUser(() => uow.run(w1, () => templates.findById(w1, a.id))))!;
    stored.archive();
    await asUser(() => uow.run(w1, () => templates.save(stored)));
    await asUser(() => uow.run(w1, () => templates.insert(newTemplate(w1, 'Único'))));
  });

  it('[TC-PLANNING-TEMPLATE-012] dos solicitudes concurrentes de predeterminado dejan exactamente uno', async () => {
    const a = newTemplate(w1, 'Predet A');
    const b = newTemplate(w1, 'Predet B');
    await asUser(async () => {
      await uow.run(w1, () => templates.insert(a));
      await uow.run(w1, () => templates.insert(b));
    });
    const svc = service();
    await Promise.all([
      asUser(() => svc.setDefault({ workspaceId: w1, templateId: a.id })),
      asUser(() => svc.setDefault({ workspaceId: w1, templateId: b.id })),
    ]);
    const { rows } = await inCtx(w1, (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM planning.budget_template WHERE workspace_id = $1 AND is_default AND status = 'ACTIVE'`,
        [w1],
      ),
    );
    expect(rows).toHaveLength(1);
    // el índice único parcial es la defensa final: dos predeterminados escritos a mano fallan
    const code = await sqlState(() =>
      inCtx(w1, async (c) => {
        await c.query(`UPDATE planning.budget_template SET is_default = true WHERE id = ANY($1::uuid[])`, [
          [a.id, b.id],
        ]);
      }),
    );
    expect(code).toBe('23505');
  });

  it('aísla los templates por workspace (RLS forzada) y una línea no puede apuntar a una versión ajena', async () => {
    const t = newTemplate(w1, 'Aislado');
    await asUser(() => uow.run(w1, () => templates.insert(t)));
    expect(await asUser(() => uow.run(w2, () => templates.findById(w2, t.id)))).toBeNull();
    expect((await asUser(() => uow.run(w2, () => templates.list(w2)))).map((x) => x.id)).not.toContain(t.id);
    // insertar con un workspace distinto al de la sesión viola la política (PF/42501)
    const code = await sqlState(() =>
      inCtx(w2, (c) =>
        c.query(`INSERT INTO planning.budget_template (id, workspace_id, name) VALUES ($1, $2, 'Intruso')`, [
          randomUUID(),
          w1,
        ]),
      ),
    );
    expect(code).toBeDefined();
    // sin contexto de workspace no se ve nada (fail-closed)
    const none = await sqlState(() => inCtx(null, (c) => c.query(`SELECT * FROM planning.budget_template`)));
    expect(none).toBeDefined();
  });

  it('un plan y su línea referencian la versión y la línea del template (FKs) y listByTemplate los encuentra', async () => {
    const t = newTemplate(w1, 'Con planes');
    await asUser(() => uow.run(w1, () => templates.insert(t)));
    const version = t.currentVersion;
    const templateLine = version.lines[0]!;
    const budget = Budget.create({
      id: randomUUID(),
      workspaceId: w1,
      periodId: periods[w1]!,
      currency: BOB,
      origin: 'TEMPLATE',
      templateVersionId: version.id,
      at: new Date().toISOString(),
    });
    const line = BudgetLine.create({
      id: randomUUID(),
      workspaceId: w1,
      budgetId: budget.id,
      target: templateLine.target,
      nature: 'EXPENSE',
      spec: templateLine.spec,
      source: 'TEMPLATE',
      templateLineId: templateLine.id,
    });
    await asUser(() =>
      uow.run(w1, async () => {
        // en w1 ya puede haber un plan del periodo de otro test de esta suite: se usa un periodo propio
        await budgets.insertIfAbsent(budget);
        await budgets.insertLine(line);
      }),
    );
    const found = await asUser(() => uow.run(w1, () => budgets.listByTemplate(w1, t.id)));
    expect(found.map((b) => b.id)).toEqual([budget.id]);
    const ref = await asUser(() => uow.run(w1, () => templates.versionRef(w1, version.id)));
    expect(ref).toMatchObject({ templateId: t.id, versionNo: 1, templateName: 'Con planes' });
    // la FK impide apuntar a una versión inexistente
    const code = await sqlState(() =>
      inCtx(w1, (c) =>
        c.query(`UPDATE planning.budget SET template_version_id = $1 WHERE id = $2`, [
          randomUUID(),
          budget.id,
        ]),
      ),
    );
    expect(code).toBe('23503');
  });
});
