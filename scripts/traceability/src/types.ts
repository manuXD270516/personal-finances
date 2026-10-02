/**
 * Reglas (docs/17 §6.2):
 * R1 referencia a spec/requirement/scenario inexistente · R2 requirement Must sin TC activo ·
 * R3 TC automated sin test · R4 test con TC-ID inexistente · R5 test con TC-ID deprecado ·
 * R6 front matter inválido / id ≠ archivo / directorio ≠ contexto · R8 TC-ID duplicado ·
 * R11 TC activo borrado en la PR (spec quality/test-traceability, "Se borra un test case activo").
 */
export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R8' | 'R11' | 'IO';

export interface Finding {
  rule: RuleId;
  severity: 'error' | 'warning';
  /** Ruta relativa a la raíz del repo, con `/`. */
  file?: string;
  message: string;
}

export type Priority = 'Must' | 'Should' | 'Could';
export type Operation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED' | 'SPEC';

export interface Requirement {
  /** Capability path, p. ej. `ledger/journal-posting`. */
  spec: string;
  name: string;
  priority: Priority | null;
  /** IDs FR/NFR de la línea `Trace:`. */
  trace: string[];
  scenarios: string[];
  /** Archivos spec.md de donde proviene (change activo o spec principal). */
  sources: string[];
}

export type AutomationStatus = 'not_automated' | 'automated' | 'manual';
export type CaseStatus = 'draft' | 'ready' | 'automated' | 'deprecated';

export interface TestCase {
  id: string;
  file: string;
  title: string;
  spec: string;
  requirement: string;
  scenario: string | null;
  requirementStatus: 'provisional' | 'confirmed';
  fr: string[];
  nfr: string[];
  invariants: string[];
  priority: string;
  automationStatus: AutomationStatus;
  automatedTests: string[];
  status: CaseStatus;
}

export interface TestFile {
  file: string;
  ids: string[];
}

export interface Model {
  root: string;
  requirements: Requirement[];
  cases: TestCase[];
  testFiles: TestFile[];
  /** Hallazgos producidos al cargar (schema del catálogo, IO). */
  loadFindings: Finding[];
}
