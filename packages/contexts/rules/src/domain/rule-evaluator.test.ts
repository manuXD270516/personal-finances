import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateRules, previewRule, type EvaluableRule } from './rule-evaluator.js';
import { catalog, rule, subject } from './testing.js';
import type { EvaluationMode, RuleTrigger } from './types.js';

const run = (
  rules: EvaluableRule[],
  s = subject(),
  opts: { trigger?: RuleTrigger; mode?: EvaluationMode; cat?: ReturnType<typeof catalog> } = {},
) =>
  evaluateRules({
    rules,
    subjects: [s],
    trigger: opts.trigger ?? 'IMPORT',
    mode: opts.mode ?? 'FILL_EMPTY',
    catalog: opts.cat ?? catalog(),
  })[0]!;

const pollos = subject({ description: 'POLLOS COPACABANA', amount: { amount: '64.00', currency: 'BOB' } });
const contains = (value: string) => [{ field: 'DESCRIPTION', operator: 'contains', value }] as const;

describe('acciones de clasificación', () => {
  it('[TC-RULES-ENGINE-013] propone categoría, etiqueta y contraparte sin tocar el monto', () => {
    const r = rule('supermercado', {
      actions: [
        { type: 'SET_CATEGORY', categoryId: 'cat-super' },
        { type: 'ADD_TAG', tagId: 'tag-hogar' },
        { type: 'SET_COUNTERPARTY', counterpartyId: 'cp-hipermaxi' },
      ],
    });
    const s = subject();
    const out = run([r], s);
    expect(out.category).toEqual({
      categoryId: 'cat-super',
      origin: { ruleId: 'supermercado', ruleVersion: 1 },
    });
    expect(out.addTags.map((t) => t.tagId)).toEqual(['tag-hogar']);
    expect(out.counterparty?.counterpartyId).toBe('cp-hipermaxi');
    expect(s.amount).toEqual({ amount: '185.40', currency: 'BOB' });
  });

  it('[TC-RULES-ENGINE-014] marca para revisión con la regla como motivo', () => {
    const r = rule('grandes', {
      conditions: [
        { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
        { field: 'AMOUNT', operator: 'gt', value: '2000.00', currency: 'BOB' },
      ],
      actions: [{ type: 'MARK_FOR_REVIEW' }],
    });
    const out = run([r], subject({ amount: { amount: '2450.00', currency: 'BOB' } }));
    expect(out.markForReview).toEqual({ ruleId: 'grandes', ruleVersion: 1 });
    expect(run([r], subject()).markForReview).toBeNull();
  });

  it('[TC-RULES-ENGINE-015] renombrar la descripción en la importación', () => {
    const r = rule('netflix', {
      conditions: contains('nflx'),
      actions: [{ type: 'SET_DESCRIPTION', text: 'Netflix' }],
    });
    const s = subject({ description: 'DEB AUT NFLX.COM 0412' });
    expect(run([r], s).description?.text).toBe('Netflix');
    expect(s.description).toBe('DEB AUT NFLX.COM 0412');
  });

  it('[TC-RULES-ENGINE-016] excluir del import solo actúa con el disparador de importación', () => {
    const r = rule('traspasos', {
      conditions: contains('traspaso entre mis cuentas'),
      actions: [{ type: 'EXCLUDE_FROM_IMPORT' }],
    });
    const s = subject({ description: 'TRASPASO ENTRE MIS CUENTAS' });
    expect(run([r], s, { trigger: 'IMPORT' }).exclude).not.toBeNull();
    expect(run([r], s, { trigger: 'RETROACTIVE' }).exclude).toBeNull();
    expect(run([r], s, { trigger: 'MANUAL_CREATE' }).exclude).toBeNull();
  });
});

describe('prioridad y resolución acumulativa', () => {
  const restaurantes = rule('restaurantes', {
    priority: 10,
    conditions: contains('pollos'),
    actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-rest' }],
  });
  const comida = rule('comida', {
    priority: 20,
    conditions: contains('pollos'),
    actions: [
      { type: 'SET_CATEGORY', categoryId: 'cat-super' },
      { type: 'ADD_TAG', tagId: 'tag-comida' },
    ],
  });

  it('[TC-RULES-ENGINE-019] la primera regla fija la categoría y la posterior suma su etiqueta', () => {
    const out = run([comida, restaurantes], pollos);
    expect(out.category).toEqual({
      categoryId: 'cat-rest',
      origin: { ruleId: 'restaurantes', ruleVersion: 1 },
    });
    expect(out.addTags).toEqual([{ tagId: 'tag-comida', origin: { ruleId: 'comida', ruleVersion: 1 } }]);
    expect(out.matched.map((o) => o.ruleId)).toEqual(['restaurantes', 'comida']);
  });

  it('[TC-RULES-ENGINE-020] el empate de prioridad se resuelve por antigüedad y es reproducible', () => {
    const a = rule('a', {
      priority: 50,
      createdAt: '2026-10-01T00:00:00.000Z',
      conditions: contains('pollos'),
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-rest' }],
    });
    const b = rule('b', {
      priority: 50,
      createdAt: '2026-10-02T00:00:00.000Z',
      conditions: contains('pollos'),
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
    });
    expect(run([b, a], pollos).category?.origin.ruleId).toBe('a');
    fc.assert(
      fc.property(fc.shuffledSubarray([a, b], { minLength: 2, maxLength: 2 }), (order) => {
        return run(order, pollos).category?.categoryId === 'cat-rest';
      }),
      { numRuns: 100 },
    );
  });

  it('[TC-RULES-ENGINE-020] PBT: mismo resultado con cualquier orden de carga', () => {
    const rules = Array.from({ length: 6 }, (_, i) =>
      rule(`r${i}`, {
        priority: i % 3,
        createdAt: `2026-10-0${(i % 2) + 1}T00:00:00.000Z`,
        conditions: contains('pollos'),
        actions: [
          { type: 'SET_CATEGORY', categoryId: i % 2 === 0 ? 'cat-rest' : 'cat-super' },
          { type: 'ADD_TAG', tagId: `tag-${i}` },
        ],
      }),
    );
    const expected = JSON.stringify(run(rules, pollos));
    fc.assert(
      fc.property(fc.shuffledSubarray(rules, { minLength: 6, maxLength: 6 }), (order) => {
        const got = run(order, pollos);
        return JSON.stringify({ ...got, addTags: [...got.addTags] }) === expected;
      }),
      { numRuns: 100 },
    );
  });

  it('[TC-RULES-ENGINE-021] stopProcessing impide evaluar las reglas posteriores', () => {
    const stop = { ...restaurantes, stopProcessing: true };
    const out = run([stop, comida], pollos);
    expect(out.category?.categoryId).toBe('cat-rest');
    expect(out.addTags).toEqual([]);
  });

  it('[TC-RULES-ENGINE-022] una regla que detiene pero no coincide no corta la cadena', () => {
    const stop = { ...restaurantes, stopProcessing: true, conditions: contains('no coincide') };
    const out = run([stop, comida], pollos);
    expect(out.category?.categoryId).toBe('cat-super');
    expect(out.addTags).toHaveLength(1);
  });

  it('una etiqueta agregada por una regla no la quita otra posterior', () => {
    const quitar = rule('quitar', {
      priority: 30,
      conditions: contains('pollos'),
      actions: [{ type: 'REMOVE_TAG', tagId: 'tag-comida' }],
    });
    const out = run([comida, quitar], pollos, { mode: 'OVERWRITE' });
    expect(out.addTags.map((t) => t.tagId)).toEqual(['tag-comida']);
    expect(out.removeTags).toEqual([]);
  });

  it('las notas se acumulan en orden de prioridad', () => {
    const n1 = rule('n1', {
      priority: 1,
      conditions: contains('pollos'),
      actions: [{ type: 'APPEND_NOTE', text: 'uno' }],
    });
    const n2 = rule('n2', {
      priority: 2,
      conditions: contains('pollos'),
      actions: [{ type: 'APPEND_NOTE', text: 'dos' }],
    });
    expect(run([n2, n1], pollos).appendNotes.map((n) => n.text)).toEqual(['uno', 'dos']);
  });
});

describe('referencias y acciones no aplicables', () => {
  it('[TC-RULES-ENGINE-023] una categoría archivada omite la acción con su motivo', () => {
    const out = run([rule('super')], subject(), { cat: catalog({ archivedCategories: ['cat-super'] }) });
    expect(out.category).toBeNull();
    expect(out.skipped).toEqual([
      {
        origin: { ruleId: 'super', ruleVersion: 1 },
        action: 'SET_CATEGORY',
        reason: 'RULE_ACTION_TARGET_ARCHIVED',
      },
    ]);
  });

  it('[TC-RULES-ENGINE-024] una acción omitida por el tipo deja fijar el campo a la siguiente regla', () => {
    const a = rule('A', { priority: 10, actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }] });
    const b = rule('B', { priority: 20, actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-reembolsos' }] });
    const income = subject({ kind: 'INCOME', amount: { amount: '40.00', currency: 'BOB' } });
    const out = run([a, b], income);
    expect(out.skipped[0]?.reason).toBe('CATEGORY_KIND_MISMATCH');
    expect(out.category).toEqual({ categoryId: 'cat-reembolsos', origin: { ruleId: 'B', ruleVersion: 1 } });
  });

  it('una transacción con varios splits omite las acciones de split (MULTI_SPLIT)', () => {
    const out = run([rule('super')], subject({ splitCount: 2 }));
    expect(out.category).toBeNull();
    expect(out.skipped[0]?.reason).toBe('MULTI_SPLIT');
  });

  it('[TC-RULES-ENGINE-039] una regla inactiva, archivada o de otro disparador no se evalúa', () => {
    expect(run([rule('x', { enabled: false })]).matched).toEqual([]);
    expect(run([rule('x', { archived: true })]).matched).toEqual([]);
    expect(run([rule('x', { triggers: ['RETROACTIVE'] })], subject(), { trigger: 'IMPORT' }).matched).toEqual(
      [],
    );
  });
});

describe('modos completar y reemplazar', () => {
  it('[TC-RULES-ENGINE-027] completar no toca una categoría ya fijada', () => {
    const out = run([rule('super')], subject({ categoryId: 'cat-hogar' }), {
      mode: 'FILL_EMPTY',
      trigger: 'RETROACTIVE',
    });
    expect(out.category).toBeNull();
    expect(out.skipped[0]?.reason).toBe('NOT_EMPTY');
  });

  it('[TC-RULES-ENGINE-028] reemplazar propone también los campos ya clasificados', () => {
    const out = run([rule('super')], subject({ categoryId: 'cat-hogar' }), {
      mode: 'OVERWRITE',
      trigger: 'RETROACTIVE',
    });
    expect(out.category?.categoryId).toBe('cat-super');
  });

  it('una contraparte reconocida por alias es reemplazable en modo completar', () => {
    const r = rule('cp', { actions: [{ type: 'SET_COUNTERPARTY', counterpartyId: 'cp-nuevo' }] });
    expect(
      run([r], subject({ counterpartyId: 'cp-alias', counterpartyOrigin: 'ALIAS' })).counterparty
        ?.counterpartyId,
    ).toBe('cp-nuevo');
    expect(
      run([r], subject({ counterpartyId: 'cp-user', counterpartyOrigin: 'USER' })).counterparty,
    ).toBeNull();
  });

  it('[TC-RULES-ENGINE-034] en la creación manual solo completa campos vacíos y agrega etiquetas', () => {
    const r = rule('tel', {
      conditions: contains('tigo'),
      actions: [
        { type: 'SET_CATEGORY', categoryId: 'cat-tel' },
        { type: 'ADD_TAG', tagId: 'tag-hogar' },
      ],
    });
    const manual = subject({ description: 'Tigo recarga', amount: { amount: '100.00', currency: 'BOB' } });
    expect(run([r], manual, { trigger: 'MANUAL_CREATE' }).category?.categoryId).toBe('cat-tel');
    const chosen = subject({ ...manual, categoryId: 'cat-regalos' });
    const out = run([r], chosen, { trigger: 'MANUAL_CREATE' });
    expect(out.category).toBeNull();
    expect(out.addTags).toHaveLength(1);
  });

  it('una nota ya presente no se duplica al reaplicar', () => {
    const r = rule('nota', { actions: [{ type: 'APPEND_NOTE', text: 'revisar' }] });
    expect(run([r], subject({ notes: 'ya dice revisar' })).appendNotes).toEqual([]);
  });
});

describe('vista previa', () => {
  const def = rule('tigo', {
    conditions: [
      { field: 'DESCRIPTION', operator: 'contains', value: 'tigo' },
      { field: 'AMOUNT', operator: 'lte', value: '150.00', currency: 'BOB' },
    ],
    actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
  });
  const at = (amount: string) =>
    previewRule({
      rule: def,
      subject: subject({ description: 'TIGO MONEY RECARGA', amount: { amount, currency: 'BOB' } }),
      trigger: 'RETROACTIVE',
      mode: 'FILL_EMPTY',
      catalog: catalog(),
    });

  it('[TC-RULES-ENGINE-025] muestra ambas condiciones cumplidas y la acción', () => {
    const p = at('100.00');
    expect(p.matched).toBe(true);
    expect(p.conditions.map((c) => c.met)).toEqual([true, true]);
    expect(p.outcome.category?.categoryId).toBe('cat-tel');
  });

  it('[TC-RULES-ENGINE-026] muestra la condición de monto no cumplida y ninguna acción', () => {
    const p = at('180.00');
    expect(p.matched).toBe(false);
    expect(p.conditions.map((c) => c.met)).toEqual([true, false]);
    expect(p.conditions[1]?.actual).toBe('180.00 BOB');
    expect(p.outcome.category).toBeNull();
  });
});
