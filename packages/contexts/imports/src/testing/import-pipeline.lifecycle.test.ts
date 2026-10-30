import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT,
  INSTITUTION,
  USER,
  WS,
  addDocument,
  approveAndPersist,
  codeOf,
  importDocument,
  jsonStatement,
  ofx,
  previewRows,
  setupPipeline,
  type PipelineCtx,
} from './pipeline-harness.js';

const FIXTURES = resolve(__dirname, '../../../../../tests/fixtures/imports/tres-meses');

async function reviewAndApprove(ctx: PipelineCtx, documentId: string) {
  const { created, job } = await importDocument(ctx, documentId);
  if (job.status !== 'AWAITING_REVIEW') throw new Error(`unexpected status ${job.status}`);
  const { job: done } = await approveAndPersist(ctx, created.id);
  return { created, job, done };
}

describe('Idempotencia por identificador externo', () => {
  const ONE = (description: string) =>
    ofx([{ fitid: '2026030100017', date: '20260301', amount: '-245.30', name: description }]);

  it('[TC-IMPORTS-PIPELINE-052] el mismo identificador del banco con otra descripción se clasifica como ya importado', async () => {
    const ctx = setupPipeline();
    await reviewAndApprove(ctx, addDocument(ctx, { format: 'OFX', text: ONE('COMPRA SUPERMERCADO') }));
    const second = await importDocument(
      ctx,
      addDocument(ctx, { format: 'OFX', text: ONE('SUPERMERCADO CENTRO') }),
    );
    const { rows } = await previewRows(ctx, second.created.id);
    expect(rows[0]).toMatchObject({ classification: 'DUPLICATE_EXACT', decision: 'SKIP' });
    const { job } = await approveAndPersist(ctx, second.created.id);
    expect(job.counters.created).toBe(0);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(1);
  });

  it('[TC-IMPORTS-PIPELINE-054] el mismo identificador en otra cuenta no se considera ya importado', async () => {
    const ctx = setupPipeline();
    ctx.world.addAccount({ accountId: 'acc-2' });
    await reviewAndApprove(ctx, addDocument(ctx, { format: 'OFX', text: ONE('COMPRA SUPERMERCADO') }));
    const other = await importDocument(
      ctx,
      addDocument(ctx, { format: 'OFX', text: ONE('COMPRA SUPERMERCADO') }),
      {
        accountId: 'acc-2',
      },
    );
    const { rows } = await previewRows(ctx, other.created.id);
    expect(rows[0]?.classification).toBe('NEW');
  });
});

describe('Extractos solapados de varios formatos', () => {
  it('[TC-IMPORTS-PIPELINE-055] tres meses en CSV y OFX con 12 movimientos solapados dejan 115 transacciones sin duplicados', async () => {
    const ctx = setupPipeline();
    await ctx.profiles.create({
      workspaceId: WS,
      userId: USER,
      name: 'Cumbre CSV',
      format: 'CSV',
      institutionId: INSTITUTION,
      options: {
        version: 'imports.profile.v1',
        mapping: {
          hasHeader: true,
          skipRows: 0,
          dateFormat: 'dd/MM/yyyy',
          decimalSeparator: ',',
          columns: {
            date: { index: 0, header: 'Fecha' },
            description: { index: 1, header: 'Descripcion' },
            amount: { mode: 'SIGNED', index: 2, header: 'Monto', signConvention: 'NEGATIVE_IS_OUTFLOW' },
          },
        },
      },
    });
    const csv = readFileSync(resolve(FIXTURES, 'enero-15feb.csv'));
    const ofxText = readFileSync(resolve(FIXTURES, 'feb-mar.ofx'), 'utf8');

    const first = await reviewAndApprove(
      ctx,
      addDocument(ctx, { format: 'CSV', bytes: new Uint8Array(csv) }),
    );
    expect(first.done.counters.created).toBe(52);
    const second = await importDocument(ctx, addDocument(ctx, { format: 'OFX', text: ofxText }));
    // Los 12 solapados quedan como posibles duplicados con la vinculación de confianza alta preseleccionada.
    expect(second.job.counters.probableDuplicates).toBe(12);
    const pending = (await previewRows(ctx, second.created.id)).rows.filter(
      (r) => r.classification === 'DUPLICATE_PROBABLE' && r.decision === null,
    );
    expect(pending).toHaveLength(0);
    const done = await approveAndPersist(ctx, second.created.id);
    expect(done.job.counters.created).toBe(63);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(115);

    // [TC-IMPORTS-PIPELINE-056] Reimportar los dos extractos crea 0 transacciones.
    for (const doc of [
      addDocument(ctx, { format: 'CSV', bytes: new Uint8Array(csv) }),
      addDocument(ctx, { format: 'OFX', text: ofxText }),
    ]) {
      const again = await importDocument(ctx, doc);
      const rows = (await previewRows(ctx, again.created.id)).rows;
      expect(rows.every((r) => r.classification === 'DUPLICATE_EXACT')).toBe(true);
      const result = await approveAndPersist(ctx, again.created.id);
      expect(result.job.counters.created).toBe(0);
    }
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(115);
  }, 60_000);
});

describe('Deshacer un import', () => {
  const THREE = jsonStatement([
    { date: '2026-10-02', amount: '-18.00', description: 'PAGO QR CAFE' },
    { date: '2026-10-02', amount: '-18.00', description: 'PAGO QR CAFE' },
    { date: '2026-10-05', amount: '8000.00', description: 'ABONO SUELDO' },
  ]);

  async function imported(ctx: PipelineCtx) {
    ctx.world.dynamicBalance = true;
    ctx.world.balance = '4000.00';
    const { created, done } = await reviewAndApprove(ctx, addDocument(ctx, { format: 'JSON', text: THREE }));
    return { id: created.id, done };
  }
  const balanceOf = (ctx: PipelineCtx) => ctx.deps.balances.presentedBalance(WS, ACCOUNT);
  const revert = (ctx: PipelineCtx, id: string, allowPartial = false) =>
    ctx.queries.get(WS, id).then((j) =>
      ctx.revert.revert({
        workspaceId: WS,
        userId: USER,
        importId: id,
        expectedVersion: j.version,
        allowPartial,
      }),
    );

  it('[TC-IMPORTS-PIPELINE-059] deshacer anula las 3 transacciones con reversa y devuelve el saldo a 4000.00 BOB', async () => {
    const ctx = setupPipeline();
    const { id } = await imported(ctx);
    expect(await balanceOf(ctx)).toBe('11964.00');
    const preview = await ctx.revert.preview(WS, id);
    expect(preview).toMatchObject({ toVoid: 3, alreadyVoided: 0, blocked: [] });
    const reverting = await revert(ctx, id);
    expect(reverting.status).toBe('REVERTING');
    expect(await ctx.revert.process({ workspaceId: WS, importId: id })).toBe('DONE');
    expect((await ctx.queries.get(WS, id)).status).toBe('ROLLED_BACK');
    expect(await balanceOf(ctx)).toBe('4000.00');
    expect(ctx.world.transactions.filter((t) => t.status === 'VOIDED')).toHaveLength(3);
    const requested = ctx.world.audit.find((a) => a.action === 'imports.import.revert_requested');
    expect(requested).toBeTruthy();
    // Idempotente: una reentrega no vuelve a anular.
    expect(await ctx.revert.process({ workspaceId: WS, importId: id })).toBe('SKIPPED');

    // [TC-IMPORTS-PIPELINE-062] Reimportar después de deshacer crea de nuevo las 3 transacciones.
    const again = await importDocument(ctx, addDocument(ctx, { format: 'JSON', text: THREE }));
    expect((await previewRows(ctx, again.created.id)).rows.map((r) => r.classification)).toEqual([
      'NEW',
      'NEW',
      'NEW',
    ]);
    const result = await approveAndPersist(ctx, again.created.id);
    expect(result.job.counters.created).toBe(3);
  });

  it('[TC-IMPORTS-PIPELINE-060] una transacción reconciliada bloquea el deshacer completo con IMPORT_REVERT_BLOCKED', async () => {
    const ctx = setupPipeline();
    const { id } = await imported(ctx);
    const salary = ctx.world.transactions.find((t) => t.signed === '8000.00');
    ctx.world.reconciled.add(salary?.id as string);
    const preview = await ctx.revert.preview(WS, id);
    expect(preview.blocked).toHaveLength(1);
    expect(preview.blocked[0]).toMatchObject({ reason: 'RECONCILED', transactionId: salary?.id });
    let error: { code?: string; details?: { blocked?: unknown[] } } = {};
    try {
      await revert(ctx, id);
    } catch (e) {
      error = e as typeof error;
    }
    expect(error.code).toBe('IMPORT_REVERT_BLOCKED');
    expect(error.details?.blocked).toHaveLength(1);
    expect(ctx.world.transactions.filter((t) => t.status === 'VOIDED')).toHaveLength(0);
    expect((await ctx.queries.get(WS, id)).status).toBe('COMPLETED');
  });

  it('[TC-IMPORTS-PIPELINE-061] el deshacer parcial explícito anula las no bloqueadas y deja el saldo en 12000.00 BOB', async () => {
    const ctx = setupPipeline();
    const { id } = await imported(ctx);
    const salary = ctx.world.transactions.find((t) => t.signed === '8000.00');
    ctx.world.reconciled.add(salary?.id as string);
    await revert(ctx, id, true);
    await ctx.revert.process({ workspaceId: WS, importId: id });
    const after = await ctx.queries.get(WS, id);
    expect(after.status).toBe('PARTIALLY_ROLLED_BACK');
    expect(after.revertSummary).toMatchObject({ voided: 2, blocked: 1 });
    expect(await balanceOf(ctx)).toBe('12000.00');
    // El vínculo de la bloqueada sigue activo: reimportar no la duplica.
    const again = await importDocument(ctx, addDocument(ctx, { format: 'JSON', text: THREE }));
    const classes = (await previewRows(ctx, again.created.id)).rows.map((r) => r.classification);
    expect(classes.filter((c) => c === 'DUPLICATE_EXACT')).toHaveLength(1);
  });

  it('deshacer una importación no terminada es INVALID_STATUS_TRANSITION', async () => {
    const ctx = setupPipeline();
    const { created } = await importDocument(ctx, addDocument(ctx, { format: 'JSON', text: THREE }));
    expect(await codeOf(revert(ctx, created.id))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-IMPORTS-PIPELINE-070] el recorrido muestra las transiciones en orden con actor y la anotación del perfil', async () => {
    const ctx = setupPipeline();
    const { id } = await imported(ctx);
    await revert(ctx, id);
    await ctx.revert.process({ workspaceId: WS, importId: id });
    const steps = ctx.world.lifecycle
      .filter((l) => l.entry.aggregateId === id)
      .flatMap((l) => l.steps.map((s) => ({ step: s, actor: l.entry.actor })))
      .filter(({ step }) => step.kind === 'TRANSITION');
    expect(steps.map(({ step }) => (step.kind === 'TRANSITION' ? step.toState : ''))).toEqual([
      'UPLOADED',
      'PROCESSING',
      'AWAITING_REVIEW',
      'APPROVED',
      'PERSISTING',
      'COMPLETED',
      'REVERTING',
      'ROLLED_BACK',
    ]);
  });
});

describe('Resumen final con la cobertura de reglas', () => {
  it('[TC-IMPORTS-PIPELINE-069] 41 de 57 transacciones clasificadas por reglas muestran una cobertura de 0.7193', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-regla', 'EXPENSE');
    ctx.world.ruleOutcomes.push((s) =>
      Number(s.description?.replace(/\D/g, '')) < 41
        ? { category: { categoryId: 'cat-regla', origin: { ruleId: 'r1', ruleVersion: 1 } } }
        : null,
    );
    const movements = Array.from({ length: 57 }, (_, i) => ({
      date: '2026-05-02',
      amount: `-${i + 1}.00`,
      description: `MOV ${i}`,
    }));
    const { done } = await reviewAndApprove(
      ctx,
      addDocument(ctx, { format: 'JSON', text: jsonStatement(movements) }),
    );
    expect(done.counters.created).toBe(57);
    expect(done.ruleCoverage).toMatchObject({ rows: 57, classifiedByRule: 41, ratio: '0.7193' });
  });
});
