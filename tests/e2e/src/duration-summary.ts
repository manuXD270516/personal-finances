import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Duración por proyecto de Playwright (`chromium`, `webkit`…) a partir del reporte JSON, para el resumen del job `e2e`
 * (change add-e2e-https, TC-PLATFORM-PIPELINE-044). Con `workers: 1` la suma de las duraciones de los tests de un
 * proyecto es su tiempo de pared (sin contar el arranque del stack).
 */
interface JsonTest {
  readonly projectName: string;
  readonly results: readonly { readonly duration: number }[];
}
interface JsonSuite {
  readonly suites?: readonly JsonSuite[];
  readonly specs?: readonly { readonly tests: readonly JsonTest[] }[];
}
export interface JsonReport {
  readonly suites: readonly JsonSuite[];
  readonly stats?: { readonly duration?: number };
}

export function durationsByProject(report: JsonReport): Map<string, { tests: number; ms: number }> {
  const out = new Map<string, { tests: number; ms: number }>();
  const visit = (suite: JsonSuite): void => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        const row = out.get(test.projectName) ?? { tests: 0, ms: 0 };
        row.tests += 1;
        row.ms += test.results.reduce((sum, r) => sum + r.duration, 0);
        out.set(test.projectName, row);
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return out;
}

const minutes = (ms: number): string => (ms / 60_000).toFixed(1);

export function renderSummary(report: JsonReport): string {
  const rows = [...durationsByProject(report)].map(
    ([project, { tests, ms }]) => `| ${project} | ${tests} | ${minutes(ms)} min |`,
  );
  const total = report.stats?.duration;
  return [
    '### Duración de la suite E2E por proyecto',
    '',
    '| Proyecto | Tests | Duración |',
    '|---|---|---|',
    ...rows,
    '',
    total === undefined
      ? ''
      : `Total de la corrida de Playwright: ${minutes(total)} min (límite del job: 40 min).`,
    '',
  ].join('\n');
}

// Uso: `tsx tests/e2e/src/duration-summary.ts <reporte.json>`; agrega la tabla a `$GITHUB_STEP_SUMMARY` si existe.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'playwright-results.json';
  if (!existsSync(file)) {
    process.stdout.write(`sin reporte JSON en ${file}\n`);
  } else {
    const text = renderSummary(JSON.parse(readFileSync(file, 'utf8')) as JsonReport);
    process.stdout.write(`${text}\n`);
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) appendFileSync(summary, `${text}\n`);
  }
}
