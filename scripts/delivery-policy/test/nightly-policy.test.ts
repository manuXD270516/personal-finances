import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWorkflow, readText, ROOT, type Step } from './helpers.js';

const TITLE = 'nightly perf: umbral superado';
const workflow = loadWorkflow('.github/workflows/nightly.yml');
const perf = workflow.jobs['perf']!;

describe('nightly.yml: permisos y aviso por issue del job perf (TC-PLATFORM-PIPELINE-009)', () => {
  it('[TC-PLATFORM-PIPELINE-009] issues: write nunca se declara a nivel de workflow', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('[TC-PLATFORM-PIPELINE-009] solo los jobs perf y fx-smoke-live declaran issues: write', () => {
    const writers = Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.['issues'] === 'write')
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual(['fx-smoke-live', 'perf']);
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

  it('[TC-PLATFORM-PIPELINE-009] el job perf no es un check requerido ni cambia a los demás jobs', () => {
    for (const name of ['regression', 'mutation']) {
      expect(workflow.jobs[name]!.permissions, name).toBeUndefined();
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
