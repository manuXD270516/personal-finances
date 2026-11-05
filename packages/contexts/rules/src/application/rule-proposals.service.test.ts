import { DomainError } from '@pf/shared-kernel';
import type { ClassificationSubjectDto } from '@pf/transactions/contracts';
import { describe, expect, it } from 'vitest';
import { proposalFingerprint, type ProposalPattern } from '../domain/index.js';
import { DEFAULT_RULES_SETTINGS } from './ports/index.js';
import { RuleProposalsService } from './rule-proposals.service.js';
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

function setup(settings = DEFAULT_RULES_SETTINGS) {
  const world = createRulesWorld();
  const deps = { ...world.deps, settings };
  const queries = new RulesQueries(deps);
  const cats: [string, string, 'EXPENSE' | 'INCOME'][] = [
    ['cat-tel', 'Telefonía', 'EXPENSE'],
    ['cat-rest', 'Restaurantes', 'EXPENSE'],
    ['cat-far', 'Farmacia', 'EXPENSE'],
    ['cat-rec', 'Recargas', 'EXPENSE'],
    ['cat-reem', 'Reembolsos', 'INCOME'],
  ];
  for (const [id, name, kind] of cats) world.catalog.categories.set(id, { kind, archived: false, name });
  world.catalog.categories.set('cat-super', { kind: 'EXPENSE', archived: false, name: 'Supermercado' });
  world.catalog.counterparties.set('cp-far', { archived: false, name: 'Farmacorp' });
  return {
    ...world,
    deps,
    queries,
    service: new RulesService(deps),
    proposals: new RuleProposalsService(deps, queries),
  };
}
type World = ReturnType<typeof setup>;

let seq = 0;
/** Una transacción de evidencia (gasto clasificado a mano) por omisión. */
function tx(
  w: World,
  over: Partial<ClassificationSubjectDto> = {},
  source = 'MANUAL',
): ClassificationSubjectDto {
  seq += 1;
  const id = `t-${String(seq).padStart(5, '0')}`;
  const s = w.subjects.add({
    transactionId: id,
    description: 'TIGO MONEY RECARGA 77712345',
    categoryId: 'cat-tel',
    categoryOrigin: 'MANUAL',
    date: '2026-09-10',
    ...over,
  });
  w.subjects.sources.set(id, source);
  return s;
}
const tigo = (w: World, n: number, over: Partial<ClassificationSubjectDto> = {}) =>
  Array.from({ length: n }, (_, i) => tx(w, { date: `2026-09-${String(10 + i).padStart(2, '0')}`, ...over }));

const TIGO_PATTERN: ProposalPattern = {
  type: 'DESCRIPTION',
  value: 'tigo money recarga',
  kind: 'EXPENSE',
  categoryId: 'cat-tel',
};
const fp = proposalFingerprint(TIGO_PATTERN);

describe('listado de sugerencias', () => {
  it('[TC-RULES-SUGGEST-001] sugiere la regla de Tigo con evidencia, nombre propuesto y disparadores por omisión', async () => {
    const w = setup();
    tx(w, { description: 'TIGO MONEY RECARGA 77712345', date: '2026-07-02' });
    tx(w, { description: 'TIGO MONEY RECARGA 77754321', date: '2026-08-10' });
    tx(w, { description: 'TIGO MONEY RECARGA 70011122', date: '2026-09-15' });
    tx(w, { description: 'TIGO MONEY RECARGA 77712345', date: '2026-10-28' });
    const out = await w.proposals.list(W);
    expect(out).toMatchObject({ from: '2026-05-08', to: '2026-11-04', scanned: 4, truncated: false });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      suggestionId: fp,
      pattern: TIGO_PATTERN,
      categoryName: 'Telefonía',
      support: 4,
      evidenceCount: 4,
      confidence: '1.0000',
      confidenceLevel: 'MEDIUM',
      status: 'OPEN',
      conflicts: [],
      warnings: [],
      proposedRule: {
        name: 'Telefonía: tigo money recarga',
        priority: 100,
        matchMode: 'ALL',
        conditions: [
          { field: 'DESCRIPTION', operator: 'contains', value: 'tigo money recarga' },
          { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
        ],
        actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
        triggers: ['IMPORT', 'RETROACTIVE'],
        stopProcessing: false,
      },
    });
    expect(out.items[0]!.evidence.map((e) => e.date)).toEqual([
      '2026-10-28',
      '2026-09-15',
      '2026-08-10',
      '2026-07-02',
    ]);
  });

  it('[TC-RULES-SUGGEST-002] dos repeticiones no generan sugerencia', async () => {
    const w = setup();
    tigo(w, 2);
    expect((await w.proposals.list(W)).items).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-003] la evidencia fuera de la ventana de 180 días no cuenta', async () => {
    const w = setup();
    tx(w, { date: '2026-04-20' });
    tx(w, { date: '2026-09-01' });
    tx(w, { date: '2026-10-01' });
    expect((await w.proposals.list(W)).items).toEqual([]);
    // con una ventana de 366 días el del 2026-04-20 entra
    expect((await w.proposals.list(W, { windowDays: 366 })).items).toHaveLength(1);
  });

  it('[TC-RULES-SUGGEST-003] la ventana debe estar entre 1 y 366 días', async () => {
    const w = setup();
    for (const days of [0, 367, 1.5]) {
      expect((await failure(w.proposals.list(W, { windowDays: days }))).code).toBe('VALIDATION_FAILED');
    }
  });

  it('[TC-RULES-SUGGEST-015] muestra hasta 20 transacciones de evidencia y los contraejemplos con su categoría', async () => {
    const w = setup();
    tigo(w, 25, { description: 'PEDIDOSYA', categoryId: 'cat-rest' });
    tx(w, { description: 'PEDIDOSYA', categoryId: 'cat-super', date: '2026-10-01' });
    const [s] = (await w.proposals.list(W)).items;
    expect(s).toMatchObject({
      support: 25,
      evidenceCount: 26,
      confidence: '0.9615',
      confidenceLevel: 'HIGH',
    });
    expect(s!.evidence).toHaveLength(20);
    expect(s!.counterExamples).toHaveLength(1);
    expect(s!.counterExamples[0]).toMatchObject({ categoryId: 'cat-super', date: '2026-10-01' });
  });

  it('[TC-RULES-SUGGEST-015] una sugerencia por contraparte lleva el nombre de la contraparte', async () => {
    const w = setup();
    tigo(w, 4, { description: 'FARMACORP SUC 3', counterpartyId: 'cp-far', categoryId: 'cat-far' });
    const [s] = (await w.proposals.list(W)).items;
    expect(s).toMatchObject({
      pattern: { type: 'COUNTERPARTY', value: 'cp-far', kind: 'EXPENSE', categoryId: 'cat-far' },
      patternLabel: 'Farmacorp',
      proposedRule: {
        name: 'Farmacia: Farmacorp',
        conditions: [
          { field: 'COUNTERPARTY', operator: 'equals', value: 'cp-far' },
          { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
        ],
      },
    });
  });

  it('[TC-RULES-SUGGEST-004] una categoría archivada no cuenta como evidencia', async () => {
    const w = setup();
    tigo(w, 4);
    w.catalog.categories.set('cat-tel', { kind: 'EXPENSE', archived: true, name: 'Telefonía' });
    expect((await w.proposals.list(W)).items).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-023] indica que la evidencia quedó truncada a las más recientes', async () => {
    const settings = {
      ...DEFAULT_RULES_SETTINGS,
      suggest: { ...DEFAULT_RULES_SETTINGS.suggest, maxEvidence: 5 },
    };
    const w = setup(settings);
    // 3 antiguas de una glosa y 5 recientes de otra: solo entran las 5 más recientes.
    tigo(w, 3, { description: 'GIMNASIO BODYTECH', categoryId: 'cat-rest', date: '2026-06-01' });
    tigo(w, 5, { description: 'PEDIDOSYA', categoryId: 'cat-rest', date: '2026-10-01' });
    const out = await w.proposals.list(W);
    expect(out).toMatchObject({ scanned: 5, truncated: true });
    expect(out.items.map((i) => i.pattern.value)).toEqual(['pedidosya']);
  });

  it('[TC-RULES-SUGGEST-024] devuelve como máximo 50 sugerencias, por apoyo, confianza y patrón', async () => {
    const w = setup();
    for (let i = 0; i < 52; i += 1) {
      tigo(w, 3, {
        description: `COMERCIO ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} LOCAL`,
      });
    }
    tigo(w, 5, { description: 'ZZ MAYOR LOCAL' });
    const out = await w.proposals.list(W);
    expect(out.items).toHaveLength(50);
    expect(out.items[0]!.pattern.value).toBe('zz mayor local');
    expect(out.items[0]!.support).toBe(5);
  });

  it('[TC-RULES-SUGGEST-020] hace una sola consulta de evidencia por listado', async () => {
    const w = setup();
    tigo(w, 4);
    await w.proposals.list(W);
    expect(w.subjects.evidenceQueries).toBe(1);
  });
});

describe('cobertura y conflictos con reglas activas', () => {
  it('[TC-RULES-SUGGEST-013] un patrón ya cubierto por una regla activa no se sugiere', async () => {
    const w = setup();
    tigo(w, 4);
    await w.service.createRule(EDITOR, W, {
      name: 'Tigo',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo money' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
    });
    expect((await w.proposals.list(W)).items).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-013] una regla solo de importación también cubre el patrón', async () => {
    const w = setup();
    tigo(w, 4);
    await w.service.createRule(EDITOR, W, {
      name: 'Tigo importación',
      triggers: ['IMPORT'],
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo money' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
    });
    expect((await w.proposals.list(W)).items).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-013] una regla inactiva no cubre el patrón', async () => {
    const w = setup();
    tigo(w, 4);
    const rule = await w.service.createRule(EDITOR, W, {
      name: 'Tigo',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo money' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
    });
    await w.service.disableRule(EDITOR, W, rule.id, rule.rowVersion);
    expect((await w.proposals.list(W)).items).toHaveLength(1);
  });

  it('[TC-RULES-SUGGEST-014] un conflicto informa la regla y propone una prioridad una unidad menor', async () => {
    const w = setup();
    tigo(w, 3, { description: 'FARMACORP SUC 3', categoryId: 'cat-far' });
    await w.service.createRule(EDITOR, W, {
      name: 'Supermercado',
      priority: 100,
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'farmacorp' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    });
    const [s] = (await w.proposals.list(W)).items;
    expect(s!.conflicts).toEqual([
      expect.objectContaining({
        name: 'Supermercado',
        version: 1,
        priority: 100,
        categoryId: 'cat-super',
        count: 3,
      }),
    ]);
    expect(s!.proposedRule.priority).toBe(99);
    expect(s!.warnings).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-014] avisa CANNOT_OUTRANK cuando la regla en conflicto ya tiene prioridad 0', async () => {
    const w = setup();
    tigo(w, 3, { description: 'FARMACORP SUC 3', categoryId: 'cat-far' });
    await w.service.createRule(EDITOR, W, {
      name: 'Supermercado',
      priority: 0,
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'farmacorp' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    });
    const [s] = (await w.proposals.list(W)).items;
    expect(s!.proposedRule.priority).toBe(0);
    expect(s!.warnings).toEqual(['CANNOT_OUTRANK']);
  });
});

describe('vista previa', () => {
  it('[TC-RULES-SUGGEST-016] cuenta coincidencias, lo que completaría y lo que ya tiene una categoría, sin efectos', async () => {
    const w = setup();
    tigo(w, 4); // MANUAL en Telefonía
    for (let i = 0; i < 3; i += 1) {
      tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT', date: `2026-10-0${i + 1}` });
    }
    for (let i = 0; i < 2; i += 1) {
      tx(w, { categoryId: 'cat-rec', categoryOrigin: 'COUNTERPARTY_DEFAULT', date: `2026-10-1${i}` });
    }
    tx(w, { description: 'FARMACORP SUC 3', categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' });
    const before = JSON.stringify([...w.subjects.byId.values()]);
    const out = await w.proposals.preview(W, { suggestionId: fp, pattern: TIGO_PATTERN });
    expect(out).toMatchObject({
      from: '2026-05-08',
      to: '2026-11-04',
      scanned: 10,
      truncated: false,
      matched: 9,
      wouldFill: 3,
      alreadyInCategory: 4,
      otherCategory: 2,
      notApplicable: 0,
    });
    expect(out.items).toHaveLength(9);
    expect(out.items.filter((i) => i.outcome === 'WOULD_FILL')).toHaveLength(3);
    expect(JSON.stringify([...w.subjects.byId.values()])).toBe(before);
    expect(w.audit.entries).toEqual([]);
    expect(w.rules.states.size).toBe(0);
    expect(w.decisions.byId.size).toBe(0);
    expect(w.classifier.calls).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-016] usa los mismos motivos de no aplicable que el dry-run', async () => {
    const w = setup();
    tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT', managedBy: 'DEBT' });
    tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT', status: 'RECONCILED' });
    tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT', splitCount: 2 });
    const out = await w.proposals.preview(W, { suggestionId: fp, pattern: TIGO_PATTERN });
    expect(out).toMatchObject({ matched: 3, wouldFill: 0, notApplicable: 3 });
    expect(out.items.map((i) => i.reasons).sort()).toEqual([
      ['MULTI_SPLIT'],
      ['TRANSACTION_MANAGED_EXTERNALLY'],
      ['TRANSACTION_RECONCILED'],
    ]);
  });

  it('[TC-RULES-SUGGEST-016] prueba la definición editada por el usuario', async () => {
    const w = setup();
    tx(w, { description: 'TIGO MONEY RECARGA 1', categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' });
    tx(w, { description: 'OTRA COSA', categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' });
    const out = await w.proposals.preview(W, {
      suggestionId: fp,
      pattern: TIGO_PATTERN,
      definition: {
        conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'otra' }],
        actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-rest' }],
      },
    });
    expect(out).toMatchObject({ matched: 1, wouldFill: 1 });
    expect(out.items[0]).toMatchObject({ proposedCategoryId: 'cat-rest', outcome: 'WOULD_FILL' });
    // el caché de reglas compiladas no se contamina con la regla transitoria
    const again = await w.proposals.preview(W, { suggestionId: fp, pattern: TIGO_PATTERN });
    expect(again).toMatchObject({ matched: 1, wouldFill: 1 });
    expect(again.items[0]!.description).toBe('TIGO MONEY RECARGA 1');
  });

  it('[TC-RULES-SUGGEST-016] limita los ítems a 200 sin perder los conteos', async () => {
    const w = setup();
    for (let i = 0; i < 205; i += 1) tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' });
    const out = await w.proposals.preview(W, { suggestionId: fp, pattern: TIGO_PATTERN });
    expect(out.matched).toBe(205);
    expect(out.items).toHaveLength(200);
  });

  it('[TC-RULES-SUGGEST-016] rechaza una huella que no corresponde al patrón', async () => {
    const w = setup();
    const err = await failure(
      w.proposals.preview(W, {
        suggestionId: proposalFingerprint({ ...TIGO_PATTERN, value: 'otra' }),
        pattern: TIGO_PATTERN,
      }),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });
});

describe('aceptación', () => {
  const accept = (w: World, over: Record<string, unknown> = {}) =>
    w.service.createRule(EDITOR, W, {
      name: 'Recargas Tigo',
      conditions: [
        { field: 'DESCRIPTION', operator: 'contains', value: 'tigo money recarga' },
        { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
      ],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
      fromSuggestion: { suggestionId: fp, pattern: TIGO_PATTERN },
      ...over,
    });

  it('[TC-RULES-SUGGEST-017] crea la regla en la versión 1 con la sugerencia de origen y sin reclasificar', async () => {
    const w = setup();
    tigo(w, 4);
    const uncategorized = tx(w, { categoryId: null, categoryOrigin: 'SYSTEM_DEFAULT' });
    const created = await accept(w);
    expect(created).toMatchObject({ version: 1, name: 'Recargas Tigo', triggers: ['IMPORT', 'RETROACTIVE'] });
    expect(w.decisions.byId.get(fp)).toMatchObject({
      decision: 'ACCEPTED',
      ruleId: created.id,
      support: 4,
      evidenceCount: 4,
      confidence: '1.0000',
    });
    expect(w.classifier.calls).toEqual([]);
    expect(w.subjects.byId.get(uncategorized.transactionId)!.categoryId).toBeNull();
    expect(w.audit.entries.map((e) => e.action)).toEqual(['rules.rule.created', 'rules.suggestion.accepted']);
    const view = (await w.queries.list(W))[0]!;
    expect(view.fromSuggestion).toMatchObject({ suggestionId: fp });
    // una sugerencia aceptada no vuelve a mostrarse
    expect((await w.proposals.list(W, { includeDismissed: true })).items).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-018] aceptar dos veces se rechaza con RULE_SUGGESTION_DECIDED y no crea otra regla', async () => {
    const w = setup();
    tigo(w, 4);
    await accept(w);
    const err = await failure(accept(w, { name: 'Otro nombre' }));
    expect(err.code).toBe('RULE_SUGGESTION_DECIDED');
    expect(w.rules.states.size).toBe(1);
    // incluso con el mismo nombre responde la decisión, no NAME_TAKEN
    expect((await failure(accept(w))).code).toBe('RULE_SUGGESTION_DECIDED');
  });

  it('[TC-RULES-SUGGEST-018] aceptar una sugerencia descartada se rechaza', async () => {
    const w = setup();
    await w.proposals.dismiss(EDITOR, W, fp, TIGO_PATTERN);
    expect((await failure(accept(w))).code).toBe('RULE_SUGGESTION_DECIDED');
    expect(w.rules.states.size).toBe(0);
  });

  it('[TC-RULES-SUGGEST-017] una huella que no corresponde al patrón es VALIDATION_FAILED y no crea nada', async () => {
    const w = setup();
    const err = await failure(
      accept(w, { fromSuggestion: { suggestionId: 'a'.repeat(64), pattern: TIGO_PATTERN } }),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(w.rules.states.size).toBe(0);
    expect(w.decisions.byId.size).toBe(0);
  });

  it('[TC-RULES-SUGGEST-017] sin fromSuggestion crear una regla no cambia (TC-RULES-ENGINE-001)', async () => {
    const w = setup();
    await accept(w, { fromSuggestion: undefined });
    expect(w.decisions.byId.size).toBe(0);
    expect(w.audit.entries.map((e) => e.action)).toEqual(['rules.rule.created']);
  });
});

describe('descartar y restaurar', () => {
  it('[TC-RULES-SUGGEST-019] una sugerencia descartada no reaparece aunque crezca su evidencia', async () => {
    const w = setup();
    tigo(w, 4, { description: 'PEDIDOSYA', categoryId: 'cat-rest' });
    const pattern: ProposalPattern = {
      type: 'DESCRIPTION',
      value: 'pedidosya',
      kind: 'EXPENSE',
      categoryId: 'cat-rest',
    };
    const id = proposalFingerprint(pattern);
    await w.proposals.dismiss(EDITOR, W, id, pattern);
    tigo(w, 3, { description: 'PEDIDOSYA', categoryId: 'cat-rest', date: '2026-10-20' });
    expect((await w.proposals.list(W)).items).toEqual([]);
    const withDismissed = await w.proposals.list(W, { includeDismissed: true });
    expect(withDismissed.items).toHaveLength(1);
    expect(withDismissed.items[0]).toMatchObject({ suggestionId: id, support: 7, status: 'DISMISSED' });
    expect(w.audit.entries.map((e) => e.action)).toEqual(['rules.suggestion.dismissed']);
    expect(w.audit.entries[0]!.aggregateType).toBe('RuleSuggestion');
  });

  it('[TC-RULES-SUGGEST-019] descartar dos veces responde RULE_SUGGESTION_DECIDED', async () => {
    const w = setup();
    await w.proposals.dismiss(EDITOR, W, fp, TIGO_PATTERN);
    expect((await failure(w.proposals.dismiss(EDITOR, W, fp, TIGO_PATTERN))).code).toBe(
      'RULE_SUGGESTION_DECIDED',
    );
  });

  it('[TC-RULES-SUGGEST-028] restaurar una descartada la vuelve a mostrar', async () => {
    const w = setup();
    tigo(w, 4);
    await w.proposals.dismiss(EDITOR, W, fp, TIGO_PATTERN);
    expect((await w.proposals.list(W)).items).toEqual([]);
    await w.proposals.restore(EDITOR, W, fp);
    const out = await w.proposals.list(W);
    expect(out.items.map((i) => [i.suggestionId, i.status])).toEqual([[fp, 'OPEN']]);
    expect(w.audit.entries.map((e) => e.action)).toEqual([
      'rules.suggestion.dismissed',
      'rules.suggestion.restored',
    ]);
  });

  it('[TC-RULES-SUGGEST-028] restaurar una aceptada es RULE_SUGGESTION_DECIDED y una sin decisión es 404', async () => {
    const w = setup();
    expect((await failure(w.proposals.restore(EDITOR, W, fp))).code).toBe('RESOURCE_NOT_FOUND');
    await w.service.createRule(EDITOR, W, {
      name: 'Recargas Tigo',
      conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'tigo' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
      fromSuggestion: { suggestionId: fp, pattern: TIGO_PATTERN },
    });
    expect((await failure(w.proposals.restore(EDITOR, W, fp))).code).toBe('RULE_SUGGESTION_DECIDED');
  });
});

describe('sin efectos', () => {
  it('[TC-RULES-SUGGEST-020] listar y probar no crea reglas ni decisiones ni auditoría', async () => {
    const w = setup();
    tigo(w, 4);
    await w.proposals.list(W);
    await w.proposals.preview(W, { suggestionId: fp, pattern: TIGO_PATTERN });
    expect(w.rules.states.size).toBe(0);
    expect(w.decisions.byId.size).toBe(0);
    expect(w.audit.entries).toEqual([]);
    expect(w.classifier.calls).toEqual([]);
  });
});
