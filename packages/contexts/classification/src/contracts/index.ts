/**
 * API pública de `@pf/classification` (consumida por otros contextos y por `apps/api`). Hoja: no importa capas
 * internas.
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const CLASSIFICATION_CONTEXT = 'classification' as const;

export type CategoryKindDto = 'EXPENSE' | 'INCOME';
export type SplitKindDto = 'EXPENSE' | 'INCOME' | 'REFUND';

export type CustomFieldDataTypeDto = 'TEXT' | 'NUMBER' | 'DECIMAL' | 'DATE' | 'BOOLEAN' | 'SELECT';
export type CustomFieldTargetDto = 'TRANSACTION' | 'ACCOUNT';
/** Clase de almacenamiento del valor: `SELECT` es texto; `NUMBER` y `DECIMAL` comparten la columna numérica. */
export type CustomFieldValueTypeDto = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';

/**
 * Valor de custom field que asigna un registro: por `fieldId` o por `key` (una de las dos); `null` quita el valor.
 * Los números y decimales viajan como string decimal exacto (INV-001).
 */
export interface CustomFieldValueInputDto {
  readonly fieldId?: string;
  readonly key?: string;
  readonly value: string | boolean | null;
}

/** Valor validado y normalizado (decimal canónico, fecha ISO, clave de opción), listo para persistir. */
export interface ValidatedCustomFieldValueDto {
  readonly fieldId: string;
  readonly key: string;
  readonly valueType: CustomFieldValueTypeDto;
  readonly value: string | boolean;
}

/** Entrada de `validateCustomFieldValues`: los valores de UN registro (un split o una cuenta). */
export interface CustomFieldValuesItemDto {
  /** Puntero JSON del arreglo de valores (para los errores), p. ej. `/splits/0/customFields`. */
  readonly pointer: string;
  readonly values: readonly CustomFieldValueInputDto[];
  /** Campos que el registro ya tiene con valor (obligatoriedad y límite de 20 valores consideran el resultado). */
  readonly existingFieldIds?: readonly string[];
}

export interface CustomFieldValuesResultDto {
  /** Valores a fijar (sustituyen al existente del mismo campo). */
  readonly set: readonly ValidatedCustomFieldValueDto[];
  /** Campos cuyo valor se quita (`value: null`). */
  readonly removeFieldIds: readonly string[];
}

/** Payload de `classification.CustomFieldDefinitionChanged.v1` (contracts/events/classification/…). */
export interface CustomFieldDefinitionChangedV1 {
  readonly fieldId: string;
  readonly key: string;
  readonly change: 'DEFINED' | 'UPDATED' | 'ARCHIVED' | 'UNARCHIVED';
  readonly dataType: CustomFieldDataTypeDto;
  readonly target: CustomFieldTargetDto;
}

/** Payload de `classification.CategoryArchived.v1` (contracts/events/classification/CategoryArchived.v1.schema.json). */
export interface CategoryArchivedV1 {
  readonly categoryId: string;
  readonly parentId: string | null;
  readonly groupId: string;
  readonly kind: CategoryKindDto;
  readonly archivedAt: string;
  readonly cascadedFromCategoryId: string | null;
  /** Transición de la máquina `Category` (opcional, aditivo; docs/31 D52). */
  readonly transition?: 'ARCHIVE';
}

/**
 * Query pública `ValidateClassification` (design §4, INV-019) para Transactions: valida SOLO los IDs nuevos o
 * modificados de cada porción. Lanza `DomainError` con `REFERENCE_NOT_FOUND`, `CATEGORY_ARCHIVED`,
 * `CATEGORY_KIND_MISMATCH`, `TAG_ARCHIVED` o `COUNTERPARTY_ARCHIVED`. Se ejecuta en la unidad de trabajo en curso.
 */
export interface ClassificationValidator {
  validate(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly categoryIds?: readonly { readonly categoryId: string; readonly splitKind: SplitKindDto }[];
    readonly tagIds?: readonly string[];
    readonly counterpartyId?: string | null;
  }): Promise<void>;

  /**
   * `ValidateCustomFieldValues` (openspec add-custom-fields, FR-CLASSIFICATION-009): valida los valores de uno o más
   * registros de la entidad `target` contra las definiciones del workspace. Falla con `CUSTOM_FIELD_TARGET_MISMATCH`,
   * `CUSTOM_FIELD_ARCHIVED`, `CUSTOM_FIELD_VALUE_INVALID`, `CUSTOM_FIELD_REQUIRED` (solo con `requireMandatory`),
   * `REFERENCE_NOT_FOUND` o `VALIDATION_FAILED` (más de 20 valores). Se ejecuta en la unidad de trabajo en curso.
   */
  validateCustomFieldValues(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly target: CustomFieldTargetDto;
    readonly requireMandatory: boolean;
    readonly items: readonly CustomFieldValuesItemDto[];
  }): Promise<readonly CustomFieldValuesResultDto[]>;
}

/** Consultas de catálogo para Transactions: categoría de sistema por código y jerarquía (subcategorías). */
export interface ClassificationLookup {
  systemCategoryId(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly systemCode: 'UNCATEGORIZED' | 'UNCATEGORIZED_INCOME' | 'FEES';
  }): Promise<string | null>;
  categoryIdsWithDescendants(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly categoryIds: readonly string[];
  }): Promise<string[]>;
}

/** Categoría resumida para lecturas de otros contextos (Reporting, openspec add-basic-dashboard). */
export interface CategorySummaryDto {
  readonly categoryId: string;
  readonly name: string;
  readonly kind: CategoryKindDto;
  readonly parentId: string | null;
  /** Código de sistema (`FEES`, `UNCATEGORIZED`, …) o `null`. */
  readonly systemCode: string | null;
  readonly archived: boolean;
}

/** Nombres de categorías por id (incluye archivadas: los históricos las siguen mostrando). Sin efectos. */
export interface CategoryCatalogQuery {
  categoriesByIds(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly categoryIds: readonly string[];
  }): Promise<readonly CategorySummaryDto[]>;
}

export const CATEGORY_CATALOG_QUERY = Symbol.for('pf.classification.CategoryCatalogQuery');

/**
 * Provisión síncrona al crear un workspace (design §6-§7): categorías de sistema siempre y catálogo inicial si
 * `seedDefaultCategories`. Se invoca dentro de la unidad de trabajo de `CreateWorkspace` (misma transacción).
 */
export interface WorkspaceCatalogProvisioner {
  onWorkspaceCreated(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly seedDefaultCategories: boolean;
  }): Promise<void>;
}

export const CLASSIFICATION_VALIDATOR = Symbol.for('pf.classification.ClassificationValidator');

/** Allow-list de auditoría de los agregados de CLASSIFICATION (openspec add-audit-trail, NFR-SEC-015). */
export const CLASSIFICATION_AUDIT_POLICY = {
  CategoryGroup: { name: 'plain', kind: 'plain', sortOrder: 'plain', status: 'plain' },
  Category: {
    name: 'plain',
    groupId: 'plain',
    parentId: 'plain',
    kind: 'plain',
    systemCode: 'plain',
    icon: 'plain',
    color: 'plain',
    sortOrder: 'plain',
    status: 'plain',
  },
  Tag: { name: 'plain', color: 'plain', status: 'plain' },
  Counterparty: {
    name: 'plain',
    kind: 'plain',
    icon: 'plain',
    defaultCategoryId: 'plain',
    aliases: 'plain',
    status: 'plain',
  },
  CustomFieldDefinition: {
    key: 'plain',
    label: 'plain',
    dataType: 'plain',
    target: 'plain',
    required: 'plain',
    options: 'plain',
    position: 'plain',
    status: 'plain',
  },
  CategoryCatalog: {
    catalogVersion: 'plain',
    createdGroups: 'plain',
    createdCategories: 'plain',
    skipped: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
