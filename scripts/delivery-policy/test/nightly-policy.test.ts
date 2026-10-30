import { execFileSync, spawnSync } from 'node:child_process';
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

// investigate-perf-under-load, decisión 5 (TC-PLATFORM-PIPELINE-028): los umbrales de los benchmarks son los de docs/02
// §PERF (NFR-PERF-001..009). Un rojo de `perf` no se cierra subiendo el umbral ni volviendo informativa una fila bloqueante:
// cambiarlos exige editar esta tabla (EXPECTED_THRESHOLDS / BLOCKING_RESULT_IDS) con la decisión del owner (D-id) que lo
// aprueba, y la revisión del PR lo comprueba. D43 (docs/31): qué filas son bloqueantes. D112 (docs/33): ≥ 42 ev/s.
// D152 (docs/33): la persistencia del import ≤ 20 s se exige por omisión desde add-bulk-imported-transactions (sin techo de
// regresión ni PF_PERF_STRICT_IMPORT). D285 y D292 (docs/46, docs/48): la fila de throughput con handler real sigue informativa.
type ThresholdUnit = 'ms' | 'ev/s';

interface ExpectedThreshold {
  /** `NFR-PERF-00x` o `NFR-PERF-00x:<variante>`. */
  readonly key: string;
  readonly unit: ThresholdUnit;
  readonly value: number;
  /** Fragmento que docs/02 debe contener en la fila del NFR. */
  readonly doc: string;
}

const EXPECTED_THRESHOLDS: readonly ExpectedThreshold[] = [
  { key: 'NFR-PERF-001', unit: 'ms', value: 300, doc: 'local ≤ 300 ms p95' },
  { key: 'NFR-PERF-001:cloud', unit: 'ms', value: 200, doc: 'p95 server time ≤ **200 ms**' },
  { key: 'NFR-PERF-002', unit: 'ms', value: 400, doc: 'p95 ≤ 400 ms' },
  { key: 'NFR-PERF-003', unit: 'ms', value: 150, doc: 'p95 ≤ **150 ms**' },
  { key: 'NFR-PERF-004', unit: 'ms', value: 300, doc: 'p95 ≤ **300 ms**' },
  { key: 'NFR-PERF-005', unit: 'ms', value: 50, doc: 'p95 ≤ 50 ms por cuenta' },
  { key: 'NFR-PERF-005:all', unit: 'ms', value: 150, doc: '≤ 150 ms para todas las cuentas' },
  { key: 'NFR-PERF-006', unit: 'ms', value: 800, doc: 'p95 ≤ 800 ms' },
  { key: 'NFR-PERF-007:preview', unit: 'ms', value: 30_000, doc: '≤ 30 s end-to-end' },
  { key: 'NFR-PERF-007:persist', unit: 'ms', value: 20_000, doc: 'persistencia ≤ 20 s' },
  { key: 'NFR-PERF-008', unit: 'ev/s', value: 42, doc: '≥ 42 eventos/s por consumidor' },
  { key: 'NFR-PERF-008:drain', unit: 'ms', value: 120_000, doc: '≤ 120 s' },
  { key: 'NFR-PERF-009', unit: 'ms', value: 10_000, doc: '≤ 10 s por workspace' },
];

/** Umbral que declara el código del benchmark (en `perf-report.ts` o como constante local de una suite). */
interface ThresholdFact {
  /** Dónde está y qué mide: archivo y constante, p. ej. `spendable.perf.ts BUDGET_MS`. */
  readonly benchmark: string;
  readonly key: string;
  readonly unit: ThresholdUnit;
  readonly value: number;
}

/** Violaciones de la regla (vacío si cumple); cada mensaje nombra el benchmark, el umbral nuevo y el de docs/02. */
function thresholdFactViolations(
  facts: readonly ThresholdFact[],
  expected: readonly ExpectedThreshold[] = EXPECTED_THRESHOLDS,
): string[] {
  return facts.flatMap((fact) => {
    const want = expected.find((e) => e.key === fact.key);
    if (!want) return [`${fact.benchmark}: ${fact.key} no está en la tabla de umbrales de docs/02`];
    if (!Number.isFinite(fact.value))
      return [
        `${fact.benchmark}: no se pudo leer su umbral (${fact.key}, docs/02: ${want.value} ${want.unit})`,
      ];
    return fact.value === want.value && fact.unit === want.unit
      ? []
      : [
          `${fact.benchmark}: umbral ${fact.value} ${fact.unit} en lugar de los ${want.value} ${want.unit} de docs/02 (${fact.key})`,
        ];
  });
}

const sourceOf = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const literalNumber = (node: ts.Node): number | undefined =>
  ts.isNumericLiteral(node) ? Number(node.text.replace(/_/gu, '')) : undefined;
const propName = (p: ts.ObjectLiteralElementLike): string | undefined =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;

function findConst(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name)
      found = node.initializer ?? found;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `{ ... } as const` -> el literal de objeto. */
const objectOf = (expr: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined => {
  let e = expr;
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
  return e && ts.isObjectLiteralExpression(e) ? e : undefined;
};

const REPORT_FILE = 'apps/api/test/perf/perf-report.ts';

/** Umbrales de `PERF_THRESHOLDS` y `PERF_THROUGHPUT` en `perf-report.ts`, por clave de docs/02. */
function perfReportFacts(text: string): ThresholdFact[] {
  const source = sourceOf(REPORT_FILE, text);
  const facts: ThresholdFact[] = [];
  const thresholds = objectOf(findConst(source, 'PERF_THRESHOLDS'));
  const variants: Record<string, string> = {
    limitMs: '',
    cloudLimitMs: ':cloud',
    allAccountsLimitMs: ':all',
  };
  for (const p of thresholds?.properties ?? []) {
    const nfr = propName(p);
    const inner = ts.isPropertyAssignment(p) ? objectOf(p.initializer) : undefined;
    for (const q of inner?.properties ?? []) {
      const variant = variants[propName(q) ?? ''];
      if (nfr && variant !== undefined && ts.isPropertyAssignment(q))
        facts.push({
          benchmark: `perf-report.ts PERF_THRESHOLDS['${nfr}'].${propName(q)}`,
          key: `${nfr}${variant}`,
          unit: 'ms',
          value: literalNumber(q.initializer) ?? Number.NaN,
        });
    }
  }
  const throughput = objectOf(findConst(source, 'PERF_THROUGHPUT'));
  const min = throughput?.properties.find((p) => propName(p) === 'minEventsPerSecond');
  facts.push({
    benchmark: 'perf-report.ts PERF_THROUGHPUT.minEventsPerSecond',
    key: 'NFR-PERF-008',
    unit: 'ev/s',
    value: min && ts.isPropertyAssignment(min) ? (literalNumber(min.initializer) ?? Number.NaN) : Number.NaN,
  });
  return facts;
}

/** Constantes locales de las suites que fijan un umbral de docs/02: archivo -> constante -> clave. */
const SUITE_THRESHOLD_CONSTANTS: Record<string, Record<string, { key: string; unit: ThresholdUnit }>> = {
  'spendable.perf.ts': { BUDGET_MS: { key: 'NFR-PERF-004', unit: 'ms' } },
  'goals.perf.ts': { BUDGET_MS: { key: 'NFR-PERF-004', unit: 'ms' } },
  'loan-simulator.perf.ts': { BUDGET_MS: { key: 'NFR-PERF-004', unit: 'ms' } },
  'upcoming-payments.perf.ts': { BUDGET_MS: { key: 'NFR-PERF-004', unit: 'ms' } },
  'subscriptions.perf.ts': { COST_P95_MS: { key: 'NFR-PERF-004', unit: 'ms' } },
  'commitments.perf.ts': {
    BUDGET_MS: { key: 'NFR-PERF-009', unit: 'ms' },
    GOAL_EVENTS_PER_SECOND: { key: 'NFR-PERF-008', unit: 'ev/s' },
  },
  'imports.perf.ts': {
    PREVIEW_BUDGET_MS: { key: 'NFR-PERF-007:preview', unit: 'ms' },
    PERSIST_BUDGET_MS: { key: 'NFR-PERF-007:persist', unit: 'ms' },
    DRAIN_BUDGET_MS: { key: 'NFR-PERF-008:drain', unit: 'ms' },
  },
};

/**
 * Umbrales de las constantes locales de una suite. Un literal numérico se compara tal cual; una referencia a
 * `PERF_THRESHOLDS['NFR-…'].limitMs` o a `PERF_THROUGHPUT.minEventsPerSecond` toma el valor de `perf-report.ts` (así una
 * referencia al NFR equivocado también falla).
 */
function suiteFacts(file: string, text: string, report: readonly ThresholdFact[]): ThresholdFact[] {
  const source = sourceOf(file, text);
  const constants = SUITE_THRESHOLD_CONSTANTS[file.split('/').at(-1)!] ?? {};
  return Object.entries(constants).map(([name, { key, unit }]) => {
    const init = findConst(source, name);
    let value = init ? (literalNumber(init) ?? Number.NaN) : Number.NaN;
    if (init && Number.isNaN(value)) {
      const ref =
        /^PERF_THRESHOLDS\['(NFR-PERF-\d+)'\]\.(limitMs|cloudLimitMs|allAccountsLimitMs)$|^PERF_THROUGHPUT\.minEventsPerSecond$/u.exec(
          init.getText(source),
        );
      const refKey = ref ? (ref[1] ?? 'NFR-PERF-008') : undefined;
      const suffix = ref?.[2] === 'cloudLimitMs' ? ':cloud' : ref?.[2] === 'allAccountsLimitMs' ? ':all' : '';
      value = report.find((f) => f.key === `${refKey}${suffix}`)?.value ?? Number.NaN;
    }
    return { benchmark: `${file.split('/').at(-1)!} ${name}`, key, unit, value };
  });
}

/** Resultados de `nightly.perf.ts` que son bloqueantes (gate) y deben seguir siéndolo (D43). */
const BLOCKING_RESULT_IDS = [
  'ledger-balance-account',
  'ledger-balance-all-accounts',
  'transactions-list',
  'transactions-search',
  'reports-summary',
  'debts-summary',
  'budget-vs-actual',
  'net-worth-history',
  'conversion-costs',
  'bulk-edit-500',
  'reconciliation-cleared-balance',
] as const;

/**
 * Filas bloqueantes que dejaron de serlo (`gate: false`) o no se encuentran, y filas de throughput por consumidor que
 * pasaron a bloqueantes (D292: siguen informativas hasta que el owner decida un umbral por consumidor).
 */
function blockingViolations(text: string, ids: readonly string[] = BLOCKING_RESULT_IDS): string[] {
  const source = sourceOf('nightly.perf.ts', text);
  const gateOf = new Map<string, boolean>();
  const throughputGates: boolean[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      const arg = node.arguments[0];
      if ((fn === 'latencyResult' || fn === 'throughputResult') && arg && ts.isObjectLiteralExpression(arg)) {
        const prop = (name: string) => arg.properties.find((p) => propName(p) === name);
        const gate = prop('gate');
        const explicit = gate && ts.isPropertyAssignment(gate) ? gate.initializer.kind : undefined;
        if (fn === 'throughputResult') throughputGates.push(explicit === ts.SyntaxKind.TrueKeyword);
        else {
          const id = prop('id');
          if (id && ts.isPropertyAssignment(id) && ts.isStringLiteralLike(id.initializer))
            gateOf.set(id.initializer.text, explicit !== ts.SyntaxKind.FalseKeyword);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [
    ...ids.flatMap((id) =>
      !gateOf.has(id)
        ? [`${id}: no se encontró el resultado bloqueante en nightly.perf.ts`]
        : gateOf.get(id)
          ? []
          : [`${id}: era bloqueante y pasó a informativo (gate: false) sin decisión del owner`],
    ),
    ...(throughputGates.some(Boolean)
      ? [
          'consumer-throughput: la fila de throughput con handler real es informativa (D292) y pasó a bloqueante',
        ]
      : []),
  ];
}

describe('umbrales de los benchmarks fijados a docs/02 (TC-PLATFORM-PIPELINE-028)', () => {
  const dir = 'apps/api/test/perf';
  const nfrDoc = readText('docs/02-non-functional-requirements.md');
  const rowOf = (key: string) =>
    nfrDoc.split('\n').find((l) => l.startsWith(`| ${key.split(':')[0]} |`)) ?? '';
  const reportFacts = () => perfReportFacts(readText(REPORT_FILE));
  const suiteFiles = Object.keys(SUITE_THRESHOLD_CONSTANTS);
  const allFacts = () => [
    ...reportFacts(),
    ...suiteFiles.flatMap((f) => suiteFacts(`${dir}/${f}`, readText(`${dir}/${f}`), reportFacts())),
  ];

  it('[TC-PLATFORM-PIPELINE-028] la tabla esperada coincide con la fila de cada NFR en docs/02 §PERF', () => {
    for (const e of EXPECTED_THRESHOLDS) expect(rowOf(e.key), e.key).toContain(e.doc);
  });

  it('[TC-PLATFORM-PIPELINE-028] PERF_THRESHOLDS, PERF_THROUGHPUT y las constantes locales de las suites coinciden con docs/02', () => {
    const facts = allFacts();
    // Cobertura: la extracción no se degrada en silencio (un archivo renombrado o una constante movida falla aquí).
    expect(facts.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'NFR-PERF-001',
        'NFR-PERF-001:cloud',
        'NFR-PERF-002',
        'NFR-PERF-003',
        'NFR-PERF-004',
        'NFR-PERF-005',
        'NFR-PERF-005:all',
        'NFR-PERF-006',
        'NFR-PERF-007:preview',
        'NFR-PERF-007:persist',
        'NFR-PERF-008',
        'NFR-PERF-008:drain',
        'NFR-PERF-009',
      ]),
    );
    expect(facts.filter((f) => f.benchmark.endsWith('GOAL_EVENTS_PER_SECOND'))).toHaveLength(1);
    expect(facts.filter((f) => f.benchmark.endsWith('BUDGET_MS')).length).toBeGreaterThanOrEqual(5);
    expect(thresholdFactViolations(facts)).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-028] las filas bloqueantes de nightly.perf.ts siguen siéndolo y la de throughput por consumidor sigue informativa (D43, D292)', () => {
    expect(blockingViolations(readText(`${dir}/nightly.perf.ts`))).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-028] subir el p95 de disponible para gastar de 300 a 400 ms hace fallar la regla indicando el benchmark y ambos umbrales', () => {
    const real = suiteFacts(`${dir}/spendable.perf.ts`, readText(`${dir}/spendable.perf.ts`), reportFacts());
    expect(thresholdFactViolations(real)).toEqual([]);
    const relaxed = readText(`${dir}/spendable.perf.ts`).replace(
      /const BUDGET_MS = [^;]+;/u,
      'const BUDGET_MS = 400;',
    );
    expect(relaxed).toContain('const BUDGET_MS = 400;');
    expect(thresholdFactViolations(suiteFacts(`${dir}/spendable.perf.ts`, relaxed, reportFacts()))).toEqual([
      'spendable.perf.ts BUDGET_MS: umbral 400 ms en lugar de los 300 ms de docs/02 (NFR-PERF-004)',
    ]);
    // El mismo cambio en perf-report.ts (PERF_THRESHOLDS) también falla.
    const reportRelaxed = readText(REPORT_FILE).replace(
      /('NFR-PERF-004': \{ metric: 'p95', limitMs: )300/u,
      '$1400',
    );
    expect(thresholdFactViolations(perfReportFacts(reportRelaxed))).toEqual([
      "perf-report.ts PERF_THRESHOLDS['NFR-PERF-004'].limitMs: umbral 400 ms en lugar de los 300 ms de docs/02 (NFR-PERF-004)",
    ]);
  });

  it('[TC-PLATFORM-PIPELINE-028] bajar el throughput mínimo por consumidor de 42 a 5 ev/s hace fallar la regla indicando el benchmark y ambos umbrales', () => {
    const reportRelaxed = readText(REPORT_FILE).replace(/(minEventsPerSecond: )42/u, '$15');
    expect(thresholdFactViolations(perfReportFacts(reportRelaxed))).toEqual([
      'perf-report.ts PERF_THROUGHPUT.minEventsPerSecond: umbral 5 ev/s en lugar de los 42 ev/s de docs/02 (NFR-PERF-008)',
    ]);
    const matcher = readText(`${dir}/commitments.perf.ts`).replace(
      /const GOAL_EVENTS_PER_SECOND = [^;]+;/u,
      'const GOAL_EVENTS_PER_SECOND = 5;',
    );
    expect(matcher).toContain('const GOAL_EVENTS_PER_SECOND = 5;');
    expect(thresholdFactViolations(suiteFacts(`${dir}/commitments.perf.ts`, matcher, reportFacts()))).toEqual(
      [
        'commitments.perf.ts GOAL_EVENTS_PER_SECOND: umbral 5 ev/s en lugar de los 42 ev/s de docs/02 (NFR-PERF-008)',
      ],
    );
  });

  it('[TC-PLATFORM-PIPELINE-028] una constante que referencia el NFR equivocado o que no se puede leer también falla', () => {
    const wrongRef = readText(`${dir}/spendable.perf.ts`).replace(
      /const BUDGET_MS = [^;]+;/u,
      "const BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-003'].limitMs;",
    );
    expect(thresholdFactViolations(suiteFacts(`${dir}/spendable.perf.ts`, wrongRef, reportFacts()))).toEqual([
      'spendable.perf.ts BUDGET_MS: umbral 150 ms en lugar de los 300 ms de docs/02 (NFR-PERF-004)',
    ]);
    const opaque = readText(`${dir}/spendable.perf.ts`).replace(
      /const BUDGET_MS = [^;]+;/u,
      'const BUDGET_MS = Number(process.env.X);',
    );
    expect(thresholdFactViolations(suiteFacts(`${dir}/spendable.perf.ts`, opaque, reportFacts()))).toEqual([
      'spendable.perf.ts BUDGET_MS: no se pudo leer su umbral (NFR-PERF-004, docs/02: 300 ms)',
    ]);
  });

  it('[TC-PLATFORM-PIPELINE-028] volver informativa una fila bloqueante, o bloqueante la de throughput, hace fallar la regla indicando el resultado', () => {
    const nightly = readText(`${dir}/nightly.perf.ts`);
    const informative = nightly.replace(/(id: 'reports-summary',)/u, '$1 gate: false,');
    expect(informative).not.toBe(nightly);
    expect(blockingViolations(informative)).toEqual([
      'reports-summary: era bloqueante y pasó a informativo (gate: false) sin decisión del owner',
    ]);
    const renamed = nightly.replace("id: 'reports-summary'", "id: 'reports-resumen'");
    expect(blockingViolations(renamed)).toEqual([
      'reports-summary: no se encontró el resultado bloqueante en nightly.perf.ts',
    ]);
    const gated = nightly.replace(
      /(minEventsPerSecond: PERF_THROUGHPUT\.minEventsPerSecond,)/u,
      '$1 gate: true,',
    );
    expect(gated).not.toBe(nightly);
    expect(blockingViolations(gated)).toEqual([
      'consumer-throughput: la fila de throughput con handler real es informativa (D292) y pasó a bloqueante',
    ]);
  });
});

// investigate-perf-under-load 5.2/5.3 (D291): el aislamiento vive en el harness de pruebas y en el mismo job; no cambia
// `nightly.yml` ni agrega jobs, y el orden de los archivos de perf es determinista.
describe('aislamiento del benchmark en el harness (TC-PLATFORM-PIPELINE-024, TC-PLATFORM-PIPELINE-026)', () => {
  const dir = 'apps/api/test/perf';
  const perfFiles = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.perf.ts'));

  it('[TC-PLATFORM-PIPELINE-024] vitest.perf.config.ts fija el orden con un sequencer sobre PERF_SUITE_ORDER', () => {
    const config = readText('apps/api/vitest.perf.config.ts');
    expect(config).toMatch(/import \{ orderPerfSuites \} from '\.\/test\/perf\/suite-order\.js'/u);
    expect(config).toMatch(/sequencer: PerfSuiteSequencer/u);
    expect(config).toMatch(/orderPerfSuites\(files, \(f\) => f\.moduleId\)/u);
    const order = readText(`${dir}/suite-order.ts`);
    for (const f of perfFiles) expect(order, `${f} en PERF_SUITE_ORDER`).toContain(`'${f}'`);
  });

  it('[TC-PLATFORM-PIPELINE-024] cada suite *.perf.ts registra la precondición de aislamiento con recordSuiteLoad', () => {
    expect(perfFiles.length).toBeGreaterThanOrEqual(8);
    for (const f of perfFiles) {
      expect(readText(`${dir}/${f}`), f).toMatch(/recordSuiteLoad\(import\.meta\.url,/u);
    }
    const load = readText(`${dir}/background-load.ts`);
    expect(load).toMatch(/beforeAll\(async \(\) => \{\s*await recorder\.prepare\(\);/u);
  });

  it('[TC-PLATFORM-PIPELINE-026] la purga y la espera de quietud solo viven en el harness de pruebas, nunca en el código del producto', () => {
    const offenders = ['apps/api/src', 'packages']
      .flatMap((root) =>
        // `git grep` sale con 1 si no hay coincidencias.
        spawnSync('git', ['grep', '-l', '-E', 'purgeBacklog|waitForQuiet|prepareIsolation', '--', root], {
          cwd: ROOT,
          encoding: 'utf8',
        }).stdout.split('\n'),
      )
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-024] nightly.yml sigue con sus cuatro jobs: el aislamiento no agrega un job aparte (D291)', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(['fx-smoke-live', 'mutation', 'perf', 'regression']);
  });
});

// optimize-consumer-throughput (D300, D311, TC-PLATFORM-THROUGHPUT-012..015): las filas nuevas del benchmark y los
// umbrales de docs/02 (TC-PLATFORM-PIPELINE-028 sigue verde: las constantes de arriba no cambian).
describe('filas de rendimiento de la entrega de eventos (TC-PLATFORM-THROUGHPUT-012..015)', () => {
  const dir = 'apps/api/test/perf';
  const imports = readText(`${dir}/imports.perf.ts`);
  const throughput = readText(`${dir}/throughput.perf.ts`);
  const report = readText(`${dir}/perf-report.ts`);

  /** Bloque `const <NAME>: ImportConfig = { ... };` de imports.perf.ts. */
  const configBlock = (name: string): string =>
    new RegExp(String.raw`const ${name}: ImportConfig = \{[\s\S]*?\n\};`, 'u').exec(imports)?.[0] ?? '';

  it('[TC-PLATFORM-THROUGHPUT-014] el benchmark del import mide dos configuraciones: la del código informativa y la de la plantilla del host bloqueante (D311)', () => {
    expect(configBlock('CODE_CONFIG')).toMatch(/gate: false/u);
    expect(configBlock('HOST_CONFIG')).toMatch(/gate: true/u);
    expect(configBlock('HOST_CONFIG')).toMatch(/EVENT_CONSUMER_CONCURRENCY: '1'/u);
    expect(configBlock('HOST_CONFIG')).toMatch(/DATABASE_POOL_MAX: '34'/u);
    // La fila informativa vuelve antes de aplicar ningún umbral; las aserciones de los umbrales quedan tras ese retorno.
    expect(imports).toMatch(
      /if \(!cfg\.gate\) return;[\s\S]*expect\(drainAfterPersistMs, verdict\.message\)/u,
    );
  });

  it('[TC-PLATFORM-THROUGHPUT-014][TC-IMPORTS-CSV-029] la fila de la ráfaga del import (configuración del host) exige la persistencia de 20 s por omisión, sin techo ni variable de relajación (D152, D311, D359)', () => {
    expect(imports).not.toMatch(/PF_PERF_STRICT_IMPORT|PERSIST_CEILING_MS/u);
    expect(imports).toMatch(/expect\(persistMs\)\.toBeLessThanOrEqual\(PERSIST_BUDGET_MS\)/u);
    // Tras el retorno de la fila informativa quedan juntas la persistencia y el drenado por consumidor.
    expect(imports).toMatch(
      /if \(!cfg\.gate\) return;[\s\S]*expect\(persistMs\)\.toBeLessThanOrEqual\(PERSIST_BUDGET_MS\)[\s\S]*expect\(drainAfterPersistMs, verdict\.message\)/u,
    );
  });

  it('[TC-PLATFORM-THROUGHPUT-012] las filas de costo por consumidor son siempre informativas: el tipo lo fija y la suite no afirma ningún umbral', () => {
    expect(report).toMatch(/export interface ConsumerCost \{[\s\S]*readonly gate: false;/u);
    expect(throughput).toMatch(/gate: false/u);
    expect(throughput).not.toMatch(/toBeLessThan|toBeGreaterThan\(\w*(?:DRAIN|BUDGET|CEILING)/u);
  });

  it('[TC-PLATFORM-THROUGHPUT-013] el costo por consumidor no entra en las brechas del reporte (buildReport solo mira los resultados con gate)', () => {
    const build = /export function buildReport[\s\S]*?\n\}/u.exec(report)?.[0] ?? '';
    expect(build).toMatch(/\.filter\(\(r\) => r\.gate && !r\.passed\)/u);
    expect(build).not.toMatch(/consumerCost/u);
  });
});
