import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  CategoriesMergedV1,
  ClassificationMergeParticipant,
  ClosedDateRange,
  CounterpartiesMergedV1,
} from '../../contracts/merge.js';
import type { Category, CategoryGroup } from '../../domain/category.js';
import type { Counterparty } from '../../domain/counterparty.js';
import type { CustomFieldDefinition, CustomFieldUsage } from '../../domain/custom-field.js';
import type { CustomFieldDataType, CustomFieldTarget } from '../../domain/custom-field-value.js';
import type { CategoryKind } from '../../domain/system-categories.js';
import type { Tag } from '../../domain/tag.js';

/** Contexto RLS de la transacción (`app.user_id` / `app.workspace_id`, ADR-0023). */
export interface RlsContext {
  readonly userId: string | null;
  readonly workspaceId: string | null;
}

/** Unidad de trabajo (`PgUnitOfWork`): reutiliza la transacción en curso si la hay (provisión síncrona, design §6). */
export interface UnitOfWork {
  run<T>(ctx: RlsContext, fn: () => Promise<T>): Promise<T>;
}

/**
 * Repositorios por agregado. Los catálogos de un workspace son pequeños (decenas a cientos de filas): `listAll`
 * devuelve todas (activas y archivadas) y la unicidad de nombres se valida en la aplicación; los índices únicos
 * parciales de la BD son la defensa (el adapter traduce 23505 a `NAME_TAKEN` / `COUNTERPARTY_ALIAS_TAKEN`).
 * `update` aplica control optimista: `false` si la versión persistida ya no es `expectedVersion`.
 */
export interface Repository<T> {
  findById(workspaceId: string, id: string): Promise<T | null>;
  listAll(workspaceId: string): Promise<T[]>;
  insert(item: T): Promise<void>;
  update(item: T, expectedVersion: number): Promise<boolean>;
}

export type CategoryGroupRepository = Repository<CategoryGroup>;
export type CategoryRepository = Repository<Category>;
export type TagRepository = Repository<Tag>;
export type CounterpartyRepository = Repository<Counterparty>;
export type CustomFieldRepository = Repository<CustomFieldDefinition>;

/**
 * Uso de una definición por valores asignados (tablas `txn.split_custom_field_value` y
 * `accounts.account_custom_field_value`, activos o históricos): sustenta `CUSTOM_FIELD_TYPE_LOCKED` y
 * `CUSTOM_FIELD_OPTION_IN_USE` (design decisión 5). Corre en la unidad de trabajo en curso.
 */
export interface CustomFieldUsagePort {
  usageOf(workspaceId: string, fieldId: string): Promise<CustomFieldUsage>;
}

export interface CategoryArchivedEvent {
  readonly eventId: string;
  readonly eventType: 'classification.CategoryArchived';
  readonly eventVersion: 1;
  readonly aggregateType: 'Category';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: { readonly type: 'USER'; readonly id: string };
  readonly payload: {
    readonly categoryId: string;
    readonly parentId: string | null;
    readonly groupId: string;
    readonly kind: CategoryKind;
    readonly archivedAt: string;
    readonly cascadedFromCategoryId: string | null;
    /** Transición de la máquina `Category` (opcional, aditivo; docs/31 D52). */
    readonly transition?: 'ARCHIVE';
  };
}

export interface CustomFieldDefinitionChangedEvent {
  readonly eventId: string;
  readonly eventType: 'classification.CustomFieldDefinitionChanged';
  readonly eventVersion: 1;
  readonly aggregateType: 'CustomFieldDefinition';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: { readonly type: 'USER'; readonly id: string };
  readonly payload: {
    readonly fieldId: string;
    readonly key: string;
    readonly change: 'DEFINED' | 'UPDATED' | 'ARCHIVED' | 'UNARCHIVED';
    readonly dataType: CustomFieldDataType;
    readonly target: CustomFieldTarget;
  };
}

/**
 * `classification.CategoriesMerged.v1` y `classification.CounterpartiesMerged.v1` (add-category-and-counterparty-
 * merge): agregado = la origen (se fusiona una sola vez; la destino viaja en el payload). Sin consumidores en este change (D249).
 */
export interface CategoriesMergedEvent {
  readonly eventId: string;
  readonly eventType: 'classification.CategoriesMerged';
  readonly eventVersion: 1;
  readonly aggregateType: 'Category';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: { readonly type: 'USER'; readonly id: string };
  readonly payload: CategoriesMergedV1;
}

export interface CounterpartiesMergedEvent {
  readonly eventId: string;
  readonly eventType: 'classification.CounterpartiesMerged';
  readonly eventVersion: 1;
  readonly aggregateType: 'Counterparty';
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly actor: { readonly type: 'USER'; readonly id: string };
  readonly payload: CounterpartiesMergedV1;
}

/** Outbox transaccional (`platform.outbox`): misma transacción que el archivado (design §11). */
export interface OutboxPort {
  append(
    event:
      | CategoryArchivedEvent
      | CustomFieldDefinitionChangedEvent
      | CategoriesMergedEvent
      | CounterpartiesMergedEvent,
  ): Promise<void>;
}

/**
 * Periodos cerrados del workspace como rangos de fechas de negocio (D494). El composition root lo implementa con
 * `PeriodQuery` de PLANNING (`CLOSED`; `REOPENED` cuenta como no cerrado): CLASSIFICATION no depende de PLANNING.
 */
export interface ClosedPeriodRangesPort {
  closedRanges(workspaceId: string): Promise<readonly ClosedDateRange[]>;
}

/**
 * Puerto implementado por TRANSACTIONS (design §8): última categoría activa del tipo pedido usada en una porción no
 * anulada con la counterparty. Hasta `add-transaction-recording` el adapter es un stub sin historial.
 */
export interface LastCategoryUsedQueryPort {
  lastCategoryUsed(input: {
    readonly workspaceId: string;
    readonly counterpartyId: string;
    readonly kind: CategoryKind;
  }): Promise<string | null>;
}

/** Locale del usuario (`Me.locale`) para resolver nombres de categorías de sistema. */
export interface LocaleResolver {
  localeOf(userId: string): Promise<string>;
}

export interface IdGenerator {
  next(): string;
}

/** Entrada del catálogo inicial (datos versionados, design §7). */
export interface DefaultCatalogCategory {
  readonly name: string;
  readonly icon?: string;
  readonly color?: string;
  readonly children?: readonly string[];
}

export interface DefaultCatalogGroup {
  readonly name: string;
  readonly kind: CategoryKind;
  readonly categories: readonly DefaultCatalogCategory[];
}

export interface DefaultCatalog {
  readonly version: string;
  readonly groups: readonly DefaultCatalogGroup[];
}

/** Fuente de los catálogos iniciales por versión (`null` si la versión no existe). */
export interface DefaultCatalogSource {
  get(version: string): DefaultCatalog | null;
}

export interface ClassificationDeps {
  readonly uow: UnitOfWork;
  readonly groups: CategoryGroupRepository;
  readonly categories: CategoryRepository;
  readonly tags: TagRepository;
  readonly counterparties: CounterpartyRepository;
  readonly customFields: CustomFieldRepository;
  readonly customFieldUsage: CustomFieldUsagePort;
  readonly outbox: OutboxPort;
  /** Auditoría síncrona (`@pf/audit/contracts`): misma transacción que el comando (INV-029). */
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline, docs/31 D52) de Category, Counterparty y Tag. */
  readonly lifecycle: LifecyclePort;
  /** Consulta `GetLifecycle` de AUDIT (el contexto dueño verifica el agregado y aporta su estado). */
  readonly lifecycleQuery: LifecycleQuery;
  readonly lastCategoryUsed: LastCategoryUsedQueryPort;
  /** Fusión (add-category-and-counterparty-merge): periodos cerrados y participantes, en orden fijo. */
  readonly closedPeriods: ClosedPeriodRangesPort;
  readonly mergeParticipants: readonly ClassificationMergeParticipant[];
  readonly catalogs: DefaultCatalogSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export type { AuditPort, LifecyclePort, LifecycleQuery };
