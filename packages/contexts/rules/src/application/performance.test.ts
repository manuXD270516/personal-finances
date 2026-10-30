import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { RuleSubject } from '../domain/index.js';
import { RulesQueries } from './rules.queries.js';
import { RulesService } from './rules.service.js';
import { createRulesWorld } from './testing/in-memory.js';

// Presupuestos de rendimiento del evaluador (NFR-PERF-007 y NFR-PERF-003) sobre el doble en memoria: aísla el costo del
// evaluador puro y de la compilación. La medición contra PostgreSQL real vive en `apps/api/test/perf/rules.perf.ts`.
const W = 'w1';
const U = 'u1';

async function world(rulesCount: number, conditions: number, trigger: 'IMPORT' | 'MANUAL_CREATE') {
  const w = createRulesWorld();
  w.catalog.categories.set('cat-x', { kind: 'EXPENSE', archived: false });
  const service = new RulesService({ ...w.deps, settings: { ...w.deps.settings, maxRules: 1000 } });
  for (let n = 1; n <= rulesCount; n += 1) {
    await service.createRule(U, W, {
      name: `Regla ${n}`,
      priority: n,
      triggers: [trigger],
      conditions: Array.from({ length: conditions }, (_, i) =>
        i === 0 && n === 1
          ? {
              field: 'DESCRIPTION',
              operator: 'matches_regex',
              value: String.raw`comercio 1 (suc|sucursal) \d+`,
            }
          : i % 2 === 0
            ? { field: 'DESCRIPTION', operator: 'contains', value: `comercio ${n}` }
            : { field: 'AMOUNT', operator: 'gte', value: String(1000 + n), currency: 'BOB' },
      ),
      actions: [{ type: 'SET_CATEGORY', categoryId: 'cat-x' }],
    });
  }
  return { ...w, queries: new RulesQueries(w.deps) };
}

const subjects = (n: number): RuleSubject[] =>
  Array.from({ length: n }, (_, i) => ({
    ref: `r${i}`,
    kind: 'EXPENSE',
    accountId: 'acc',
    date: '2026-10-05',
    amount: { amount: `${10 + (i % 997)}.00`, currency: 'BOB' },
    description: `COMERCIO ${i % 400} SUC ${i % 13} REF ${i}`,
    counterpartyId: null,
    counterpartyOrigin: null,
    categoryId: null,
    tagIds: [],
    externalSource: 'imports.csv-row',
    customFields: [],
    splitCount: 1,
  }));

describe('rendimiento del evaluador', () => {
  it('[TC-RULES-ENGINE-050] 5 000 filas contra 200 reglas de 5 condiciones (una con regex) tardan 3 s o menos', async () => {
    const { queries, rules } = await world(200, 5, 'IMPORT');
    const rows = subjects(5000);
    const started = performance.now();
    const out = await queries.evaluate({
      workspaceId: W,
      trigger: 'IMPORT',
      mode: 'FILL_EMPTY',
      subjects: rows,
    });
    const elapsed = performance.now() - started;
    expect(out).toHaveLength(5000);
    expect(rules.evaluableQueries).toBe(1);
    expect(elapsed).toBeLessThanOrEqual(3000);
  }, 60_000);

  it('[TC-RULES-ENGINE-051] evaluar una transacción manual contra 200 reglas añade 20 ms o menos (con las reglas ya compiladas)', async () => {
    const { queries } = await world(200, 5, 'MANUAL_CREATE');
    const one = subjects(1);
    const run = () =>
      queries.evaluate({ workspaceId: W, trigger: 'MANUAL_CREATE', mode: 'FILL_EMPTY', subjects: one });
    await run(); // compila y llena el caché de árboles
    const times: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      await run();
      times.push(performance.now() - started);
    }
    const p95 = [...times].sort((a, b) => a - b)[Math.ceil(0.95 * times.length) - 1] as number;
    expect(p95).toBeLessThanOrEqual(20);
  }, 60_000);

  it('el peor caso (500 reglas de 20 condiciones sobre 5 000 filas) termina y no tiene umbral', async () => {
    const { queries } = await world(500, 20, 'IMPORT');
    const started = performance.now();
    const out = await queries.evaluate({
      workspaceId: W,
      trigger: 'IMPORT',
      mode: 'FILL_EMPTY',
      subjects: subjects(5000),
    });
    expect(out).toHaveLength(5000);
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 120_000);
});
