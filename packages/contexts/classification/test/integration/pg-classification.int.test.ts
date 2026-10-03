import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@pf/audit/contracts';
import { FixedClock, Instant, isDomainError } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ClassificationQueries } from '../../src/application/classification.queries.js';
import { ClassificationService } from '../../src/application/classification.service.js';
import type { CategoryArchivedEvent } from '../../src/application/ports/index.js';
import { pgClassificationDeps } from '../../src/infrastructure/pg-classification.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string };
  }
}

const deps = inject('deps');

describe('Repositorios PostgreSQL de CLASSIFICATION (tareas 5.1 y 5.2)', () => {
  let pool: Pool;
  let migrator: Pool;
  let svc: ClassificationService;
  let q: ClassificationQueries;
  const events: CategoryArchivedEvent[] = [];
  const audits: AuditEntry[] = [];
  let user: string;
  const w1 = randomUUID();
  const w2 = randomUUID();

  /** SQL como pf_app con contexto RLS (el owner tampoco ve filas: RLS FORZADA). */
  async function asApp(workspaceId: string, text: string, values: unknown[] = []) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
        [user, workspaceId],
      );
      const res = await client.query(text, values);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function sqlError(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
    try {
      await p;
    } catch (err) {
      return err as { code?: string; message: string };
    }
    throw new Error('expected an SQL error');
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: deps.databaseUrl, max: 4 });
    migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/cls', $1, $2, 'cls') AS id`,
      [`sub-${randomUUID()}`, `cls-${randomUUID()}@demo.pfos.test`],
    );
    user = rows[0]!.id;
    for (const ws of [w1, w2]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
          [user, ws],
        );
        await client.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'W', 'BOB', 'America/La_Paz', 'es-BO')`,
          [ws],
        );
        await client.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [ws, user],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
    const d = pgClassificationDeps({
      pool,
      outbox: { append: async (e) => void events.push(e) },
      audit: { append: async (a) => void audits.push(a) },
      clock: new FixedClock(Instant.parse('2026-10-03T12:00:00Z')),
    });
    svc = new ClassificationService(d);
    q = new ClassificationQueries(d);
    await svc.onWorkspaceCreated({ workspaceId: w1, userId: user, seedDefaultCategories: true });
  });

  afterAll(async () => {
    await pool?.end();
    await migrator?.end();
  });

  it('[TC-CLASSIFICATION-SEED-001] la provisión síncrona persiste 13 grupos y 78 categorías (11 de sistema) y es idempotente', async () => {
    expect(await q.listCategoryGroups(user, w1)).toHaveLength(13);
    const all = await q.listCategories(user, w1);
    expect(all).toHaveLength(78);
    expect(all.filter((c) => c.isSystem)).toHaveLength(11);
    await svc.onWorkspaceCreated({ workspaceId: w1, userId: user, seedDefaultCategories: true });
    expect(await q.listCategories(user, w1, { includeArchived: true })).toHaveLength(78);
  });

  it('[TC-CLASSIFICATION-ARCHIVE-001] archivar conserva fila, id y datos; pf_app no puede borrar (sin grant DELETE)', async () => {
    const ocio = (await q.listCategoryGroups(user, w1)).find((g) => g.name === 'Ocio')!;
    const gym = await svc.createCategory(user, w1, { groupId: ocio.id, name: 'Old Gym', color: '#6A1B9A' });
    await svc.archiveCategory(user, w1, gym.id, 1);
    const reread = await q.getCategory(user, w1, gym.id);
    expect(reread).toMatchObject({ id: gym.id, name: 'Old Gym', color: '#6A1B9A', version: 2 });
    expect(reread.archivedAt).toEqual(expect.any(String));
    expect(events.at(-1)).toMatchObject({ aggregateId: gym.id, aggregateVersion: 2 });
    const del = await sqlError(asApp(w1, 'DELETE FROM classification.category WHERE id = $1', [gym.id]));
    expect(del.code).toBe('42501');
    expect((await q.getCategory(user, w1, gym.id)).id).toBe(gym.id);
  });

  it('[TC-CLASSIFICATION-TAG-003] un tag archivado sigue existiendo con su nombre; DELETE denegado', async () => {
    const t = await svc.createTag(user, w1, { name: 'Viaje Santa Cruz 2026' });
    await svc.archiveTag(user, w1, t.id, 1);
    expect(await q.getTag(user, w1, t.id)).toMatchObject({ name: 'Viaje Santa Cruz 2026', isArchived: true });
    expect((await sqlError(asApp(w1, 'DELETE FROM classification.tag WHERE id = $1', [t.id]))).code).toBe(
      '42501',
    );
    // Unicidad solo entre activos: el nombre queda libre mientras está archivado.
    const nuevo = await svc.createTag(user, w1, { name: 'viaje santa cruz 2026' });
    expect(
      await svc.unarchiveTag(user, w1, t.id, 2).catch((e: unknown) => (isDomainError(e) ? e.code : e)),
    ).toBe('NAME_TAKEN');
    expect(nuevo.id).not.toBe(t.id);
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-003] archivar una counterparty conserva sus alias y la libera del reconocimiento', async () => {
    const entel = await svc.createCounterparty(user, w1, {
      name: 'Entel',
      kind: 'SERVICE_PROVIDER',
      aliases: ['entel sa'],
    });
    expect((await q.resolveCounterparty(user, w1, 'PAGO ENTEL SA 120.00')).counterparty?.id).toBe(entel.id);
    await svc.archiveCounterparty(user, w1, entel.id, 1);
    expect(await q.getCounterparty(user, w1, entel.id)).toMatchObject({
      aliases: ['entel sa'],
      isArchived: true,
    });
    expect((await q.resolveCounterparty(user, w1, 'PAGO ENTEL SA 120.00')).counterparty).toBeNull();
    expect(
      (await sqlError(asApp(w1, 'DELETE FROM classification.counterparty WHERE id = $1', [entel.id]))).code,
    ).toBe('42501');
    // El alias de una archivada no bloquea a una activa (índice parcial).
    await svc.createCounterparty(user, w1, { name: 'Entel Nuevo', aliases: ['entel sa'] });
  });

  it('[TC-CLASSIFICATION-ALIAS-002] el índice único de alias activos es la defensa en BD', async () => {
    await svc.createCounterparty(user, w1, { name: 'PedidosYa', aliases: ['pedidos ya'] });
    const yaigo = await svc.createCounterparty(user, w1, { name: 'Yaigo' });
    const err = await sqlError(
      asApp(
        w1,
        `INSERT INTO classification.counterparty_alias (workspace_id, counterparty_id, alias, alias_normalized)
         VALUES ($1, $2, 'Pedidos Ya', 'pedidos ya')`,
        [w1, yaigo.id],
      ),
    );
    expect(err.code).toBe('23505');
  });

  it('RLS forzada: otro workspace no ve ni escribe categorías de W1; sin contexto falla (PF002)', async () => {
    const fromW2 = await asApp(w2, 'SELECT count(*)::int AS n FROM classification.category');
    expect(fromW2.rows[0]).toEqual({ n: 0 });
    const g1 = (await q.listCategoryGroups(user, w1))[0]!;
    const insert = await sqlError(
      asApp(
        w2,
        `INSERT INTO classification.category_group (id, workspace_id, kind, name, normalized_name) VALUES ($1, $2, 'EXPENSE', 'x', 'x')`,
        [randomUUID(), w1],
      ),
    );
    expect(insert.code).toBe('42501');
    const upd = await asApp(w2, `UPDATE classification.category_group SET name = 'hack' WHERE id = $1`, [
      g1.id,
    ]);
    expect(upd.rowCount).toBe(0);
    const noCtx = await sqlError(asApp('', 'SELECT 1 FROM classification.tag'));
    expect(noCtx.code).toBe('PF002');
  });

  it('triggers de defensa: sistema no renombrable, tipo inmutable y profundidad ≤ 2 en BD', async () => {
    const fees = (await q.listCategories(user, w1)).find((c) => c.systemCode === 'FEES')!;
    const rename = await sqlError(
      asApp(w1, `UPDATE classification.category SET name = 'Cargos' WHERE id = $1`, [fees.id]),
    );
    expect(rename.message).toContain('SYSTEM_CATEGORY_IMMUTABLE');
    const sub = (await q.listCategories(user, w1)).find((c) => c.name === 'Luz')!;
    const deep = await sqlError(
      asApp(
        w1,
        `INSERT INTO classification.category (id, workspace_id, group_id, parent_id, kind, name, normalized_name)
         VALUES ($1, $2, $3, $4, 'EXPENSE', 'Luz depto', 'luz depto')`,
        [randomUUID(), w1, sub.groupId, sub.id],
      ),
    );
    expect(deep.message).toContain('CATEGORY_DEPTH_EXCEEDED');
    const kind = await sqlError(
      asApp(w1, `UPDATE classification.category SET kind = 'INCOME' WHERE id = $1`, [sub.id]),
    );
    expect(kind.message).toContain('CATEGORY_KIND_MISMATCH');
    const names = await asApp(
      w1,
      `SELECT name FROM classification.category_name_i18n WHERE system_code = 'FEES' ORDER BY locale`,
    );
    expect(names.rows.map((r) => r['name'])).toEqual(['Fees', 'Comisiones', 'Tarifas']);
  });

  it('control optimista: una versión vieja ⇒ PRECONDITION_FAILED', async () => {
    const t = await svc.createTag(user, w1, { name: `Tag ${randomUUID().slice(0, 8)}` });
    await svc.updateTag(user, w1, t.id, 1, { color: '#000000' });
    await expect(svc.updateTag(user, w1, t.id, 1, { color: '#FFFFFF' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(audits.length).toBeGreaterThan(0);
  });
});
