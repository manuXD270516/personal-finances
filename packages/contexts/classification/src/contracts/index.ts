/**
 * API pública de `@pf/classification` (consumida por otros contextos y por `apps/api`). Hoja: no importa capas
 * internas.
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const CLASSIFICATION_CONTEXT = 'classification' as const;

export type CategoryKindDto = 'EXPENSE' | 'INCOME';
export type SplitKindDto = 'EXPENSE' | 'INCOME' | 'REFUND';

/** Payload de `classification.CategoryArchived.v1` (contracts/events/classification/CategoryArchived.v1.schema.json). */
export interface CategoryArchivedV1 {
  readonly categoryId: string;
  readonly parentId: string | null;
  readonly groupId: string;
  readonly kind: CategoryKindDto;
  readonly archivedAt: string;
  readonly cascadedFromCategoryId: string | null;
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
}

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
  CategoryCatalog: {
    catalogVersion: 'plain',
    createdGroups: 'plain',
    createdCategories: 'plain',
    skipped: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
