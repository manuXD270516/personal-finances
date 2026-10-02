import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { buildMatrix, renderMatrixMarkdown } from '../src/matrix.js';
import type { MatrixJson } from '../src/matrix.js';
import { makeRepo, runCli } from './helpers.js';

describe('matriz de trazabilidad', () => {
  it('[TC-PLATFORM-TRACE-006] la matriz lista cada TC catalogado con su estado de automatización y la cadena FR → test', async () => {
    const root = makeRepo('broken-reference');
    const run = await runCli(['matrix', '--root', root, '--openspec', 'markdown']);
    expect(run.code).toBe(0);

    const json = JSON.parse(readFileSync(join(root, 'tests/traceability/matrix.json'), 'utf8')) as MatrixJson;
    const md = readFileSync(join(root, 'tests/traceability/matrix.md'), 'utf8');

    // Cada TC del catálogo aparece (incluidos los que no enlazan a un requirement existente).
    const catalogIds = ['TC-DEMO-CORE-001', 'TC-DEMO-CORE-002', 'TC-DEMO-CORE-003'].concat(
      ['001', '002', '003', '004'].map((n) => `TC-DEMO-REF-${n}`),
    );
    expect(json.testCases.map((tc) => tc.id).sort()).toEqual(catalogIds.sort());
    for (const id of catalogIds) expect(md).toContain(id);
    expect(json.testCases.find((tc) => tc.id === 'TC-DEMO-CORE-001')).toMatchObject({
      automationStatus: 'automated',
      tests: ['packages/demo/src/core.test.ts'],
      linked: true,
    });
    expect(json.testCases.find((tc) => tc.id === 'TC-DEMO-REF-002')).toMatchObject({ linked: false });

    // Cadena: FR/NFR → capability → requirement → scenario → TC → tests.
    const row = json.rows.find((r) => r.testCase === 'TC-DEMO-CORE-001');
    expect(row).toEqual({
      trace: ['FR-DEMO-001', 'NFR-MAINT-005'],
      spec: 'demo/capability',
      requirement: 'Requirement cubierto',
      priority: 'Must',
      scenario: 'Escenario uno',
      testCase: 'TC-DEMO-CORE-001',
      status: 'ready',
      automationStatus: 'automated',
      tests: ['packages/demo/src/core.test.ts'],
    });
    // Los scenarios y requirements sin TC también aparecen (filas sin caso).
    expect(json.rows).toContainEqual(
      expect.objectContaining({
        requirement: 'Requirement opcional',
        scenario: 'Escenario opcional',
        testCase: null,
      }),
    );
    expect(md).toContain(
      '| FR-DEMO-001, NFR-MAINT-005 | `demo/capability` | Requirement cubierto | Must | Escenario uno |',
    );
    expect(json.summary).toMatchObject({ testCases: 7, automated: 1, requirements: 3, mustRequirements: 2 });
  });

  it('la salida es determinista (sin marcas de tiempo) para poder versionarla', async () => {
    const root = makeRepo();
    const model = (await runCheck({ root, openspec: 'markdown' })).model;
    const a = renderMatrixMarkdown(buildMatrix(model));
    const b = renderMatrixMarkdown(buildMatrix(model));
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('--out escribe en el directorio indicado', async () => {
    const root = makeRepo();
    const run = await runCli(['matrix', '--root', root, '--openspec', 'markdown', '--out', 'salida']);
    expect(run.code).toBe(0);
    expect(existsSync(join(root, 'salida/matrix.md'))).toBe(true);
    expect(existsSync(join(root, 'salida/matrix.json'))).toBe(true);
  });
});
