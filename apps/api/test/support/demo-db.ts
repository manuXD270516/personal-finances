import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { inTx } from './db.js';

/**
 * Chequeo de catálogo de la purga demo (ADR-0026, TC-SECURITY-RLS-004 ampliado, tarea 4.3): toda tabla con columna
 * `workspace_id` (salvo particiones, que se purgan por su padre) debe figurar en `platform.workspace_scoped_table`;
 * toda tabla registrada debe existir; y el orden de purga debe borrar hijas antes que padres (FKs entre tablas
 * registradas con `DELETE`). Devuelve las violaciones (vacío = OK).
 */
export async function demoPurgeCatalogViolations(client: Client): Promise<string[]> {
  const unregistered = await client.query<{ name: string }>(
    `SELECT n.nspname || '.' || c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped)
        AND NOT EXISTS (SELECT 1 FROM platform.workspace_scoped_table t
                         WHERE t.schema_name = n.nspname AND t.table_name = c.relname)
      ORDER BY 1`,
  );
  const missing = await client.query<{ name: string }>(
    `SELECT t.schema_name || '.' || t.table_name AS name FROM platform.workspace_scoped_table t
      WHERE to_regclass(format('%I.%I', t.schema_name, t.table_name)) IS NULL ORDER BY 1`,
  );
  const order = await client.query<{ name: string }>(
    `SELECT DISTINCT ch.schema_name || '.' || ch.table_name || ' -> ' || pa.schema_name || '.' || pa.table_name AS name
       FROM pg_constraint k
       JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = cc.relnamespace
       JOIN pg_class pc ON pc.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
       JOIN platform.workspace_scoped_table ch ON ch.schema_name = cn.nspname AND ch.table_name = cc.relname
       JOIN platform.workspace_scoped_table pa ON pa.schema_name = pn.nspname AND pa.table_name = pc.relname
      WHERE k.contype = 'f' AND k.conrelid <> k.confrelid
        AND ch.purge_action = 'DELETE' AND pa.purge_action = 'DELETE' AND ch.purge_order >= pa.purge_order
      ORDER BY 1`,
  );
  return [
    ...unregistered.rows.map((r) => `sin registrar: ${r.name}`),
    ...missing.rows.map((r) => `registrada y no existe: ${r.name}`),
    ...order.rows.map((r) => `orden de purga: ${r.name}`),
  ];
}

/** Tablas registradas para borrar en la purga. */
export async function purgeTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT schema_name || '.' || table_name AS name FROM platform.workspace_scoped_table
      WHERE purge_action = 'DELETE' ORDER BY purge_order, 1`,
  );
  return rows.map((r) => r.name);
}

/**
 * Filas por tabla registrada para un workspace, leídas por el dueño (`pf_migrator`) con la GUC de purga apuntando a
 * ese workspace (las políticas `demo_purge_read` son de solo lectura y se acotan a la GUC). Siempre ROLLBACK.
 */
export async function rowsByTable(migrator: Client, workspaceId: string): Promise<Record<string, number>> {
  const tables = await purgeTables(migrator);
  await migrator.query('BEGIN');
  try {
    await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [workspaceId]);
    const out: Record<string, number> = {};
    for (const t of tables) {
      const { rows } = await migrator.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${t} WHERE workspace_id = $1`,
        [workspaceId],
      );
      out[t] = rows[0]?.n ?? 0;
    }
    return out;
  } finally {
    await migrator.query('ROLLBACK');
  }
}

/** Σ postings por (asiento, moneda) distinto de cero en un workspace (INV-004); vacío = ledger cuadrado. */
export async function unbalancedEntries(migrator: Client, workspaceId: string): Promise<string[]> {
  await migrator.query('BEGIN');
  try {
    await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [workspaceId]);
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT journal_entry_id::text || ':' || currency AS id FROM ledger.posting WHERE workspace_id = $1
        GROUP BY journal_entry_id, currency HAVING sum(amount) <> 0`,
      [workspaceId],
    );
    return rows.map((r) => r.id);
  } finally {
    await migrator.query('ROLLBACK');
  }
}

export async function provisionUser(migrator: Client, label: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/demo', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
  );
  return rows[0]!.id;
}

/** Workspace (real o demo) creado con el rol de la app bajo RLS, con su OWNER. */
export async function createWorkspaceRow(
  app: Client,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly demoOf?: string;
  },
): Promise<void> {
  await inTx(
    app,
    { userId: input.owner, workspaceId: input.id },
    async () => {
      if (input.demoOf) {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, is_demo, demo_status,
                                      demo_origin_workspace_id, demo_requested_by, demo_dataset_version)
           VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO', true, 'LOADING', $3, $4, '1')`,
          [input.id, input.name, input.demoOf, input.owner],
        );
        await app.query(
          `INSERT INTO platform.demo_workspace_run (workspace_id, origin_workspace_id, requested_by, dataset_version,
                                                    anchor_date, requested_at)
           VALUES ($1, $2, $3, '1', '2026-09-30', now())`,
          [input.id, input.demoOf, input.owner],
        );
      } else {
        await app.query(
          `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale)
           VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
          [input.id, input.name],
        );
      }
      await app.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [input.id, input.owner],
      );
    },
    true,
  );
}

/**
 * Datos de negocio mínimos con el rol de la app (bajo RLS): cuenta contable + asiento de apertura balanceado
 * (`amount` / −`amount` BOB), una fila de auditoría, un evento en el outbox y una clave de idempotencia.
 */
export async function seedBusinessRows(
  app: Client,
  ctx: { readonly userId: string; readonly workspaceId: string },
  amount: string,
): Promise<void> {
  const asset = randomUUID();
  const equity = randomUUID();
  const entry = randomUUID();
  await inTx(
    app,
    ctx,
    async () => {
      await app.query(
        `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, source_account_id, code)
         VALUES ($1, $2, 'ASSET', 'BOB', $3, $4)`,
        [asset, ctx.workspaceId, randomUUID(), `ASSET:${asset}`],
      );
      await app.query(
        `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, code)
         VALUES ($1, $2, 'EQUITY', 'BOB', 'OPENING_BALANCE', 'EQUITY:OPENING_BALANCE:BOB')
         ON CONFLICT DO NOTHING`,
        [equity, ctx.workspaceId],
      );
      const { rows } = await app.query<{ id: string }>(
        `SELECT id::text FROM ledger.ledger_account
          WHERE workspace_id = $1 AND system_kind = 'OPENING_BALANCE' AND currency = 'BOB'`,
        [ctx.workspaceId],
      );
      const equityId = rows[0]!.id;
      await app.query(
        `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_type, source_id,
                                           source_revision)
         VALUES ($1, $2, '2026-09-01', 'OPENING', 'Transaction', $3, 1)`,
        [entry, ctx.workspaceId, randomUUID()],
      );
      await app.query(
        `INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id,
                                     account_type, currency, amount)
         VALUES ($1, $2, $3, '2026-09-01', 1, $4, 'ASSET', 'BOB', $6::numeric),
                ($5, $2, $3, '2026-09-01', 2, $7, 'EQUITY', 'BOB', -$6::numeric)`,
        [randomUUID(), ctx.workspaceId, entry, asset, randomUUID(), amount, equityId],
      );
      await app.query(
        `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action, aggregate_type,
                                      aggregate_id, origin, correlation_id)
         VALUES ($1, now(), $2, 'USER', $3, 'ledger.journal_entry.posted', 'JournalEntry', $4, 'api', $5)`,
        [randomUUID(), ctx.workspaceId, ctx.userId, entry, randomUUID()],
      );
      await app.query(
        `INSERT INTO platform.outbox (id, workspace_id, event_type, event_version, aggregate_type, aggregate_id,
                                      aggregate_version, occurred_at, correlation_id, envelope)
         VALUES ($1, $2, 'ledger.JournalEntryPosted', 1, 'JournalEntry', $3, 1, now(), $4, '{}'::jsonb)`,
        [randomUUID(), ctx.workspaceId, entry, randomUUID()],
      );
      await app.query(
        `INSERT INTO platform.idempotency_key (scope_id, key, workspace_id, user_id, method, route, request_hash,
                                               status, response_status, created_at, expires_at)
         VALUES ($1, $2, $1, $3, 'POST', '/r', $4, 'COMPLETED', 201, now(), now() + interval '24 hours')`,
        [ctx.workspaceId, `K-demo-${randomUUID()}`, ctx.userId, Buffer.alloc(32, 7)],
      );
    },
    true,
  );
}
