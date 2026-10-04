import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { testsByCase } from './check.js';
import type { Model } from './types.js';

/**
 * Financial Regression Suite (docs/16 §11.3, docs/17 §7): TC con `regression_suite: true` (no deprecados) y los
 * tests que los nombran, agrupados por paquete y tipo de ejecución:
 *   unit        → `vitest run` con la config por defecto del paquete (sin Docker);
 *   integration → `vitest run --config vitest.integration.config.ts` (`*.int.test.ts`, `*.api.test.ts`; Testcontainers);
 *   stack       → `*.stack.test.ts` (Compose; corre en `pnpm test:stack`, no aquí);
 *   e2e         → `tests/e2e/**` (Playwright contra el stack `pfos-e2e`; corre en `pnpm test:e2e`, no aquí).
 * Dentro de cada archivo solo se ejecutan los tests cuyo nombre completo contiene alguno de los TC-IDs (`-t`).
 */
export type RegressionKind = 'unit' | 'integration' | 'stack' | 'e2e';
export const RUNNABLE_KINDS: readonly RegressionKind[] = ['unit', 'integration'];
const KIND_ORDER: readonly RegressionKind[] = ['unit', 'integration', 'stack', 'e2e'];

export interface RegressionGroup {
  /** Directorio del paquete relativo a la raíz (con `/`). */
  readonly package: string;
  readonly kind: RegressionKind;
  /** Archivos relativos al paquete (con `/`). */
  readonly files: readonly string[];
  readonly ids: readonly string[];
}

export interface RegressionCase {
  readonly id: string;
  readonly file: string;
  readonly priority: string;
  readonly status: string;
  readonly automationStatus: string;
  readonly tests: readonly string[];
}

export interface RegressionSuite {
  readonly version: 1;
  readonly summary: {
    readonly cases: number;
    readonly withTests: number;
    readonly withoutTests: number;
    readonly testFiles: number;
    /** Archivos de test por tipo de ejecución. */
    readonly byKind: Record<RegressionKind, number>;
  };
  readonly cases: readonly RegressionCase[];
  /** TC de la suite sin ningún test que los nombre (no automatizados o manuales). */
  readonly withoutTests: readonly string[];
  readonly groups: readonly RegressionGroup[];
}

export function kindOf(file: string): RegressionKind {
  if (file.startsWith('tests/e2e/')) return 'e2e';
  if (/\.stack\.test\.tsx?$/.test(file)) return 'stack';
  if (/\.(int|api)\.test\.tsx?$/.test(file)) return 'integration';
  return 'unit';
}

/** Paquete del archivo: primer ancestro con `package.json` (sin salir de la raíz). */
function packageOf(root: string, file: string): string {
  let dir = dirname(file);
  while (dir !== '.' && dir !== '' && dir !== '/') {
    if (existsSync(join(root, dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return '.';
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildRegressionSuite(model: Model): RegressionSuite {
  const testsOf = testsByCase(model);
  const cases = model.cases
    .filter((tc) => tc.regressionSuite && tc.status !== 'deprecated')
    .sort((a, b) => byText(a.id, b.id));
  const groups = new Map<
    string,
    { package: string; kind: RegressionKind; files: Set<string>; ids: Set<string> }
  >();
  for (const tc of cases) {
    for (const file of testsOf.get(tc.id) ?? []) {
      const pkg = packageOf(model.root, file);
      const kind = kindOf(file);
      const key = `${pkg}|${kind}`;
      const group = groups.get(key) ?? {
        package: pkg,
        kind,
        files: new Set<string>(),
        ids: new Set<string>(),
      };
      group.files.add(pkg === '.' ? file : file.slice(pkg.length + 1));
      group.ids.add(tc.id);
      groups.set(key, group);
    }
  }
  const list: RegressionGroup[] = [...groups.values()]
    .map((g) => ({ package: g.package, kind: g.kind, files: [...g.files].sort(), ids: [...g.ids].sort() }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byText(a.package, b.package));
  const withoutTests = cases.filter((tc) => (testsOf.get(tc.id) ?? []).length === 0).map((tc) => tc.id);
  const byKind: Record<RegressionKind, number> = { unit: 0, integration: 0, stack: 0, e2e: 0 };
  for (const g of list) byKind[g.kind] += g.files.length;
  return {
    version: 1,
    summary: {
      cases: cases.length,
      withTests: cases.length - withoutTests.length,
      withoutTests: withoutTests.length,
      testFiles: new Set(list.flatMap((g) => g.files.map((f) => `${g.package}/${f}`))).size,
      byKind,
    },
    cases: cases.map((tc) => ({
      id: tc.id,
      file: tc.file,
      priority: tc.priority,
      status: tc.status,
      automationStatus: tc.automationStatus,
      tests: testsOf.get(tc.id) ?? [],
    })),
    withoutTests,
    groups: list,
  };
}

export function renderRegressionMarkdown(suite: RegressionSuite): string {
  const s = suite.summary;
  return [
    '# Financial Regression Suite',
    '',
    '> Generada por `@pf/traceability` desde el front matter de `tests/cases` (`regression_suite: true`). No editar a mano.',
    '',
    '| TC en la suite | Con tests | Sin tests | Archivos de test | unit | integration | stack | e2e |',
    '|---|---|---|---|---|---|---|---|',
    `| ${s.cases} | ${s.withTests} | ${s.withoutTests} | ${s.testFiles} | ${s.byKind.unit} | ${s.byKind.integration} | ${s.byKind.stack} | ${s.byKind.e2e} |`,
    '',
    '## Grupos de ejecución',
    '',
    '| Paquete | Tipo | Archivos | TC |',
    '|---|---|---|---|',
    ...suite.groups.map((g) => `| \`${g.package}\` | ${g.kind} | ${g.files.length} | ${g.ids.length} |`),
    '',
    '## TC de la suite sin tests',
    '',
    ...(suite.withoutTests.length > 0 ? suite.withoutTests.map((id) => `- ${id}`) : ['—']),
    '',
  ].join('\n');
}

export function writeRegressionSuite(suite: RegressionSuite, outDir: string): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const json = join(outDir, 'regression-suite.json');
  const md = join(outDir, 'regression-suite.md');
  writeFileSync(json, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
  writeFileSync(md, renderRegressionMarkdown(suite), 'utf8');
  return { json, md };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Patrón `-t` de vitest: el nombre completo del test contiene `[TC-…]` de alguno de los TC del grupo. */
export const testNamePattern = (ids: readonly string[]): string =>
  `\\[(${ids.map(escapeRegex).join('|')})\\]`;

/** Argumentos de `node` para `vitest run` de un grupo; `null` si el tipo no se ejecuta con vitest aquí. */
export function vitestCommand(root: string, group: RegressionGroup): string[] | null {
  if (!RUNNABLE_KINDS.includes(group.kind)) return null;
  const pkgDir = join(root, group.package);
  const vitestPkg = createRequire(join(pkgDir, 'package.json')).resolve('vitest/package.json');
  const manifest = JSON.parse(readFileSync(vitestPkg, 'utf8')) as { bin: Record<string, string> };
  return [
    join(dirname(vitestPkg), manifest.bin['vitest'] as string),
    'run',
    ...(group.kind === 'integration' ? ['--config', 'vitest.integration.config.ts'] : []),
    '--passWithNoTests',
    '-t',
    testNamePattern(group.ids),
    ...group.files,
  ];
}

export interface RunOutcome {
  readonly group: RegressionGroup;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly durationMs: number;
}

/** Ejecuta en serie los grupos de los tipos pedidos (los de integración levantan Testcontainers por paquete). */
export function runRegressionSuite(
  root: string,
  suite: RegressionSuite,
  kinds: readonly RegressionKind[],
  log: (line: string) => void,
): RunOutcome[] {
  const outcomes: RunOutcome[] = [];
  for (const group of suite.groups) {
    const argv = kinds.includes(group.kind) ? vitestCommand(root, group) : null;
    if (!argv) {
      outcomes.push({ group, status: 'skipped', durationMs: 0 });
      continue;
    }
    log(`\n▶ ${group.package} (${group.kind}): ${group.files.length} archivo(s), ${group.ids.length} TC`);
    const started = Date.now();
    const result = spawnSync(process.execPath, argv, {
      cwd: join(root, group.package),
      stdio: 'inherit',
      env: process.env,
    });
    outcomes.push({
      group,
      status: result.status === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - started,
    });
  }
  return outcomes;
}
