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
  Rule,
  RuleState,
  RuleTrigger,
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
}

export const DEFAULT_RULES_SETTINGS: RulesSettings = {
  maxRules: 500,
  dryRunMaxDays: 366,
  dryRunMaxTransactions: 5000,
  applyMaxItems: 500,
};

export interface IdGenerator {
  next(): string;
}

export interface RulesDeps {
  readonly uow: UnitOfWork;
  readonly rules: RuleRepository;
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
