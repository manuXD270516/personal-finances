/**
 * Tipos del dominio de RULES (openspec add-rule-engine). Solo `@pf/shared-kernel`: el contrato público
 * (`@pf/rules/contracts`) declara las mismas formas de forma estructural.
 */

export const RULE_TRIGGERS = ['IMPORT', 'MANUAL_CREATE', 'RETROACTIVE'] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
/** Disparadores de una regla nueva sin indicar otros (D337: la creación manual es opt-in por regla). */
export const DEFAULT_TRIGGERS: readonly RuleTrigger[] = ['IMPORT', 'RETROACTIVE'];

export const EVALUATION_MODES = ['FILL_EMPTY', 'OVERWRITE'] as const;
export type EvaluationMode = (typeof EVALUATION_MODES)[number];

export const MATCH_MODES = ['ALL', 'ANY'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const SUBJECT_KINDS = ['INCOME', 'EXPENSE', 'REFUND'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** Versión del DSL (docs/08 §5.13). */
export const RULE_SCHEMA_VERSION = 1;

/** Límites de una definición (spec "Definición de reglas WHEN/THEN"). */
export const MAX_CONDITIONS = 20;
export const MAX_ACTIONS = 10;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 500;
export const MAX_PRIORITY = 1_000_000;

/** Origen de una acción: la regla y la versión de su definición. */
export interface RuleOrigin {
  readonly ruleId: string;
  readonly ruleVersion: number;
}

/** Campo "sujeto": una fila de staging o una transacción existente (`RuleSubjectDto`). */
export interface RuleSubject {
  readonly ref: string;
  readonly kind: SubjectKind;
  readonly accountId: string;
  readonly date: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly counterpartyOrigin: 'USER' | 'ALIAS' | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  readonly externalSource: string | null;
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly splitCount: number;
  /** Notas actuales (aditivo): evita duplicar el texto de `APPEND_NOTE` al reaplicar una regla. */
  readonly notes?: string | null;
}

/** Catálogo de destinos vigentes (ids activos de CLASSIFICATION); una consulta por evaluación. */
export interface ActionCatalog {
  /** Tipo de la categoría activa (`null`: no existe o está archivada). */
  activeCategoryKind(categoryId: string): 'EXPENSE' | 'INCOME' | null;
  isTagActive(tagId: string): boolean;
  isCounterpartyActive(counterpartyId: string): boolean;
  isCustomFieldActive(fieldId: string): boolean;
}

export interface SkippedAction {
  readonly origin: RuleOrigin;
  readonly action: string;
  readonly reason: string;
}

/** Resultado de evaluar un sujeto (`RuleOutcomeDto`). */
export interface RuleOutcome {
  readonly ref: string;
  readonly category: { readonly categoryId: string; readonly origin: RuleOrigin } | null;
  readonly counterparty: { readonly counterpartyId: string; readonly origin: RuleOrigin } | null;
  readonly addTags: readonly { readonly tagId: string; readonly origin: RuleOrigin }[];
  readonly removeTags: readonly { readonly tagId: string; readonly origin: RuleOrigin }[];
  readonly customFields: readonly {
    readonly fieldId: string;
    readonly value: string | boolean;
    readonly origin: RuleOrigin;
  }[];
  readonly description: { readonly text: string; readonly origin: RuleOrigin } | null;
  readonly appendNotes: readonly { readonly text: string; readonly origin: RuleOrigin }[];
  readonly markForReview: RuleOrigin | null;
  readonly exclude: RuleOrigin | null;
  readonly matched: readonly RuleOrigin[];
  readonly skipped: readonly SkippedAction[];
}

/** Motivos de omisión de una acción (enum abierto `RuleSkipReason`). */
export const SKIP_REASONS = {
  targetArchived: 'RULE_ACTION_TARGET_ARCHIVED',
  categoryKindMismatch: 'CATEGORY_KIND_MISMATCH',
  multiSplit: 'MULTI_SPLIT',
  notEmpty: 'NOT_EMPTY',
  alreadyApplied: 'ALREADY_APPLIED',
} as const;
