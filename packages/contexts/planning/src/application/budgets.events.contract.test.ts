import { readFileSync } from 'node:fs';
import { Instant } from '@pf/shared-kernel';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { BudgetCalculator } from './budget-calculator.js';
import { BudgetThresholdService } from './budget-thresholds.service.js';
import { BudgetsService } from './budgets.service.js';
import { InMemoryBudgets } from './testing/in-memory-budgets.js';

// ajv-formats es CJS: según el loader, el default llega envuelto.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
const load = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, EVENTS), 'utf8')) as Record<string, unknown>;

function payloadValidator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = load(schemaPath);
  ajv.addSchema(load('envelope.v1.schema.json'));
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
}

const W = '0190a000-0000-7000-8000-00000000a001';
const REST = '0190a000-0000-7000-8000-000000000003';
const G = '0190a000-0000-7000-8000-000000000100';

describe('Contrato del productor planning.BudgetCreated.v1 y planning.BudgetThresholdReached.v1 (tarea 4.3)', () => {
  it('[TC-PLANNING-THRESHOLD-003] los payloads escritos en el outbox cumplen sus JSON Schema; un campo extra o un umbral inválido no', async () => {
    const env = new InMemoryBudgets();
    env.mem.workspace(W);
    env.mem.clock.set(Instant.parse('2026-11-10T15:00:00Z'));
    env.tree = {
      groups: [{ groupId: G, name: 'Alimentación', kind: 'EXPENSE', archived: false }],
      categories: [
        {
          categoryId: REST,
          name: 'Restaurantes',
          kind: 'EXPENSE',
          groupId: G,
          parentId: null,
          systemCode: null,
          archived: false,
        },
      ],
      tags: [],
    };
    const nov = env.mem.seed(W, '2026-11', 'ACTIVE');
    const deps = env.deps();
    const service = new BudgetsService(deps);
    const budget = await service.createBudget({ workspaceId: W, periodId: nov.id });
    await service.addLine({
      workspaceId: W,
      budgetId: budget.id,
      target: { kind: 'CATEGORY', id: REST },
      spec: { kind: 'MAXIMUM', planned: { amount: '600.00', currency: 'BOB' } },
    });
    env.flow('2026-11-05', 'EXPENSE', REST, '550.00');
    await new BudgetThresholdService(deps, new BudgetCalculator(deps)).evaluateWorkspace(W);

    const created = env.mem.events.filter((e) => e.eventType === 'planning.BudgetCreated');
    const reached = env.mem.events.filter((e) => e.eventType === 'planning.BudgetThresholdReached');
    expect(created).toHaveLength(1);
    expect(reached).toHaveLength(1);
    expect(created[0]).toMatchObject({ eventVersion: 1, aggregateType: 'Budget', aggregateId: budget.id });
    expect(reached[0]).toMatchObject({ eventVersion: 1, aggregateType: 'Budget', aggregateId: budget.id });

    const validateCreated = payloadValidator('planning/BudgetCreated.v1.schema.json');
    expect(validateCreated(created[0]!.payload), JSON.stringify(validateCreated.errors)).toBe(true);
    expect(validateCreated({ ...(created[0]!.payload as object), extra: 1 })).toBe(false);

    const validateReached = payloadValidator('planning/BudgetThresholdReached.v1.schema.json');
    expect(validateReached(reached[0]!.payload), JSON.stringify(validateReached.errors)).toBe(true);
    expect(reached[0]!.payload).toMatchObject({ threshold: '90', alsoCrossed: ['50', '75'] });
    expect(validateReached({ ...(reached[0]!.payload as object), threshold: '90%' })).toBe(false);
    expect(validateReached({ ...(reached[0]!.payload as object), alsoCrossed: [90] })).toBe(false);
    expect(validateReached({ ...(reached[0]!.payload as object), extra: 1 })).toBe(false);
    // Cada hecho lleva una versión de agregado distinta (el outbox exige unicidad por agregado, tipo y versión).
    expect(reached[0]!.aggregateVersion).toBeGreaterThan(created[0]!.aggregateVersion);
  });
});
