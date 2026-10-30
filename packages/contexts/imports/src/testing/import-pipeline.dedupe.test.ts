import { describe, expect, it } from 'vitest';
import {
  ACCOUNT,
  USER,
  WS,
  addDocument,
  approveAndPersist,
  importDocument,
  jsonStatement,
  previewRows,
  setupPipeline,
  type PipelineCtx,
} from './pipeline-harness.js';

const SUPER = { date: '2026-10-02', amount: '-245.30', description: 'SUPERMERCADO DEMO' };

function withManualExpense(ctx: PipelineCtx) {
  return ctx.world.addTransaction({
    accountId: ACCOUNT,
    date: '2026-10-02',
    signed: '-245.30',
    description: 'SUPERMERCADO DEMO',
  });
}

const decide = (
  ctx: PipelineCtx,
  job: { id: string; version: number },
  rowId: string,
  decision: 'CREATE' | 'SKIP' | 'EXCLUDE',
) =>
  ctx.service.decideRow({
    workspaceId: WS,
    userId: USER,
    importId: job.id,
    rowId,
    expectedVersion: job.version,
    decision,
  });

describe('Resolución de duplicados registrada', () => {
  it('[TC-TRANSACTIONS-DEDUPE-009] fusionar no crea transacción ni modifica el gasto y registra la decisión con su puntaje', async () => {
    const ctx = setupPipeline();
    const manual = withManualExpense(ctx);
    const { job } = await importDocument(
      ctx,
      addDocument(ctx, { format: 'JSON', text: jsonStatement([SUPER]) }),
    );
    const row = (await previewRows(ctx, job.id)).rows[0];
    const decided = await decide(ctx, job, row?.id as string, 'SKIP');
    expect(decided.row).toMatchObject({ decision: 'SKIP', decidedBy: USER, decidedScore: '0.9000' });
    expect(decided.row.decidedAt).toBeTruthy();
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(0);
    expect(ctx.world.transactions.find((t) => t.id === manual.id)).toMatchObject({
      signed: '-245.30',
      description: 'SUPERMERCADO DEMO',
      date: '2026-10-02',
      status: 'POSTED',
    });
  });

  it('[TC-TRANSACTIONS-DEDUPE-010] conservar ambas crea el gasto importado sin tocar el manual y la reimportación lo reconoce', async () => {
    const ctx = setupPipeline();
    const manual = withManualExpense(ctx);
    const doc = addDocument(ctx, { format: 'JSON', text: jsonStatement([SUPER]) });
    const first = await importDocument(ctx, doc);
    const row = (await previewRows(ctx, first.job.id)).rows[0];
    const decided = await decide(ctx, first.job, row?.id as string, 'CREATE');
    expect(decided.row.decision).toBe('CREATE');
    await approveAndPersist(ctx, first.job.id);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(1);
    expect(ctx.world.transactions.find((t) => t.id === manual.id)?.signed).toBe('-245.30');

    const again = await importDocument(ctx, doc);
    expect((await previewRows(ctx, again.job.id)).rows[0]?.classification).toBe('DUPLICATE_EXACT');
  });

  it('[TC-TRANSACTIONS-DEDUPE-013] dos filas idénticas sin identificador externo en el mismo archivo crean dos gastos', async () => {
    const ctx = setupPipeline();
    const cafe = { date: '2026-10-02', amount: '-18.00', description: 'PAGO QR CAFE' };
    const { job } = await importDocument(
      ctx,
      addDocument(ctx, { format: 'JSON', text: jsonStatement([cafe, cafe]) }),
    );
    expect((await previewRows(ctx, job.id)).rows.map((r) => r.classification)).toEqual(['NEW', 'NEW']);
    await approveAndPersist(ctx, job.id);
    const created = ctx.world.transactions.filter((t) => t.source === 'IMPORT');
    expect(created.map((t) => t.signed)).toEqual(['-18.00', '-18.00']);
  });

  it('[TC-TRANSACTIONS-DEDUPE-014] deshacer olvida los vínculos y la reimportación vuelve a mostrar la fila fusionada como posible duplicado', async () => {
    const ctx = setupPipeline();
    withManualExpense(ctx);
    const cafe = { date: '2026-10-02', amount: '-18.00', description: 'PAGO QR CAFE' };
    const doc = addDocument(ctx, {
      format: 'JSON',
      text: jsonStatement([
        SUPER,
        { ...cafe, description: 'PAGO QR CAFE 1' },
        { ...cafe, description: 'PAGO QR CAFE 2' },
      ]),
    });
    const first = await importDocument(ctx, doc);
    const done = (await approveAndPersist(ctx, first.job.id)).job;
    expect(done.counters.created).toBe(2);

    const reverting = await ctx.revert.revert({
      workspaceId: WS,
      userId: USER,
      importId: done.id,
      expectedVersion: done.version,
      allowPartial: false,
    });
    expect(reverting.status).toBe('REVERTING');
    await ctx.revert.process({ workspaceId: WS, importId: done.id });

    const again = await importDocument(ctx, doc);
    const classes = (await previewRows(ctx, again.job.id)).rows.map((r) => r.classification);
    expect(classes).toEqual(['DUPLICATE_PROBABLE', 'NEW', 'NEW']);
  });
});
