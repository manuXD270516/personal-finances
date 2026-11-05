import type { AuditPort } from '@pf/audit/contracts';
import type {
  ClassificationCoverageQuery,
  ClassificationSubjectsQuery,
  RuleClassificationCommand,
} from '@pf/transactions/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  Action,
  ActionCatalog,
  EvaluableRule,
  ProposalPatternType,
  ProposalThresholds,
  Rule,
  RuleState,
  RuleTrigger,
  SubjectKind,
} from '../../domain/index.js';

/** Unidad de trabajo (`PgRulesUnitOfWork`): reutiliza la transacción en curso (la del llamador) si la hay. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface RuleVersionRecord {
  readonly ruleId: string;
  readonly version: number;
  readonly snapshot: RuleVersionSnapshot;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** Instantánea inmutable de una versión (docs/08 §5.13). */
export interface RuleVersionSnapshot {
  readonly name: string;
  readonly triggers: readonly string[];
  readonly matchMode: string;
  readonly conditions: unknown;
  readonly actions: unknown;
  readonly stopProcessing: boolean;
  readonly schemaVersion: number;
}

export interface RuleNameRecord {
  readonly ruleId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly version: number;
}

export interface RuleRepository {
  findById(workspaceId: string, id: string): Promise<Rule | null>;
  listAll(workspaceId: string, options: { readonly includeArchived: boolean }): Promise<Rule[]>;
  /** Reglas activas del disparador con UNA consulta (índice parcial por prioridad). */
  listEvaluable(workspaceId: string, trigger: RuleTrigger): Promise<EvaluableRule[]>;
  /** Reglas activas por id (cualquier disparador). */
  listEvaluableByIds(workspaceId: string, ids: readonly string[]): Promise<EvaluableRule[]>;
  countNonArchived(workspaceId: string): Promise<number>;
  insert(rule: Rule, createdBy: string): Promise<void>;
  /** `false` si la versión de fila persistida ya no es `expectedRowVersion`. */
  update(rule: Rule, expectedRowVersion: number): Promise<boolean>;
  insertVersion(state: RuleState, createdBy: string): Promise<void>;
  listVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]>;
  /** Nombre, estado y versión vigente, incluidas las archivadas. */
  names(workspaceId: string, ids: readonly string[]): Promise<RuleNameRecord[]>;
}

/** Destinos de catálogo (CLASSIFICATION) que referencian las acciones. */
export interface ReferenceCatalog {
  /**
   * Valida al guardar que cada categoría, etiqueta, contraparte y campo personalizado referenciado exista y esté
   * activo, con los códigos de Classification (`REFERENCE_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TAG_ARCHIVED`,
   * `COUNTERPARTY_ARCHIVED`, `CUSTOM_FIELD_ARCHIVED`, `CUSTOM_FIELD_VALUE_INVALID`).
   */
  assertActions(input: { readonly workspaceId: string; readonly actions: readonly Action[] }): Promise<void>;
  /** Estado vigente de los destinos que usan las acciones dadas (una consulta por tipo de destino). */
  load(input: { readonly workspaceId: string; readonly actions: readonly Action[] }): Promise<ActionCatalog>;
  /** Nombres de categorías y contrapartes por id (incluye archivadas), para explicar una sugerencia. */
  describe(input: {
    readonly workspaceId: string;
    readonly categoryIds: readonly string[];
    readonly counterpartyIds: readonly string[];
  }): Promise<ReferenceDescriptions>;
}

/** Nombre, tipo y estado de una categoría o contraparte para explicar una sugerencia (incluye archivadas). */
export interface ReferenceDescriptions {
  readonly categories: ReadonlyMap<string, { readonly name: string; readonly archived: boolean }>;
  readonly counterparties: ReadonlyMap<string, { readonly name: string; readonly archived: boolean }>;
}

/** Decisión del usuario sobre una sugerencia (`rules.rule_suggestion_decision`, clave: la huella). */
export interface RuleProposalDecisionRecord {
  readonly suggestionId: string;
  readonly patternType: ProposalPatternType;
  readonly patternValue: string;
  readonly kind: SubjectKind;
  readonly categoryId: string;
  readonly decision: 'ACCEPTED' | 'DISMISSED';
  /** Solo en `ACCEPTED`: la regla creada. */
  readonly ruleId: string | null;
  /** Instantánea de la sugerencia al decidir (nula si ya no se podía calcular). */
  readonly support: number | null;
  readonly evidenceCount: number | null;
  readonly confidence: string | null;
  readonly decidedAt: string;
  readonly decidedBy: string;
}

export interface RuleProposalDecisionRepository {
  list(workspaceId: string): Promise<RuleProposalDecisionRecord[]>;
  find(workspaceId: string, suggestionId: string): Promise<RuleProposalDecisionRecord | null>;
  /** `false` si ya existe una decisión para la huella (previa o concurrente): no escribe nada. */
  insert(workspaceId: string, record: RuleProposalDecisionRecord): Promise<boolean>;
  /** Borra la decisión `DISMISSED` de la huella; `false` si no había una. */
  deleteDismissed(workspaceId: string, suggestionId: string): Promise<boolean>;
  /** Decisión `ACCEPTED` que originó cada regla dada. */
  acceptedByRules(
    workspaceId: string,
    ruleIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly suggestionId: string; readonly acceptedAt: string }>>;
}

/** Fecha de negocio de hoy en la zona horaria del workspace. */
export interface WorkspaceToday {
  today(workspaceId: string): Promise<string>;
}

export interface RulesSettings {
  /** Reglas no archivadas por workspace (D339). */
  readonly maxRules: number;
  /** Rango máximo del dry-run en días (D339). */
  readonly dryRunMaxDays: number;
  /** Transacciones máximas del dry-run (D339). */
  readonly dryRunMaxTransactions: number;
  /** Transacciones máximas por aplicación (D339). */
  readonly applyMaxItems: number;
  /** Sugerencias de reglas (add-rule-suggestions, decisión 8). */
  readonly suggest: RuleSuggestSettings;
}

export interface RuleSuggestSettings extends ProposalThresholds {
  readonly windowDays: number;
  readonly maxWindowDays: number;
  readonly maxEvidence: number;
  readonly maxResults: number;
}

export const DEFAULT_SUGGEST_SETTINGS: RuleSuggestSettings = {
  windowDays: 180,
  maxWindowDays: 366,
  minSupport: 3,
  minConfidence: '0.8000',
  highConfidence: '0.9500',
  highMinSupport: 5,
  maxEvidence: 5000,
  maxResults: 50,
};

export const DEFAULT_RULES_SETTINGS: RulesSettings = {
  maxRules: 500,
  dryRunMaxDays: 366,
  dryRunMaxTransactions: 5000,
  applyMaxItems: 500,
  suggest: DEFAULT_SUGGEST_SETTINGS,
};

export interface IdGenerator {
  next(): string;
}

export interface RulesDeps {
  readonly uow: UnitOfWork;
  readonly rules: RuleRepository;
  readonly decisions: RuleProposalDecisionRepository;
  readonly calendar: WorkspaceToday;
  readonly catalog: ReferenceCatalog;
  readonly subjects: ClassificationSubjectsQuery;
  readonly coverage: Pick<ClassificationCoverageQuery, 'coverage' | 'ruleStats'>;
  readonly classifier: RuleClassificationCommand;
  readonly audit: AuditPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: RulesSettings;
}

export type { AuditPort };
