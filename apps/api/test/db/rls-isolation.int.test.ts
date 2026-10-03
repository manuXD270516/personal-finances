import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { ESLint } from 'eslint';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx, rlsCatalogViolations, sqlState, withRole } from '../support/db.js';

const deps = inject('deps');
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Suite de aislamiento por workspace (security/access-control, ADR-0023). Las tablas de negocio de changes
 * posteriores (accounts, ledger, txn, classification) se agregan a `WS_TABLES` cuando existan. `audit.audit_log` es
 * append-only (sin UPDATE para pf_app): su aislamiento lo cubre TC-AUDIT-ISOLATION-001 y el chequeo de catálogo de
 * TC-SECURITY-RLS-004 incluye la tabla y sus particiones.
 */
const WS_TABLES = ['platform.idempotency_key', 'iam.workspace', 'iam.workspace_membership'] as const;

describe('RLS por workspace (security/access-control)', () => {
  let migrator: Client;
  let app: Client;
  let owner: string;
  let outsider: string;
  const w1 = randomUUID();
  const w2 = randomUUID();

  async function provision(label: string): Promise<string> {
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/rls', $1, $2, $3) AS id`,
      [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
    );
    return rows[0]?.id as string;
  }

  async function createWorkspace(userId: string, wsId: string, name: string): Promise<void> {
    await inTx(
      app,
      { userId, workspaceId: wsId },
      async () => {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
          [wsId, name],
        );
        await app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [wsId, userId],
        );
        await app.query(
          `INSERT INTO platform.idempotency_key (scope_id, key, workspace_id, user_id, method, route, request_hash, status,
                                                 response_status, created_at, expires_at)
           VALUES ($1, $2, $1, $3, 'POST', '/r', $4, 'COMPLETED', 201, now(), now() + interval '24 hours')`,
          [wsId, `K-rls-${randomBytes(8).toString('hex')}`, userId, randomBytes(32)],
        );
      },
      true,
    );
  }

  beforeAll(async () => {
    migrator = await connect(deps.migratorUrl);
    app = await connect(deps.databaseUrl);
    owner = await provision('owner');
    outsider = await provision('outsider');
    await createWorkspace(owner, w1, 'W1 Personal Demo');
    await createWorkspace(outsider, w2, 'W2 Other Demo');
  });

  afterAll(async () => {
    await app?.end();
    await migrator?.end();
  });

  const wsColumn = (table: string) => (table === 'iam.workspace' ? 'id' : 'workspace_id');

  it('[TC-SECURITY-RLS-001] con contexto W1 solo se ven filas de W1; INSERT para W2 falla y UPDATE de W2 afecta 0 filas', async () => {
    for (const table of WS_TABLES) {
      const col = wsColumn(table);
      const seen = await inTx(app, { userId: owner, workspaceId: w1 }, async () =>
        (await app.query<{ ws: string }>(`SELECT ${col}::text AS ws FROM ${table}`)).rows.map((r) => r.ws),
      );
      expect(seen.length, table).toBeGreaterThan(0);
      expect(new Set(seen), table).toEqual(new Set([w1]));

      const updated = await inTx(
        app,
        { userId: owner, workspaceId: w1 },
        async () => (await app.query(`UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1`, [w2])).rowCount,
      );
      expect(updated, table).toBe(0);
    }
    // INSERT con W2 bajo contexto W1: WITH CHECK lo rechaza.
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: w1 }, () =>
          app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'VIEWER')`,
            [w2, owner],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: w1 }, () =>
          app.query(
            `INSERT INTO platform.idempotency_key (scope_id, key, workspace_id, user_id, method, route, request_hash, status,
                                                   response_status, created_at, expires_at)
             VALUES ($1, 'K-rls-cross-workspace-0001', $1, $2, 'POST', '/r', $3, 'COMPLETED', 201, now(), now() + interval '24 hours')`,
            [w2, owner, randomBytes(32)],
          ),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner, workspaceId: w1 }, () =>
          app.query(
            `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'x', 'BOB', 'UTC', 'es-BO')`,
            [randomUUID()],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('[TC-SECURITY-RLS-002] sin contexto de workspace toda consulta y escritura falla con PF002 (también con conexión reutilizada)', async () => {
    // Conexión que antes fijó W1 con SET LOCAL: tras el COMMIT el setting queda vacío, nunca en W1.
    await inTx(app, { userId: owner, workspaceId: w1 }, () => app.query('SELECT 1'));
    for (const table of ['platform.idempotency_key', 'iam.workspace_membership', 'iam.workspace']) {
      expect(await sqlState(() => inTx(app, {}, () => app.query(`SELECT * FROM ${table}`))), table).toBe(
        'PF002',
      );
    }
    expect(await sqlState(() => app.query('SELECT * FROM iam.workspace'))).toBe('PF002');
    expect(
      await sqlState(() =>
        inTx(app, { userId: owner }, () =>
          app.query(
            `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'x', 'BOB', 'UTC', 'es-BO')`,
            [randomUUID()],
          ),
        ),
      ),
    ).toBe('PF002');
    expect(await sqlState(() => migrator.query('SELECT platform.current_workspace_id()'))).toBe('PF002');
    expect(await sqlState(() => migrator.query('SELECT platform.current_user_id()'))).toBe('PF002');
  });

  it('[TC-SECURITY-RLS-003] 200 unidades de trabajo intercaladas W1/W2 en un pool de 2 nunca mezclan datos; sin LOCAL no hay contexto', async () => {
    const pool = new Pool({ connectionString: deps.databaseUrl, max: 2 });
    const uow = new PgUnitOfWork(pool);
    try {
      const results = await Promise.all(
        Array.from({ length: 200 }, (_, i) => {
          const [userId, wsId] = i % 2 === 0 ? [owner, w1] : [outsider, w2];
          return uow.run({ userId, workspaceId: wsId }, async () => {
            const { rows } = await requireSqlExecutor().query(
              'SELECT workspace_id::text AS ws FROM platform.idempotency_key',
            );
            return { wsId, seen: (rows as { ws: string }[]).map((r) => r.ws) };
          });
        }),
      );
      for (const r of results) {
        expect(r.seen.length).toBeGreaterThan(0);
        expect(r.seen.every((ws) => ws === r.wsId)).toBe(true);
      }
      // Reutilizar una conexión del pool sin contexto: falla (PF002), no ve W1.
      const client = await pool.connect();
      try {
        expect(await sqlState(() => client.query('SELECT * FROM platform.idempotency_key'))).toBe('PF002');
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }

    // Lint de CI: un `SET app.` de sesión o set_config(..., false) en código de producción no pasa.
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [bad] = await eslint.lintText(
      "export const q = (c: { query(s: string): unknown }) => c.query(`SET app.workspace_id = 'x'`);\nexport const r = \"SELECT set_config('app.user_id', 'x', false)\";\n",
      { filePath: 'packages/platform/src/api/db/fixture-rls.ts' },
    );
    expect(bad?.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toHaveLength(2);
    const [good] = await eslint.lintText(
      "export const s = \"SELECT set_config('app.user_id', $1, true)\";\nexport const t = 'SET LOCAL app.workspace_id = $1';\n",
      { filePath: 'packages/platform/src/api/db/fixture-rls.ts' },
    );
    expect(good?.messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  });

  it('[TC-SECURITY-RLS-004] el chequeo de catálogo pasa con las migraciones y falla nombrando una tabla sin política', async () => {
    expect(await rlsCatalogViolations(migrator)).toEqual([]);
    await migrator.query('BEGIN');
    try {
      await migrator.query('CREATE SCHEMA IF NOT EXISTS rlsfixture');
      await migrator.query(
        'CREATE TABLE rlsfixture.sin_politica (id uuid PRIMARY KEY, workspace_id uuid NOT NULL)',
      );
      await migrator.query('CREATE TABLE platform.fixture_sin_force (workspace_id uuid NOT NULL)');
      await migrator.query('ALTER TABLE platform.fixture_sin_force ENABLE ROW LEVEL SECURITY');
      await migrator.query(
        'CREATE POLICY p ON platform.fixture_sin_force USING (workspace_id = platform.current_workspace_id())',
      );
      expect(await rlsCatalogViolations(migrator)).toEqual([
        'platform.fixture_sin_force',
        'rlsfixture.sin_politica',
      ]);
    } finally {
      await migrator.query('ROLLBACK');
    }
    expect(await rlsCatalogViolations(migrator)).toEqual([]);
  });

  it('[TC-SECURITY-RLS-005] pf_app, pf_worker y pf_bff no saltan RLS, no son owners, no hacen DDL y pf_bff no ve negocio', async () => {
    const { rows: roles } = await migrator.query(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('pf_app', 'pf_worker', 'pf_bff') ORDER BY 1`,
    );
    expect(roles).toEqual([
      { rolname: 'pf_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'pf_bff', rolsuper: false, rolbypassrls: false },
      { rolname: 'pf_worker', rolsuper: false, rolbypassrls: false },
    ]);
    const { rows: owners } = await migrator.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('iam', 'fx', 'platform')`,
    );
    expect(owners).toEqual([{ owner: 'pf_migrator' }]);

    // pf_worker usa la credencial que `migrate` alineó con WORKER_DATABASE_URL (la comparten los tests del outbox);
    // pf_bff, una efímera (pf_migrator tiene ADMIN sobre el rol).
    const clients: Client[] = [];
    try {
      for (const role of ['pf_worker', 'pf_bff']) {
        let url = deps.workerDatabaseUrl;
        if (role === 'pf_bff') {
          const password = randomBytes(18).toString('hex');
          await migrator.query(`ALTER ROLE ${role} PASSWORD ${migrator.escapeLiteral(password)}`);
          url = withRole(deps.databaseUrl, role, password);
        }
        const c = await connect(url);
        clients.push(c);
        expect(await sqlState(() => c.query(`CREATE TABLE platform.ddl_${role} (id int)`)), role).toBe(
          '42501',
        );
        expect(await sqlState(() => c.query('ALTER TABLE iam.workspace ADD COLUMN x int')), role).toBe(
          '42501',
        );
      }
      const [worker, bff] = clients as [Client, Client];
      // pf_worker hereda pf_app: mismas políticas (sin contexto → PF002, con W1 → solo W1).
      expect(await sqlState(() => worker.query('SELECT * FROM platform.idempotency_key'))).toBe('PF002');
      // pf_bff: sin acceso a tablas de negocio; CRUD solo sobre iam.bff_session.
      for (const table of [
        'iam.workspace',
        'iam.workspace_membership',
        'iam."user"',
        'platform.idempotency_key',
      ]) {
        expect(await sqlState(() => bff.query(`SELECT * FROM ${table}`)), table).toBe('42501');
      }
      await bff.query(
        `INSERT INTO iam.bff_session (sid_hash, kind, idle_expires_at, absolute_expires_at)
         VALUES ($1, 'PENDING_LOGIN', now() + interval '10 minutes', now() + interval '10 minutes')`,
        [randomBytes(32)],
      );
      expect((await bff.query('DELETE FROM iam.bff_session')).rowCount).toBeGreaterThan(0);
      // pf_app no tiene grants sobre las sesiones del BFF.
      expect(await sqlState(() => app.query('SELECT * FROM iam.bff_session'))).toBe('42501');
    } finally {
      await Promise.all(clients.map((c) => c.end()));
      await migrator.query('ALTER ROLE pf_bff PASSWORD NULL');
    }
  });
});
