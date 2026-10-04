import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/check.js';
import {
  buildRegressionSuite,
  kindOf,
  renderRegressionMarkdown,
  testNamePattern,
  vitestCommand,
} from '../src/regression.js';
import { makeRepo, runCli } from './helpers.js';

/** `[TC-…]` armado en ejecución: un literal haría que el escáner de trazabilidad atribuya el TC a este archivo. */
const tag = (id: string) => ['[', id, ']'].join('');

/** Marca `regression_suite: true` en los TC indicados del fixture. */
function markRegression(root: string, ids: string[]): void {
  for (const id of ids) {
    const file = join(root, 'tests', 'cases', 'demo', `${id}.md`);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('regression_suite: false', 'regression_suite: true'),
    );
  }
}

function repoWithSuite(): string {
  const root = makeRepo();
  markRegression(root, ['TC-DEMO-CORE-001', 'TC-DEMO-CORE-002']);
  writeFileSync(join(root, 'packages', 'demo', 'package.json'), '{"name":"@demo/pkg","private":true}\n');
  mkdirSync(join(root, 'packages', 'demo', 'test'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'demo', 'test', 'core.int.test.ts'),
    `import { it } from 'vitest';\nit('${tag('TC-DEMO-CORE-001')} integración', () => {});\n`,
  );
  return root;
}

describe('Financial Regression Suite (docs/16 §11.3)', () => {
  it('deriva del front matter los TC con regression_suite: true y agrupa sus tests por paquete y tipo', async () => {
    const root = repoWithSuite();
    const suite = buildRegressionSuite(await loadModel({ root, openspec: 'markdown' }));
    expect(suite.cases.map((c) => c.id)).toEqual(['TC-DEMO-CORE-001', 'TC-DEMO-CORE-002']);
    expect(suite.withoutTests).toEqual(['TC-DEMO-CORE-002']);
    expect(suite.groups).toEqual([
      { package: 'packages/demo', kind: 'unit', files: ['src/core.test.ts'], ids: ['TC-DEMO-CORE-001'] },
      {
        package: 'packages/demo',
        kind: 'integration',
        files: ['test/core.int.test.ts'],
        ids: ['TC-DEMO-CORE-001'],
      },
    ]);
    expect(suite.summary).toMatchObject({ cases: 2, withTests: 1, withoutTests: 1, testFiles: 2 });
    expect(renderRegressionMarkdown(suite)).toContain('- TC-DEMO-CORE-002');
  });

  it('el CLI escribe regression-suite.{json,md}; sin TC marcados la suite queda vacía', async () => {
    const root = repoWithSuite();
    const run = await runCli(['regression', '--root', root, '--openspec', 'markdown']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Financial Regression Suite: 2 TC (1 con tests, 1 sin tests)');
    const json = JSON.parse(
      readFileSync(join(root, 'tests', 'traceability', 'regression-suite.json'), 'utf8'),
    );
    expect(json.summary.cases).toBe(2);
    const empty = buildRegressionSuite(await loadModel({ root: makeRepo(), openspec: 'markdown' }));
    expect(empty.cases).toEqual([]);
    expect((await runCli(['regression', '--kinds', 'e2e'])).code).toBe(2);
  });

  it('clasifica los tests por tipo de ejecución y filtra por TC-ID con un patrón exacto', () => {
    expect(kindOf('packages/x/src/a.test.ts')).toBe('unit');
    expect(kindOf('packages/x/test/integration/a.int.test.ts')).toBe('integration');
    expect(kindOf('apps/api/test/api/a.api.test.ts')).toBe('integration');
    expect(kindOf('scripts/stack/test/stack/a.stack.test.ts')).toBe('stack');
    expect(kindOf('tests/e2e/specs/a.spec.ts')).toBe('e2e');
    const pattern = new RegExp(testNamePattern(['TC-LEDGER-MONEY-004', 'TC-FX-PROVIDER-003']));
    expect(pattern.test(`money ${tag('TC-LEDGER-MONEY-004')} propiedad`)).toBe(true);
    expect(pattern.test(`${tag('TC-LEDGER-MONEY-0045')} otro`)).toBe(false);
    expect(pattern.test(`${tag('TC-LEDGER-MONEY-005')} otro`)).toBe(false);
  });

  it('arma el comando vitest del grupo (config de integración solo para integration; e2e no se ejecuta aquí)', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const unit = vitestCommand(root, {
      package: 'scripts/traceability',
      kind: 'unit',
      files: ['test/regression.test.ts'],
      ids: ['TC-PLATFORM-TRACE-001'],
    });
    expect(unit?.slice(1)).toEqual([
      'run',
      '--passWithNoTests',
      '-t',
      '\\[(TC-PLATFORM-TRACE-001)\\]',
      'test/regression.test.ts',
    ]);
    expect(
      vitestCommand(root, {
        package: 'tests/e2e',
        kind: 'e2e',
        files: ['specs/a.spec.ts'],
        ids: ['TC-X-Y-001'],
      }),
    ).toBeNull();
  });
});

describe('CLI: separador `--` reenviado por pnpm', () => {
  it('las opciones después de `--` se respetan (p. ej. --base de R11 o --kinds)', async () => {
    expect((await runCli(['check', '--', '--base', 'ref-inexistente-xyz', '--root', makeRepo()])).code).toBe(
      2,
    );
    expect((await runCli(['regression', '--', '--kinds', 'e2e'])).code).toBe(2);
  });
});
