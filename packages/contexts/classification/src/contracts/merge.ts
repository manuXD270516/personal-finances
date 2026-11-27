/**
 * Contratos de la fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge, D480, D494–D499).
 * Hoja: sin imports internos. CLASSIFICATION define el puerto; cada contexto dueño de una referencia lo implementa
 * (inversión de dependencias, como `PeriodCreatedHook` de PLANNING) y `apps/api` los compone, sin consumidores nuevos
 * (D249): la fusión corre síncrona en una única unidad de trabajo.
 */

export type MergeKind = 'CATEGORY' | 'COUNTERPARTY';

/** Tipos de referencia contados por la vista previa y por el resultado (`x-extensible-enum` en el contrato HTTP). */
export const MERGE_COUNT_KEYS = [
  'SPLITS_OPEN',
  'SPLITS_CLOSED_KEPT',
  'TRANSACTIONS_OPEN',
  'TRANSACTIONS_CLOSED_KEPT',
  'BUDGET_LINES',
  'TEMPLATES',
  'RECURRING_DEFINITIONS',
  'SUBSCRIPTIONS',
  'RULES',
  'DEFAULT_CATEGORY_COUNTERPARTIES',
  'ESSENTIALS',
  'LOANS',
  'CONVERSIONS',
  'IMPORT_ROWS',
  'SUBCATEGORIES_MOVED',
  'ALIASES_MOVED',
] as const;
export type MergeCountKey = (typeof MERGE_COUNT_KEYS)[number];

export interface MergeCount {
  readonly key: MergeCountKey;
  readonly count: number;
}

/** Referencia a un dato que bloquea la fusión (`kind`: p. ej. `BUDGET_LINE`, `BUDGET_TEMPLATE_LINE`, `CATEGORY`). */
export interface MergeConflictRef {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

export type MergeConflictReason = 'BUDGET_LINE_EXISTS' | 'TEMPLATE_LINE_EXISTS' | 'SUBCATEGORY_NAME_TAKEN';

export interface MergeConflict {
  readonly reason: MergeConflictReason | (string & {});
  readonly refs: readonly MergeConflictRef[];
}

/** Rango cerrado de un periodo financiero `CLOSED` (fechas de negocio `YYYY-MM-DD`, extremos inclusivos). */
export interface ClosedDateRange {
  readonly from: string;
  readonly to: string;
}

/** Entrada común de `preview` y `apply`: corre en la unidad de trabajo en curso (RLS del workspace). */
export interface MergeParticipantInput {
  readonly userId: string;
  readonly workspaceId: string;
  readonly kind: MergeKind;
  readonly sourceId: string;
  readonly targetId: string;
  /**
   * Periodos cerrados (D494): las porciones y transacciones con fecha de negocio en estos rangos conservan la origen.
   * Un periodo reabierto (`REOPENED`) cuenta como no cerrado y no figura aquí.
   */
  readonly closedRanges: readonly ClosedDateRange[];
  /** Correlación de la operación (solo en `apply`): el mismo UUID de la auditoría, el recorrido y el evento. */
  readonly operationId?: string;
}

export interface MergePreviewResult {
  readonly counts: readonly MergeCount[];
  readonly conflicts: readonly MergeConflict[];
}

export interface MergeApplyResult {
  readonly counts: readonly MergeCount[];
}

/**
 * Participante de la fusión (decisión 1 del design). `preview` no escribe nada; `apply` reasigna toda referencia viva a
 * la origen hacia la destino de forma idempotente, con actualizaciones por conjunto y sin consultas en paralelo sobre
 * el mismo cliente. Una excepción revierte la fusión completa. Un contexto que no tiene referencias de un `kind`
 * devuelve cero conteos.
 */
export interface ClassificationMergeParticipant {
  /** Contexto dueño (`transactions`, `planning`, …): nombra su registro de auditoría. */
  readonly context: string;
  preview(input: MergeParticipantInput): Promise<MergePreviewResult>;
  apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult>;
}

/** Composición de los participantes (orden fijo: se aplican de a uno, nunca en paralelo). */
export const CLASSIFICATION_MERGE_PARTICIPANTS = Symbol.for('pf.classification.MergeParticipants');

/**
 * Consulta `CategoryMergeQuery.resolve` (D496): para cada categoría fusionada devuelve su destino vigente, siguiendo la
 * cadena si la destino se fusionó después en otra; las no fusionadas no aparecen. Lectura sin efectos, en la unidad de
 * trabajo del llamador. FORECAST y RULES la usan para leer la historia de una origen como historia de su destino.
 */
export interface CategoryMergeQuery {
  resolve(input: {
    readonly workspaceId: string;
    readonly categoryIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

export const CATEGORY_MERGE_QUERY = Symbol.for('pf.classification.CategoryMergeQuery');

/** Payload de `classification.CategoriesMerged.v1` (contracts/events/classification/CategoriesMerged.v1.schema.json). */
export interface CategoriesMergedV1 {
  readonly sourceCategoryId: string;
  readonly targetCategoryId: string;
  readonly movedSubcategoryIds: readonly string[];
  readonly counts: readonly MergeCount[];
  readonly operationId: string;
  readonly mergedAt: string;
}

/** Payload de `classification.CounterpartiesMerged.v1` (contracts/events/classification/CounterpartiesMerged.v1.schema.json). */
export interface CounterpartiesMergedV1 {
  readonly sourceCounterpartyId: string;
  readonly targetCounterpartyId: string;
  readonly movedAliases: readonly string[];
  readonly counts: readonly MergeCount[];
  readonly operationId: string;
  readonly mergedAt: string;
}
