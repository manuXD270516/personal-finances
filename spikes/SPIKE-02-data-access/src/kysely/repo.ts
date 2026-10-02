import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { APP_URL, pg } from '../shared/env.js';
import type { EntryInput, LedgerRepo, PostingRow } from '../shared/scenario.js';
import type { DB } from './db.generated.js';

/** Unit of Work mínima: toda operación corre en tx con SET LOCAL (set_config(..., true)). */
async function inWorkspace<T>(db: Kysely<DB>, ws: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.workspace_id', ${ws}, true)`.execute(trx);
    return fn(trx);
  });
}

const toRow = (r: { id: string; workspace_id: string; line_no: number; currency: string; amount: string }): PostingRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  lineNo: r.line_no,
  currency: r.currency,
  amount: r.amount,
  rawAmountType: typeof r.amount,
});

export function createKyselyRepo(opts: { max?: number } = {}): LedgerRepo {
  const pool = new pg.Pool({ connectionString: APP_URL, max: opts.max ?? 4 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const cols = ['id', 'workspace_id', 'line_no', 'currency', 'amount'] as const;

  return {
    name: 'kysely',
    async postEntry(ws, entry: EntryInput, hooks) {
      await inWorkspace(db, ws, async (trx) => {
        await trx
          .insertInto('ledger.journal_entry')
          .values({
            id: entry.id,
            workspace_id: ws,
            entry_date: entry.entryDate,
            entry_type: 'STANDARD',
            source_type: 'Transaction',
            source_id: entry.id,
            source_revision: 1,
          })
          .execute();
        await trx
          .insertInto('ledger.posting')
          .values(
            entry.postings.map((p) => ({
              id: p.id,
              workspace_id: ws,
              journal_entry_id: entry.id,
              entry_date: entry.entryDate,
              line_no: p.lineNo,
              ledger_account_id: p.ledgerAccountId,
              account_type: p.accountType,
              currency: p.currency,
              amount: p.amount,
              split_id: p.splitId,
            })),
          )
          .execute();
        hooks?.afterInserts?.();
      });
    },
    async readEntryPostings(ws, entryId) {
      const rows = await inWorkspace(db, ws, (trx) =>
        trx.selectFrom('ledger.posting').select(cols).where('journal_entry_id', '=', entryId).orderBy('line_no').execute(),
      );
      return rows.map(toRow);
    },
    async listAllPostingsUnfiltered(ws) {
      const rows = await inWorkspace(db, ws, (trx) => trx.selectFrom('ledger.posting').select(cols).execute());
      return rows.map(toRow);
    },
    async listAllPostingsWithoutContext() {
      const rows = await db.selectFrom('ledger.posting').select(cols).execute();
      return rows.map(toRow);
    },
    async probeContext(ws) {
      return inWorkspace(db, ws, async (trx) => {
        const { rows } = await sql<{ s: string }>`SELECT current_setting('app.workspace_id') AS s`.execute(trx);
        const vis = await trx.selectFrom('ledger.posting').select('workspace_id').distinct().execute();
        return { setting: rows[0]!.s, visibleWorkspaces: vis.map((v) => v.workspace_id) };
      });
    },
    async updatePostingAmount(ws, postingId, amount) {
      // El tipo generado (override) declara amount como no actualizable (never): se fuerza con sql`` para probar la BD.
      await inWorkspace(db, ws, (trx) =>
        trx.updateTable('ledger.posting').set({ memo: sql`memo`, amount: sql`${amount}::numeric` as never }).where('id', '=', postingId).execute(),
      );
    },
    async deletePosting(ws, postingId) {
      await inWorkspace(db, ws, (trx) => trx.deleteFrom('ledger.posting').where('id', '=', postingId).execute());
    },
    async sumByCurrency(ws, entryId) {
      const rows = await inWorkspace(db, ws, (trx) =>
        trx
          .selectFrom('ledger.posting')
          .select(['currency', (eb) => eb.fn.sum<string>('amount').as('total')])
          .where('journal_entry_id', '=', entryId)
          .groupBy('currency')
          .execute(),
      );
      return Object.fromEntries(rows.map((r) => [r.currency, r.total]));
    },
    async close() {
      await db.destroy();
    },
  };
}
