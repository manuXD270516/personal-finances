import { describe, expect, it } from 'vitest';
import type { CategorySuggestionEntry } from '../application/ports/index.js';
import {
  USER,
  WS,
  addDocument,
  approveAndPersist,
  codeOf,
  importDocument,
  jsonStatement,
  previewRows,
  setupPipeline,
  type PipelineCtx,
} from './pipeline-harness.js';

const RULE = { ruleId: 'rule-1', ruleVersion: 1 };

const suggestion = (
  level: 'HIGH' | 'MEDIUM',
  categoryId = 'cat-rest',
  over: Partial<CategorySuggestionEntry> = {},
): CategorySuggestionEntry => ({
  categoryId,
  confidence: level === 'HIGH' ? '0.9000' : '0.7500',
  level,
  support: level === 'HIGH' ? 10 : 4,
  matches: level === 'HIGH' ? 9 : 3,
  basis: 'DESCRIPTION',
  descriptionKey: 'pedidosya',
  counterpartyId: null,
  ...over,
});

/** Un import con filas «PEDIDOSYA n» (nivel alto), «CAFE n» (medio), «OTRO n» (sin sugerencia) y una de regla. */
async function setup(over: { enabled?: boolean } = {}) {
  const ctx = setupPipeline();
  ctx.world.suggestionsEnabled = over.enabled ?? true;
  ctx.world.categories.set('cat-rest', 'EXPENSE');
  ctx.world.categories.set('cat-cafe', 'EXPENSE');
  ctx.world.categories.set('cat-transporte', 'EXPENSE');
  ctx.world.suggestionRules.push(
    { match: 'pedidosya', entry: suggestion('HIGH') },
    { match: 'cafe', entry: suggestion('MEDIUM', 'cat-cafe', { descriptionKey: 'cafe' }) },
    { match: 'uber', entry: suggestion('HIGH', 'cat-rest') },
  );
  ctx.world.ruleOutcomes.push((s) =>
    (s.description ?? '').toUpperCase().includes('UBER')
      ? { category: { categoryId: 'cat-transporte', origin: RULE } }
      : null,
  );
  const movements = [
    ...Array.from({ length: 5 }, (_, i) => ({
      date: '2026-05-02',
      amount: `-${10 + i}.00`,
      description: `PEDIDOSYA ${i}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      date: '2026-05-03',
      amount: `-${20 + i}.00`,
      description: `CAFE ${i}`,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      date: '2026-05-04',
      amount: `-${30 + i}.00`,
      description: `OTRO ${i}`,
    })),
    { date: '2026-05-05', amount: '-40.00', description: 'UBER TRIP' },
  ];
  const documentId = addDocument(ctx, { format: 'JSON', text: jsonStatement(movements) });
  const { job } = await importDocument(ctx, documentId);
  return { ctx, job };
}

const rowsOf = async (ctx: PipelineCtx, id: string) => (await previewRows(ctx, id)).rows;
const byDescription = (rows: Awaited<ReturnType<typeof rowsOf>>, prefix: string) =>
  rows.filter((r) => (r.description ?? '').startsWith(prefix));

describe('sugerencias de categoría en la vista previa', () => {
  it('[TC-CLASSIFICATION-AUTO-010] las filas sin categoría muestran la sugerencia y las clasificadas por una regla no', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    expect(byDescription(rows, 'PEDIDOSYA').every((r) => r.suggestedCategory?.level === 'HIGH')).toBe(true);
    expect(byDescription(rows, 'CAFE').every((r) => r.suggestedCategory?.level === 'MEDIUM')).toBe(true);
    expect(byDescription(rows, 'OTRO').every((r) => r.suggestedCategory === null)).toBe(true);
    // «UBER TRIP» tiene una regla que propone «Transporte»: no se calcula sugerencia por historial.
    const uber = byDescription(rows, 'UBER')[0];
    expect(uber?.proposal?.categoryId).toMatchObject({ value: 'cat-transporte', origin: 'RULE' });
    expect(uber?.suggestedCategory).toBeNull();
    // La sugerencia es una propuesta: ninguna fila quedó con la categoría aplicada.
    expect(rows.filter((r) => r.edits?.categoryId !== undefined)).toHaveLength(0);
    expect(ctx.world.suggestionCalls).toBe(1);
  });

  it('[TC-CLASSIFICATION-AUTO-010] una fila con la categoría elegida por el usuario no calcula sugerencia al reevaluar', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    const first = byDescription(rows, 'PEDIDOSYA')[0]!;
    const edited = await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      rowId: first.id,
      expectedVersion: job.version,
      patch: { categoryId: 'cat-transporte' },
    });
    expect(edited.row.suggestedCategory).toBeNull();
    await ctx.service.reevaluateRules({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: edited.version,
    });
    const after = await rowsOf(ctx, job.id);
    expect(after.find((r) => r.id === first.id)?.suggestedCategory).toBeNull();
    // Las otras siguen con su sugerencia recalculada.
    expect(
      byDescription(after, 'PEDIDOSYA').filter((r) => r.suggestedCategory?.level === 'HIGH'),
    ).toHaveLength(4);
  });

  it('[TC-CLASSIFICATION-AUTO-014] aceptar en lote las de nivel alta: 5 filas quedan con la categoría sugerida y origen manual', async () => {
    const { ctx, job } = await setup();
    const result = await ctx.service.acceptCategorySuggestions({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
      minLevel: 'HIGH',
    });
    expect(result).toEqual({ accepted: 5, version: job.version + 1 });
    const rows = await rowsOf(ctx, job.id);
    const accepted = byDescription(rows, 'PEDIDOSYA');
    expect(accepted.every((r) => r.edits?.categoryId === 'cat-rest')).toBe(true);
    expect(accepted.every((r) => r.proposal?.needsCategory === false)).toBe(true);
    // Las otras filas no cambian: las medias siguen con su sugerencia.
    expect(
      byDescription(rows, 'CAFE').every((r) => r.edits?.categoryId === undefined && r.suggestedCategory),
    ).toBe(true);
    expect(byDescription(rows, 'OTRO').every((r) => r.edits?.categoryId === undefined)).toBe(true);
    // Auditado como el resto de las ediciones de la vista previa, sin textos ni montos.
    const entry = ctx.world.audit.find((a) => a.action === 'imports.import.suggestions_accepted');
    expect(entry?.changes).toEqual([
      { field: 'acceptedSuggestions', before: null, after: JSON.stringify({ minLevel: 'HIGH', count: 5 }) },
    ]);
  });

  it('[TC-CLASSIFICATION-AUTO-014] con el nivel MEDIUM acepta las altas y las medias, o solo las filas elegidas', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    const chosen = [byDescription(rows, 'CAFE')[0]!.id, byDescription(rows, 'PEDIDOSYA')[0]!.id];
    const some = await ctx.service.acceptCategorySuggestions({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
      minLevel: 'MEDIUM',
      rowIds: chosen,
    });
    expect(some.accepted).toBe(2);
    const all = await ctx.service.acceptCategorySuggestions({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: some.version,
      minLevel: 'MEDIUM',
    });
    // 5 altas + 3 medias, menos las 2 ya aceptadas.
    expect(all.accepted).toBe(6);
  });

  it('[TC-CLASSIFICATION-AUTO-015] aceptar en lote con una versión vencida se rechaza y ninguna fila cambia', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      rowId: rows[0]!.id,
      expectedVersion: job.version,
      patch: { note: 'otra edición' },
    });
    expect(
      await codeOf(
        ctx.service.acceptCategorySuggestions({
          workspaceId: WS,
          userId: USER,
          importId: job.id,
          expectedVersion: job.version,
          minLevel: 'HIGH',
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect((await rowsOf(ctx, job.id)).filter((r) => r.edits?.categoryId !== undefined)).toHaveLength(0);
  });

  it('una categoría sugerida que se archivó desde entonces no se acepta', async () => {
    const { ctx, job } = await setup();
    ctx.world.categories.delete('cat-rest');
    const result = await ctx.service.acceptCategorySuggestions({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
      minLevel: 'HIGH',
    });
    expect(result.accepted).toBe(0);
  });

  it('aceptar una sola fila con decideImportRow marca la sugerencia; otra categoría con la marca se rechaza', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    const target = byDescription(rows, 'PEDIDOSYA')[0]!;
    expect(
      await codeOf(
        ctx.service.decideRow({
          workspaceId: WS,
          userId: USER,
          importId: job.id,
          rowId: target.id,
          expectedVersion: job.version,
          patch: { categoryId: 'cat-transporte', acceptedSuggestion: true },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    const decided = await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      rowId: target.id,
      expectedVersion: job.version,
      patch: { categoryId: 'cat-rest', acceptedSuggestion: true },
    });
    expect(decided.row.edits?.categoryId).toBe('cat-rest');
    expect(decided.row.suggestedCategory).toBeNull();
  });

  it('[TC-CLASSIFICATION-AUTO-011] aprobar sin aceptar crea las transacciones sin categoría y registra los resultados', async () => {
    const { ctx, job } = await setup();
    await approveAndPersist(ctx, job.id);
    const created = ctx.world.transactions.filter((t) => t.source === 'IMPORT');
    expect(created).toHaveLength(11);
    // 8 filas con sugerencia no aceptada (5 altas y 3 medias): ninguna se creó con categoría por la sugerencia.
    expect(
      created
        .filter((t) => /PEDIDOSYA|CAFE/u.test(t.description ?? ''))
        .every((t) => t.categoryName === 'UNCATEGORIZED'),
    ).toBe(true);
    expect(ctx.world.feedback).toHaveLength(1);
    const outcomes = ctx.world.feedback[0]!.outcomes;
    expect(outcomes).toHaveLength(8);
    expect(outcomes.every((o) => o.outcome === 'IGNORED')).toBe(true);
    expect(outcomes.filter((o) => o.level === 'HIGH')).toHaveLength(5);
    expect(outcomes[0]?.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('al aprobar registra aceptadas, corregidas e ignoradas según la categoría final de cada fila', async () => {
    const { ctx, job } = await setup();
    const rows = await rowsOf(ctx, job.id);
    const [a, b] = byDescription(rows, 'PEDIDOSYA');
    // a: se acepta; b: se corrige con otra categoría; las demás quedan sin categoría.
    const first = await ctx.service.acceptCategorySuggestions({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      expectedVersion: job.version,
      minLevel: 'HIGH',
      rowIds: [a!.id],
    });
    await ctx.service.decideRow({
      workspaceId: WS,
      userId: USER,
      importId: job.id,
      rowId: b!.id,
      expectedVersion: first.version,
      patch: { categoryId: 'cat-transporte' },
    });
    await approveAndPersist(ctx, job.id);
    const outcomes = ctx.world.feedback[0]!.outcomes.map((o) => o.outcome);
    expect(outcomes.filter((o) => o === 'ACCEPTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'CORRECTED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'IGNORED')).toHaveLength(6);
    // La categoría aceptada llegó a la transacción con origen manual.
    expect(ctx.world.transactions.find((t) => t.description === 'PEDIDOSYA 0')).toMatchObject({
      categoryName: 'cat-rest',
      categoryOrigin: 'MANUAL',
    });
  });

  it('[TC-CLASSIFICATION-AUTO-016] si falla el cálculo de sugerencias la importación llega a revisión y se puede aprobar', async () => {
    const ctx = setupPipeline();
    ctx.world.suggestionsEnabled = true;
    ctx.world.suggestionsFail = true;
    ctx.world.suggestionRules.push({ match: 'pedidosya', entry: suggestion('HIGH') });
    const documentId = addDocument(ctx, {
      format: 'JSON',
      text: jsonStatement([{ date: '2026-05-02', amount: '-10.00', description: 'PEDIDOSYA 1' }]),
    });
    const { job } = await importDocument(ctx, documentId);
    expect(job.status).toBe('AWAITING_REVIEW');
    const rows = await rowsOf(ctx, job.id);
    expect(rows[0]?.suggestedCategory).toBeNull();
    // Sin la advertencia de reglas: la falla de las sugerencias es solo una ausencia.
    expect(rows[0]?.issues.filter((i) => i.code === 'IMPORT_RULES_UNAVAILABLE')).toHaveLength(0);
    const { job: done } = await approveAndPersist(ctx, job.id);
    expect(done.status).toMatch(/^COMPLETED/u);
  });

  it('[TC-CLASSIFICATION-AUTO-022] con la función deshabilitada la vista previa no muestra sugerencias ni registra resultados', async () => {
    const { ctx, job } = await setup({ enabled: false });
    const rows = await rowsOf(ctx, job.id);
    expect(rows.every((r) => !r.suggestedCategory)).toBe(true);
    expect(ctx.world.suggestionCalls).toBe(0);
    await approveAndPersist(ctx, job.id);
    expect(ctx.world.feedback).toHaveLength(0);
  });

  it('[TC-CLASSIFICATION-AUTO-014] un import que ya no está en revisión no acepta sugerencias', async () => {
    const { ctx, job } = await setup();
    await approveAndPersist(ctx, job.id);
    const current = await ctx.queries.get(WS, job.id);
    expect(
      await codeOf(
        ctx.service.acceptCategorySuggestions({
          workspaceId: WS,
          userId: USER,
          importId: job.id,
          expectedVersion: current.version,
          minLevel: 'HIGH',
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });
});
