import { DomainError, Instant, type FixedClock } from '@pf/shared-kernel';
import type { ClassificationSubjectDto } from '@pf/transactions/contracts';
import { describe, expect, it } from 'vitest';
import { CategorySuggestionService } from './category-suggestions.js';
import { DEFAULT_RULES_SETTINGS, type RulesSettings } from './ports/index.js';
import { RulesQueries } from './rules.queries.js';
import { RulesService } from './rules.service.js';
import { createRulesWorld } from './testing/in-memory.js';

const W = 'w1';
const EDITOR = 'u-editor';

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('no error');
}

function setup(over: Partial<RulesSettings['categorySuggest']> = {}) {
  const world = createRulesWorld();
  const settings: RulesSettings = {
    ...DEFAULT_RULES_SETTINGS,
    categorySuggest: { ...DEFAULT_RULES_SETTINGS.categorySuggest, ...over },
  };
  const deps = { ...world.deps, settings };
  const queries = new RulesQueries(deps);
  const cats: [string, string, 'EXPENSE' | 'INCOME'][] = [
    ['cat-rest', 'Restaurantes', 'EXPENSE'],
    ['cat-super', 'Supermercado', 'EXPENSE'],
    ['cat-hogar', 'Hogar', 'EXPENSE'],
    ['cat-gym', 'Gimnasio', 'EXPENSE'],
    ['cat-far', 'Farmacia', 'EXPENSE'],
    ['cat-regalos', 'Regalos', 'EXPENSE'],
    ['cat-reem', 'Reembolsos', 'INCOME'],
  ];
  for (const [id, name, kind] of cats) world.catalog.categories.set(id, { kind, archived: false, name });
  const service = new CategorySuggestionService(deps, queries);
  return { ...world, deps, queries, service, rulesService: new RulesService(deps) };
}
type World = ReturnType<typeof setup>;

let seq = 0;
function tx(
  w: World,
  over: Partial<ClassificationSubjectDto> = {},
  source = 'MANUAL',
): ClassificationSubjectDto {
  seq += 1;
  const id = `t-${String(seq).padStart(6, '0')}`;
  const s = w.subjects.add({
    transactionId: id,
    description: 'PEDIDOSYA *8811',
    categoryId: 'cat-rest',
    categoryOrigin: 'MANUAL',
    date: '2026-09-10',
    ...over,
  });
  w.subjects.sources.set(id, source);
  return s;
}
const fresh = (over: Partial<RulesSettings['categorySuggest']> = {}): World => setup(over);

/** El historial de TC-CLASSIFICATION-AUTO-001: 9 en Restaurantes y 1 en Supermercado. */
function pedidosYa(w: World) {
  for (let i = 0; i < 9; i += 1) tx(w);
  tx(w, { categoryId: 'cat-super' });
}

describe('consulta de la sugerencia del alta manual', () => {
  it('[TC-CLASSIFICATION-AUTO-001] sugiere Restaurantes con confianza alta para el gasto nuevo', async () => {
    const w = fresh();
    pedidosYa(w);
    const result = await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA *8812' });
    expect(result.status).toBe('SUGGESTED');
    expect(result.ruleId).toBeNull();
    expect(result.suggestion).toMatchObject({
      categoryId: 'cat-rest',
      confidence: '0.9000',
      level: 'HIGH',
      support: 10,
      matches: 9,
      basis: 'DESCRIPTION',
      descriptionKey: 'pedidosya',
    });
  });

  it('[TC-CLASSIFICATION-AUTO-005] las clasificaciones hechas por una regla no cuentan como historial', async () => {
    const w = fresh();
    for (let i = 0; i < 6; i += 1) {
      tx(w, { description: 'HIPERMAXI SUC 12', categoryId: 'cat-super', categoryOrigin: 'RULE' });
    }
    const result = await w.service.query(W, { kind: 'EXPENSE', description: 'HIPERMAXI SUC 12' });
    expect(result).toEqual({ status: 'NONE', suggestion: null, ruleId: null });
  });

  it('[TC-CLASSIFICATION-AUTO-006] una categoría archivada no se sugiere', async () => {
    const w = fresh();
    for (let i = 0; i < 5; i += 1) {
      tx(w, { description: 'GIMNASIO BODYTECH', categoryId: 'cat-gym' });
    }
    expect((await w.service.query(W, { kind: 'EXPENSE', description: 'GIMNASIO BODYTECH' })).status).toBe(
      'SUGGESTED',
    );
    w.service.clearCache();
    w.catalog.categories.set('cat-gym', { kind: 'EXPENSE', archived: true });
    const archived = await w.service.query(W, { kind: 'EXPENSE', description: 'GIMNASIO BODYTECH' });
    expect(archived).toEqual({ status: 'NONE', suggestion: null, ruleId: null });
  });

  it('una categoría de ingreso no se sugiere para un gasto', async () => {
    const w = fresh();
    for (let i = 0; i < 4; i += 1) tx(w, { description: 'DEVOLUCION TIENDA', categoryId: 'cat-reem' });
    const result = await w.service.query(W, { kind: 'EXPENSE', description: 'DEVOLUCION TIENDA' });
    expect(result.status).toBe('NONE');
  });

  it('[TC-CLASSIFICATION-AUTO-009] si una regla de alta manual clasificará el gasto responde RULE_APPLIES sin sugerencia', async () => {
    const w = fresh();
    for (let i = 0; i < 6; i += 1) tx(w, { description: 'HIPERMAXI', categoryId: 'cat-hogar' });
    const rule = await w.rulesService.createRule(EDITOR, W, {
      name: 'Supermercado',
      triggers: ['MANUAL_CREATE'],
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    });
    const result = await w.service.query(W, { kind: 'EXPENSE', description: 'HIPERMAXI' });
    expect(result).toEqual({ status: 'RULE_APPLIES', suggestion: null, ruleId: rule.id });
  });

  it('una regla solo de importación no impide la sugerencia del alta manual', async () => {
    const w = fresh();
    for (let i = 0; i < 6; i += 1) tx(w, { description: 'HIPERMAXI', categoryId: 'cat-hogar' });
    await w.rulesService.createRule(EDITOR, W, {
      name: 'Supermercado',
      triggers: ['IMPORT'],
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    });
    const result = await w.service.query(W, { kind: 'EXPENSE', description: 'HIPERMAXI' });
    expect(result.status).toBe('SUGGESTED');
    expect(result.suggestion?.categoryId).toBe('cat-hogar');
  });

  it('[TC-CLASSIFICATION-AUTO-025] por la contraparte sin descripción: 4 de 5 en Farmacia da 0.8000 (no «la última usada»)', async () => {
    const w = fresh();
    for (let i = 0; i < 4; i += 1) {
      tx(w, {
        description: `COMPRA ${i}`,
        counterpartyId: 'cp-far',
        categoryId: 'cat-far',
        date: `2026-09-0${i + 1}`,
      });
    }
    tx(w, {
      description: 'COMPRA 9',
      counterpartyId: 'cp-far',
      categoryId: 'cat-regalos',
      date: '2026-09-20',
    });
    const result = await w.service.query(W, { kind: 'EXPENSE', counterpartyId: 'cp-far' });
    expect(result.suggestion).toMatchObject({
      categoryId: 'cat-far',
      confidence: '0.8000',
      basis: 'COUNTERPARTY',
      support: 5,
      matches: 4,
    });
  });

  it('[TC-CLASSIFICATION-AUTO-022] con la función deshabilitada la consulta responde DISABLED', async () => {
    const w = fresh({ enabled: false });
    pedidosYa(w);
    expect(await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA' })).toEqual({
      status: 'DISABLED',
      suggestion: null,
      ruleId: null,
    });
    expect(
      (
        await w.service.suggestMany({
          workspaceId: W,
          subjects: [{ ref: 'r1', kind: 'EXPENSE', description: 'PEDIDOSYA', counterpartyId: null }],
        })
      ).size,
    ).toBe(0);
    expect(w.subjects.evidenceQueries).toBe(0);
  });

  it('exige descripción o contraparte y valida los tipos', async () => {
    const w = fresh();
    expect((await failure(w.service.query(W, { kind: 'EXPENSE' }))).code).toBe('VALIDATION_FAILED');
    expect((await failure(w.service.query(W, { kind: 'TRANSFER', description: 'x' }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await failure(w.service.query(W, { kind: 'EXPENSE', description: 'x'.repeat(501) }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await failure(w.service.query(W, { kind: 'EXPENSE', description: '   ' }))).code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('caché del historial', () => {
  it('[TC-CLASSIFICATION-AUTO-026] la segunda consulta usa la caché y vence a los 300 s', async () => {
    const w = fresh();
    pedidosYa(w);
    await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA 1' });
    await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA 2' });
    expect(w.subjects.evidenceQueries).toBe(1);
    // Un gasto clasificado después no se ve hasta que vence la caché (aceptado: hasta 5 minutos).
    tx(w, { categoryId: 'cat-super' });
    (w.clock as FixedClock).set(Instant.parse('2026-10-20T14:04:59.000Z'));
    await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA 3' });
    expect(w.subjects.evidenceQueries).toBe(1);
    (w.clock as FixedClock).set(Instant.parse('2026-10-20T14:05:01.000Z'));
    await w.service.query(W, { kind: 'EXPENSE', description: 'PEDIDOSYA 4' });
    expect(w.subjects.evidenceQueries).toBe(2);
  });

  it('el tope de workspaces en caché descarta el menos usado', async () => {
    const w = fresh({ cacheMaxWorkspaces: 2 });
    pedidosYa(w);
    for (const ws of ['a', 'b', 'a', 'c']) {
      await w.service.query(ws, { kind: 'EXPENSE', description: 'PEDIDOSYA' });
    }
    // a, b, a (acierto), c (descarta b): 3 cargas.
    expect(w.subjects.evidenceQueries).toBe(3);
    await w.service.query('b', { kind: 'EXPENSE', description: 'PEDIDOSYA' });
    expect(w.subjects.evidenceQueries).toBe(4);
  });
});

describe('sugerencias de varias filas (import)', () => {
  it('[TC-CLASSIFICATION-AUTO-010] arma el índice una vez y solo devuelve las filas con sugerencia', async () => {
    const w = fresh();
    pedidosYa(w);
    const out = await w.service.suggestMany({
      workspaceId: W,
      subjects: [
        { ref: 'r1', kind: 'EXPENSE', description: 'PEDIDOSYA *1', counterpartyId: null },
        { ref: 'r2', kind: 'EXPENSE', description: 'COMERCIO NUEVO', counterpartyId: null },
        { ref: 'r3', kind: 'EXPENSE', description: 'PEDIDOSYA *3', counterpartyId: null },
      ],
    });
    expect([...out.keys()]).toEqual(['r1', 'r3']);
    expect(out.get('r1')?.categoryId).toBe('cat-rest');
    expect(w.subjects.evidenceQueries).toBe(1);
  });
});

describe('resultados y tasa de aceptación', () => {
  it('[TC-CLASSIFICATION-AUTO-012] el alta manual registra aceptada, corregida e ignorada según la categoría elegida', async () => {
    const w = fresh();
    const base = { surface: 'MANUAL_ENTRY', level: 'HIGH', suggestedCategoryId: 'cat-rest' };
    await w.service.recordManualOutcome(W, { ...base, chosenCategoryId: 'cat-rest', transactionId: 't-1' });
    await w.service.recordManualOutcome(W, { ...base, chosenCategoryId: 'cat-super' });
    await w.service.recordManualOutcome(W, { ...base, chosenCategoryId: null });
    expect(w.outcomes.records.map((r) => [r.surface, r.level, r.outcome, r.occurredOn])).toEqual([
      ['MANUAL_ENTRY', 'HIGH', 'ACCEPTED', '2026-11-04'],
      ['MANUAL_ENTRY', 'HIGH', 'CORRECTED', '2026-11-04'],
      ['MANUAL_ENTRY', 'HIGH', 'IGNORED', '2026-11-04'],
    ]);
    expect(w.outcomes.records[0]?.transactionId).toBe('t-1');
    // El resultado no guarda descripciones, montos ni categorías.
    expect(Object.keys(w.outcomes.records[0] ?? {}).sort()).toEqual(
      ['id', 'importJobId', 'level', 'occurredOn', 'outcome', 'surface', 'transactionId'].sort(),
    );
  });

  it('valida el cuerpo del resultado', async () => {
    const w = fresh();
    const bad = (over: Record<string, unknown>) =>
      failure(
        w.service.recordManualOutcome(W, {
          surface: 'MANUAL_ENTRY',
          level: 'HIGH',
          suggestedCategoryId: 'cat-rest',
          chosenCategoryId: null,
          ...over,
        }),
      );
    expect((await bad({ surface: 'IMPORT' })).code).toBe('VALIDATION_FAILED');
    expect((await bad({ level: 'LOW' })).code).toBe('VALIDATION_FAILED');
    expect((await bad({ suggestedCategoryId: '' })).code).toBe('VALIDATION_FAILED');
  });

  it('[TC-CLASSIFICATION-AUTO-018] el informe del mes calcula 20 mostradas, 15 aceptadas, 3 corregidas, 2 ignoradas y tasa 0.7500', async () => {
    const w = fresh();
    const rows = [
      ...Array.from({ length: 15 }, () => 'ACCEPTED' as const),
      ...Array.from({ length: 3 }, () => 'CORRECTED' as const),
      ...Array.from({ length: 2 }, () => 'IGNORED' as const),
    ];
    await w.service.recordBatch({
      workspaceId: W,
      surface: 'IMPORT',
      importJobId: 'job-1',
      outcomes: rows.slice(0, 12).map((outcome) => ({
        level: 'HIGH' as const,
        outcome,
        occurredOn: '2026-11-10',
        transactionId: null,
      })),
    });
    await w.service.recordBatch({
      workspaceId: W,
      surface: 'MANUAL_ENTRY',
      importJobId: null,
      outcomes: rows.slice(12).map((outcome) => ({
        level: 'MEDIUM' as const,
        outcome,
        occurredOn: '2026-11-20',
        transactionId: null,
      })),
    });
    // Fuera del mes: no cuenta.
    await w.service.recordBatch({
      workspaceId: W,
      surface: 'IMPORT',
      importJobId: 'job-0',
      outcomes: [{ level: 'HIGH', outcome: 'IGNORED', occurredOn: '2026-10-31', transactionId: null }],
    });
    const stats = await w.service.stats(W, '2026-11-01', '2026-11-30');
    expect(stats).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      shown: 20,
      accepted: 15,
      corrected: 3,
      ignored: 2,
      acceptanceRate: '0.7500',
    });
    expect(stats.bySurface.map((s) => [s.surface, s.shown])).toEqual([
      ['MANUAL_ENTRY', 8],
      ['IMPORT', 12],
    ]);
    expect(stats.byLevel.map((l) => [l.level, l.shown])).toEqual([
      ['HIGH', 12],
      ['MEDIUM', 8],
    ]);
  });

  it('sin sugerencias la tasa es nula y un rango invertido o de más de 366 días es INVALID_FILTER', async () => {
    const w = fresh();
    expect((await w.service.stats(W, '2026-11-01', '2026-11-30')).acceptanceRate).toBeNull();
    expect((await failure(w.service.stats(W, '2026-11-30', '2026-11-01'))).code).toBe('INVALID_FILTER');
    expect((await failure(w.service.stats(W, '2025-01-01', '2026-11-30'))).code).toBe('INVALID_FILTER');
    expect((await failure(w.service.stats(W, 'nov', '2026-11-30'))).code).toBe('INVALID_FILTER');
  });
});

describe('backtesting temporal', () => {
  /**
   * Cuatro meses (junio a septiembre de 2026), 100 transacciones por mes: 75 de patrones con historial (66 en la
   * categoría mayoritaria y 9 en otra) y 25 de comercios nuevos sin historial.
   */
  function seedFourMonths(w: World) {
    for (let i = 0; i < 5; i += 1)
      tx(w, { description: 'COMERCIO ALFA', categoryId: 'cat-super', date: '2026-05-15' });
    const letters = (n: number) =>
      String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + (Math.floor(n / 26) % 26));
    let unique = 0;
    for (const month of ['06', '07', '08', '09']) {
      for (let i = 0; i < 66; i += 1)
        tx(w, { description: 'COMERCIO ALFA', categoryId: 'cat-super', date: `2026-${month}-10` });
      for (let i = 0; i < 9; i += 1)
        tx(w, { description: 'COMERCIO ALFA', categoryId: 'cat-hogar', date: `2026-${month}-11` });
      for (let i = 0; i < 25; i += 1) {
        unique += 1;
        tx(w, {
          description: `NUEVO ${letters(unique)}${letters(unique * 7)}x`,
          categoryId: 'cat-hogar',
          date: `2026-${month}-12`,
        });
      }
    }
  }

  it('[TC-CLASSIFICATION-AUTO-019] cuatro meses: 300 sugerencias sobre 400 transacciones con 264 aciertos dan precisión 0.8800 y cobertura 0.7500', async () => {
    const w = fresh();
    seedFourMonths(w);
    const report = await w.service.backtest(W, { months: 4, asOf: '2026-09' });
    expect(report.total).toMatchObject({
      month: null,
      transactions: 400,
      suggestions: 300,
      hits: 264,
      precision: '0.8800',
      coverage: '0.7500',
      truncated: false,
    });
    expect(report.byMonth.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(report.byMonth.every((m) => m.suggestions === 75 && m.hits === 66)).toBe(true);
    expect(report.byBasis.find((b) => b.basis === 'DESCRIPTION')).toMatchObject({
      suggestions: 300,
      hits: 264,
    });
    // El informe no contiene descripciones ni montos.
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/COMERCIO|NUEVO|amount/iu);
  }, 60_000);

  it('el índice de cada mes usa solo el historial hasta el fin del mes anterior', async () => {
    const w = fresh();
    // Todo el historial es posterior a junio: el primer mes no tiene con qué sugerir.
    for (let i = 0; i < 5; i += 1)
      tx(w, { description: 'COMERCIO BETA', categoryId: 'cat-super', date: '2026-07-10' });
    for (let i = 0; i < 5; i += 1)
      tx(w, { description: 'COMERCIO BETA', categoryId: 'cat-super', date: '2026-06-10' });
    const report = await w.service.backtest(W, { months: 3, asOf: '2026-07' });
    expect(report.byMonth.map((m) => [m.month, m.transactions, m.suggestions])).toEqual([
      ['2026-05', 0, 0],
      ['2026-06', 5, 0],
      ['2026-07', 5, 5],
    ]);
    expect(report.total.precision).toBe('1.0000');
  });

  it('[TC-CLASSIFICATION-AUTO-020] el backtesting exige al menos 3 meses y no calcula nada con menos', async () => {
    const w = fresh();
    const before = w.subjects.evidenceQueries;
    const error = await failure(w.service.backtest(W, { months: 2 }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toMatch(/at least 3 months/u);
    expect(w.subjects.evidenceQueries).toBe(before);
  });
});
