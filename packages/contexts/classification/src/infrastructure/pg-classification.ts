import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, type Clock } from '@pf/shared-kernel';
import { sql, type Generated, type Kysely, type Selectable } from 'kysely';
import type { Pool } from 'pg';
import type {
  AuditPort,
  ClassificationDeps,
  DefaultCatalog,
  DefaultCatalogSource,
  IdGenerator,
  LastCategoryUsedQueryPort,
  LifecyclePort,
  LifecycleQuery,
  OutboxPort,
  Repository,
} from '../application/ports/index.js';
import { Category, CategoryGroup } from '../domain/category.js';
import { Alias, Counterparty, type CounterpartyKind } from '../domain/counterparty.js';
import type { CategoryKind, SystemCode } from '../domain/system-categories.js';
import { Tag } from '../domain/tag.js';
import esBoV1 from './seed/default-catalog.es-BO.v1.json' with { type: 'json' };

/**
 * Adaptadores PostgreSQL de CLASSIFICATION (schema `classification`) con Kysely sobre la conexión de la
 * `PgUnitOfWork` en curso (misma transacción y contexto RLS LOCAL). Control optimista por `version`; las violaciones
 * de los índices únicos parciales se traducen a `NAME_TAKEN` / `COUNTERPARTY_ALIAS_TAKEN`.
 */
interface Common {
  id: string;
  workspace_id: string;
  archived_at: Date | null;
  version: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface GroupTable extends Common {
  kind: CategoryKind;
  name: string;
  normalized_name: string;
  sort_order: number;
}

interface CategoryTable extends Common {
  group_id: string;
  parent_id: string | null;
  kind: CategoryKind;
  name: string;
  normalized_name: string;
  system_code: SystemCode | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
}

interface TagTable extends Common {
  name: string;
  normalized_name: string;
  color: string | null;
}

interface CounterpartyTable extends Common {
  name: string;
  normalized_name: string;
  kind: CounterpartyKind;
  icon: string | null;
  default_category_id: string | null;
  notes: string | null;
  website: string | null;
}

interface AliasTable {
  workspace_id: string;
  counterparty_id: string;
  alias: string;
  alias_normalized: string;
  active: boolean;
}

export interface ClassificationDb {
  'classification.category_group': GroupTable;
  'classification.category': CategoryTable;
  'classification.tag': TagTable;
  'classification.counterparty': CounterpartyTable;
  'classification.counterparty_alias': AliasTable;
}

const db = (): Kysely<ClassificationDb> => unitOfWorkKysely<ClassificationDb>();
const now = sql<Date>`now()`;
const iso = (d: Date | null): string | null => (d === null ? null : new Date(d).toISOString());
const ts = (s: string | null): Date | null => (s === null ? null : new Date(s));

/** 23505 (unique_violation) de un índice de nombre/alias ⇒ error del dominio; otro error se propaga. */
async function translateUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint?.includes('alias')) {
      throw new DomainError('COUNTERPARTY_ALIAS_TAKEN', 'an alias already belongs to another counterparty');
    }
    if (e.code === '23505' && e.constraint?.includes('name')) {
      throw new DomainError('NAME_TAKEN', 'an active item already uses this name');
    }
    throw err;
  }
}

export class PgCategoryGroupRepository implements Repository<CategoryGroup> {
  private static toDomain(r: Selectable<GroupTable>): CategoryGroup {
    return CategoryGroup.restore({
      id: r.id,
      workspaceId: r.workspace_id,
      kind: r.kind,
      name: r.name,
      sortOrder: r.sort_order,
      archivedAt: iso(r.archived_at),
      version: r.version,
    });
  }

  async findById(workspaceId: string, id: string): Promise<CategoryGroup | null> {
    const r = await db()
      .selectFrom('classification.category_group')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? PgCategoryGroupRepository.toDomain(r) : null;
  }

  async listAll(workspaceId: string): Promise<CategoryGroup[]> {
    const rows = await db()
      .selectFrom('classification.category_group')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    return rows.map((r) => PgCategoryGroupRepository.toDomain(r));
  }

  async insert(g: CategoryGroup): Promise<void> {
    await translateUnique(() =>
      db()
        .insertInto('classification.category_group')
        .values({
          id: g.id,
          workspace_id: g.workspaceId,
          kind: g.kind,
          name: g.name,
          normalized_name: g.normalizedName,
          sort_order: g.sortOrder,
          archived_at: ts(g.archivedAt),
          version: g.version,
        })
        .execute(),
    );
  }

  async update(g: CategoryGroup, expectedVersion: number): Promise<boolean> {
    const res = await translateUnique(() =>
      db()
        .updateTable('classification.category_group')
        .set({
          name: g.name,
          normalized_name: g.normalizedName,
          sort_order: g.sortOrder,
          archived_at: ts(g.archivedAt),
          version: g.version,
          updated_at: now,
        })
        .where('workspace_id', '=', g.workspaceId)
        .where('id', '=', g.id)
        .where('version', '=', expectedVersion)
        .executeTakeFirst(),
    );
    return Number(res.numUpdatedRows) === 1;
  }
}

export class PgCategoryRepository implements Repository<Category> {
  private static toDomain(r: Selectable<CategoryTable>): Category {
    return Category.restore({
      id: r.id,
      workspaceId: r.workspace_id,
      groupId: r.group_id,
      parentId: r.parent_id,
      kind: r.kind,
      name: r.name,
      systemCode: r.system_code,
      icon: r.icon,
      color: r.color,
      sortOrder: r.sort_order,
      archivedAt: iso(r.archived_at),
      version: r.version,
    });
  }

  async findById(workspaceId: string, id: string): Promise<Category | null> {
    const r = await db()
      .selectFrom('classification.category')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? PgCategoryRepository.toDomain(r) : null;
  }

  async listAll(workspaceId: string): Promise<Category[]> {
    const rows = await db()
      .selectFrom('classification.category')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    return rows.map((r) => PgCategoryRepository.toDomain(r));
  }

  async insert(c: Category): Promise<void> {
    await translateUnique(() =>
      db()
        .insertInto('classification.category')
        .values({
          id: c.id,
          workspace_id: c.workspaceId,
          group_id: c.groupId,
          parent_id: c.parentId,
          kind: c.kind,
          name: c.name,
          normalized_name: c.normalizedName,
          system_code: c.systemCode,
          icon: c.icon,
          color: c.color,
          sort_order: c.sortOrder,
          archived_at: ts(c.archivedAt),
          version: c.version,
        })
        .execute(),
    );
  }

  async update(c: Category, expectedVersion: number): Promise<boolean> {
    const res = await translateUnique(() =>
      db()
        .updateTable('classification.category')
        .set({
          group_id: c.groupId,
          parent_id: c.parentId,
          name: c.name,
          normalized_name: c.normalizedName,
          icon: c.icon,
          color: c.color,
          sort_order: c.sortOrder,
          archived_at: ts(c.archivedAt),
          version: c.version,
          updated_at: now,
        })
        .where('workspace_id', '=', c.workspaceId)
        .where('id', '=', c.id)
        .where('version', '=', expectedVersion)
        .executeTakeFirst(),
    );
    return Number(res.numUpdatedRows) === 1;
  }
}

export class PgTagRepository implements Repository<Tag> {
  private static toDomain(r: Selectable<TagTable>): Tag {
    return Tag.restore({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      color: r.color,
      archivedAt: iso(r.archived_at),
      version: r.version,
    });
  }

  async findById(workspaceId: string, id: string): Promise<Tag | null> {
    const r = await db()
      .selectFrom('classification.tag')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? PgTagRepository.toDomain(r) : null;
  }

  async listAll(workspaceId: string): Promise<Tag[]> {
    const rows = await db()
      .selectFrom('classification.tag')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    return rows.map((r) => PgTagRepository.toDomain(r));
  }

  async insert(t: Tag): Promise<void> {
    await translateUnique(() =>
      db()
        .insertInto('classification.tag')
        .values({
          id: t.id,
          workspace_id: t.workspaceId,
          name: t.name,
          normalized_name: t.normalizedName,
          color: t.color,
          archived_at: ts(t.archivedAt),
          version: t.version,
        })
        .execute(),
    );
  }

  async update(t: Tag, expectedVersion: number): Promise<boolean> {
    const res = await translateUnique(() =>
      db()
        .updateTable('classification.tag')
        .set({
          name: t.name,
          normalized_name: t.normalizedName,
          color: t.color,
          archived_at: ts(t.archivedAt),
          version: t.version,
          updated_at: now,
        })
        .where('workspace_id', '=', t.workspaceId)
        .where('id', '=', t.id)
        .where('version', '=', expectedVersion)
        .executeTakeFirst(),
    );
    return Number(res.numUpdatedRows) === 1;
  }
}

export class PgCounterpartyRepository implements Repository<Counterparty> {
  private async load(rows: Selectable<CounterpartyTable>[], workspaceId: string): Promise<Counterparty[]> {
    if (rows.length === 0) return [];
    const aliases = await db()
      .selectFrom('classification.counterparty_alias')
      .select(['counterparty_id', 'alias'])
      .where('workspace_id', '=', workspaceId)
      .where(
        'counterparty_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('alias')
      .execute();
    return rows.map((r) =>
      Counterparty.restore({
        id: r.id,
        workspaceId: r.workspace_id,
        name: r.name,
        kind: r.kind,
        icon: r.icon,
        defaultCategoryId: r.default_category_id,
        aliases: aliases.filter((a) => a.counterparty_id === r.id).map((a) => a.alias),
        notes: r.notes,
        website: r.website,
        archivedAt: iso(r.archived_at),
        version: r.version,
      }),
    );
  }

  async findById(workspaceId: string, id: string): Promise<Counterparty | null> {
    const rows = await db()
      .selectFrom('classification.counterparty')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .execute();
    return (await this.load(rows, workspaceId))[0] ?? null;
  }

  async listAll(workspaceId: string): Promise<Counterparty[]> {
    const rows = await db()
      .selectFrom('classification.counterparty')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .execute();
    return this.load(rows, workspaceId);
  }

  private async writeAliases(c: Counterparty): Promise<void> {
    await db()
      .deleteFrom('classification.counterparty_alias')
      .where('workspace_id', '=', c.workspaceId)
      .where('counterparty_id', '=', c.id)
      .execute();
    if (c.aliases.length === 0) return;
    await translateUnique(() =>
      db()
        .insertInto('classification.counterparty_alias')
        .values(
          c.aliases.map((a) => ({
            workspace_id: c.workspaceId,
            counterparty_id: c.id,
            alias: a,
            alias_normalized: Alias.of(a).normalized,
            active: !c.isArchived,
          })),
        )
        .execute(),
    );
  }

  async insert(c: Counterparty): Promise<void> {
    await translateUnique(() =>
      db()
        .insertInto('classification.counterparty')
        .values({
          id: c.id,
          workspace_id: c.workspaceId,
          name: c.name,
          normalized_name: c.normalizedName,
          kind: c.kind,
          icon: c.icon,
          default_category_id: c.defaultCategoryId,
          notes: c.notes,
          website: c.website,
          archived_at: ts(c.archivedAt),
          version: c.version,
        })
        .execute(),
    );
    await this.writeAliases(c);
  }

  async update(c: Counterparty, expectedVersion: number): Promise<boolean> {
    const res = await translateUnique(() =>
      db()
        .updateTable('classification.counterparty')
        .set({
          name: c.name,
          normalized_name: c.normalizedName,
          kind: c.kind,
          icon: c.icon,
          default_category_id: c.defaultCategoryId,
          notes: c.notes,
          website: c.website,
          archived_at: ts(c.archivedAt),
          version: c.version,
          updated_at: now,
        })
        .where('workspace_id', '=', c.workspaceId)
        .where('id', '=', c.id)
        .where('version', '=', expectedVersion)
        .executeTakeFirst(),
    );
    if (Number(res.numUpdatedRows) !== 1) return false;
    await this.writeAliases(c);
    return true;
  }
}

/** Catálogos iniciales versionados (archivos de datos, design §7). */
export const defaultCatalogs: DefaultCatalogSource = {
  get(version: string): DefaultCatalog | null {
    const catalogs = [esBoV1 as unknown as DefaultCatalog];
    return catalogs.find((c) => c.version === version) ?? null;
  },
};

/**
 * `LastCategoryUsedQueryPort` sin historial: stub hasta `add-transaction-recording` (tarea 5.3). Cuando exista
 * Transactions, el composition root lo sustituye por el adapter sobre `@pf/transactions/contracts`.
 */
export const noTransactionsYet: LastCategoryUsedQueryPort = {
  lastCategoryUsed: async () => null,
};

/** UUIDv7 (RFC 9562): 48 bits de milisegundos + aleatorio. */
export const uuidV7: IdGenerator = {
  next(): string {
    const hex = Date.now().toString(16).padStart(12, '0');
    const rnd = randomUUID().replace(/-/g, '');
    const variant = ((parseInt(rnd.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rnd.slice(13, 16)}-${variant}${rnd.slice(17, 20)}-${rnd.slice(20, 32)}`;
  },
};

export function pgClassificationDeps(input: {
  readonly pool: Pool;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly clock: Clock;
  readonly lastCategoryUsed?: LastCategoryUsedQueryPort;
  readonly ids?: IdGenerator;
}): ClassificationDeps {
  return {
    uow: new PgUnitOfWork(input.pool),
    groups: new PgCategoryGroupRepository(),
    categories: new PgCategoryRepository(),
    tags: new PgTagRepository(),
    counterparties: new PgCounterpartyRepository(),
    outbox: input.outbox,
    audit: input.audit,
    lifecycle: input.lifecycle,
    lifecycleQuery: input.lifecycleQuery,
    lastCategoryUsed: input.lastCategoryUsed ?? noTransactionsYet,
    catalogs: defaultCatalogs,
    ids: input.ids ?? uuidV7,
    clock: input.clock,
  };
}
