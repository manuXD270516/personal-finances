import { readdirSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../src/migrate/dbmate.js';

const deps = inject('deps');

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Código SQLSTATE del error lanzado por `fn` (p. ej. 42501 = insufficient_privilege). */
async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('migración de bootstrap: roles pf_migrator / pf_app (tarea 4.5, ARCHITECTURE §9)', () => {
  let migrator: Client;
  let app: Client;

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    // Tabla con RLS creada por el propietario (como hará cada bounded context): pf_app no es owner.
    await migrator.query(`
      CREATE TABLE platform.rls_probe (workspace_id text NOT NULL, amount int NOT NULL);
      ALTER TABLE platform.rls_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY workspace_isolation ON platform.rls_probe
        USING (workspace_id = current_setting('app.workspace_id', true));
      INSERT INTO platform.rls_probe VALUES ('ws-a', 1), ('ws-b', 2);
    `);
  });

  afterAll(async () => {
    await migrator?.query('DROP TABLE IF EXISTS platform.rls_probe');
    await app?.end();
    await migrator?.end();
  });

  it('todas las migraciones del repositorio figuran como aplicadas', async () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0]);
    const { rows } = await migrator.query<{ version: string }>(
      'SELECT version FROM public.schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual(files.sort());
    expect(files.length).toBeGreaterThan(0);
  });

  it('pf_app no es superusuario ni tiene BYPASSRLS, CREATEDB ni CREATEROLE', async () => {
    const { rows } = await migrator.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
         FROM pg_roles WHERE rolname = 'pf_app'`,
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
      },
    ]);
  });

  it('pf_app no puede ejecutar DDL (crear, alterar, borrar ni truncar)', async () => {
    expect(await sqlState(() => app.query('CREATE TABLE platform.ddl_probe (id int)'))).toBe('42501');
    expect(await sqlState(() => app.query('CREATE TABLE public.ddl_probe (id int)'))).toBe('42501');
    expect(await sqlState(() => app.query('CREATE SCHEMA ddl_probe'))).toBe('42501');
    expect(await sqlState(() => app.query('ALTER TABLE platform.seed_run ADD COLUMN x int'))).toBe('42501');
    expect(await sqlState(() => app.query('DROP TABLE platform.seed_run'))).toBe('42501');
    expect(await sqlState(() => app.query('TRUNCATE platform.seed_run'))).toBe('42501');
    expect(await sqlState(() => app.query('CREATE TABLE pgboss.ddl_probe (id int)'))).toBe('42501');
  });

  it('pf_app no puede saltarse RLS: solo ve su workspace, no puede desactivarla ni escribir fuera de él', async () => {
    await app.query(`SELECT set_config('app.workspace_id', 'ws-a', false)`);
    const visible = await app.query('SELECT workspace_id, amount FROM platform.rls_probe');
    expect(visible.rows).toEqual([{ workspace_id: 'ws-a', amount: 1 }]);

    // Sin contexto de workspace no ve nada.
    await app.query(`SELECT set_config('app.workspace_id', '', false)`);
    expect((await app.query('SELECT * FROM platform.rls_probe')).rowCount).toBe(0);

    // row_security=off no es un bypass: falla en vez de devolver todas las filas.
    await app.query('SET row_security = off');
    expect(await sqlState(() => app.query('SELECT * FROM platform.rls_probe'))).toBe('42501');
    await app.query('SET row_security = on');

    expect(await sqlState(() => app.query('ALTER TABLE platform.rls_probe DISABLE ROW LEVEL SECURITY'))).toBe(
      '42501',
    );
    expect(await sqlState(() => app.query('DROP POLICY workspace_isolation ON platform.rls_probe'))).toBe(
      '42501',
    );

    await app.query(`SELECT set_config('app.workspace_id', 'ws-a', false)`);
    expect(await sqlState(() => app.query(`INSERT INTO platform.rls_probe VALUES ('ws-b', 99)`))).toBe(
      '42501',
    );
  });

  it('pf_app sí puede usar la cola (pg-boss instalado por migrate) y escribir en platform', async () => {
    const { rows } = await app.query<{ n: string }>('SELECT count(*)::text AS n FROM pgboss.queue');
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
    await app.query(
      `INSERT INTO platform.diagnostic_probe (key, job_id) VALUES ('roles-test', 'n/a') ON CONFLICT DO NOTHING`,
    );
  });
});
