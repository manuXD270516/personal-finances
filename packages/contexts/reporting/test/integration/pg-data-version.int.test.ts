import { randomUUID } from 'node:crypto';
import { PgUnitOfWork } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DataVersionProjector } from '../../src/application/data-version-projector.js';
import { PgDataVersionStore, PgReportingUnitOfWork } from '../../src/infrastructure/pg-reporting.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `reporting.workspace_data_version` (DRV, openspec add-basic-dashboard tarea 4.1) contra PostgreSQL real: el worker
// la incrementa con RLS del workspace; `pf_app` solo la lee y nunca ve la de otro workspace.
describe('reporting.workspace_data_version (PG real)', () => {
  let app: Pool;
  let worker: Pool;
  let migrator: Pool;
  let user: string;
  const w1 = randomUUID();
  const w2 = randomUUID();
  const store = new PgDataVersionStore();

  beforeAll(async () => {
    app = new Pool({ connectionString: deps.databaseUrl, max: 2 });
    worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/rep', $1, $2, 'rep') AS id`,
      [`sub-${randomUUID()}`, `rep-${randomUUID()}@demo.pfos.test`],
    );
    user = rows[0]!.id;
    for (const ws of [w1, w2]) {
      const client = await app.connect();
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
  });

  afterAll(async () => {
    await app?.end();
    await worker?.end();
    await migrator?.end();
  });

  const read = (ws: string) =>
    new PgReportingUnitOfWork(app).run({ userId: user, workspaceId: ws }, () => store.versionOf(ws));

  it('el proyector del worker incrementa la versión; pf_app la lee aislada por workspace y no puede escribirla', async () => {
    expect(await read(w1)).toBe('0');
    const projector = new DataVersionProjector(store);
    const bump = (ws: string) =>
      new PgUnitOfWork(worker).run({ userId: null, workspaceId: ws }, () =>
        projector.on({ eventId: randomUUID(), workspaceId: ws, occurredAt: '2026-10-03T12:00:00Z' }),
      );
    await bump(w1);
    await bump(w1);
    expect(await read(w1)).toBe('2');
    expect(await read(w2)).toBe('0');
    // Con el contexto RLS de w2, w1 es invisible.
    const foreign = await new PgReportingUnitOfWork(app).run({ userId: user, workspaceId: w2 }, () =>
      store.versionOf(w1),
    );
    expect(foreign).toBe('0');
    // pf_app no tiene INSERT/UPDATE (DRV): solo el worker escribe.
    await expect(
      new PgReportingUnitOfWork(app).run({ userId: user, workspaceId: w1 }, () =>
        store.bump(w1, '2026-10-03T12:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
