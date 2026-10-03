import type { Pool, PoolClient } from 'pg';
import type { LedgerInvariantViolation, LedgerMaintenanceRepository } from '../application/ports/index.js';

/**
 * Clave del candado consultivo por workspace que serializa `RebuildBalanceSnapshots` (exclusivo) con el registro de
 * asientos (compartido, `PgJournalEntryRepository`): al reconstruir no queda ningún asiento en vuelo, de modo que
 * `last_sequence` (máximo `sequence` visible) es un checkpoint exacto y todo asiento posterior tiene `sequence` mayor.
 */
export const SNAPSHOT_LOCK_SQL = `hashtextextended('ledger.balance_snapshot:' || $1::text, 0)`;

/**
 * Mantenimiento del ledger sobre PostgreSQL con el pool del worker (`pf_worker`), asumiendo
 * `pf_ledger_maintenance` SOLO dentro de cada transacción (`SET LOCAL ROLE`, migración 20261003190000).
 */
export class PgLedgerMaintenanceRepository implements LedgerMaintenanceRepository {
  constructor(private readonly pool: Pool) {}

  async rebuildSnapshots(input: {
    readonly asOfDate: string;
    readonly workspaceId?: string;
    readonly ledgerAccountId?: string;
  }): Promise<{ readonly workspaces: number; readonly snapshots: number }> {
    const workspaces =
      input.workspaceId !== undefined
        ? [input.workspaceId]
        : await this.tx(async (c) => {
            const { rows } = await c.query<{ workspace_id: string }>(
              `SELECT DISTINCT workspace_id FROM ledger.ledger_account ORDER BY 1`,
            );
            return rows.map((r) => r.workspace_id);
          });
    let snapshots = 0;
    for (const ws of workspaces) {
      snapshots += await this.tx(async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(${SNAPSHOT_LOCK_SQL})`, [ws]);
        await c.query(
          `DELETE FROM ledger.balance_snapshot
            WHERE workspace_id = $1 AND ($2::uuid IS NULL OR ledger_account_id = $2::uuid)`,
          [ws, input.ledgerAccountId ?? null],
        );
        const inserted = await c.query(
          `INSERT INTO ledger.balance_snapshot
             (workspace_id, ledger_account_id, as_of_date, currency, balance, last_sequence)
           SELECT a.workspace_id, a.id, $3::date, a.currency, SUM(p.amount), ms.max_seq
             FROM ledger.ledger_account a
             JOIN ledger.posting p
               ON p.workspace_id = a.workspace_id AND p.ledger_account_id = a.id AND p.entry_date <= $3::date
            CROSS JOIN (SELECT COALESCE(max(sequence), 0) AS max_seq
                          FROM ledger.journal_entry WHERE workspace_id = $1) ms
            WHERE a.workspace_id = $1 AND ($2::uuid IS NULL OR a.id = $2::uuid)
            GROUP BY a.workspace_id, a.id, a.currency, ms.max_seq`,
          [ws, input.ledgerAccountId ?? null, input.asOfDate],
        );
        return inserted.rowCount ?? 0;
      });
    }
    return { workspaces: workspaces.length, snapshots };
  }

  findViolations(): Promise<readonly LedgerInvariantViolation[]> {
    return this.tx(async (c) => {
      const violations: LedgerInvariantViolation[] = [];
      // INV-004: Σ por moneda = 0 en cada asiento.
      const unbalanced = await c.query<{ workspace_id: string; id: string; currency: string; total: string }>(
        `SELECT p.workspace_id, p.journal_entry_id AS id, p.currency, trim_scale(SUM(p.amount))::text AS total
           FROM ledger.posting p
          GROUP BY p.workspace_id, p.journal_entry_id, p.currency
         HAVING SUM(p.amount) <> 0`,
      );
      for (const r of unbalanced.rows)
        violations.push({
          invariant: 'INV-004',
          workspaceId: r.workspace_id,
          journalEntryId: r.id,
          currency: r.currency,
          difference: r.total,
          detail: 'entry does not balance per currency',
        });
      // Estructura: ≥ 2 postings por asiento.
      const few = await c.query<{ workspace_id: string; id: string; n: string }>(
        `SELECT e.workspace_id, e.id, count(p.id)::text AS n
           FROM ledger.journal_entry e LEFT JOIN ledger.posting p ON p.journal_entry_id = e.id
          GROUP BY e.workspace_id, e.id HAVING count(p.id) < 2`,
      );
      for (const r of few.rows)
        violations.push({
          invariant: 'STRUCTURE',
          workspaceId: r.workspace_id,
          journalEntryId: r.id,
          detail: `entry has ${r.n} postings (minimum 2)`,
        });
      // INV-005: ningún posting en cero.
      const zero = await c.query<{ workspace_id: string; id: string; account: string }>(
        `SELECT workspace_id, journal_entry_id AS id, ledger_account_id AS account
           FROM ledger.posting WHERE amount = 0`,
      );
      for (const r of zero.rows)
        violations.push({
          invariant: 'INV-005',
          workspaceId: r.workspace_id,
          journalEntryId: r.id,
          ledgerAccountId: r.account,
          detail: 'zero-amount posting',
        });
      // INV-022: snapshot = Σ postings hasta su fecha. Los snapshots ya invalidados por un asiento retroactivo
      // posterior (`sequence > last_sequence`) no son corrupción: la lectura los descarta y el job los reconstruye.
      const snapshots = await c.query<{
        workspace_id: string;
        account: string;
        as_of: string;
        currency: string;
        diff: string;
      }>(
        `SELECT s.workspace_id, s.ledger_account_id AS account, s.as_of_date::text AS as_of, s.currency,
                round(s.balance - COALESCE(t.total, 0), c.scale)::text AS diff
           FROM ledger.balance_snapshot s
           JOIN fx.currency c ON c.code = s.currency
           LEFT JOIN LATERAL (
             SELECT SUM(p.amount) AS total FROM ledger.posting p
              WHERE p.workspace_id = s.workspace_id AND p.ledger_account_id = s.ledger_account_id
                AND p.entry_date <= s.as_of_date) t ON true
          WHERE s.balance <> COALESCE(t.total, 0)
            AND NOT EXISTS (
              SELECT 1 FROM ledger.journal_entry e JOIN ledger.posting p2 ON p2.journal_entry_id = e.id
               WHERE e.workspace_id = s.workspace_id AND e.sequence > s.last_sequence
                 AND e.entry_date <= s.as_of_date AND p2.ledger_account_id = s.ledger_account_id)`,
      );
      for (const r of snapshots.rows)
        violations.push({
          invariant: 'INV-022',
          workspaceId: r.workspace_id,
          ledgerAccountId: r.account,
          asOfDate: r.as_of,
          currency: r.currency,
          difference: r.diff,
          detail: 'balance snapshot differs from the sum of postings',
        });
      // INV-008: la reversa niega exactamente cada línea del original (misma cuenta, monto opuesto).
      const reversals = await c.query<{ workspace_id: string; id: string; lines: string }>(
        `SELECT r.workspace_id, r.reversal_entry_id AS id, count(*)::text AS lines
           FROM ledger.entry_reversal r
           CROSS JOIN LATERAL (
             SELECT 1
               FROM (SELECT line_no, ledger_account_id, amount FROM ledger.posting
                      WHERE journal_entry_id = r.original_entry_id) o
               FULL JOIN (SELECT line_no, ledger_account_id, amount FROM ledger.posting
                           WHERE journal_entry_id = r.reversal_entry_id) v ON v.line_no = o.line_no
              WHERE o.line_no IS NULL OR v.line_no IS NULL
                 OR v.ledger_account_id <> o.ledger_account_id OR v.amount <> -o.amount) bad
          GROUP BY r.workspace_id, r.reversal_entry_id`,
      );
      for (const r of reversals.rows)
        violations.push({
          invariant: 'INV-008',
          workspaceId: r.workspace_id,
          journalEntryId: r.id,
          detail: `reversal does not exactly negate its original (${r.lines} lines)`,
        });
      return violations;
    });
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE pf_ledger_maintenance');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
}
