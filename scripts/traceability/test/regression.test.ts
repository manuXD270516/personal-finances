import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/check.js';
import {
  buildRegressionSuite,
  kindOf,
  renderRegressionMarkdown,
  runRegressionSuite,
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

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** Fixture con un archivo unit de la suite (`src/<name>.test.ts`) y vitest resuelto desde el repositorio real. */
async function repoWithUnitFile(content: string) {
  const root = makeRepo();
  markRegression(root, ['TC-DEMO-CORE-001']);
  writeFileSync(join(root, 'packages', 'demo', 'package.json'), '{"name":"@demo/pkg","private":true}\n');
  mkdirSync(join(root, 'packages', 'demo', 'src'), { recursive: true });
  writeFileSync(join(root, 'packages', 'demo', 'src', 'periodos.test.ts'), content);
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  const suite = buildRegressionSuite(await loadModel({ root, openspec: 'markdown' }));
  return { root, suite };
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

  it('clasifica los tests por tipo de ejecución', () => {
    expect(kindOf('packages/x/src/a.test.ts')).toBe('unit');
    expect(kindOf('packages/x/test/integration/a.int.test.ts')).toBe('integration');
    expect(kindOf('apps/api/test/api/a.api.test.ts')).toBe('integration');
    expect(kindOf('scripts/stack/test/stack/a.stack.test.ts')).toBe('stack');
    expect(kindOf('tests/e2e/specs/a.spec.ts')).toBe('e2e');
  });

  it('[TC-PLATFORM-PIPELINE-012] arma el comando vitest del grupo (config de integración solo para integration; e2e no se ejecuta aquí)', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const unit = vitestCommand(root, {
      package: 'scripts/traceability',
      kind: 'unit',
      files: ['test/regression.test.ts'],
      ids: ['TC-PLATFORM-TRACE-001'],
    });
    expect(unit?.slice(1)).toEqual(['run', '--passWithNoTests', 'test/regression.test.ts']);
    const integration = vitestCommand(root, {
      package: 'packages/contexts/planning',
      kind: 'integration',
      files: ['test/integration/pg-planning.int.test.ts'],
      ids: ['TC-PLANNING-PERIOD-002'],
    });
    expect(integration?.slice(1)).toEqual([
      'run',
      '--config',
      'vitest.integration.config.ts',
      '--passWithNoTests',
      'test/integration/pg-planning.int.test.ts',
    ]);
    for (const argv of [unit, integration]) {
      expect(argv).not.toContain('-t');
      expect(argv).not.toContain('--testNamePattern');
      expect(argv?.some((a) => a.includes('TC-'))).toBe(false);
    }
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

describe('Ejecución de la suite con archivos completos', () => {
  it('[TC-PLATFORM-PIPELINE-010] un TC que depende del estado de un test anterior sin TC pasa y el grupo queda en verde', async () => {
    const { root, suite } = await repoWithUnitFile(
      [
        `import { expect, it } from 'vitest';`,
        `const periodos: string[] = [];`,
        `it('crea los periodos 2026-10..2027-01 (sin TC)', () => { periodos.push('2026-10'); });`,
        `it('${tag('TC-DEMO-CORE-001')} rechaza un 2026-10 solapado', () => { expect(periodos).toContain('2026-10'); });`,
        '',
      ].join('\n'),
    );
    const outcomes = runRegressionSuite(root, suite, ['unit'], () => {});
    expect(outcomes.map((o) => o.status)).toEqual(['passed']);
    expect(renderRegressionMarkdown(suite, outcomes)).toMatch(/\| verde \|/);
    const cli = await runCli([
      'regression',
      '--root',
      root,
      '--openspec',
      'markdown',
      '--run',
      '--kinds',
      'unit',
    ]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toContain('Financial Regression Suite en verde.');
  }, 120_000);

  it('[TC-PLATFORM-PIPELINE-011] un test sin TC que falla en un archivo de la suite pone el grupo en rojo y el reporte nombra paquete y archivo', async () => {
    const { root, suite } = await repoWithUnitFile(
      [
        `import { expect, it } from 'vitest';`,
        `it('${tag('TC-DEMO-CORE-001')} pasa', () => {});`,
        `it('test sin TC con una aserción falsa', () => { expect(1).toBe(2); });`,
        '',
      ].join('\n'),
    );
    const outcomes = runRegressionSuite(root, suite, ['unit'], () => {});
    expect(outcomes.map((o) => o.status)).toEqual(['failed']);
    const md = renderRegressionMarkdown(suite, outcomes);
    expect(md).toContain('## Grupos en rojo');
    expect(md).toMatch(/- `packages\/demo` \(unit\): .*`src\/periodos\.test\.ts`/);
    const cli = await runCli([
      'regression',
      '--root',
      root,
      '--openspec',
      'markdown',
      '--run',
      '--kinds',
      'unit',
    ]);
    expect(cli.code).toBe(1);
    expect(cli.stderr).toMatch(/en rojo: packages\/demo \(unit\): .*src\/periodos\.test\.ts/);
    expect(readFileSync(join(root, 'tests', 'traceability', 'regression-suite.md'), 'utf8')).toContain(
      '| rojo |',
    );
  }, 120_000);
});

describe('CLI: separador `--` reenviado por pnpm', () => {
  it('las opciones después de `--` se respetan (p. ej. --base de R11 o --kinds)', async () => {
    expect((await runCli(['check', '--', '--base', 'ref-inexistente-xyz', '--root', makeRepo()])).code).toBe(
      2,
    );
    expect((await runCli(['regression', '--', '--kinds', 'e2e'])).code).toBe(2);
  });
});
