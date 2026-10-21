import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadWorkflow, readText, ROOT, type Step } from './helpers.js';

const TITLE = 'nightly perf: umbral superado';
const workflow = loadWorkflow('.github/workflows/nightly.yml');
const perf = workflow.jobs['perf']!;

describe('nightly.yml: permisos y aviso por issue del job perf (TC-PLATFORM-PIPELINE-009)', () => {
  it('[TC-PLATFORM-PIPELINE-009] issues: write nunca se declara a nivel de workflow', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  // D284 (fix-nightly-pipeline, decisión 8): `regression` y `mutation` también avisan por issue, cada uno con el suyo,
  // así que ya no se les niega el permiso; la regla sigue rechazándolo a nivel de workflow y en cualquier otro job.
  it('[TC-PLATFORM-PIPELINE-009] solo los jobs regression, mutation, perf y fx-smoke-live declaran issues: write', () => {
    const writers = Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.['issues'] === 'write')
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual(['fx-smoke-live', 'mutation', 'perf', 'regression']);
    expect(Object.keys(workflow.jobs).sort()).toEqual(['fx-smoke-live', 'mutation', 'perf', 'regression']);
  });

  it('[TC-PLATFORM-PIPELINE-009] el job perf tiene exactamente contents: read e issues: write', () => {
    expect(perf.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  const notice = (): Step => {
    const found = perf.steps!.find((s) => s.run?.includes(TITLE));
    expect(found, 'paso de aviso con el título exacto').toBeDefined();
    return found!;
  };

  it('[TC-PLATFORM-PIPELINE-009] el paso de aviso corre solo si el job falla y va después del benchmark', () => {
    const step = notice();
    expect(step.if).toMatch(/failure\(\)/);
    const steps = perf.steps!;
    const bench = steps.findIndex((s) => s.run === 'pnpm perf:bench');
    expect(bench).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(step)).toBeGreaterThan(bench);
  });

  it('[TC-PLATFORM-PIPELINE-009] busca el issue abierto con el título exacto antes de crear y comenta si existe', () => {
    const run = notice().run!;
    const list = run.indexOf('gh issue list');
    const comment = run.indexOf('gh issue comment');
    const create = run.indexOf('gh issue create');
    expect(list).toBeGreaterThanOrEqual(0);
    expect(comment).toBeGreaterThan(list);
    expect(create).toBeGreaterThan(comment);
    expect(run).toMatch(/--state open/);
    expect(run).toMatch(/select\(\.title == /);
    expect(run).toContain('reports/perf/perf-summary.md');
    expect(run).toMatch(/sin reporte/);
    expect(notice().env?.['RUN_URL']).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/);
    expect(notice().env?.['GH_TOKEN']).toBe('${{ github.token }}');
  });

  it('[TC-PLATFORM-PIPELINE-009] los jobs que avisan por issue declaran exactamente contents: read e issues: write', () => {
    for (const name of ['regression', 'mutation']) {
      expect(workflow.jobs[name]!.permissions, name).toEqual({ contents: 'read', issues: 'write' });
    }
  });
});

// fix-nightly-pipeline, decisión 8 (D284): un issue por job, con el patrón del aviso de perf (D270).
describe('nightly.yml: aviso por issue de regression y mutation (TC-PLATFORM-PIPELINE-022 y 023)', () => {
  const TITLES = {
    regression: 'nightly regression: falló',
    mutation: 'nightly mutation: falló',
    perf: TITLE,
  } as const;

  const noticeOf = (job: 'regression' | 'mutation'): Step => {
    const found = workflow.jobs[job]!.steps!.find((s) => s.run?.includes(TITLES[job]));
    expect(found, `${job}: paso de aviso con el título exacto`).toBeDefined();
    return found!;
  };

  it.each([
    ['TC-PLATFORM-PIPELINE-022', 'regression', 'pnpm traceability:regression --run'],
    ['TC-PLATFORM-PIPELINE-023', 'mutation', 'pnpm --filter @pf/shared-kernel run test:mutation'],
  ] as const)(
    '[%s] el paso de aviso de %s corre solo con failure() y va después del paso que puede fallar',
    (_tc, job, failing) => {
      const step = noticeOf(job);
      expect(step.if).toMatch(/failure\(\)/);
      expect(step['continue-on-error']).toBeUndefined();
      const steps = workflow.jobs[job]!.steps!;
      const idx = steps.findIndex((s) => s.run === failing);
      expect(idx, failing).toBeGreaterThanOrEqual(0);
      expect(steps.indexOf(step)).toBeGreaterThan(idx);
      if (job === 'mutation') {
        const identity = steps.findIndex((s) => s.run === 'pnpm --filter @pf/identity run test:coverage');
        expect(steps.indexOf(step)).toBeGreaterThan(identity);
      }
    },
  );

  it.each([
    ['TC-PLATFORM-PIPELINE-022', 'regression', 'tests/traceability/regression-suite.md'],
    ['TC-PLATFORM-PIPELINE-023', 'mutation', 'packages/shared-kernel/coverage/coverage-summary.json'],
  ] as const)(
    '[%s] el aviso de %s busca el issue abierto con el título exacto antes de crear y comenta si existe',
    (_tc, job, summary) => {
      const step = noticeOf(job);
      const run = step.run!;
      const list = run.indexOf('gh issue list');
      const comment = run.indexOf('gh issue comment');
      const create = run.indexOf('gh issue create');
      expect(list).toBeGreaterThanOrEqual(0);
      expect(comment).toBeGreaterThan(list);
      expect(create).toBeGreaterThan(comment);
      expect(run).toMatch(/--state open/);
      expect(run).toMatch(/select\(\.title == /);
      expect(run).toContain(summary);
      expect(run).toMatch(/sin reporte|sin resumen/);
      expect(step.env?.['RUN_URL']).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/);
      expect(step.env?.['GH_TOKEN']).toBe('${{ github.token }}');
    },
  );

  it('[TC-PLATFORM-PIPELINE-023] el aviso de mutation incluye la cobertura y el mutation score', () => {
    const run = noticeOf('mutation').run!;
    expect(run).toContain('packages/contexts/identity/coverage/coverage-summary.json');
    expect(run).toContain('packages/shared-kernel/reports/mutation/mutation.json');
    expect(run).toMatch(/Mutation score/);
  });

  it('[TC-PLATFORM-PIPELINE-022] los títulos de regression, mutation y perf son distintos y cada uno aparece solo en su job', () => {
    const titles = Object.values(TITLES);
    expect(new Set(titles).size).toBe(3);
    for (const [job, title] of Object.entries(TITLES)) {
      for (const [other, def] of Object.entries(workflow.jobs)) {
        const uses = def.steps!.some((s) => s.run?.includes(title));
        expect(uses, `${other} usa el título de ${job}`).toBe(other === job);
      }
    }
  });
});

// fix-nightly-pipeline, decisión 3: la cobertura del shared-kernel cayó a 89.86 % / 84.07 % sin aviso. Los umbrales
// (NFR-MAINT-002: ≥ 95 % de líneas, ≥ 90 % de ramas) solo pueden subir y el paso del nightly es bloqueante.
const MIN_LINES = 95;
const MIN_BRANCHES = 90;

/** Umbrales `thresholds: { lines: N, branches: M }` de un `vitest.config.ts`. */
function coverageThresholds(config: string): { lines: number; branches: number } {
  const m = /thresholds:\s*\{([^}]*)\}/u.exec(config);
  const pick = (key: string) => {
    const v = new RegExp(`\\b${key}:\\s*(\\d+(?:\\.\\d+)?)`, 'u').exec(m?.[1] ?? '');
    return v ? Number(v[1]) : Number.NaN;
  };
  return { lines: pick('lines'), branches: pick('branches') };
}

/** Mensajes de la regla de umbrales (vacío si cumple); nombra el umbral rebajado. */
function thresholdViolations(config: string): string[] {
  const t = coverageThresholds(config);
  const out: string[] = [];
  if (!(t.lines >= MIN_LINES)) out.push(`thresholds.lines = ${t.lines} (< ${MIN_LINES})`);
  if (!(t.branches >= MIN_BRANCHES)) out.push(`thresholds.branches = ${t.branches} (< ${MIN_BRANCHES})`);
  return out;
}

describe('cobertura del núcleo compartido (TC-PLATFORM-PIPELINE-013 y 014)', () => {
  const kernelConfig = () => readText('packages/shared-kernel/vitest.config.ts');
  const mutation = workflow.jobs['mutation']!;

  it('[TC-PLATFORM-PIPELINE-014] los umbrales de packages/shared-kernel/vitest.config.ts son ≥ 95 % de líneas y ≥ 90 % de ramas', () => {
    expect(thresholdViolations(kernelConfig())).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-014] rebajar un umbral hace fallar la regla indicando el umbral modificado', () => {
    const lowered = kernelConfig().replace(/lines:\s*\d+/u, 'lines: 89');
    expect(thresholdViolations(lowered)).toEqual(['thresholds.lines = 89 (< 95)']);
    expect(thresholdViolations(kernelConfig().replace(/branches:\s*\d+/u, 'branches: 84'))).toEqual([
      'thresholds.branches = 84 (< 90)',
    ]);
    expect(thresholdViolations('export default {}')).toHaveLength(2);
    expect(thresholdViolations(kernelConfig().replace(/lines:\s*\d+/u, 'lines: 97'))).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-013] el paso de cobertura del job mutation ejecuta test:coverage del shared-kernel y es bloqueante', () => {
    const step = mutation.steps!.find((s) => s.run === 'pnpm --filter @pf/shared-kernel run test:coverage');
    expect(step, 'paso de cobertura del shared-kernel').toBeDefined();
    expect(step!['continue-on-error']).toBeUndefined();
    expect(step!.if).toBeUndefined();
    expect(mutation['continue-on-error']).toBeUndefined();
    expect(workflow.jobs['mutation']!.steps!.indexOf(step!)).toBeLessThan(
      mutation.steps!.findIndex((s) => s.run?.includes('test:mutation')),
    );
  });

  it('[TC-PLATFORM-PIPELINE-013] el script test:coverage del shared-kernel corre vitest con --coverage (usa los umbrales)', () => {
    const pkg = JSON.parse(readText('packages/shared-kernel/package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:coverage']).toMatch(/vitest run .*--coverage/u);
  });
});

// fix-nightly-pipeline, decisión 5: los benchmarks miden latencia, no la política de cuotas. Toda suite `*.perf.ts` que
// configure la API lo hace con el helper compartido (`perfApiEnv` o `PERF_RATE_LIMITS`).
const CONFIGURES_API = /\b(createApiRuntime|startHarness|apiConfig)\(/u;
const USES_HELPER = /\b(perfApiEnv\(|PERF_RATE_LIMITS\b)/u;
const RAW_BASE_ENV = /(?<!workerConfig\()\bbaseEnv\(/u;

/** Suites que configuran la API sin el helper compartido (o con `baseEnv` directo): sus nombres. */
function perfSuiteViolations(suites: readonly { file: string; content: string }[]): string[] {
  return suites
    .filter(
      ({ content }) =>
        RAW_BASE_ENV.test(content) || (CONFIGURES_API.test(content) && !USES_HELPER.test(content)),
    )
    .map(({ file }) => file);
}

describe('suites de benchmark y cuotas (TC-PLATFORM-PIPELINE-019)', () => {
  const dir = 'apps/api/test/perf';
  const suites = readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.perf.ts'))
    .map((f) => ({ file: `${dir}/${f}`, content: readText(`${dir}/${f}`) }));

  it('[TC-PLATFORM-PIPELINE-019] hay suites de benchmark y todas configuran la API con el helper compartido', () => {
    expect(suites.length).toBeGreaterThanOrEqual(8);
    expect(perfSuiteViolations(suites)).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-019] una suite que configura la API con baseEnv(deps) y las cuotas por defecto falla indicando el archivo', () => {
    const fixture = [
      {
        file: `${dir}/nueva.perf.ts`,
        content: 'runtime = await createApiRuntime(apiConfig(baseEnv(deps)), log, {});',
      },
      { file: `${dir}/sin-helper.perf.ts`, content: 'const h = await startHarness({ worker: true });' },
      {
        file: `${dir}/ok.perf.ts`,
        content: 'createApiRuntime(apiConfig(perfApiEnv(deps)), log, {}); workerConfig(baseEnv(deps))',
      },
      { file: `${dir}/ok-harness.perf.ts`, content: 'startHarness({ apiEnv: PERF_RATE_LIMITS });' },
    ];
    expect(perfSuiteViolations(fixture)).toEqual([`${dir}/nueva.perf.ts`, `${dir}/sin-helper.perf.ts`]);
  });

  it('[TC-PLATFORM-PIPELINE-018] los benchmarks del simulador de estrategias y de disponible para gastar usan las cuotas relajadas y nombran el TC', () => {
    // La ejecución real (200 simulaciones sin 429, p95 frente a 300 ms) corre en `pnpm perf:bench`; aquí se fija la
    // configuración que la hace posible (los `.perf.ts` no entran en el escáner de trazabilidad).
    for (const file of ['loan-simulator.perf.ts', 'spendable.perf.ts']) {
      const content = suites.find((s) => s.file.endsWith(file))?.content ?? '';
      expect(content, file).toMatch(/apiConfig\(perfApiEnv\(deps\)\)/u);
      expect(content, file).toContain('[TC-PLATFORM-PIPELINE-018]');
    }
  });

  it('[TC-PLATFORM-PIPELINE-019] el helper relaja las tres cuotas por encima de las solicitudes de cualquier suite', () => {
    const helper = readText(`${dir}/perf-env.ts`);
    for (const name of [
      'RATE_LIMIT_READS_PER_MIN',
      'RATE_LIMIT_WRITES_PER_MIN',
      'RATE_LIMIT_COSTLY_PER_MIN',
    ]) {
      const m = new RegExp(`${name}:\\s*'(\\d+)'`, 'u').exec(helper);
      expect(Number(m?.[1]), name).toBeGreaterThanOrEqual(100_000);
    }
  });
});

// fix-nightly-pipeline, seguimiento: con `NIGHTLY=1` fast-check corre 10 000 casos y el timeout por defecto (5 s) de
// vitest se agota (falso rojo de `regression`). Todo test de un archivo que lee `NIGHTLY` y ejecuta `fc.assert`
// declara un timeout explícito (tercer argumento de `it`/`test`).
function nightlyTestsWithoutTimeout(file: string, content: string): string[] {
  if (!/\bNIGHTLY\b/u.test(content)) return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.expression.getText(source)
        : node.expression.getText(source);
      const isTest = callee === 'it' || callee === 'test';
      const [title, body] = node.arguments;
      if (isTest && body && /\bfc\.assert\(/u.test(body.getText(source)) && node.arguments.length < 3) {
        offenders.push(`${file}: ${title?.getText(source).slice(0, 70) ?? '(sin título)'}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

describe('tests con NIGHTLY y timeout explícito (seguimiento de TC-PLATFORM-PIPELINE-010)', () => {
  it('[TC-PLATFORM-PIPELINE-010] todo test con fast-check de un archivo que lee NIGHTLY declara un timeout explícito', () => {
    const files = execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f && !f.startsWith('scripts/delivery-policy/'));
    const scanned = files.filter((f) => /\bNIGHTLY\b/u.test(readText(f)));
    expect(scanned.length).toBeGreaterThanOrEqual(10);
    expect(scanned.flatMap((f) => nightlyTestsWithoutTimeout(f, readText(f)))).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-010] un test con fc.assert sin tercer argumento hace fallar la regla indicando el archivo', () => {
    const bad = `const NIGHTLY = Boolean(process.env.NIGHTLY);\nit('[TC-X-001] a', () => { fc.assert(p, runs); });`;
    const ok = `const NIGHTLY = 1;\nit('[TC-X-002] b', () => { fc.assert(p, runs); }, NIGHTLY ? 300_000 : 15_000);`;
    const noNightly = `it('[TC-X-003] c', () => { fc.assert(p); });`;
    expect(nightlyTestsWithoutTimeout('a.test.ts', bad)).toEqual(["a.test.ts: '[TC-X-001] a'"]);
    expect(nightlyTestsWithoutTimeout('b.test.ts', ok)).toEqual([]);
    expect(nightlyTestsWithoutTimeout('c.test.ts', noNightly)).toEqual([]);
  });
});
