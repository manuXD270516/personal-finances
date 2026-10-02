import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexRequirements, linkCase, testsByCase } from './check.js';
import { normalizeName } from './fs-utils.js';
import type { AutomationStatus, CaseStatus, Model, Priority, TestCase } from './types.js';

export interface MatrixRow {
  trace: string[];
  spec: string;
  requirement: string;
  priority: Priority | null;
  scenario: string | null;
  testCase: string | null;
  status: CaseStatus | null;
  automationStatus: AutomationStatus | null;
  tests: string[];
}

export interface MatrixCase {
  id: string;
  title: string;
  file: string;
  spec: string;
  requirement: string;
  scenario: string | null;
  priority: string;
  status: CaseStatus;
  automationStatus: AutomationStatus;
  fr: string[];
  nfr: string[];
  invariants: string[];
  tests: string[];
  /** true si spec + requirement (+ scenario) existen en OpenSpec. */
  linked: boolean;
}

export interface MatrixJson {
  version: 1;
  summary: {
    requirements: number;
    mustRequirements: number;
    scenarios: number;
    testCases: number;
    automated: number;
    notAutomated: number;
    manual: number;
    deprecated: number;
    testFilesWithIds: number;
  };
  requirements: {
    spec: string;
    name: string;
    priority: Priority | null;
    trace: string[];
    sources: string[];
    scenarios: string[];
    testCases: string[];
  }[];
  rows: MatrixRow[];
  testCases: MatrixCase[];
  tests: { file: string; ids: string[] }[];
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** FR/NFR → capability → requirement → scenario → TC → tests, con estado de automatización. */
export function buildMatrix(model: Model): MatrixJson {
  const index = indexRequirements(model.requirements);
  const testsOf = testsByCase(model);
  const cases = [...model.cases].sort((a, b) => byText(a.id, b.id));
  const requirements = [...model.requirements].sort((a, b) =>
    byText(`${a.spec}#${a.name}`, `${b.spec}#${b.name}`),
  );

  const scenarioMatches = (tc: TestCase, scenario: string | null) =>
    scenario === null
      ? !tc.scenario
      : !!tc.scenario && normalizeName(tc.scenario) === normalizeName(scenario);

  const rows: MatrixRow[] = [];
  const linkedIds = new Set<string>();
  const reqCases = new Map<string, string[]>();
  for (const req of requirements) {
    const linked = cases.filter((tc) => linkCase(tc, index) === req);
    reqCases.set(
      `${req.spec}#${req.name}`,
      linked.map((tc) => tc.id),
    );
    const base = { trace: req.trace, spec: req.spec, requirement: req.name, priority: req.priority };
    const pushRows = (scenario: string | null, list: TestCase[]) => {
      if (list.length === 0 && scenario !== null) {
        rows.push({ ...base, scenario, testCase: null, status: null, automationStatus: null, tests: [] });
      }
      for (const tc of list) {
        linkedIds.add(tc.id);
        rows.push({
          ...base,
          scenario,
          testCase: tc.id,
          status: tc.status,
          automationStatus: tc.automationStatus,
          tests: testsOf.get(tc.id) ?? [],
        });
      }
    };
    for (const scenario of req.scenarios)
      pushRows(
        scenario,
        linked.filter((tc) => scenarioMatches(tc, scenario)),
      );
    // TCs a nivel de requirement (sin scenario o con scenario inexistente).
    const rest = linked.filter((tc) => !req.scenarios.some((s) => scenarioMatches(tc, s)));
    pushRows(null, rest);
    if (req.scenarios.length === 0 && linked.length === 0) {
      rows.push({ ...base, scenario: null, testCase: null, status: null, automationStatus: null, tests: [] });
    }
  }

  const count = (s: AutomationStatus) => cases.filter((c) => c.automationStatus === s).length;
  return {
    version: 1,
    summary: {
      requirements: requirements.length,
      mustRequirements: requirements.filter((r) => r.priority === 'Must').length,
      scenarios: requirements.reduce((n, r) => n + r.scenarios.length, 0),
      testCases: cases.length,
      automated: count('automated'),
      notAutomated: count('not_automated'),
      manual: count('manual'),
      deprecated: cases.filter((c) => c.status === 'deprecated').length,
      testFilesWithIds: model.testFiles.filter((t) => t.ids.length > 0).length,
    },
    requirements: requirements.map((r) => ({
      spec: r.spec,
      name: r.name,
      priority: r.priority,
      trace: r.trace,
      sources: r.sources,
      scenarios: r.scenarios,
      testCases: reqCases.get(`${r.spec}#${r.name}`) ?? [],
    })),
    rows,
    testCases: cases.map((tc) => {
      const req = linkCase(tc, index);
      const scenarioOk = !tc.scenario || (req?.scenarios.some((s) => scenarioMatches(tc, s)) ?? false);
      return {
        id: tc.id,
        title: tc.title,
        file: tc.file,
        spec: tc.spec,
        requirement: tc.requirement,
        scenario: tc.scenario,
        priority: tc.priority,
        status: tc.status,
        automationStatus: tc.automationStatus,
        fr: tc.fr,
        nfr: tc.nfr,
        invariants: tc.invariants,
        tests: testsOf.get(tc.id) ?? [],
        linked: linkedIds.has(tc.id) && req !== null && scenarioOk,
      };
    }),
    tests: model.testFiles.filter((t) => t.ids.length > 0).map((t) => ({ file: t.file, ids: t.ids })),
  };
}

const cell = (value: string) => value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
const list = (values: string[]) => (values.length > 0 ? values.map(cell).join(', ') : '—');
const code = (values: string[]) => (values.length > 0 ? values.map((v) => `\`${v}\``).join(', ') : '—');

export function renderMatrixMarkdown(m: MatrixJson): string {
  const s = m.summary;
  const lines = [
    '# Matriz de trazabilidad',
    '',
    '> Generada por `@pf/traceability` (docs/17-test-traceability.md). No editar a mano.',
    '',
    '## Resumen',
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Requirements | ${s.requirements} (Must: ${s.mustRequirements}) |`,
    `| Scenarios | ${s.scenarios} |`,
    `| Test cases | ${s.testCases} |`,
    `| Automatizados | ${s.automated} |`,
    `| No automatizados | ${s.notAutomated} |`,
    `| Manuales | ${s.manual} |`,
    `| Deprecados | ${s.deprecated} |`,
    `| Archivos de test con TC-IDs | ${s.testFilesWithIds} |`,
    '',
    '## FR/NFR → Requirement → Scenario → TC → test',
    '',
    '| FR/NFR | Capability | Requirement | Prioridad | Scenario | TC | Estado TC | Automatización | Tests |',
    '|---|---|---|---|---|---|---|---|---|',
    ...m.rows.map(
      (r) =>
        `| ${list(r.trace)} | \`${r.spec}\` | ${cell(r.requirement)} | ${r.priority ?? '—'} | ${r.scenario ? cell(r.scenario) : '—'} | ${r.testCase ?? '—'} | ${r.status ?? '—'} | ${r.automationStatus ?? '—'} | ${code(r.tests)} |`,
    ),
    '',
    '## Catálogo de test cases',
    '',
    '| TC | Título | Capability | Requirement | Prioridad | Estado | Automatización | Enlazado | Tests |',
    '|---|---|---|---|---|---|---|---|---|',
    ...m.testCases.map(
      (tc) =>
        `| ${tc.id} | ${cell(tc.title)} | \`${tc.spec}\` | ${cell(tc.requirement)} | ${tc.priority} | ${tc.status} | ${tc.automationStatus} | ${tc.linked ? 'sí' : 'no'} | ${code(tc.tests)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

/** Escribe `matrix.md` y `matrix.json` en `outDir`. */
export function writeMatrix(matrix: MatrixJson, outDir: string): { md: string; json: string } {
  mkdirSync(outDir, { recursive: true });
  const md = join(outDir, 'matrix.md');
  const json = join(outDir, 'matrix.json');
  writeFileSync(md, renderMatrixMarkdown(matrix));
  writeFileSync(json, `${JSON.stringify(matrix, null, 2)}\n`);
  return { md, json };
}
