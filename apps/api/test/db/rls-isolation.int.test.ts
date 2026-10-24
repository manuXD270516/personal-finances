import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { ESLint } from 'eslint';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, inTx, rlsCatalogViolations, sqlState, withRole } from '../support/db.js';
import { cleanupSeededWorkspaces, seedLedgerWorkspace } from '../support/rls-ledger-seed.js';

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

/**
 * Aislamiento cruzado y fail-closed de las políticas vigentes (openspec optimize-rls-policy-overhead, D287/D294-D296;
 * sin migración por D298, docs/49): TC-SECURITY-RLS-006 (lectura y escritura cruzadas W1/W2) y 007 (matriz sin
 * contexto tabla por tabla).
 */
describe('Políticas de aislamiento vigentes: aislamiento cruzado y fail-closed (TC-SECURITY-RLS-006, 007)', () => {
  let su: Client;
  let app: Client;
  const w1 = randomUUID();
  const w2 = randomUUID();
  let w2Account = '';

  beforeAll(async () => {
    su = await connect(deps.superuserUrl);
    app = await connect(deps.databaseUrl);
    // W1 «Personal Demo» y W2 «Other Demo» con cuentas, asientos, postings y snapshots; W2 con la cuenta «W2 Bank»
    // de 5000.00 BOB (nombres de la Minimal Seed; docs/29). Confirmados y borrados en afterAll.
    await seedLedgerWorkspace(su, {
      workspaceId: w1,
      name: 'W1 Personal Demo',
      entries: 20,
      assetAccounts: 2,
      withAccountsAndSnapshots: true,
    });
    const b = await seedLedgerWorkspace(su, {
      workspaceId: w2,
      name: 'W2 Other Demo',
      entries: 5,
      assetAccounts: 1,
      withAccountsAndSnapshots: true,
    });
    w2Account = b.assetAccountIds[0]!;
    const entry = randomUUID();
    await su.query("SET session_replication_role = 'replica'");
    try {
      await su.query(
        `UPDATE accounts.account SET name = 'W2 Bank'
          WHERE id = (SELECT source_account_id FROM ledger.ledger_account WHERE id = $1)`,
        [w2Account],
      );
      await su.query(
        `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_type, source_id, source_revision)
         VALUES ($1, $2, DATE '2026-02-01', 'STANDARD', 'RLS_W2_BANK', gen_random_uuid(), 1)`,
        [entry, w2],
      );
      await su.query(
        `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency, amount)
         VALUES (gen_random_uuid(), $1, $2, DATE '2026-02-01', 1, $3, 'ASSET', 'BOB', 5000.00),
                (gen_random_uuid(), $1, $2, DATE '2026-02-01', 2, $4, 'EQUITY', 'BOB', -5000.00)`,
        [w2, entry, w2Account, b.equityAccountId],
      );
    } finally {
      await su.query("SET session_replication_role = 'origin'");
    }
  }, 120_000);

  afterAll(async () => {
    try {
      if (su) await cleanupSeededWorkspaces(su, [w1, w2]);
    } finally {
      await app?.end();
      await su?.end();
    }
  }, 120_000);

  it('[TC-SECURITY-RLS-006] con el contexto de W1 las lecturas sin filtro de cuentas, asientos, postings y saldos no traen filas de W2 y las inserciones hacia W2 fallan', async () => {
    const ctx = { workspaceId: w1 };
    const tables = [
      ['accounts.account', 'workspace_id'],
      ['ledger.ledger_account', 'workspace_id'],
      ['ledger.journal_entry', 'workspace_id'],
      ['ledger.posting', 'workspace_id'],
      ['ledger.balance_snapshot', 'workspace_id'],
    ] as const;
    for (const [table, col] of tables) {
      const seen = await inTx(app, ctx, async () =>
        (await app.query<{ ws: string }>(`SELECT ${col}::text AS ws FROM ${table}`)).rows.map((r) => r.ws),
      );
      expect(seen.length, table).toBeGreaterThan(0);
      expect(new Set(seen), table).toEqual(new Set([w1]));
    }
    // La cuenta «W2 Bank» (5000.00 BOB) de W2 no aparece en ninguna lectura de W1.
    const names = await inTx(app, ctx, async () =>
      (await app.query<{ name: string }>('SELECT name FROM accounts.account')).rows.map((r) => r.name),
    );
    expect(names).not.toContain('W2 Bank');
    const leaked = await inTx(app, ctx, async () => ({
      accounts: (await app.query('SELECT 1 FROM ledger.ledger_account WHERE id = $1', [w2Account])).rowCount,
      postings: (await app.query('SELECT 1 FROM ledger.posting WHERE ledger_account_id = $1', [w2Account]))
        .rowCount,
      snapshots: (
        await app.query('SELECT 1 FROM ledger.balance_snapshot WHERE ledger_account_id = $1', [w2Account])
      ).rowCount,
      fiveThousand: (await app.query('SELECT 1 FROM ledger.posting WHERE amount = 5000')).rowCount,
    }));
    expect(leaked).toEqual({ accounts: 0, postings: 0, snapshots: 0, fiveThousand: 0 });

    // Escrituras cruzadas hacia W2: la política las rechaza (WITH CHECK, 42501).
    const crossInserts: [string, string, unknown[]][] = [
      [
        'ledger.ledger_account',
        `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
         VALUES (gen_random_uuid(), $1, 'ASSET', 'BOB', NULL, gen_random_uuid(), 'CRUZADA')`,
        [w2],
      ],
      [
        'ledger.journal_entry',
        `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_type, source_id, source_revision)
         VALUES (gen_random_uuid(), $1, DATE '2026-02-01', 'STANDARD', 'RLS_CRUZADA', gen_random_uuid(), 1)`,
        [w2],
      ],
      [
        'ledger.posting',
        `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id, account_type, currency, amount)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), DATE '2026-02-01', 1, $2, 'ASSET', 'BOB', 1)`,
        [w2, w2Account],
      ],
      [
        'ledger.period_lock',
        `INSERT INTO ledger.period_lock (workspace_id, year_month) VALUES ($1, '2026-02')`,
        [w2],
      ],
      [
        'accounts.account',
        `INSERT INTO accounts.account (id, workspace_id, name, type, classification, currency, liquidity)
         VALUES (gen_random_uuid(), $1, 'Cruzada', 'BANK', 'ASSET', 'BOB', 'LIQUID')`,
        [w2],
      ],
    ];
    for (const [table, sql, values] of crossInserts) {
      expect(await sqlState(() => inTx(app, ctx, () => app.query(sql, values))), table).toBe('42501');
    }
    // Control positivo: la inserción de W1 con su propio contexto sí pasa (WITH CHECK satisfecho).
    const own = await inTx(app, ctx, () =>
      app.query(
        `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
         VALUES (gen_random_uuid(), $1, 'ASSET', 'BOB', NULL, gen_random_uuid(), 'PROPIA')`,
        [w1],
      ),
    );
    expect(own.rowCount).toBe(1);
  }, 60_000);

  /** Resultado de una operación: `ERROR <sqlstate>`, `VACIO` o `FILAS`. */
  type Outcome = string;
  const outcomeOf = async (sql: string, values: readonly unknown[] = []): Promise<Outcome> => {
    await su.query('SAVEPOINT op');
    try {
      const r = await su.query(sql, [...values]);
      await su.query('RELEASE SAVEPOINT op');
      return (r.rowCount ?? 0) === 0 ? 'VACIO' : 'FILAS';
    } catch (err) {
      await su.query('ROLLBACK TO SAVEPOINT op');
      return `ERROR ${(err as { code?: string }).code ?? 'sin-código'}`;
    }
  };

  /**
   * Para cada tabla registrada y operación (lectura filtrada, lectura sin filtro, inserción) ejecuta, como `pf_app` y
   * SIN contexto de workspace, dentro de una transacción que se revierte. Devuelve `tabla|operación -> resultado`.
   */
  async function failClosedMatrix(
    tables: readonly { schema: string; table: string; column: string | null }[],
  ): Promise<Map<string, Outcome>> {
    const out = new Map<string, Outcome>();
    await su.query('BEGIN');
    try {
      await su.query('SET LOCAL ROLE pf_app');
      await su.query(`SELECT set_config('app.workspace_id', '', true), set_config('app.user_id', '', true)`);
      for (const t of tables) {
        const qualified = `${su.escapeIdentifier(t.schema)}.${su.escapeIdentifier(t.table)}`;
        const key = `${t.schema}.${t.table}`;
        if (t.column !== null) {
          out.set(
            `${key}|lectura filtrada`,
            await outcomeOf(
              `SELECT 1 FROM ${qualified} WHERE ${su.escapeIdentifier(t.column)} = $1 LIMIT 1`,
              [w1],
            ),
          );
        }
        out.set(`${key}|lectura sin filtro`, await outcomeOf(`SELECT 1 FROM ${qualified} LIMIT 1`));
        out.set(`${key}|inserción`, await outcomeOf(`INSERT INTO ${qualified} DEFAULT VALUES`));
      }
    } finally {
      await su.query('ROLLBACK');
    }
    return out;
  }

  it('[TC-SECURITY-RLS-007] sin contexto ninguna tabla registrada devuelve filas y cada vacío sin PF002 queda listado como hallazgo', async () => {
    const { rows: registry } = await su.query<{ schema: string; table: string; column: string | null }>(
      `SELECT w.schema_name AS schema, w.table_name AS "table",
              CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                                 WHERE a.attrelid = format('%I.%I', w.schema_name, w.table_name)::regclass
                                   AND a.attname = 'workspace_id' AND NOT a.attisdropped) THEN 'workspace_id'
                   WHEN w.schema_name = 'iam' AND w.table_name = 'workspace' THEN 'id' END AS "column"
         FROM platform.workspace_scoped_table w ORDER BY w.purge_order, w.schema_name, w.table_name`,
    );
    expect(registry.length).toBeGreaterThan(10);

    const matrix = await failClosedMatrix(registry);
    const histogram = new Map<string, number>();
    const findings: string[] = [];
    const withRows: string[] = [];
    for (const [key, result] of matrix) {
      histogram.set(result, (histogram.get(result) ?? 0) + 1);
      // Hallazgo (D296): la política vigente devuelve vacío sin lanzar PF002 sin contexto.
      if (result === 'VACIO') findings.push(`${key}: ${result}`);
      if (result === 'FILAS') withRows.push(key);
    }
    console.log(
      [
        '==== RLS-FAIL-CLOSED-MATRIX (TC-SECURITY-RLS-007) ====',
        `tablas registradas: ${registry.length}; operaciones: ${matrix.size}`,
        `resultados: ${[...histogram].map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `HALLAZGOS (vacío sin PF002 sin contexto; se registran, no se corrigen aquí, D296): ${findings.length}`,
        ...findings.map((f) => `  RLS-FAIL-CLOSED-FINDING ${f}`),
        '==== FIN RLS-FAIL-CLOSED-MATRIX ====',
      ].join('\n'),
    );
    expect(withRows, 'operaciones sin contexto que devuelven filas de negocio').toEqual([]);
  }, 120_000);
});
