import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { Category, CategoryGroup } from '../../domain/category.js';
import type { Counterparty } from '../../domain/counterparty.js';
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

/** Outbox transaccional (`platform.outbox`): misma transacción que el archivado (design §11). */
export interface OutboxPort {
  append(event: CategoryArchivedEvent): Promise<void>;
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
  readonly outbox: OutboxPort;
  /** Auditoría síncrona (`@pf/audit/contracts`): misma transacción que el comando (INV-029). */
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline, docs/31 D52) de Category, Counterparty y Tag. */
  readonly lifecycle: LifecyclePort;
  /** Consulta `GetLifecycle` de AUDIT (el contexto dueño verifica el agregado y aporta su estado). */
  readonly lifecycleQuery: LifecycleQuery;
  readonly lastCategoryUsed: LastCategoryUsedQueryPort;
  readonly catalogs: DefaultCatalogSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export type { AuditPort, LifecyclePort, LifecycleQuery };
