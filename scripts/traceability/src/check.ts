import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, parseCaseFile } from './catalog.js';
import { normalizeName } from './fs-utils.js';
import { deletedCaseFiles, type DeletedFile } from './git.js';
import { loadRequirements, type OpenSpecMode } from './openspec.js';
import { extractIds, scanTests } from './tests-scan.js';
import type { Finding, Model, Requirement, TestCase } from './types.js';

export interface LoadOptions {
  root: string;
  openspec?: OpenSpecMode;
}

export async function loadModel({ root, openspec = 'auto' }: LoadOptions): Promise<Model> {
  const catalog = loadCatalog(root);
  const requirements = await loadRequirements({ root, openspec });
  return {
    root,
    requirements,
    cases: catalog.cases,
    testFiles: scanTests(root),
    loadFindings: catalog.findings,
  };
}

const reqKey = (spec: string, name: string) => `${spec}#${normalizeName(name)}`;

/** Requirement al que enlaza un TC (o null si spec/requirement no existen). */
export function linkCase(tc: TestCase, index: Map<string, Requirement>): Requirement | null {
  return index.get(reqKey(tc.spec, tc.requirement)) ?? null;
}

export const indexRequirements = (requirements: Requirement[]): Map<string, Requirement> =>
  new Map(requirements.map((r) => [reqKey(r.spec, r.name), r]));

/** Tests que contienen el TC-ID, por archivo. */
export function testsByCase(model: Model): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of model.testFiles) for (const id of t.ids) map.set(id, [...(map.get(id) ?? []), t.file]);
  return map;
}

/** R1: el TC referencia una capability/requirement/scenario existentes (warning si requirement_status provisional). */
function checkReferences(model: Model, index: Map<string, Requirement>): Finding[] {
  const findings: Finding[] = [];
  const specs = new Set(model.requirements.map((r) => r.spec));
  for (const tc of model.cases) {
    if (tc.status === 'deprecated') continue;
    let reason: string | null = null;
    const req = linkCase(tc, index);
    if (!specs.has(tc.spec)) {
      reason = `referencia una capability inexistente '${tc.spec}' (ni en openspec/specs ni en un change activo)`;
    } else if (!req) {
      reason = `referencia un requirement inexistente '${tc.requirement}' en '${tc.spec}'`;
    } else if (
      tc.scenario &&
      !req.scenarios.some((s) => normalizeName(s) === normalizeName(tc.scenario as string))
    ) {
      reason = `referencia un scenario inexistente '${tc.scenario}' en '${tc.spec}#${req.name}'`;
    }
    if (reason) {
      findings.push({
        rule: 'R1',
        severity: tc.requirementStatus === 'provisional' ? 'warning' : 'error',
        file: tc.file,
        message: `${tc.id} ${reason}`,
      });
    }
  }
  return findings;
}

/** R2: todo requirement Must (Phase 1: todos los changes activos y specs principales) tiene ≥ 1 TC no deprecado. */
function checkMustCoverage(model: Model, index: Map<string, Requirement>): Finding[] {
  const covered = new Set<Requirement>();
  for (const tc of model.cases) {
    if (tc.status === 'deprecated') continue;
    const req = linkCase(tc, index);
    if (req) covered.add(req);
  }
  return model.requirements
    .filter((r) => r.priority === 'Must' && !covered.has(r))
    .map((r) => ({
      rule: 'R2' as const,
      severity: 'error' as const,
      ...(r.sources[0] ? { file: r.sources[0] } : {}),
      message: `el requirement Must '${r.spec}#${r.name}' no tiene ningún test case no deprecado que lo referencie`,
    }));
}

/** R3: TC automated ⇒ al menos un test contiene su ID; las rutas de automated_tests existen y lo contienen. */
function checkAutomated(model: Model, byCase: Map<string, string[]>): Finding[] {
  const findings: Finding[] = [];
  for (const tc of model.cases) {
    if (tc.automationStatus !== 'automated' && tc.status !== 'automated') continue;
    if (tc.status === 'deprecated') continue;
    if (!byCase.has(tc.id)) {
      findings.push({
        rule: 'R3',
        severity: 'error',
        file: tc.file,
        message: `${tc.id} está marcado automated pero ningún test automatizado contiene '[${tc.id}]' en su nombre`,
      });
    }
    for (const path of tc.automatedTests) {
      const abs = join(model.root, path);
      if (!existsSync(abs) || !extractIds(readFileSync(abs, 'utf8')).includes(tc.id)) {
        findings.push({
          rule: 'R3',
          severity: 'error',
          file: tc.file,
          message: `${tc.id} declara en automated_tests '${path}', pero ese archivo no existe o no contiene '[${tc.id}]'`,
        });
      }
    }
  }
  return findings;
}

/** R4 / R5: los TC-IDs citados en tests existen en el catálogo y no están deprecados. */
function checkTestReferences(model: Model): Finding[] {
  const findings: Finding[] = [];
  const cases = new Map(model.cases.map((c) => [c.id, c]));
  const pending = new Map<string, string[]>();
  for (const t of model.testFiles) {
    for (const id of t.ids) {
      const tc = cases.get(id);
      if (!tc) {
        findings.push({
          rule: 'R4',
          severity: 'error',
          file: t.file,
          message: `el test referencia ${id}, que no existe en tests/cases (o su front matter es inválido)`,
        });
      } else if (tc.status === 'deprecated') {
        findings.push({
          rule: 'R5',
          severity: 'error',
          file: t.file,
          message: `el test referencia ${id}, que está deprecado (${tc.file}); elimínalo o renómbralo al TC sucesor`,
        });
      } else if (tc.automationStatus !== 'automated') {
        pending.set(id, [...(pending.get(id) ?? []), t.file]);
      }
    }
  }
  for (const [id, files] of pending) {
    const tc = cases.get(id) as TestCase;
    findings.push({
      rule: 'R3',
      severity: 'warning',
      file: tc.file,
      message: `${id} tiene tests (${files.join(', ')}) pero su automation_status es '${tc.automationStatus}'`,
    });
  }
  return findings;
}

/** R11: la PR no borra TC cuyo status (en la base) no sea deprecated. */
function checkDeleted(model: Model, deleted: DeletedFile[]): Finding[] {
  const present = new Set(model.cases.map((c) => c.id));
  const findings: Finding[] = [];
  for (const d of deleted) {
    const parsed = parseCaseFile(d.file, d.content).testCase;
    const id = parsed?.id ?? d.file.replace(/^.*\//, '').replace(/\.md$/, '');
    if (present.has(id)) continue; // movido de archivo: el ID sigue en el catálogo
    if (parsed?.status === 'deprecated') continue;
    findings.push({
      rule: 'R11',
      severity: 'error',
      file: d.file,
      message: `la PR borra el test case ${id} con status '${parsed?.status ?? 'desconocido'}'; los TC no se borran: márcalo deprecated con deprecated_by_change y deprecation_reason`,
    });
  }
  return findings;
}

export function checkModel(model: Model, deleted: DeletedFile[] = []): Finding[] {
  const index = indexRequirements(model.requirements);
  const byCase = testsByCase(model);
  return [
    ...model.loadFindings,
    ...checkReferences(model, index),
    ...checkMustCoverage(model, index),
    ...checkAutomated(model, byCase),
    ...checkTestReferences(model),
    ...checkDeleted(model, deleted),
  ];
}

export interface CheckOptions extends LoadOptions {
  /** Ref base para detectar TC borrados (`git diff <base>...HEAD`). */
  base?: string;
}

export interface CheckResult {
  model: Model;
  findings: Finding[];
}

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const model = await loadModel(options);
  const deleted = options.base ? deletedCaseFiles(options.root, options.base) : [];
  return { model, findings: checkModel(model, deleted) };
}
