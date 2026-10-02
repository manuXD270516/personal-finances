import { asc, eq, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { APP_URL, pg } from '../shared/env.js';
import type { EntryInput, LedgerRepo, PostingRow } from '../shared/scenario.js';
import { journalEntryInLedger as journalEntry, postingInLedger as posting } from './schema.js';

export function createDrizzleRepo(opts: { max?: number } = {}): LedgerRepo {
  const pool = new pg.Pool({ connectionString: APP_URL, max: opts.max ?? 4 });
  const db = drizzle({ client: pool });
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  const inWorkspace = <T>(ws: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${ws}, true)`);
      return fn(tx);
    });

  const cols = {
    id: posting.id,
    workspaceId: posting.workspaceId,
    lineNo: posting.lineNo,
    currency: posting.currency,
    amount: posting.amount,
  };
  const toRow = (r: { id: string; workspaceId: string; lineNo: number; currency: string; amount: string }): PostingRow => ({
    ...r,
    rawAmountType: typeof r.amount,
  });

  return {
    name: 'drizzle',
    async postEntry(ws, entry: EntryInput, hooks) {
      await inWorkspace(ws, async (tx) => {
        await tx.insert(journalEntry).values({
          id: entry.id,
          workspaceId: ws,
          entryDate: entry.entryDate,
          entryType: 'STANDARD',
          sourceType: 'Transaction',
          sourceId: entry.id,
          sourceRevision: 1,
        });
        await tx.insert(posting).values(
          entry.postings.map((p) => ({
            id: p.id,
            workspaceId: ws,
            journalEntryId: entry.id,
            entryDate: entry.entryDate,
            lineNo: p.lineNo,
            ledgerAccountId: p.ledgerAccountId,
            accountType: p.accountType,
            currency: p.currency,
            amount: p.amount,
            splitId: p.splitId,
          })),
        );
        hooks?.afterInserts?.();
      });
    },
    async readEntryPostings(ws, entryId) {
      const rows = await inWorkspace(ws, (tx) =>
        tx.select(cols).from(posting).where(eq(posting.journalEntryId, entryId)).orderBy(asc(posting.lineNo)),
      );
      return rows.map(toRow);
    },
    async listAllPostingsUnfiltered(ws) {
      return (await inWorkspace(ws, (tx) => tx.select(cols).from(posting))).map(toRow);
    },
    async listAllPostingsWithoutContext() {
      return (await db.select(cols).from(posting)).map(toRow);
    },
    async probeContext(ws) {
      return inWorkspace(ws, async (tx) => {
        const r = await tx.execute<{ s: string }>(sql`SELECT current_setting('app.workspace_id') AS s`);
        const vis = await tx.selectDistinct({ w: posting.workspaceId }).from(posting);
        return { setting: r.rows[0]!.s, visibleWorkspaces: vis.map((v) => v.w) };
      });
    },
    async updatePostingAmount(ws, postingId, amount) {
      await inWorkspace(ws, (tx) => tx.update(posting).set({ amount }).where(eq(posting.id, postingId)));
    },
    async deletePosting(ws, postingId) {
      await inWorkspace(ws, (tx) => tx.delete(posting).where(eq(posting.id, postingId)));
    },
    async sumByCurrency(ws, entryId) {
      const rows = await inWorkspace(ws, (tx) =>
        tx
          .select({ currency: posting.currency, total: sum(posting.amount) })
          .from(posting)
          .where(eq(posting.journalEntryId, entryId))
          .groupBy(posting.currency),
      );
      return Object.fromEntries(rows.map((r) => [r.currency, r.total!]));
    },
    async close() {
      await pool.end();
    },
  };
}
