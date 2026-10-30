/**
 * API pública de `@pf/rules` (openspec add-rule-engine; ADR-0003). Hoja: no importa capas internas.
 * `RuleEvaluationQuery` es el puerto que consume `add-import-pipeline` en la vista previa del import.
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import type { PortabilitySection } from '@pf/shared-kernel';

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
  RuleDryRunApplication: {
    bulkOperationId: 'plain',
    count: 'plain',
    ruleIds: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

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
];
