import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parseActions, parseConditionItems } from '../domain/index.js';

const load = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../../contracts/rules/${name}`, import.meta.url)), 'utf8'),
  ) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
const conditions = ajv.compile(load('conditions.v1.schema.json'));
const actions = ajv.compile(load('actions.v1.schema.json'));

const conditionsSchema = load('conditions.v1.schema.json');
const actionsSchema = load('actions.v1.schema.json');

describe('JSON Schema del DSL (contracts/rules)', () => {
  it('[TC-RULES-ENGINE-017] los ejemplos de condiciones y acciones son válidos y los acepta el dominio', () => {
    for (const example of conditionsSchema['examples'] as unknown[]) {
      expect(conditions(example), JSON.stringify(conditions.errors)).toBe(true);
      expect(() => parseConditionItems(example, 20)).not.toThrow();
    }
    for (const example of actionsSchema['examples'] as unknown[]) {
      expect(actions(example), JSON.stringify(actions.errors)).toBe(true);
      expect(() => parseActions(example, 10)).not.toThrow();
    }
  });

  it('[TC-RULES-ENGINE-017] una acción sobre monto, moneda, cuenta, fecha, tipo o estado es inválida en el esquema y en el dominio', () => {
    const invalid = [
      [{ type: 'SET_AMOUNT', amount: '100.00', currency: 'BOB' }],
      [{ type: 'SET_CATEGORY', categoryId: 'c', amount: '100.00' }],
      [{ type: 'SET_CATEGORY', categoryId: 'c', accountId: 'a' }],
      [{ type: 'SET_CATEGORY', categoryId: 'c', status: 'VOIDED' }],
      [{ type: 'SET_CATEGORY', categoryId: 'c', date: '2026-01-01' }],
      [{ type: 'SET_CATEGORY', categoryId: 'c', kind: 'INCOME' }],
      [],
    ];
    for (const example of invalid) {
      expect(actions(example)).toBe(false);
      expect(() => parseActions(example, 10)).toThrow();
    }
  });

  it('[TC-RULES-ENGINE-009] una condición inválida lo es en el esquema y en el dominio', () => {
    const invalid = [
      [{ field: 'AMOUNT', operator: 'gt', value: '1' }], // sin moneda
      [{ field: 'DESCRIPTION', operator: 'contains', value: 'x', currency: 'BOB' }], // moneda ajena
      [{ field: 'CUSTOM_FIELD', operator: 'equals', value: 'x' }], // sin fieldId
      [{ field: 'DESCRIPTION', operator: 'is_empty', value: 'x' }],
      [{ field: 'DESCRIPTION', operator: 'in' }],
      [{ field: 'DESCRIPTION', operator: 'nope', value: 'x' }],
      [
        {
          match: 'ANY',
          items: [{ match: 'ALL', items: [{ field: 'DESCRIPTION', operator: 'contains', value: 'x' }] }],
        },
      ],
    ];
    for (const example of invalid) {
      expect(conditions(example)).toBe(false);
      expect(() => parseConditionItems(example, 20)).toThrow();
    }
  });
});
