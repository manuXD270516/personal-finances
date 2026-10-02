import { PrismaPg } from '@prisma/adapter-pg';
import { APP_URL, pg } from '../shared/env.js';
import type { EntryInput, LedgerRepo, PostingRow } from '../shared/scenario.js';
import { PrismaClient, Prisma } from './generated/client.ts';

type Tx = Prisma.TransactionClient;

export function createPrismaRepo(opts: { max?: number } = {}): LedgerRepo {
  const pool = new pg.Pool({ connectionString: APP_URL, max: opts.max ?? 4 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  /** Patrón recomendado por Prisma para RLS: transacción interactiva + set_config(..., true). */
  const inWorkspace = <T>(ws: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.workspace_id', ${ws}, true)`;
      return fn(tx);
    });

  const select = { id: true, workspace_id: true, line_no: true, currency: true, amount: true } as const;
  const toRow = (r: { id: string; workspace_id: string; line_no: number; currency: string; amount: Prisma.Decimal }): PostingRow => ({
    id: r.id,
    workspaceId: r.workspace_id,
    lineNo: r.line_no,
    currency: r.currency,
    // Prisma.Decimal (decimal.js) -> string con la escala de la columna
    amount: r.amount.toFixed(18),
    rawAmountType: r.amount?.constructor?.name ?? typeof r.amount,
  });
  // @db.Date se modela como DateTime: hay que pasar Date a medianoche UTC
  const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

  return {
    name: 'prisma',
    async postEntry(ws, entry: EntryInput, hooks) {
      await inWorkspace(ws, async (tx) => {
        await tx.journal_entry.create({
          data: {
            id: entry.id,
            workspace_id: ws,
            entry_date: asDate(entry.entryDate),
            entry_type: 'STANDARD',
            source_type: 'Transaction',
            source_id: entry.id,
            source_revision: 1,
          },
        });
        await tx.posting.createMany({
          data: entry.postings.map((p) => ({
            id: p.id,
            workspace_id: ws,
            journal_entry_id: entry.id,
            entry_date: asDate(entry.entryDate),
            line_no: p.lineNo,
            ledger_account_id: p.ledgerAccountId,
            account_type: p.accountType,
            currency: p.currency,
            amount: p.amount, // acepta string | number | Decimal
            split_id: p.splitId,
          })),
        });
        hooks?.afterInserts?.();
      });
    },
    async readEntryPostings(ws, entryId) {
      const rows = await inWorkspace(ws, (tx) =>
        tx.posting.findMany({ select, where: { journal_entry_id: entryId }, orderBy: { line_no: 'asc' } }),
      );
      return rows.map(toRow);
    },
    async listAllPostingsUnfiltered(ws) {
      return (await inWorkspace(ws, (tx) => tx.posting.findMany({ select }))).map(toRow);
    },
    async listAllPostingsWithoutContext() {
      return (await prisma.posting.findMany({ select })).map(toRow);
    },
    async probeContext(ws) {
      return inWorkspace(ws, async (tx) => {
        const r = await tx.$queryRaw<{ s: string }[]>`SELECT current_setting('app.workspace_id') AS s`;
        const vis = await tx.posting.findMany({ select: { workspace_id: true }, distinct: ['workspace_id'] });
        return { setting: r[0]!.s, visibleWorkspaces: vis.map((v) => v.workspace_id) };
      });
    },
    async updatePostingAmount(ws, postingId, amount) {
      await inWorkspace(ws, (tx) => tx.posting.update({ where: { id: postingId }, data: { amount } }));
    },
    async deletePosting(ws, postingId) {
      await inWorkspace(ws, (tx) => tx.posting.delete({ where: { id: postingId } }));
    },
    async sumByCurrency(ws, entryId) {
      const rows = await inWorkspace(ws, (tx) =>
        tx.posting.groupBy({ by: ['currency'], where: { journal_entry_id: entryId }, _sum: { amount: true } }),
      );
      return Object.fromEntries(rows.map((r) => [r.currency, r._sum.amount!.toFixed(18)]));
    },
    async close() {
      await prisma.$disconnect();
      await pool.end().catch(() => undefined);
    },
  };
}
