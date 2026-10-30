import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { compileConditionTree, parseConditionItems, SubjectView, type ConditionItem } from './condition.js';
import { parseDefinition } from './rule-definition.js';
import { subject } from './testing.js';

const parse = (raw: unknown, max = 20) => parseConditionItems(raw, max);
const test = (items: ConditionItem[], s = subject(), match: 'ALL' | 'ANY' = 'ALL') =>
  compileConditionTree(match, items).test(new SubjectView(s));
const err = (fn: () => unknown): DomainError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('no error');
};

describe('condiciones: monto', () => {
  const between = parse([
    { field: 'AMOUNT', operator: 'between', value: '100.00', valueTo: '500.00', currency: 'BOB' },
  ]);
  const amountOf = (amount: string, currency: string) =>
    test(between, subject({ amount: { amount, currency } }));

  it('[TC-RULES-ENGINE-004] compara exacto y solo en su moneda', () => {
    expect(amountOf('250.00', 'BOB')).toBe(true);
    expect(amountOf('500.00', 'BOB')).toBe(true);
    expect(amountOf('500.01', 'BOB')).toBe(false);
    expect(amountOf('250.00', 'USD')).toBe(false);
  });

  it('[TC-RULES-ENGINE-004] exige la moneda y rechaza números de punto flotante', () => {
    expect(err(() => parse([{ field: 'AMOUNT', operator: 'gt', value: '1' }])).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(err(() => parse([{ field: 'AMOUNT', operator: 'gt', value: 1.5, currency: 'BOB' }])).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[TC-RULES-ENGINE-004] 0.1 + 0.2 no genera falsos negativos (decimal exacto)', () => {
    const items = parse([{ field: 'AMOUNT', operator: 'equals', value: '0.30', currency: 'BOB' }]);
    expect(test(items, subject({ amount: { amount: '0.3', currency: 'BOB' } }))).toBe(true);
  });
});

describe('condiciones: fecha, día y tipo', () => {
  const items = parse([
    { field: 'KIND', operator: 'equals', value: 'INCOME' },
    { field: 'DAY_OF_MONTH', operator: 'between', value: 1, valueTo: 5 },
  ]);

  it('[TC-RULES-ENGINE-005] día del mes y tipo sobre la fecha de negocio', () => {
    expect(test(items, subject({ kind: 'INCOME', date: '2026-09-03' }))).toBe(true);
    expect(test(items, subject({ kind: 'INCOME', date: '2026-09-15' }))).toBe(false);
    expect(test(items, subject({ kind: 'EXPENSE', date: '2026-09-03' }))).toBe(false);
  });

  it('[TC-RULES-ENGINE-005] el día de la semana es ISO (lunes = 1, domingo = 7)', () => {
    const monday = parse([{ field: 'WEEKDAY', operator: 'equals', value: 1 }]);
    expect(test(monday, subject({ date: '2026-09-07' }))).toBe(true);
    const sunday = parse([{ field: 'WEEKDAY', operator: 'equals', value: 7 }]);
    expect(test(sunday, subject({ date: '2026-09-06' }))).toBe(true);
  });
});

describe('condiciones: campo personalizado', () => {
  const items = parse([{ field: 'CUSTOM_FIELD', fieldId: 'f-proyecto', operator: 'equals', value: 'casa' }]);

  it('[TC-RULES-ENGINE-006] usa el valor del split', () => {
    expect(test(items, subject({ customFields: [{ fieldId: 'f-proyecto', value: 'casa' }] }))).toBe(true);
    expect(test(items, subject())).toBe(false);
    expect(test(items, subject({ customFields: [{ fieldId: 'f-proyecto', value: 'viaje' }] }))).toBe(false);
  });

  it('compara decimales y fechas de forma exacta', () => {
    const gt = parse([{ field: 'CUSTOM_FIELD', fieldId: 'f-n', operator: 'gt', value: '35.10' }]);
    expect(test(gt, subject({ customFields: [{ fieldId: 'f-n', value: '35.125' }] }))).toBe(true);
    expect(test(gt, subject({ customFields: [{ fieldId: 'f-n', value: '35.1' }] }))).toBe(false);
  });
});

describe('condiciones: texto', () => {
  it('[TC-RULES-ENGINE-007] contains ignora acentos, mayúsculas y espacios repetidos', () => {
    const items = parse([{ field: 'DESCRIPTION', operator: 'contains', value: 'cafe' }]);
    expect(test(items, subject({ description: 'PAGO QR  CAFÉ Alexander' }))).toBe(true);
    expect(test(items, subject({ description: 'PAGO QR TE' }))).toBe(false);
  });

  it('operadores starts_with, ends_with, not_contains, in y matches_regex', () => {
    const s = subject({ description: 'DEB AUT NFLX.COM 0412' });
    expect(test(parse([{ field: 'DESCRIPTION', operator: 'starts_with', value: 'deb aut' }]), s)).toBe(true);
    expect(test(parse([{ field: 'DESCRIPTION', operator: 'ends_with', value: '0412' }]), s)).toBe(true);
    expect(test(parse([{ field: 'DESCRIPTION', operator: 'not_contains', value: 'uber' }]), s)).toBe(true);
    expect(
      test(parse([{ field: 'DESCRIPTION', operator: 'in', values: ['uber', 'deb aut nflx.com 0412'] }]), s),
    ).toBe(true);
    expect(
      test(parse([{ field: 'DESCRIPTION', operator: 'matches_regex', value: String.raw`nflx\.com \d+` }]), s),
    ).toBe(true);
  });
});

describe('condiciones: contraparte vacía', () => {
  it('[TC-RULES-ENGINE-008] is_empty distingue gastos sin contraparte', () => {
    const items = parse([{ field: 'COUNTERPARTY', operator: 'is_empty' }]);
    expect(test(items, subject({ counterpartyId: null }))).toBe(true);
    expect(test(items, subject({ counterpartyId: 'cp-hipermaxi', counterpartyOrigin: 'USER' }))).toBe(false);
  });
});

describe('condiciones: validación al guardar', () => {
  it('[TC-RULES-ENGINE-009] un operador incompatible con el campo se rechaza con el puntero', () => {
    const e = err(() => parse([{ field: 'AMOUNT', operator: 'starts_with', value: '100', currency: 'BOB' }]));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.violations[0]?.pointer).toBe('/conditions/0/operator');
  });

  it('[TC-RULES-ENGINE-010] regex con referencia hacia atrás, lookaround o larga ⇒ RULE_INVALID_REGEX', () => {
    for (const value of [String.raw`(a+)\1`, '(?=a)b', 'a'.repeat(201)]) {
      expect(err(() => parse([{ field: 'DESCRIPTION', operator: 'matches_regex', value }])).code).toBe(
        'RULE_INVALID_REGEX',
      );
    }
  });

  it('[TC-RULES-ENGINE-011] un patrón patológico se evalúa sin bloqueo', () => {
    const items = parse([{ field: 'DESCRIPTION', operator: 'matches_regex', value: '(a|aa)*b' }]);
    const started = performance.now();
    expect(test(items, subject({ description: 'a'.repeat(500) }))).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('[TC-RULES-ENGINE-002] entre 1 y 20 condiciones, contando las de los grupos', () => {
    expect(err(() => parse([])).code).toBe('VALIDATION_FAILED');
    const one = { field: 'DESCRIPTION', operator: 'contains', value: 'x' };
    expect(parse(Array.from({ length: 20 }, () => one))).toHaveLength(20);
    expect(err(() => parse(Array.from({ length: 21 }, () => one))).code).toBe('VALIDATION_FAILED');
    const grouped = [
      { match: 'ANY', items: Array.from({ length: 15 }, () => one) },
      ...Array.from({ length: 6 }, () => one),
    ];
    expect(err(() => parse(grouped)).code).toBe('VALIDATION_FAILED');
  });

  it('[TC-RULES-ENGINE-012] un segundo nivel de grupos se rechaza', () => {
    const one = { field: 'DESCRIPTION', operator: 'contains', value: 'x' };
    const e = err(() => parse([{ match: 'ANY', items: [{ match: 'ALL', items: [one] }] }]));
    expect(e.code).toBe('VALIDATION_FAILED');
  });

  it('[TC-RULES-ENGINE-012] un grupo ANY dentro de una regla ALL', () => {
    const items = parse([
      { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
      {
        match: 'ANY',
        items: [
          { field: 'DESCRIPTION', operator: 'contains', value: 'uber' },
          { field: 'DESCRIPTION', operator: 'contains', value: 'yango' },
        ],
      },
    ]);
    const yango = subject({
      kind: 'EXPENSE',
      description: 'YANGO VIAJE',
      amount: { amount: '18.50', currency: 'BOB' },
    });
    const uberIncome = subject({ kind: 'INCOME', description: 'UBER REEMBOLSO' });
    expect(test(items, yango)).toBe(true);
    expect(test(items, uberIncome)).toBe(false);
  });
});

describe('definición', () => {
  const base = {
    conditions: [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
    actions: [{ type: 'SET_CATEGORY', categoryId: 'c1' }],
  };

  it('[TC-RULES-ENGINE-001] sin disparadores nace con importación y ejecución retroactiva (D337)', () => {
    expect(parseDefinition(base).triggers).toEqual(['IMPORT', 'RETROACTIVE']);
  });

  it('[TC-RULES-ENGINE-002] sin acciones o fuera de los límites ⇒ VALIDATION_FAILED', () => {
    expect(err(() => parseDefinition({ ...base, actions: [] })).code).toBe('VALIDATION_FAILED');
    const tag = { type: 'ADD_TAG', tagId: 't' };
    expect(err(() => parseDefinition({ ...base, actions: Array.from({ length: 11 }, () => tag) })).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(parseDefinition({ ...base, actions: Array.from({ length: 10 }, () => tag) }).actions).toHaveLength(
      10,
    );
  });

  it('[TC-RULES-ENGINE-017] una acción sobre monto, moneda, cuenta, fecha, tipo o estado se rechaza', () => {
    for (const bad of [
      { type: 'SET_AMOUNT', amount: '100.00', currency: 'BOB' },
      { type: 'SET_CATEGORY', categoryId: 'c1', amount: '100.00' },
      { type: 'SET_CATEGORY', categoryId: 'c1', accountId: 'a' },
      { type: 'SET_CATEGORY', categoryId: 'c1', status: 'VOIDED' },
      { type: 'SET_CATEGORY', categoryId: 'c1', date: '2026-01-01' },
      { type: 'SET_CATEGORY', categoryId: 'c1', kind: 'INCOME' },
    ]) {
      expect(err(() => parseDefinition({ ...base, actions: [bad] })).code).toBe('VALIDATION_FAILED');
    }
  });

  it('el límite de condiciones es configurable', () => {
    const many = Array.from({ length: 3 }, () => base.conditions[0]);
    expect(
      err(() => parseDefinition({ ...base, conditions: many }, { maxConditions: 2, maxActions: 10 })).code,
    ).toBe('VALIDATION_FAILED');
  });
});
