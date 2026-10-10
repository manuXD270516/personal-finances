import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { definitionOf } from '../domain/index.js';

const threshold = definitionOf('BUDGET_THRESHOLD');
const closePending = definitionOf('MONTH_CLOSE_PENDING');
const occurrenceDue = definitionOf('RECURRING_PAYMENT_UPCOMING');

// ajv-formats es CJS: según el loader, el default llega envuelto.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

describe('Contrato consumido: los ejemplos publicados por el productor son traducibles', () => {
  for (const [file, definition] of [
    ['planning/BudgetThresholdReached.v1.schema.json', threshold],
    ['planning/MonthClosePending.v1.schema.json', closePending],
    ['commitments/RecurringOccurrenceDue.v1.schema.json', occurrenceDue],
  ] as const) {
    it(`[TC-NOTIFICATIONS-INAPP-007] ${file}: sus examples validan el esquema y producen un plan`, () => {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      const schema = load(file);
      ajv.addSchema(load('envelope.v1.schema.json'));
      const validate = ajv.compile(schema);
      const examples = schema['examples'] as { eventType: string; eventVersion: number; payload: unknown }[];
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) {
        expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
        expect(example.eventType).toBe(definition.event.type);
        expect(example.eventVersion).toBe(definition.event.version);
        expect(() => definition.plan(example.payload)).not.toThrow();
      }
    });
  }
});
