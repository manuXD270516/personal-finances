import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { toPosix, walkFiles } from './fs-utils.js';
import type { Finding, TestCase } from './types.js';

export const TC_ID = /^TC-[A-Z]+-[A-Z0-9]+-\d{3}$/;
const CAPABILITY = /^[a-z-]+\/[a-z0-9-]+$/;
const FR = /^FR-[A-Z]+-\d{3}$/;
const NFR = /^NFR-(SEC|PERF|REL|OBS|PORT|MAINT|USAB|DATA|COMP)-\d{3}$/;
const INV = /^INV-\d{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = z.string();
const strList = z.array(z.string());
const date = z.union([z.string().regex(DATE), z.date()]);

/** Schema canónico del front matter (docs/17 §4.1). */
export const frontMatterSchema = z.strictObject({
  id: str.regex(TC_ID),
  title: str.min(10).max(140),
  spec: str.regex(CAPABILITY),
  related_specs: z.array(str.regex(CAPABILITY)).optional(),
  requirement: str.min(1),
  scenario: z.string().nullable().optional(),
  requirement_status: z.enum(['provisional', 'confirmed']),
  fr: z.array(str.regex(FR)),
  nfr: z.array(str.regex(NFR)).optional(),
  invariants: z.array(str.regex(INV)),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  type: z.enum(['unit', 'domain', 'property', 'integration', 'api', 'e2e', 'security', 'platform']),
  level: z.enum([
    'unit',
    'domain',
    'application',
    'repository-integration',
    'database-integration',
    'api',
    'contract',
    'event-contract',
    'migration',
    'import',
    'container-integration',
    'e2e',
    'property',
    'security',
    'performance',
    'smoke',
    'architecture',
  ]),
  automation_status: z.enum(['not_automated', 'automated', 'manual']),
  automated_tests: strList.optional(),
  status: z.enum(['draft', 'ready', 'automated', 'deprecated']),
  regression_suite: z.boolean().optional(),
  phase: z.number().int().min(0).max(10).optional(),
  tags: strList.optional(),
  preconditions: strList,
  input: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string()]),
  steps: strList.min(1),
  expected_result: strList.min(1),
  error_code: z.string().nullable().optional(),
  deprecated_by_change: z.string().nullable().optional(),
  superseded_by: z.array(str.regex(TC_ID)).optional(),
  deprecation_reason: z.string().nullable().optional(),
  created: date.optional(),
  updated: date.optional(),
});

type FrontMatter = z.infer<typeof frontMatterSchema>;

const isNonEmptyList = (v: unknown) => Array.isArray(v) && v.length > 0;

/** Reglas entre campos (allOf de docs/17 §4.1 + "al menos un FR o NFR"); se evalúan aunque falle el schema. */
function crossFieldIssues(data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (data['status'] === 'automated' && data['automation_status'] !== 'automated') {
    issues.push("campo 'automation_status': debe ser 'automated' cuando status es 'automated'");
  }
  if (data['status'] === 'deprecated') {
    for (const key of ['deprecated_by_change', 'deprecation_reason']) {
      if (!data[key]) issues.push(`campo '${key}': obligatorio cuando status es deprecated`);
    }
  }
  if (
    data['automation_status'] === 'manual' &&
    data['status'] !== 'ready' &&
    data['status'] !== 'deprecated'
  ) {
    issues.push("campo 'status': un caso manual solo puede estar en 'ready' o 'deprecated'");
  }
  if (!isNonEmptyList(data['fr']) && !isNonEmptyList(data['nfr'])) {
    issues.push("campo 'fr'/'nfr': debe declarar al menos un FR o un NFR");
  }
  return issues;
}

const FRONT_MATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function describeIssue(issue: z.core.$ZodIssue, data: Record<string, unknown>): string {
  const field = issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((k) => `campo no permitido '${k}'`).join('; ');
  }
  if (issue.path.length === 1 && !(field in data)) {
    return `falta el campo obligatorio '${field}'`;
  }
  if (issue.code === 'invalid_value') {
    const allowed = issue.values.map((v) => String(v)).join(' | ');
    return `valor inválido en '${field}' (permitidos: ${allowed})`;
  }
  return `valor inválido en '${field}': ${issue.message}`;
}

export interface ParsedCase {
  testCase: TestCase | null;
  findings: Finding[];
}

/** Parsea y valida un archivo de TC. `file` es la ruta relativa (con `/`) desde la raíz del repo. */
export function parseCaseFile(file: string, content: string): ParsedCase {
  const error = (message: string): Finding => ({ rule: 'R6', severity: 'error', file, message });
  const match = FRONT_MATTER.exec(content);
  if (!match)
    return { testCase: null, findings: [error('no tiene front matter YAML (bloque --- … --- al inicio)')] };
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? '');
  } catch (e) {
    return { testCase: null, findings: [error(`YAML inválido en el front matter: ${(e as Error).message}`)] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { testCase: null, findings: [error('el front matter debe ser un objeto YAML')] };
  }
  const data = raw as Record<string, unknown>;
  const result = frontMatterSchema.safeParse(data);
  const schemaIssues = result.success ? [] : result.error.issues.map((issue) => describeIssue(issue, data));
  const issues = [...schemaIssues, ...crossFieldIssues(data)];
  if (!result.success || issues.length > 0) return { testCase: null, findings: issues.map(error) };
  const fm: FrontMatter = result.data;
  const findings: Finding[] = [];
  const fileId = basename(file, '.md');
  if (fm.id !== fileId)
    findings.push(error(`el id '${fm.id}' no coincide con el nombre del archivo '${fileId}.md'`));
  const context = fm.id.split('-')[1]?.toLowerCase() ?? '';
  const expectedDir = `tests/cases/${context}/`;
  if (!file.startsWith(expectedDir) || file.slice(expectedDir.length).includes('/')) {
    findings.push(error(`el TC ${fm.id} debe estar en ${expectedDir} (directorio = contexto en minúsculas)`));
  }
  return {
    findings,
    testCase: {
      id: fm.id,
      file,
      title: fm.title,
      spec: fm.spec,
      requirement: fm.requirement,
      scenario: fm.scenario ?? null,
      requirementStatus: fm.requirement_status,
      fr: fm.fr,
      nfr: fm.nfr ?? [],
      invariants: fm.invariants,
      priority: fm.priority,
      automationStatus: fm.automation_status,
      automatedTests: fm.automated_tests ?? [],
      status: fm.status,
    },
  };
}

export interface Catalog {
  cases: TestCase[];
  findings: Finding[];
}

/** Carga `tests/cases/**\/TC-*.md`. Los TC inválidos se reportan (R6) y no participan del enlace. */
export function loadCatalog(root: string): Catalog {
  const files = walkFiles(join(root, 'tests', 'cases')).filter((f) => /^TC-.*\.md$/.test(basename(f)));
  const cases: TestCase[] = [];
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const abs of files) {
    const file = toPosix(root, abs);
    const parsed = parseCaseFile(file, readFileSync(abs, 'utf8'));
    findings.push(...parsed.findings);
    const tc = parsed.testCase;
    if (!tc) continue;
    const previous = seen.get(tc.id);
    if (previous) {
      findings.push({
        rule: 'R8',
        severity: 'error',
        file,
        message: `TC-ID duplicado ${tc.id} (también en ${previous})`,
      });
      continue;
    }
    seen.set(tc.id, file);
    cases.push(tc);
  }
  return { cases, findings };
}
