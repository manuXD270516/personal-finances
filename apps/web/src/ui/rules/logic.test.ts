import { describe, expect, it } from 'vitest';
import {
  FIELD_OPERATORS,
  actionTarget,
  applicableItems,
  changeSummary,
  chunk,
  coverageRows,
  draftBody,
  draftDefinition,
  draftFromSeed,
  emptyAction,
  emptyCondition,
  emptyDraft,
  moveId,
  operandShape,
  percentText,
  ruleTextFromDescription,
  ruleToDraft,
  seedFromQuery,
  seedQuery,
  validateDraft,
} from './logic';
import type { Coverage, DryRunItem, Rule } from './types';

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'Supermercado',
  description: null,
  priority: 100,
  enabled: true,
  status: 'ACTIVE',
  triggers: ['IMPORT', 'RETROACTIVE'],
  matchMode: 'ALL',
  conditions: [
    { field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' },
    { field: 'AMOUNT', operator: 'between', value: '100.00', valueTo: '500.00', currency: 'BOB' },
    { match: 'ANY', items: [{ field: 'DAY_OF_MONTH', operator: 'between', value: 1, valueTo: 5 }] },
  ],
  actions: [{ type: 'SET_CATEGORY', categoryId: 'c1' }, { type: 'MARK_FOR_REVIEW' }],
  stopProcessing: false,
  version: 2,
  rowVersion: 3,
  needsAttention: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('matriz operador × campo', () => {
  it('[TC-RULES-ENGINE-009] los montos no admiten operadores de texto y el texto sí admite la expresión regular', () => {
    expect(FIELD_OPERATORS.AMOUNT).not.toContain('starts_with');
    expect(FIELD_OPERATORS.AMOUNT).not.toContain('contains');
    expect(FIELD_OPERATORS.DESCRIPTION).toContain('matches_regex');
    expect(FIELD_OPERATORS.KIND).toEqual(['equals', 'not_equals', 'in']);
    expect(operandShape('between')).toBe('range');
    expect(operandShape('is_empty')).toBe('none');
    expect(operandShape('in')).toBe('list');
  });
});

describe('borrador del editor', () => {
  it('[TC-RULES-ENGINE-001] el cuerpo de una regla nueva trae los disparadores por defecto y el monto como texto exacto', () => {
    const draft = emptyDraft({
      name: ' Supermercado ',
      conditions: [
        {
          kind: 'condition',
          ...emptyCondition({ field: 'AMOUNT', operator: 'gt', value: '2000.00', currency: 'BOB' }),
        },
      ],
      actions: [emptyAction({ type: 'SET_CATEGORY', categoryId: 'c1' })],
    });
    expect(validateDraft(draft)).toEqual([]);
    expect(draftBody(draft)).toMatchObject({
      name: 'Supermercado',
      priority: 100,
      triggers: ['IMPORT', 'RETROACTIVE'],
      conditions: [{ field: 'AMOUNT', operator: 'gt', value: '2000.00', currency: 'BOB' }],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'c1' }],
    });
  });

  it('un borrador de una regla guardada vuelve a producir la misma definición (ida y vuelta)', () => {
    const r = rule();
    const body = draftBody(ruleToDraft(r));
    expect(body.conditions).toEqual(r.conditions);
    expect(body.actions).toEqual(r.actions);
    expect(body.matchMode).toBe('ALL');
    expect(draftDefinition(ruleToDraft(r))).not.toHaveProperty('name');
  });

  it('[TC-RULES-ENGINE-012] los días de la semana y del mes viajan como enteros y los grupos como un solo nivel', () => {
    const draft = emptyDraft({
      name: 'x',
      conditions: [
        {
          kind: 'group',
          match: 'ANY',
          items: [
            emptyCondition({ field: 'WEEKDAY', operator: 'equals', value: '1' }),
            emptyCondition({ field: 'DESCRIPTION', value: 'uber' }),
          ],
        },
      ],
      actions: [emptyAction({ type: 'MARK_FOR_REVIEW' })],
    });
    expect(draftBody(draft).conditions).toEqual([
      {
        match: 'ANY',
        items: [
          { field: 'WEEKDAY', operator: 'equals', value: 1 },
          { field: 'DESCRIPTION', operator: 'contains', value: 'uber' },
        ],
      },
    ]);
  });

  it('[TC-RULES-ENGINE-002] valida nombre, operandos, destinos, límites y disparadores antes de llamar a la API', () => {
    expect(validateDraft(emptyDraft()).map((e) => e.key)).toEqual(
      expect.arrayContaining(['nameRequired', 'operandRequired', 'targetRequired']),
    );
    const many = emptyDraft({
      name: 'x',
      triggers: [],
      conditions: Array.from({ length: 21 }, () => ({
        kind: 'condition' as const,
        ...emptyCondition({ value: 'a' }),
      })),
      actions: Array.from({ length: 11 }, () => emptyAction({ type: 'MARK_FOR_REVIEW' })),
    });
    expect(validateDraft(many).map((e) => e.key)).toEqual(
      expect.arrayContaining(['triggersRequired', 'tooManyConditions', 'tooManyActions']),
    );
    expect(validateDraft(emptyDraft({ name: 'x', priority: '-1' })).map((e) => e.key)).toContain(
      'priorityInvalid',
    );
    expect(validateDraft(emptyDraft({ name: 'x', conditions: [], actions: [] })).map((e) => e.key)).toEqual(
      expect.arrayContaining(['conditionsRequired', 'actionsRequired']),
    );
  });
});

describe('listado', () => {
  it('[TC-RULES-ENGINE-043] reordenar mueve una posición y no sale de los extremos', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('describe el destino de una acción con el nombre del catálogo', () => {
    const names = {
      category: (id: string) => (id === 'c1' ? 'Supermercado' : undefined),
      tag: () => 'hogar',
      counterparty: () => undefined,
      account: () => undefined,
    };
    expect(actionTarget({ type: 'SET_CATEGORY', categoryId: 'c1' }, names)).toBe('Supermercado');
    expect(actionTarget({ type: 'ADD_TAG', tagId: 't' }, names)).toBe('hogar');
    expect(actionTarget({ type: 'SET_COUNTERPARTY', counterpartyId: 'zz' }, names)).toBe('zz');
    expect(actionTarget({ type: 'MARK_FOR_REVIEW' }, names)).toBe('');
  });
});

describe('dry-run', () => {
  const item = (id: string, applicable = true): DryRunItem => ({
    transactionId: id,
    version: 1,
    applicable,
    reasons: applicable ? [] : ['TRANSACTION_RECONCILED'],
    changes: [{ field: 'categoryId', before: null, after: 'c1', ruleId: 'r1', ruleVersion: 1 }],
  });

  it('[TC-RULES-ENGINE-029] se aplica por páginas de 500 y solo lo aplicable', () => {
    const many = Array.from({ length: 1201 }, (_, i) => item(`t${i}`));
    expect(chunk(many, 500).map((p) => p.length)).toEqual([500, 500, 201]);
    expect(chunk([], 500)).toEqual([]);
    expect(applicableItems([item('a'), item('b', false)]).map((i) => i.transactionId)).toEqual(['a']);
    expect(changeSummary([item('a'), item('b')])).toEqual({ categoryId: 2 });
  });
});

describe('cobertura', () => {
  const coverage: Coverage = {
    count: 200,
    byOrigin: { rule: 148, counterpartyDefault: 20, manual: 12, systemDefault: 20, unknown: 0 },
    ruleCoverage: '0.7400',
    target: '0.7000',
    meetsTarget: true,
    byRule: [],
  };

  it('[TC-RULES-ENGINE-044] el cociente se presenta con dos decimales en el locale de formato y el desglose cuadra', () => {
    expect(percentText('0.7400', 'es-BO')).toBe('74,00 %');
    expect(percentText('0.7323', 'es-BO')).toBe('73,23 %');
    expect(percentText('0.7193', 'en-US')).toBe('71.93 %');
    expect(coverageRows(coverage).reduce((n, r) => n + r.count, 0)).toBe(coverage.count);
  });
});

describe('crear regla desde una fila', () => {
  it('[TC-RULES-ENGINE-054] normaliza la descripción sin números de referencia y prellena tipo, categoría y contraparte', () => {
    expect(ruleTextFromDescription('TIGO MONEY RECARGA 77712345')).toBe('tigo money recarga');
    expect(ruleTextFromDescription('PAGO QR  CAFÉ Alexander')).toBe('pago qr cafe alexander');
    expect(ruleTextFromDescription('COMPRA TARJ ****1234 FARMACORP')).toBe('compra tarj farmacorp');
    const draft = draftFromSeed({
      description: 'TIGO MONEY RECARGA 77712345',
      kind: 'EXPENSE',
      categoryId: 'cat-tel',
    });
    expect(draftBody(draft)).toMatchObject({
      conditions: [
        { field: 'DESCRIPTION', operator: 'contains', value: 'tigo money recarga' },
        { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
      ],
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-tel' }],
    });
  });

  it('la semilla viaja por la URL y vuelve igual; una URL ajena no inventa campos', () => {
    const seed = { description: 'NETFLIX 04', kind: 'EXPENSE' as const, accountId: 'a1', categoryId: 'c1' };
    expect(seedFromQuery(new URLSearchParams(seedQuery(seed)))).toEqual(seed);
    expect(seedFromQuery(new URLSearchParams('kind=OTRO&x=1'))).toEqual({});
  });
});
