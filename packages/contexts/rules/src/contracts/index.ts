/**
 * API pública de `@pf/rules` (openspec add-rule-engine; ADR-0003). Hoja: no importa capas internas.
 * `RuleEvaluationQuery` es el puerto que consume `add-import-pipeline` en la vista previa del import.
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

export const RULES_CONTEXT = 'rules' as const;

export type RuleTriggerDto = 'IMPORT' | 'MANUAL_CREATE' | 'RETROACTIVE';
export type RuleEvaluationModeDto = 'FILL_EMPTY' | 'OVERWRITE';

export interface RuleSubjectDto {
  /** Id de la fila de staging o de la transacción. */
  readonly ref: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly accountId: string;
  /** `YYYY-MM-DD` (fecha de negocio). */
  readonly date: string;
  /** Positivo, a la escala de la moneda. */
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly counterpartyId: string | null;
  /** `ALIAS` es reemplazable por una regla. */
  readonly counterpartyOrigin: 'USER' | 'ALIAS' | null;
  /** `null` ⇒ "sin categoría". */
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  /** `source` y espacio de nombres de la referencia externa. */
  readonly externalSource: string | null;
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly splitCount: number;
  /** Notas actuales (aditivo): evita duplicar el texto de `APPEND_NOTE` al reaplicar. */
  readonly notes?: string | null;
}

export interface RuleOriginDto {
  readonly ruleId: string;
  readonly ruleVersion: number;
}

export interface RuleOutcomeDto {
  readonly ref: string;
  readonly category: { readonly categoryId: string; readonly origin: RuleOriginDto } | null;
  readonly counterparty: { readonly counterpartyId: string; readonly origin: RuleOriginDto } | null;
  readonly addTags: readonly { readonly tagId: string; readonly origin: RuleOriginDto }[];
  readonly removeTags: readonly { readonly tagId: string; readonly origin: RuleOriginDto }[];
  readonly customFields: readonly {
    readonly fieldId: string;
    readonly value: string | boolean;
    readonly origin: RuleOriginDto;
  }[];
  readonly description: { readonly text: string; readonly origin: RuleOriginDto } | null;
  readonly appendNotes: readonly { readonly text: string; readonly origin: RuleOriginDto }[];
  readonly markForReview: RuleOriginDto | null;
  /** Solo con el disparador `IMPORT`. */
  readonly exclude: RuleOriginDto | null;
  readonly matched: readonly RuleOriginDto[];
  readonly skipped: readonly {
    readonly origin: RuleOriginDto;
    readonly action: string;
    readonly reason: string;
  }[];
}

/** Máximo de sujetos por llamada de `evaluate` (D339). */
export const RULE_EVALUATION_MAX_SUBJECTS = 5000;

/**
 * Evaluación sin efectos (sin auditoría, sin escrituras), en la unidad de trabajo del llamador si existe. Carga las
 * reglas activas del disparador con UNA consulta y los ids activos de CLASSIFICATION con otra, y evalúa en memoria hasta
 * 5 000 sujetos por llamada. Más sujetos ⇒ `VALIDATION_FAILED`.
 */
export interface RuleEvaluationQuery {
  evaluate(input: {
    readonly workspaceId: string;
    readonly trigger: RuleTriggerDto;
    readonly mode: RuleEvaluationModeDto;
    readonly subjects: readonly RuleSubjectDto[];
  }): Promise<readonly RuleOutcomeDto[]>;
}

export const RULE_EVALUATION_QUERY = Symbol.for('pf.rules.RuleEvaluationQuery');

// ───────────────────────────────────────────── add-category-suggestions (classification/auto-classification)

export type CategorySuggestionLevelDto = 'HIGH' | 'MEDIUM';
export type CategorySuggestionBasisDto = 'COUNTERPARTY' | 'DESCRIPTION' | 'BOTH';

/** Sugerencia de categoría por historial (nunca se aplica sin una acción explícita del usuario, D476). */
export interface CategorySuggestionDto {
  readonly categoryId: string;
  /** `matches ÷ support`, texto decimal de 4 decimales (`0.9000`). */
  readonly confidence: string;
  readonly level: CategorySuggestionLevelDto;
  readonly support: number;
  readonly matches: number;
  readonly basis: CategorySuggestionBasisDto;
  readonly descriptionKey: string | null;
  readonly counterpartyId: string | null;
}

export interface CategorySuggestionSubjectDto {
  /** Id de la fila de staging. */
  readonly ref: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly description: string | null;
  readonly counterpartyId: string | null;
}

/**
 * Sugerencias para varias filas de un import: el índice de evidencia se construye UNA vez por llamada (en la unidad de
 * trabajo del llamador) y devuelve solo las filas con sugerencia. Deshabilitada la función, el mapa va vacío.
 */
export interface CategorySuggestionQuery {
  suggestMany(input: {
    readonly workspaceId: string;
    readonly subjects: readonly CategorySuggestionSubjectDto[];
  }): Promise<ReadonlyMap<string, CategorySuggestionDto>>;
}

export const CATEGORY_SUGGESTION_QUERY = Symbol.for('pf.rules.CategorySuggestionQuery');

export type CategorySuggestionSurfaceDto = 'MANUAL_ENTRY' | 'IMPORT';

/**
 * Registro del resultado de las sugerencias mostradas (aceptada, corregida o ignorada) por canal y nivel, sin
 * descripciones ni montos. Corre en la unidad de trabajo del llamador (IMPORTS lo llama al aprobar).
 */
export interface CategorySuggestionFeedbackPort {
  recordBatch(input: {
    readonly workspaceId: string;
    readonly surface: CategorySuggestionSurfaceDto;
    readonly importJobId: string | null;
    readonly outcomes: readonly {
      readonly level: CategorySuggestionLevelDto;
      readonly outcome: 'ACCEPTED' | 'CORRECTED' | 'IGNORED';
      /** `YYYY-MM-DD` en la zona del workspace. */
      readonly occurredOn: string;
      readonly transactionId: string | null;
    }[];
  }): Promise<void>;
}

export const CATEGORY_SUGGESTION_FEEDBACK_PORT = Symbol.for('pf.rules.CategorySuggestionFeedbackPort');

/** Allow-list de auditoría de RULES (NFR-SEC-015): `conditions` y `actions` viajan como texto JSON. */
export const RULES_AUDIT_POLICY = {
  Rule: {
    name: 'plain',
    description: 'plain',
    priority: 'plain',
    status: 'plain',
    triggers: 'plain',
    matchMode: 'plain',
    conditions: 'plain',
    actions: 'plain',
    stopProcessing: 'plain',
    version: 'plain',
  },
  RuleOrder: { ruleIds: 'plain', count: 'plain' },
  /** Decisiones sobre sugerencias (add-rule-suggestions): el patrón es texto normalizado o un id, sin montos. */
  RuleSuggestion: {
    decision: 'plain',
    patternType: 'plain',
    patternValue: 'plain',
    kind: 'plain',
    categoryId: 'plain',
    ruleId: 'plain',
    support: 'plain',
    evidenceCount: 'plain',
    confidence: 'plain',
  },
  RuleDryRunApplication: {
    bulkOperationId: 'plain',
    count: 'plain',
    ruleIds: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

/** Gancho de importación que recalcula la huella de cada decisión tras el remapeo de ids (add-rule-suggestions). */
export const RULES_SUGGESTION_FINGERPRINT_HOOK = 'rules.suggestion-fingerprint' as const;

/**
 * Secciones de exportación del workspace (openspec add-rule-engine, tarea 4.4): reglas y sus versiones inmutables.
 * Orden 360–361: después de CLASSIFICATION (300–350) y antes de las cuentas; los splits de TRANSACTIONS (600)
 * referencian reglas por id.
 */
export const RULES_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'rules',
    context: 'rules',
    table: 'rules.rule',
    order: 360,
    orderBy: ['id'],
  },
  {
    name: 'rule-versions',
    context: 'rules',
    table: 'rules.rule_version',
    order: 361,
    orderBy: ['rule_id', 'version'],
    idColumns: [],
  },
  {
    // add-rule-suggestions: decisiones (aceptadas y descartadas). La huella cubre la categoría y la contraparte, que se
    // remapean al importar: el gancho la recalcula; `pattern_value` lleva el id de la contraparte (o la clave de texto).
    name: 'rule-suggestion-decisions',
    context: 'rules',
    table: 'rules.rule_suggestion_decision',
    order: 362,
    orderBy: ['suggestion_id'],
    idColumns: [],
    textRefs: ['pattern_value'],
    importHook: RULES_SUGGESTION_FINGERPRINT_HOOK,
  },
];

/** Los resultados de las sugerencias de categoría son telemetría de producto: no viajan en la exportación. */
export const RULES_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'rules.category_suggestion_outcome',
    reason:
      'Telemetría de producto (tasa de aceptación de las sugerencias de categoría, sin descripciones ni montos): no es un dato del usuario y empieza de cero en un workspace importado.',
  },
];
