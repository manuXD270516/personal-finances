import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/**
 * Habilita monedas en el workspace (`fx.workspace_currency`, como `FxService.enableCurrencies`; sin endpoint en
 * Phase 1). docs/31 D45: una cuenta solo puede abrirse en una moneda habilitada (p. ej. BTC, TRX).
 */
export async function enableCurrencies(
  url: string,
  ctx: { readonly userId: string; readonly workspaceId: string },
  codes: readonly string[],
): Promise<void> {
  const client = await connect(url);
  try {
    await inTx(
      client,
      ctx,
      () =>
        client.query(
          `INSERT INTO fx.workspace_currency (workspace_id, currency_code)
           SELECT $1, code FROM unnest($2::text[]) AS code ON CONFLICT DO NOTHING`,
          [ctx.workspaceId, codes],
        ),
      true,
    );
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Forma canónica de las políticas de aislamiento (change `optimize-rls-policy-overhead`, decisión 5; TC-SECURITY-RLS-011)
// ---------------------------------------------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

/**
 * Interruptor documentado de las pruebas que describen el estado POSTERIOR a la migración de las políticas
 * (TC-SECURITY-RLS-008, 009 y 011 sobre la forma nueva). Es verdadero cuando existe en `apps/api/db/migrations/` el
 * archivo `<timestamp>_platform_rls_policy_initplan.sql` (tarea 3.1). Mientras no exista, esas pruebas se omiten con
 * `describe.skipIf`; al fusionar la migración pasan a activas sin tocar los tests. Ver tasks.md (grupo 2).
 */
export const RLS_POLICY_REWRITE_MIGRATION_PRESENT: boolean = readdirSync(MIGRATIONS_DIR).some((f) =>
  /_platform_rls_policy_initplan\.sql$/u.test(f),
);

/** Toda mención de la función de contexto en el texto de una política (forma de `pg_get_expr`). */
const CONTEXT_CALL = /(?:platform\.)?current_workspace_id\(\)/giu;

/**
 * FORMA CANÓNICA de una mención del contexto (como la devuelve `pg_get_expr`): variante V2 del experimento
 * `rls-policy-variants.int.test.ts` (change `optimize-rls-policy-overhead`, tarea 1.3), elegida porque conserva los
 * nodos y el acceso por índice del plan sin política y el fail-closed (PF002) de la política anterior:
 * `<col> = ANY (ARRAY[(SELECT platform.current_workspace_id())])`. La regex cubre solo la parte `ANY (ARRAY[…])` (el
 * `<col> =` queda fuera) y tolera el espacio tras `(` y el `AS current_workspace_id` que agrega el deparse. Es el único
 * lugar donde cambia la forma: la regla de catálogo, la prueba de equivalencia (TC-SECURITY-RLS-007) y la restauración
 * de la forma anterior se derivan de esta expresión.
 */
export const RLS_CANONICAL_CONTEXT_FORM =
  /ANY\s*\(\s*ARRAY\s*\[\s*\(\s*SELECT\s+(?:platform\.)?current_workspace_id\(\)(?:\s+AS\s+current_workspace_id)?\s*\)\s*\]\s*\)/giu;

/**
 * Predicado de ejemplo en la forma canónica, para los fixtures de las pruebas (TC-SECURITY-RLS-011/007). Debe
 * cambiar junto con `RLS_CANONICAL_CONTEXT_FORM`.
 */
export const RLS_CANONICAL_PREDICATE_EXAMPLE =
  'workspace_id = ANY (ARRAY[(SELECT platform.current_workspace_id())])';

/** Forma anterior (sin envolver) que sustituye a la canónica al reconstruir la política anterior. */
const LEGACY_CONTEXT_CALL = 'platform.current_workspace_id()';

/** Menciones del contexto que NO están en la forma canónica dentro de `expr`. */
export function nonCanonicalContextMentions(expr: string | null): number {
  if (!expr) return 0;
  const total = expr.match(CONTEXT_CALL)?.length ?? 0;
  const canonical = expr.match(RLS_CANONICAL_CONTEXT_FORM)?.length ?? 0;
  return Math.max(0, total - canonical);
}

/** Misma forma aplicada a `platform.current_user_id()` en las políticas que además comparan con el usuario. */
const CANONICAL_USER_FORM =
  /ANY\s*\(\s*ARRAY\s*\[\s*\(\s*SELECT\s+(?:platform\.)?current_user_id\(\)(?:\s+AS\s+current_user_id)?\s*\)\s*\]\s*\)/giu;

/** Convierte una expresión de política a la forma anterior (reemplaza cada mención canónica por la llamada directa). */
export function legacyContextExpr(expr: string): string {
  return expr
    .replace(RLS_CANONICAL_CONTEXT_FORM, LEGACY_CONTEXT_CALL)
    .replace(CANONICAL_USER_FORM, 'platform.current_user_id()');
}

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
}

/** Políticas de `pf_app`/`pf_worker` que mencionan `current_workspace_id` (cualquier forma). */
async function contextPolicies(client: Client): Promise<PolicyRow[]> {
  const { rows } = await client.query<PolicyRow>(
    `SELECT schemaname::text, tablename::text, policyname::text, qual, with_check
       FROM pg_policies
      WHERE roles::text[] && ARRAY['pf_app', 'pf_worker']::text[]
        AND (qual ~ 'current_workspace_id[(]' OR with_check ~ 'current_workspace_id[(]')
      ORDER BY schemaname, tablename, policyname`,
  );
  return rows;
}

/**
 * Regla de forma canónica (TC-SECURITY-RLS-011): políticas de `pf_app`/`pf_worker` cuya expresión `USING`/`WITH CHECK`
 * menciona `current_workspace_id` fuera de la forma canónica. Devuelve `esquema.tabla (política)`.
 */
export async function rlsNonCanonicalPolicies(client: Client): Promise<string[]> {
  return (await contextPolicies(client))
    .filter((p) => nonCanonicalContextMentions(p.qual) + nonCanonicalContextMentions(p.with_check) > 0)
    .map((p) => `${p.schemaname}.${p.tablename} (${p.policyname})`);
}

/**
 * Sentencias `ALTER POLICY` que devuelven a la forma anterior las políticas que hoy usan la forma canónica (vacío si
 * ninguna la usa, es decir, antes de la migración). Para ejecutarlas dentro de una transacción que se revierte
 * (TC-SECURITY-RLS-007: comparar la política nueva con la anterior).
 */
export async function legacyPolicyAlterStatements(client: Client): Promise<string[]> {
  const out: string[] = [];
  for (const p of await contextPolicies(client)) {
    const qual = p.qual === null ? null : legacyContextExpr(p.qual);
    const check = p.with_check === null ? null : legacyContextExpr(p.with_check);
    if (qual === p.qual && check === p.with_check) continue;
    const clauses = [qual === null ? '' : `USING (${qual})`, check === null ? '' : `WITH CHECK (${check})`];
    out.push(
      `ALTER POLICY ${client.escapeIdentifier(p.policyname)} ON ${client.escapeIdentifier(p.schemaname)}.${client.escapeIdentifier(p.tablename)} ${clauses.join(' ')}`,
    );
  }
  return out;
}

/** Foto del catálogo de aislamiento: registro de tablas (en orden) y políticas por tabla (TC-SECURITY-RLS-008). */
export interface RlsCatalogSnapshot {
  readonly registry: readonly { table: string; purgeOrder: number; purgeAction: string }[];
  readonly policiesByTable: Readonly<Record<string, readonly string[]>>;
  readonly rlsFlags: Readonly<Record<string, { enabled: boolean; forced: boolean }>>;
}

export async function rlsCatalogSnapshot(client: Client): Promise<RlsCatalogSnapshot> {
  const { rows: reg } = await client.query<{ t: string; o: number; a: string }>(
    `SELECT schema_name || '.' || table_name AS t, purge_order AS o, purge_action AS a
       FROM platform.workspace_scoped_table ORDER BY purge_order, schema_name, table_name`,
  );
  const { rows: pol } = await client.query<{ t: string; p: string }>(
    `SELECT schemaname || '.' || tablename AS t, policyname AS p FROM pg_policies
      WHERE roles::text[] && ARRAY['pf_app', 'pf_worker']::text[] ORDER BY 1, 2`,
  );
  const { rows: flags } = await client.query<{ t: string; e: boolean; f: boolean }>(
    `SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS e, c.relforcerowsecurity AS f
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN platform.workspace_scoped_table w ON w.schema_name = n.nspname AND w.table_name = c.relname
      ORDER BY 1`,
  );
  const policiesByTable: Record<string, string[]> = {};
  for (const r of pol) (policiesByTable[r.t] ??= []).push(r.p);
  return {
    registry: reg.map((r) => ({ table: r.t, purgeOrder: r.o, purgeAction: r.a })),
    policiesByTable,
    rlsFlags: Object.fromEntries(flags.map((r) => [r.t, { enabled: r.e, forced: r.f }])),
  };
}
