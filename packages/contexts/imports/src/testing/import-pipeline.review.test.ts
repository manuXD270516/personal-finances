import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT,
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

const RULE = { ruleId: 'rule-1', ruleVersion: 1 };

const OFX_3 = ofx(
  [
    { fitid: '2026030100017', date: '20260301020000[0:UTC]', amount: '-245.30', name: 'COMPRA SUPERMERCADO' },
    { fitid: '2026030500021', date: '20260305', amount: '1500.00', name: 'ABONO SUELDO SINTETICO' },
    { fitid: '2026031000033', date: '20260310120000', amount: '-235.38', name: 'PAGO SERVICIOS' },
  ],
  { closing: { amount: '1019.32', date: '20260331' } },
);

async function review(ctx: PipelineCtx, text = OFX_3, format: 'OFX' | 'JSON' = 'OFX') {
  const documentId = addDocument(ctx, { format, text });
  const { job } = await importDocument(ctx, documentId);
  return job;
}

const edit = (
  ctx: PipelineCtx,
  job: { id: string; version: number },
  rowId: string,
  patch: Record<string, unknown>,
  version = job.version,
) =>
  ctx.service.decideRow({
    workspaceId: WS,
    userId: USER,
    importId: job.id,
    rowId,
    expectedVersion: version,
    patch,
  });

describe('Orden de la clasificación y de los duplicados', () => {
  it('[TC-IMPORTS-PIPELINE-002] una vinculación preseleccionada de confianza alta cuenta como decisión al aprobar', async () => {
    const ctx = setupPipeline();
    ctx.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-02-28',
      signed: '-245.30',
      description: 'COMPRA SUPERMERCADO',
    });
    const job = await review(ctx);
    const { rows } = await previewRows(ctx, job.id);
    const merged = rows.find((r) => r.externalId === '2026030100017');
    expect(merged).toMatchObject({ classification: 'DUPLICATE_PROBABLE', decision: 'SKIP' });
    expect(merged?.candidates[0]).toMatchObject({ score: '0.9000', confidence: 'HIGH', preselected: true });
    expect(job.counters.probableDuplicates).toBe(1);

    const { job: done } = await approveAndPersist(ctx, job.id);
    // El extracto declara un saldo final distinto del de la cuenta de prueba: termina con diferencia, sin ajuste.
    expect(done.status).toBe('COMPLETED_WITH_DIFFERENCE');
    // La fila quedó vinculada al gasto manual y no creó transacción; las otras dos sí.
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(2);
    expect(ctx.world.links.filter((l) => l.kind === 'SKIPPED_AS_DUPLICATE')).toHaveLength(1);
    // [TC-IMPORTS-PIPELINE-064] Cada vínculo queda auditado con línea, movimiento, puntaje y actor.
    const link = ctx.world.audit.find((a) => a.action === 'imports.row.linked');
    expect(link?.changes).toEqual(
      expect.arrayContaining([
        { field: 'line', before: null, after: 1 },
        { field: 'score', before: null, after: '0.9000' },
      ]),
    );
  });

  it('[TC-IMPORTS-PIPELINE-038] la contraparte propuesta por alias participa del puntaje de duplicados', async () => {
    const ctx = setupPipeline();
    ctx.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-02-28',
      signed: '-245.30',
      description: 'COMPRA SUPERMERCADO',
      counterpartyId: 'cp-super',
    });
    const without = await review(ctx);
    const base = (await previewRows(ctx, without.id)).rows[0]?.candidates[0];
    expect(base?.signals.counterparty).toBe('0.5000');

    const ctx2 = setupPipeline();
    ctx2.world.aliases.set('COMPRA SUPERMERCADO', 'cp-super');
    ctx2.world.addTransaction({
      accountId: ACCOUNT,
      date: '2026-02-28',
      signed: '-245.30',
      description: 'COMPRA SUPERMERCADO',
      counterpartyId: 'cp-super',
    });
    const withAlias = await review(ctx2);
    const scored = (await previewRows(ctx2, withAlias.id)).rows[0]?.candidates[0];
    expect(scored).toMatchObject({ score: '0.9000', signals: { counterparty: '1.0000' } });
  });

  it('[TC-IMPORTS-PIPELINE-040] una falla de la evaluación de reglas deja las filas sin propuesta y no impide aprobar', async () => {
    const ctx = setupPipeline();
    ctx.world.rulesFail = true;
    const job = await review(ctx);
    expect(job.status).toBe('AWAITING_REVIEW');
    const { rows } = await previewRows(ctx, job.id);
    expect(rows.every((r) => r.issues.length === 0 || r.issues.every((i) => i.severity === 'WARNING'))).toBe(
      true,
    );
    expect(rows[0]?.proposal?.categoryId).toBeUndefined();
    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(done.status).toMatch(/^COMPLETED/);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(3);
  });

  it('[TC-IMPORTS-PIPELINE-003] la transacción creada toma la categoría que la vista previa mostró', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-hogar', 'EXPENSE');
    ctx.world.ruleOutcomes.push((s) =>
      (s.description ?? '').includes('SUPERMERCADO')
        ? { category: { categoryId: 'cat-hogar', origin: RULE } }
        : null,
    );
    const job = await review(ctx);
    const row = (await previewRows(ctx, job.id)).rows[0];
    expect(row?.proposal?.categoryId).toMatchObject({ value: 'cat-hogar', origin: 'RULE', ruleId: 'rule-1' });
    await approveAndPersist(ctx, job.id);
    const tx = ctx.world.transactions.find((t) => t.description?.includes('SUPERMERCADO'));
    expect(tx).toMatchObject({ categoryName: 'cat-hogar', categoryOrigin: 'RULE' });
  });
});

describe('Vista previa editable', () => {
  it('[TC-IMPORTS-PIPELINE-041] editar descripción y categoría deja origen manual y no crea transacciones', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-seguros', 'EXPENSE');
    const job = await review(ctx);
    const rowId = (await previewRows(ctx, job.id)).rows[2]?.id as string;
    const result = await edit(ctx, job, rowId, { description: 'Seguro del auto', categoryId: 'cat-seguros' });
    expect(result.row.edits).toMatchObject({ description: 'Seguro del auto', categoryId: 'cat-seguros' });
    expect(result.row.proposal?.needsCategory).toBe(false);
    expect(ctx.world.transactions).toHaveLength(0);
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.transactions.find((t) => t.description === 'Seguro del auto')?.categoryName).toBe(
      'cat-seguros',
    );
  });

  it('[TC-IMPORTS-PIPELINE-043] editar con una versión vencida se rechaza sin cambiar la fila', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-x', 'EXPENSE');
    const job = await review(ctx);
    const rowId = (await previewRows(ctx, job.id)).rows[0]?.id as string;
    await edit(ctx, job, rowId, { note: 'primera' });
    // `job.version` quedó vencida por la edición anterior: 412 `PRECONDITION_FAILED` (docs/10 §6; decisión del lead).
    expect(await codeOf(edit(ctx, job, rowId, { note: 'segunda' }))).toBe('PRECONDITION_FAILED');
    expect((await previewRows(ctx, job.id)).rows[0]?.edits).toEqual({ note: 'primera' });
  });

  it('una edición vacía o con referencias inexistentes se rechaza', async () => {
    const ctx = setupPipeline();
    const job = await review(ctx);
    const rowId = (await previewRows(ctx, job.id)).rows[0]?.id as string;
    expect(await codeOf(edit(ctx, job, rowId, {}))).toBe('VALIDATION_FAILED');
    expect(await codeOf(edit(ctx, job, rowId, { categoryId: 'no-existe' }))).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-IMPORTS-PIPELINE-042] una edición en lote asigna la categoría a las 40 filas filtradas y no toca las demás', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-transporte', 'EXPENSE');
    ctx.world.categories.set('cat-otra', 'EXPENSE');
    ctx.world.ruleOutcomes.push((s) =>
      dec(s.amount.amount).greaterThan(100) ? { category: { categoryId: 'cat-otra', origin: RULE } } : null,
    );
    const movements = Array.from({ length: 60 }, (_, i) => ({
      date: '2026-05-02',
      amount: i < 40 ? `-${i + 1}.00` : `-${200 + i}.00`,
      description: `MOV ${i}`,
    }));
    const job = await review(ctx, jsonStatement(movements), 'JSON');
    const result = await ctx.service.bulkEdit({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
      filter: { needsCategory: true },
      set: { categoryId: 'cat-transporte' },
    });
    expect(result.updated).toBe(40);
    const { rows } = await previewRows(ctx, job.id);
    expect(rows.filter((r) => r.edits?.categoryId === 'cat-transporte')).toHaveLength(40);
    expect(rows.filter((r) => r.edits === null)).toHaveLength(20);
  });

  it('[TC-IMPORTS-PIPELINE-039] reevaluar reglas conserva lo editado y actualiza el resto', async () => {
    const ctx = setupPipeline();
    ctx.world.categories.set('cat-hogar', 'EXPENSE');
    const job = await review(ctx);
    const rows = (await previewRows(ctx, job.id)).rows;
    const edited = await edit(ctx, job, rows[0]?.id as string, { categoryId: 'cat-hogar' });
    // Se "edita una regla": ahora clasifica todo como cat-nueva.
    ctx.world.categories.set('cat-nueva', 'EXPENSE');
    ctx.world.ruleOutcomes.push(() => ({
      category: { categoryId: 'cat-nueva', origin: { ruleId: 'rule-1', ruleVersion: 2 } },
    }));
    await ctx.service.reevaluateRules({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: edited.version,
    });
    const after = (await previewRows(ctx, job.id)).rows;
    expect(after[0]?.edits).toMatchObject({ categoryId: 'cat-hogar' });
    expect(after[1]?.proposal?.categoryId).toMatchObject({
      value: 'cat-nueva',
      origin: 'RULE',
      ruleVersion: 2,
    });
    expect(after[1]?.edits).toBeNull();
  });
});

describe('Transferencias y conversiones', () => {
  it('[TC-IMPORTS-PIPELINE-044] una fila marcada como transferencia crea una transferencia y ningún gasto', async () => {
    const ctx = setupPipeline();
    ctx.world.addAccount({ accountId: 'acc-visa', nature: 'LIABILITY' });
    const job = await review(
      ctx,
      jsonStatement([{ date: '2026-10-10', amount: '-400.00', description: 'PAGO TARJETA' }]),
      'JSON',
    );
    const rowId = (await previewRows(ctx, job.id)).rows[0]?.id as string;
    const edited = await edit(ctx, job, rowId, { transfer: { counterAccountId: 'acc-visa' } });
    expect(edited.row.kind).toBe('TRANSFER');
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.transactions.filter((t) => t.kind === 'EXPENSE')).toHaveLength(0);
    expect(ctx.world.transactions.find((t) => t.kind === 'TRANSFER')).toMatchObject({
      transfer: 'acc-visa',
      signed: '-400.00',
    });
  });

  it('[TC-IMPORTS-PIPELINE-045] marcar una transferencia hacia otra moneda se rechaza con TRANSFER_CURRENCY_MISMATCH', async () => {
    const ctx = setupPipeline();
    ctx.world.addAccount({ accountId: 'acc-usd', currency: 'USD' });
    const job = await review(
      ctx,
      jsonStatement([{ date: '2026-10-10', amount: '-400.00', description: 'X' }]),
      'JSON',
    );
    const rowId = (await previewRows(ctx, job.id)).rows[0]?.id as string;
    expect(await codeOf(edit(ctx, job, rowId, { transfer: { counterAccountId: 'acc-usd' } }))).toBe(
      'TRANSFER_CURRENCY_MISMATCH',
    );
    expect((await previewRows(ctx, job.id)).rows[0]?.edits).toBeNull();
  });

  it('[TC-IMPORTS-PIPELINE-046] una conversión usa la hora del extracto y, sin hora, el fin del día de negocio', async () => {
    const ctx = setupPipeline();
    ctx.world.addAccount({ accountId: 'acc-usd', currency: 'USD' });
    const job = await review(
      ctx,
      jsonStatement([
        { date: '2026-03-10', time: '14:05', amount: '-696.00', description: 'COMPRA DIVISAS' },
        { date: '2026-03-11', amount: '-348.00', description: 'COMPRA DIVISAS 2' },
      ]),
      'JSON',
    );
    const rows = (await previewRows(ctx, job.id)).rows;
    let version = job.version;
    for (const [i, counter] of ['100.00', '50.00'].entries()) {
      version = (
        await edit(
          ctx,
          job,
          rows[i]?.id as string,
          {
            conversion: { counterAccountId: 'acc-usd', counterAmount: { amount: counter, currency: 'USD' } },
          },
          version,
        )
      ).version;
    }
    await approveAndPersist(ctx, job.id);
    const conversions = ctx.world.transactions.filter((t) => t.kind === 'CONVERSION');
    expect(conversions).toHaveLength(2);
    const executedAt = conversions.map((t) => (t.conversion as { executedAt: string }).executedAt);
    // 14:05 en America/La_Paz (UTC-4) = 18:05Z; sin hora, 23:59:59.999 local = 03:59:59.999Z del día siguiente.
    expect(executedAt).toEqual(['2026-03-10T18:05:00.000Z', '2026-03-12T03:59:59.999Z']);
  });
});

describe('Coincidencias con compromisos', () => {
  const OCC = {
    occurrenceId: 'occ-internet',
    definitionId: 'def-internet',
    definitionName: 'Internet',
    dueDate: '2026-10-20',
    score: '0.9500',
    confidence: 'HIGH',
    ambiguous: false,
    amount: '199.00',
    kind: 'EXPENSE' as const,
  };
  const TIGO = jsonStatement([{ date: '2026-10-20', amount: '-199.00', description: 'TIGO INTERNET' }]);

  it('[TC-IMPORTS-PIPELINE-048] una coincidencia confirmada vincula la ocurrencia con la transacción importada por quien aprobó', async () => {
    const ctx = setupPipeline();
    ctx.world.occurrences.push({ ...OCC });
    const job = await review(ctx, TIGO, 'JSON');
    const row = (await previewRows(ctx, job.id)).rows[0];
    expect(row?.occurrenceCandidates[0]).toMatchObject({ occurrenceId: 'occ-internet', label: 'Internet' });
    await edit(ctx, job, row?.id as string, { occurrenceLink: { occurrenceId: 'occ-internet' } });
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.occurrenceLinks).toEqual([
      expect.objectContaining({ occurrenceId: 'occ-internet', userId: USER }),
    ]);
  });

  it('[TC-IMPORTS-PIPELINE-049] sin confirmación del usuario la ocurrencia no se vincula', async () => {
    const ctx = setupPipeline();
    ctx.world.occurrences.push({ ...OCC });
    const job = await review(ctx, TIGO, 'JSON');
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.occurrenceLinks).toEqual([]);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(1);
    expect(ctx.world.occurrences[0]?.resolved).toBeUndefined();
  });

  it('[TC-IMPORTS-PIPELINE-050] confirmar todas las de confianza alta vincula las únicas y deja sin confirmar las ambiguas', async () => {
    const ctx = setupPipeline();
    for (let i = 0; i < 5; i += 1) {
      ctx.world.occurrences.push({
        ...OCC,
        occurrenceId: `occ-${i}`,
        amount: `${100 + i}.00`,
        dueDate: '2026-10-20',
      });
    }
    // Dos filas con candidatas ambiguas (dos ocurrencias de 300.00 el mismo día).
    for (const id of ['amb-1', 'amb-2']) {
      ctx.world.occurrences.push({ ...OCC, occurrenceId: id, amount: '300.00', ambiguous: true });
    }
    const movements = [
      ...Array.from({ length: 5 }, (_, i) => ({
        date: '2026-10-20',
        amount: `-${100 + i}.00`,
        description: `DEB ${i}`,
      })),
      { date: '2026-10-20', amount: '-300.00', description: 'AMBIGUA 1' },
      { date: '2026-10-21', amount: '-300.00', description: 'AMBIGUA 2' },
    ];
    const job = await review(ctx, jsonStatement(movements), 'JSON');
    const result = await ctx.service.confirmOccurrenceMatches({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
    });
    expect(result.confirmed).toBe(5);
    const rows = (await previewRows(ctx, job.id)).rows;
    expect(rows.filter((r) => r.occurrenceLink !== null)).toHaveLength(5);
  });

  it('[TC-IMPORTS-PIPELINE-051] si la ocurrencia se resolvió antes de persistir, la transacción se crea sin vínculo y con advertencia', async () => {
    const ctx = setupPipeline();
    ctx.world.occurrences.push({ ...OCC });
    const job = await review(ctx, TIGO, 'JSON');
    const row = (await previewRows(ctx, job.id)).rows[0];
    const edited = await edit(ctx, job, row?.id as string, {
      occurrenceLink: { occurrenceId: 'occ-internet' },
    });
    await ctx.service.approve({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: edited.version,
    });
    // Otra vía resuelve la ocurrencia antes de persistir.
    (ctx.world.occurrences[0] as { resolved?: boolean }).resolved = true;
    await ctx.persist.persist({ workspaceId: WS, importId: job.id });
    expect(ctx.world.occurrenceLinks).toEqual([]);
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(1);
    const after = (await previewRows(ctx, job.id)).rows[0];
    expect(after?.occurrenceLink).toMatchObject({ outcome: 'SKIPPED' });
  });
});

describe('Reconciliación contra el saldo del extracto', () => {
  it('[TC-IMPORTS-PIPELINE-057] un import cuyo saldo coincide termina completado y ofrece la reconciliación', async () => {
    const ctx = setupPipeline();
    ctx.world.dynamicBalance = true;
    ctx.world.balance = '0.00';
    const job = await review(ctx);
    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.reconciliationOffer).toEqual({
      accountId: ACCOUNT,
      statementDate: '2026-03-31',
      statementBalance: { amount: '1019.32', currency: 'BOB' },
    });
  });

  it('[TC-IMPORTS-PIPELINE-058] una diferencia de 18.00 BOB termina completado con diferencia y sin ajuste', async () => {
    const ctx = setupPipeline();
    ctx.world.dynamicBalance = true;
    ctx.world.balance = '-18.00';
    const job = await review(ctx);
    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(done.status).toBe('COMPLETED_WITH_DIFFERENCE');
    expect(done.reconciliationOffer).toBeNull();
    expect(ctx.world.transactions.filter((t) => t.source === 'IMPORT')).toHaveLength(3);
    expect(ctx.world.transactions.some((t) => t.kind === ('ADJUSTMENT' as never))).toBe(false);
  });

  it('[TC-IMPORTS-PIPELINE-037] la vista previa muestra la diferencia entre el saldo final del extracto y el saldo resultante', async () => {
    const ctx = setupPipeline();
    ctx.world.balance = '-18.00';
    const job = await review(ctx);
    // 4000.00 → aquí -18.00 + (1500.00 − 245.30 − 235.38) = 1001.32 resultante; el extracto dice 1019.32.
    expect(job.statementDifference).toEqual({ amount: '18.00', currency: 'BOB' });
  });
});
