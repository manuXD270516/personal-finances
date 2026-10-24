import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

/**
 * Datos de ledger para los experimentos y pruebas de plan de RLS (change `optimize-rls-policy-overhead`).
 *
 * Se siembran CONFIRMADOS (los planes con `Index Only Scan` y `Heap Fetches: 0` exigen filas visibles para todos y
 * un `VACUUM`, que no corre dentro de una transacción) con un superusuario y `session_replication_role = replica`
 * (sin triggers ni FK: los datos se construyen coherentes y balanceados), y se BORRAN al terminar con
 * `cleanupSeededWorkspaces` (el ledger es inmutable por triggers, que `replica` también omite). Cada corrida usa
 * ids nuevos, así que nunca chocan con los datos de otros archivos.
 */
export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly name: string;
  readonly assetAccountIds: readonly string[];
  readonly equityAccountId: string;
  /** Postings sembrados (2 por asiento). */
  readonly postings: number;
}

export interface SeedOptions {
  readonly name: string;
  /** Asientos (cada uno con 2 postings: un activo y la cuenta de patrimonio de apertura). */
  readonly entries: number;
  readonly assetAccounts: number;
  /** Crea también `accounts.account` (una por cuenta del ledger de usuario) y `ledger.balance_snapshot`. */
  readonly withAccountsAndSnapshots?: boolean;
  readonly workspaceId?: string;
}

const lit = (c: Client, v: string): string => c.escapeLiteral(v);

/** Siembra un workspace con ledger. `su` debe ser un cliente superusuario fuera de transacción. */
export async function seedLedgerWorkspace(su: Client, opts: SeedOptions): Promise<SeededWorkspace> {
  const ws = opts.workspaceId ?? randomUUID();
  const W = lit(su, ws);
  let assetAccountIds: string[];
  let equityAccountId: string;
  await su.query("SET session_replication_role = 'replica'");
  try {
    await su.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale)
       VALUES (${W}, ${lit(su, opts.name)}, 'BOB', 'America/La_Paz', 'es-BO')`,
    );
    const assets = await su.query<{ id: string }>(
      `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
       SELECT gen_random_uuid(), ${W}, 'ASSET', 'BOB', NULL, gen_random_uuid(), 'ASSET-' || lpad(g::text, 3, '0')
         FROM generate_series(1, ${Math.trunc(opts.assetAccounts)}) AS g
       RETURNING id::text AS id`,
    );
    const equity = await su.query<{ id: string }>(
      `INSERT INTO ledger.ledger_account (id, workspace_id, type, currency, system_kind, source_account_id, code)
       VALUES (gen_random_uuid(), ${W}, 'EQUITY', 'BOB', 'OPENING_BALANCE', NULL, 'EQUITY-OPENING-BOB')
       RETURNING id::text AS id`,
    );
    assetAccountIds = assets.rows.map((r) => r.id);
    equityAccountId = equity.rows[0]!.id;
    if (opts.withAccountsAndSnapshots) {
      await su.query(
        `INSERT INTO accounts.account (id, workspace_id, name, type, classification, currency, liquidity)
         SELECT a.source_account_id, a.workspace_id, 'Cuenta ' || a.code, 'BANK', 'ASSET', 'BOB', 'LIQUID'
           FROM ledger.ledger_account a WHERE a.workspace_id = ${W} AND a.source_account_id IS NOT NULL`,
      );
    }
    await su.query(
      `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_type, source_id, source_revision)
       SELECT gen_random_uuid(), ${W}, DATE '2026-01-01' + (g % 270), 'STANDARD', 'RLS_EXPERIMENT', gen_random_uuid(), 1
         FROM generate_series(1, ${Math.trunc(opts.entries)}) AS g`,
    );
    await su.query(
      `WITH a AS (SELECT array_agg(id ORDER BY code) AS ids FROM ledger.ledger_account
                   WHERE workspace_id = ${W} AND type = 'ASSET'),
            q AS (SELECT id FROM ledger.ledger_account WHERE workspace_id = ${W} AND type = 'EQUITY')
       INSERT INTO ledger.posting (id, workspace_id, journal_entry_id, entry_date, line_no, ledger_account_id,
                                   account_type, currency, amount)
       SELECT gen_random_uuid(), e.workspace_id, e.id, e.entry_date, l.n::smallint,
              CASE l.n WHEN 1 THEN a.ids[1 + (e.sequence % cardinality(a.ids))::int] ELSE q.id END,
              CASE l.n WHEN 1 THEN 'ASSET' ELSE 'EQUITY' END, 'BOB',
              (CASE l.n WHEN 1 THEN 1 ELSE -1 END) * (((e.sequence % 97) + 1)::numeric / 100)
         FROM ledger.journal_entry e
        CROSS JOIN (VALUES (1), (2)) AS l(n) CROSS JOIN a CROSS JOIN q
        WHERE e.workspace_id = ${W}`,
    );
    if (opts.withAccountsAndSnapshots) {
      await su.query(
        `INSERT INTO ledger.balance_snapshot (workspace_id, ledger_account_id, as_of_date, currency, balance, last_sequence)
         SELECT p.workspace_id, p.ledger_account_id, DATE '2026-06-30', 'BOB', sum(p.amount) FILTER (WHERE p.entry_date <= DATE '2026-06-30') ,
                (SELECT max(sequence) FROM ledger.journal_entry WHERE workspace_id = ${W})
           FROM ledger.posting p WHERE p.workspace_id = ${W}
          GROUP BY p.workspace_id, p.ledger_account_id
         HAVING sum(p.amount) FILTER (WHERE p.entry_date <= DATE '2026-06-30') IS NOT NULL`,
      );
    }
  } finally {
    await su.query("SET session_replication_role = 'origin'");
  }
  return {
    workspaceId: ws,
    name: opts.name,
    assetAccountIds,
    equityAccountId,
    postings: Math.trunc(opts.entries) * 2,
  };
}

/** `VACUUM (ANALYZE)` de las tablas del ledger sembradas (visibilidad para `Index Only Scan` y estadísticas). */
export async function vacuumAnalyzeLedger(su: Client): Promise<void> {
  await su.query(
    'VACUUM (ANALYZE) ledger.posting, ledger.journal_entry, ledger.ledger_account, ledger.balance_snapshot',
  );
}

/**
 * Borra todo lo sembrado para los workspaces dados (superusuario con `replica`: el ledger es inmutable por
 * triggers) y comprueba que no queda ninguna fila. Lanza si queda algo.
 */
export async function cleanupSeededWorkspaces(su: Client, workspaceIds: readonly string[]): Promise<void> {
  if (workspaceIds.length === 0) return;
  await su.query("SET session_replication_role = 'replica'");
  try {
    for (const table of [
      'ledger.posting',
      'ledger.balance_snapshot',
      'ledger.entry_reversal',
      'ledger.journal_entry',
      'ledger.ledger_account',
      'accounts.account',
    ]) {
      await su.query(`DELETE FROM ${table} WHERE workspace_id = ANY ($1::uuid[])`, [workspaceIds]);
    }
    await su.query('DELETE FROM iam.workspace WHERE id = ANY ($1::uuid[])', [workspaceIds]);
  } finally {
    await su.query("SET session_replication_role = 'origin'");
  }
  const { rows } = await su.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM ledger.posting WHERE workspace_id = ANY ($1::uuid[]))
          + (SELECT count(*) FROM ledger.journal_entry WHERE workspace_id = ANY ($1::uuid[]))
          + (SELECT count(*) FROM ledger.ledger_account WHERE workspace_id = ANY ($1::uuid[]))
          + (SELECT count(*) FROM ledger.balance_snapshot WHERE workspace_id = ANY ($1::uuid[]))
          + (SELECT count(*) FROM accounts.account WHERE workspace_id = ANY ($1::uuid[]))
          + (SELECT count(*) FROM iam.workspace WHERE id = ANY ($1::uuid[])) AS n`,
    [workspaceIds],
  );
  if (Number(rows[0]!.n) !== 0) throw new Error(`cleanupSeededWorkspaces: quedaron ${rows[0]!.n} filas`);
}
