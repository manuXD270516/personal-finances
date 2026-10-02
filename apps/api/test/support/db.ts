import { Client } from 'pg';

/** Código SQLSTATE del error lanzado por `fn` (p. ej. 42501 = insufficient_privilege, PF002 = sin contexto). */
export async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** URL de conexión con otras credenciales (mismo host/base). */
export function withRole(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

/** Ejecuta `fn` en una transacción con contexto RLS LOCAL; siempre ROLLBACK salvo `commit: true`. */
export async function inTx<T>(
  client: Client,
  ctx: { userId?: string | null; workspaceId?: string | null },
  fn: () => Promise<T>,
  commit = false,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
      [ctx.userId ?? '', ctx.workspaceId ?? ''],
    );
    const result = await fn();
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Chequeo de catálogo RLS (TC-SECURITY-RLS-004, ADR-0023): toda tabla de un schema de negocio (todos salvo los de
 * sistema, `platform`, `pgboss` y `public`) y toda tabla con columna `workspace_id` en cualquier schema debe tener
 * RLS habilitada y FORZADA y al menos una política, salvo la allowlist explícita. Devuelve las tablas que fallan.
 */
export const RLS_ALLOWLIST = ['iam.user', 'iam.bff_session', 'fx.currency', 'platform.inbox'] as const;

export async function rlsCatalogViolations(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT n.nspname || '.' || c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
        AND (n.nspname NOT IN ('platform', 'public')
             OR EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped))
        AND NOT (n.nspname || '.' || c.relname = ANY ($1::text[]))
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                 AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
      ORDER BY 1`,
    [RLS_ALLOWLIST],
  );
  return rows.map((r) => r.name);
}
