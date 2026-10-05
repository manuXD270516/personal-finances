import type {
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { Category, CategoryGroup, type CategoryPatch } from '../domain/category.js';
import {
  CATEGORY_LIFECYCLE,
  COUNTERPARTY_LIFECYCLE,
  type ClassificationLifecycleMachine,
  type ClassificationTransitionRecord,
} from '../domain/classification-lifecycle.js';
import {
  Counterparty,
  aliasList,
  type CounterpartyKind,
  type CounterpartyPatch,
} from '../domain/counterparty.js';
import { NameTakenError, notFound, referenceNotFound, validation } from '../domain/errors.js';
import { normalizeText } from '../domain/normalized-text.js';
import { SYSTEM_CATEGORY_CATALOG, type CategoryKind } from '../domain/system-categories.js';
import { Tag } from '../domain/tag.js';
import type { ClassificationDeps } from './ports/index.js';

export const DEFAULT_CATALOG_VERSION = 'es-BO.v1';

export interface CreateCategoryCommand {
  readonly id?: string;
  readonly groupId: string;
  readonly parentId?: string | null;
  readonly name: string;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly sortOrder?: number;
}

export interface UpdateCategoryCommand extends CategoryPatch {
  readonly groupId?: string;
  readonly parentId?: string | null;
}

export interface CreateCounterpartyCommand {
  readonly id?: string;
  readonly name: string;
  readonly kind?: CounterpartyKind;
  readonly icon?: string | null;
  readonly defaultCategoryId?: string | null;
  readonly aliases?: readonly string[];
  readonly notes?: string | null;
  readonly website?: string | null;
}

export interface CatalogResult {
  readonly catalogVersion: string;
  readonly createdGroups: number;
  readonly createdCategories: number;
  readonly skipped: number;
}

/** 412 con la versión vigente (`currentVersion`, docs/10 §6) cuando se conoce. */
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });
/** El UPDATE condicional perdió una carrera: relee la fila para publicar la versión ganadora. */
const lostRace = async (current: Promise<{ readonly version: number } | null>) =>
  preconditionFailed((await current)?.version);

type Snap = Readonly<Record<string, unknown>>;

/** Diff campo a campo entre dos snapshots (la allow-list de AUDIT filtra lo no permitido). */
function diff(before: Snap | null, after: Snap, fields: readonly string[]): AuditChangeInput[] {
  return fields
    .filter((f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after[f] ?? null))
    .map((f) => ({ field: f, before: before?.[f] ?? null, after: after[f] ?? null }));
}

const status = (archivedAt: string | null) => (archivedAt === null ? 'ACTIVE' : 'ARCHIVED');
const groupView = (g: CategoryGroup): Snap => ({ ...g.snapshot(), status: status(g.archivedAt) });
const categoryView = (c: Category): Snap => ({ ...c.snapshot(), status: status(c.archivedAt) });
const tagView = (t: Tag): Snap => ({ ...t.snapshot(), status: status(t.archivedAt) });
/** Los alias se auditan como texto (AUDIT solo admite valores escalares o dinero). */
const counterpartyView = (c: Counterparty): Snap => ({
  ...c.snapshot(),
  aliases: c.aliases.join(', '),
  status: status(c.archivedAt),
});

const GROUP_FIELDS = ['name', 'kind', 'sortOrder', 'status'] as const;
const CATEGORY_FIELDS = [
  'name',
  'groupId',
  'parentId',
  'kind',
  'systemCode',
  'icon',
  'color',
  'sortOrder',
  'status',
] as const;
const TAG_FIELDS = ['name', 'color', 'status'] as const;
const COUNTERPARTY_FIELDS = [
  'name',
  'kind',
  'icon',
  'defaultCategoryId',
  'aliases',
  'notes',
  'website',
  'status',
] as const;

/**
 * Casos de uso (comandos) de CLASSIFICATION (design §1). TypeScript plano: todo efecto pasa por puertos dentro de la
 * `UnitOfWork` con contexto RLS; cada mutación se audita (`AuditPort`) en la misma transacción y los archivados de
 * categorías emiten `classification.CategoryArchived.v1` por el outbox. La autorización por rol la aplica el guard
 * de la API (`x-required-role`); no hay operación de eliminación (INV-019).
 */
export class ClassificationService {
  constructor(private readonly deps: ClassificationDeps) {}

  private now(): string {
    return this.deps.clock.now().toString();
  }

  private run<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.uow.run({ userId, workspaceId }, fn);
  }

  private async audit(
    userId: string,
    entry: Omit<AuditEntry, 'actor'> & { readonly changes: readonly AuditChangeInput[] },
  ): Promise<void> {
    await this.deps.audit.append({ ...entry, actor: { type: 'USER', userId } });
  }

  // ------------------------------------------------------------------ grupos

  async createCategoryGroup(
    userId: string,
    workspaceId: string,
    cmd: { id?: string; name: string; kind: CategoryKind; sortOrder?: number },
  ): Promise<CategoryGroup> {
    return this.run(userId, workspaceId, async () => {
      const group = CategoryGroup.create({
        id: cmd.id ?? this.deps.ids.next(),
        workspaceId,
        kind: cmd.kind,
        name: cmd.name,
        ...(cmd.sortOrder === undefined ? {} : { sortOrder: cmd.sortOrder }),
      });
      await this.assertGroupNameFree(group);
      await this.deps.groups.insert(group);
      await this.audit(userId, {
        workspaceId,
        action: 'classification.category_group.created',
        aggregateType: 'CategoryGroup',
        aggregateId: group.id,
        aggregateVersion: group.version,
        changes: diff(null, groupView(group), GROUP_FIELDS),
      });
      return group;
    });
  }

  async updateCategoryGroup(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: { name?: string; sortOrder?: number },
  ): Promise<CategoryGroup> {
    return this.run(userId, workspaceId, async () => {
      const group = await this.loadGroup(workspaceId, id, expectedVersion);
      const before = groupView(group);
      if (!group.update(patch)) return group;
      if (!group.isArchived) await this.assertGroupNameFree(group);
      await this.saveGroup(group, expectedVersion);
      await this.audit(userId, {
        workspaceId,
        action: 'classification.category_group.updated',
        aggregateType: 'CategoryGroup',
        aggregateId: group.id,
        aggregateVersion: group.version,
        changes: diff(before, groupView(group), GROUP_FIELDS),
      });
      return group;
    });
  }

  async archiveCategoryGroup(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<CategoryGroup> {
    return this.run(userId, workspaceId, async () => {
      const group = await this.loadGroup(workspaceId, id, expectedVersion);
      const active = (await this.deps.categories.listAll(workspaceId)).filter(
        (c) => c.groupId === id && !c.isArchived,
      );
      const before = groupView(group);
      group.archive(this.now(), active.length);
      await this.saveGroup(group, expectedVersion);
      await this.audit(userId, {
        workspaceId,
        action: 'classification.category_group.archived',
        aggregateType: 'CategoryGroup',
        aggregateId: group.id,
        aggregateVersion: group.version,
        changes: diff(before, groupView(group), GROUP_FIELDS),
      });
      return group;
    });
  }

  async unarchiveCategoryGroup(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<CategoryGroup> {
    return this.run(userId, workspaceId, async () => {
      const group = await this.loadGroup(workspaceId, id, expectedVersion);
      const before = groupView(group);
      group.unarchive();
      await this.assertGroupNameFree(group);
      await this.saveGroup(group, expectedVersion);
      await this.audit(userId, {
        workspaceId,
        action: 'classification.category_group.unarchived',
        aggregateType: 'CategoryGroup',
        aggregateId: group.id,
        aggregateVersion: group.version,
        changes: diff(before, groupView(group), GROUP_FIELDS),
      });
      return group;
    });
  }

  // ------------------------------------------------------------------ categorías

  async createCategory(userId: string, workspaceId: string, cmd: CreateCategoryCommand): Promise<Category> {
    return this.run(userId, workspaceId, async () => {
      const group = await this.deps.groups.findById(workspaceId, cmd.groupId);
      if (!group) throw referenceNotFound('category group', '/groupId');
      const parent = cmd.parentId ? await this.deps.categories.findById(workspaceId, cmd.parentId) : null;
      if (cmd.parentId && !parent) throw referenceNotFound('parent category', '/parentId');
      const category = Category.create({
        id: cmd.id ?? this.deps.ids.next(),
        group,
        parent,
        name: cmd.name,
        icon: cmd.icon ?? null,
        color: cmd.color ?? null,
        ...(cmd.sortOrder === undefined ? {} : { sortOrder: cmd.sortOrder }),
      });
      await this.assertCategoryNameFree(category);
      await this.deps.categories.insert(category);
      await this.auditCategory(userId, 'created', null, category);
      return category;
    });
  }

  async updateCategory(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
    cmd: UpdateCategoryCommand,
  ): Promise<Category> {
    return this.run(userId, workspaceId, async () => {
      const category = await this.loadCategory(workspaceId, id, expectedVersion);
      const before = categoryView(category);
      const all = await this.deps.categories.listAll(workspaceId);
      const children = all.filter((c) => c.parentId === id);
      let moved = false;
      if (cmd.groupId !== undefined || cmd.parentId !== undefined) {
        let parent: Category | null = null;
        const parentId = cmd.parentId === undefined ? category.parentId : cmd.parentId;
        if (parentId !== null) {
          parent = all.find((c) => c.id === parentId) ?? null;
          if (!parent) throw referenceNotFound('parent category', '/parentId');
        }
        const groupId = cmd.groupId ?? (cmd.parentId ? parent?.groupId : undefined) ?? category.groupId;
        const group = await this.deps.groups.findById(workspaceId, groupId);
        if (!group) throw referenceNotFound('category group', '/groupId');
        moved = category.moveTo(group, parent, children.length > 0);
      }
      const updated = category.update({
        ...(cmd.name === undefined ? {} : { name: cmd.name }),
        ...(cmd.icon === undefined ? {} : { icon: cmd.icon }),
        ...(cmd.color === undefined ? {} : { color: cmd.color }),
        ...(cmd.sortOrder === undefined ? {} : { sortOrder: cmd.sortOrder }),
      });
      if (!moved && !updated) return category;
      if (!category.isArchived) await this.assertCategoryNameFree(category);
      await this.saveCategory(category, expectedVersion);
      await this.auditCategory(userId, 'updated', before, category);
      if (moved) {
        for (const child of children) {
          const childBefore = categoryView(child);
          const v = child.version;
          if (child.followParentGroup(category.groupId)) {
            await this.saveCategory(child, v);
            await this.auditCategory(userId, 'updated', childBefore, child);
          }
        }
      }
      return category;
    });
  }

  /** Archiva la categoría y, en cascada, sus subcategorías activas; un evento por categoría archivada (design §4). */
  async archiveCategory(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Category> {
    return this.run(userId, workspaceId, async () => {
      const category = await this.loadCategory(workspaceId, id, expectedVersion);
      const at = this.now();
      const before = categoryView(category);
      category.archive(at);
      await this.saveCategory(category, expectedVersion);
      const event = await this.emitArchived(userId, category, null);
      await this.auditCategory(userId, 'archived', before, category, [event]);
      const children = (await this.deps.categories.listAll(workspaceId)).filter(
        (c) => c.parentId === id && !c.isArchived,
      );
      for (const child of children) {
        const childBefore = categoryView(child);
        const v = child.version;
        child.archive(at);
        await this.saveCategory(child, v);
        const childEvent = await this.emitArchived(userId, child, category.id);
        await this.auditCategory(userId, 'archived', childBefore, child, [childEvent]);
      }
      return category;
    });
  }

  async unarchiveCategory(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Category> {
    return this.run(userId, workspaceId, async () => {
      const category = await this.loadCategory(workspaceId, id, expectedVersion);
      const group = await this.deps.groups.findById(workspaceId, category.groupId);
      if (!group) throw notFound('category group');
      const parent = category.parentId
        ? await this.deps.categories.findById(workspaceId, category.parentId)
        : null;
      const before = categoryView(category);
      category.unarchive(group, parent);
      await this.assertCategoryNameFree(category);
      await this.saveCategory(category, expectedVersion);
      await this.auditCategory(userId, 'unarchived', before, category);
      return category;
    });
  }

  /** Orden persistente de hermanas activas: `orderedIds` debe ser exactamente ese conjunto (design §Contratos 5). */
  async reorderCategories(
    userId: string,
    workspaceId: string,
    cmd: { groupId: string; parentId: string | null; orderedIds: readonly string[] },
  ): Promise<Category[]> {
    return this.run(userId, workspaceId, async () => {
      const group = await this.deps.groups.findById(workspaceId, cmd.groupId);
      if (!group) throw referenceNotFound('category group', '/groupId');
      const siblings = (await this.deps.categories.listAll(workspaceId)).filter(
        (c) => c.groupId === cmd.groupId && c.parentId === cmd.parentId && !c.isArchived,
      );
      const ids = new Set(siblings.map((s) => s.id));
      const exact =
        cmd.orderedIds.length === ids.size &&
        new Set(cmd.orderedIds).size === ids.size &&
        cmd.orderedIds.every((i) => ids.has(i));
      if (!exact) throw validation('orderedIds must be exactly the set of active siblings', '/orderedIds');
      const result: Category[] = [];
      for (const [index, id] of cmd.orderedIds.entries()) {
        const cat = siblings.find((s) => s.id === id) as Category;
        const before = categoryView(cat);
        const v = cat.version;
        if (cat.update({ sortOrder: index })) {
          await this.saveCategory(cat, v);
          await this.auditCategory(userId, 'reordered', before, cat);
        }
        result.push(cat);
      }
      return result;
    });
  }

  // ------------------------------------------------------------------ provisión y catálogo inicial

  /**
   * `ProvisionSystemCategories` (design §6): idempotente por `(workspace, systemCode)`; crea (o reutiliza por nombre
   * normalizado) los grupos "Finanzas", "Otros gastos" y "Otros ingresos".
   */
  async provisionSystemCategories(userId: string, workspaceId: string): Promise<CatalogResult> {
    return this.run(userId, workspaceId, async () => {
      const created: Category[] = [];
      const result = await this.provisionInTx(workspaceId, created);
      if (created.length > 0) await this.recordCatalog(userId, workspaceId, result, created, 'system');
      return result;
    });
  }

  /** `ApplyDefaultCategoryCatalog` a demanda (POST …/apply-default-catalog): idempotente y auditado. */
  async applyDefaultCatalog(
    userId: string,
    workspaceId: string,
    version: string = DEFAULT_CATALOG_VERSION,
  ): Promise<CatalogResult> {
    return this.run(userId, workspaceId, async () => {
      const created: Category[] = [];
      const result = await this.applyCatalogInTx(workspaceId, version, created);
      await this.recordCatalog(userId, workspaceId, result, created);
      return result;
    });
  }

  /**
   * Registro `classification.catalog.applied` + `CREATE` de cada categoría creada por el catálogo (docs/31 D52): un
   * paso del recorrido puede apuntar a otro agregado (cada categoría), respaldado por este único registro.
   */
  private recordCatalog(
    userId: string,
    workspaceId: string,
    result: CatalogResult,
    created: readonly Category[],
    origin?: 'system',
  ): Promise<void> {
    const steps: LifecycleStepInput[] = created.map((c) => ({
      ...transitionStep(c.lastTransition, CATEGORY_LIFECYCLE),
      aggregateType: 'Category',
      aggregateId: c.id,
      aggregateVersion: c.version,
    }));
    return this.deps.lifecycle.record(
      {
        workspaceId,
        action: 'classification.catalog.applied',
        aggregateType: 'CategoryCatalog',
        aggregateId: workspaceId,
        actor: { type: 'USER', userId },
        ...(origin ? { origin } : {}),
        changes: [
          { field: 'catalogVersion', before: null, after: result.catalogVersion },
          { field: 'createdGroups', before: null, after: result.createdGroups },
          { field: 'createdCategories', before: null, after: result.createdCategories },
          { field: 'skipped', before: null, after: result.skipped },
        ],
      },
      steps,
    );
  }

  /**
   * Gancho síncrono de `CreateWorkspace` (design §6-§7; docs/31 D54): dentro de la MISMA unidad de trabajo que crea el
   * workspace provisiona las 11 categorías de sistema y, si `seedDefaultCategories`, el catálogo inicial. Recorrido
   * (docs/31 D52): cada categoría creada registra `CREATE` con `origin = system`, respaldado por UN registro
   * `classification.catalog.applied` (agregado `CategoryCatalog`, id = workspace; mismo formato que
   * `POST …/apply-default-catalog`). Si no se creó nada (provisión repetida), no se escribe nada.
   */
  async onWorkspaceCreated(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly seedDefaultCategories: boolean;
  }): Promise<void> {
    await this.run(input.userId, input.workspaceId, async () => {
      const created: Category[] = [];
      const system = await this.provisionInTx(input.workspaceId, created);
      const catalog = input.seedDefaultCategories
        ? await this.applyCatalogInTx(input.workspaceId, DEFAULT_CATALOG_VERSION, created)
        : null;
      if (created.length === 0) return;
      await this.recordCatalog(
        input.userId,
        input.workspaceId,
        {
          catalogVersion: catalog?.catalogVersion ?? system.catalogVersion,
          createdGroups: system.createdGroups + (catalog?.createdGroups ?? 0),
          createdCategories: system.createdCategories + (catalog?.createdCategories ?? 0),
          skipped: system.skipped + (catalog?.skipped ?? 0),
        },
        created,
        'system',
      );
    });
  }

  private async provisionInTx(workspaceId: string, created: Category[] = []): Promise<CatalogResult> {
    const groups = await this.deps.groups.listAll(workspaceId);
    const categories = await this.deps.categories.listAll(workspaceId);
    let createdGroups = 0;
    let createdCategories = 0;
    let skipped = 0;
    for (const def of SYSTEM_CATEGORY_CATALOG) {
      if (categories.some((c) => c.systemCode === def.code)) {
        skipped += 1;
        continue;
      }
      let group = groups.find(
        (g) => !g.isArchived && g.kind === def.kind && g.normalizedName === normalizeText(def.group),
      );
      if (!group) {
        group = CategoryGroup.create({
          id: this.deps.ids.next(),
          workspaceId,
          kind: def.kind,
          name: def.group,
          sortOrder: groups.filter((g) => g.kind === def.kind).length,
        });
        await this.deps.groups.insert(group);
        groups.push(group);
        createdGroups += 1;
      }
      const category = Category.create({
        id: this.deps.ids.next(),
        group,
        name: def.names.es,
        systemCode: def.code,
        sortOrder: categories.filter((c) => c.groupId === group.id).length,
      });
      await this.deps.categories.insert(category);
      categories.push(category);
      created.push(category);
      createdCategories += 1;
    }
    return { catalogVersion: 'system', createdGroups, createdCategories, skipped };
  }

  private async applyCatalogInTx(
    workspaceId: string,
    version: string,
    created: Category[] = [],
  ): Promise<CatalogResult> {
    const catalog = this.deps.catalogs.get(version);
    if (!catalog) throw validation(`unknown catalog version '${version}'`, '/catalogVersion');
    const groups = await this.deps.groups.listAll(workspaceId);
    const categories = await this.deps.categories.listAll(workspaceId);
    let createdGroups = 0;
    let createdCategories = 0;
    let skipped = 0;
    const ensureCategory = async (
      group: CategoryGroup,
      parent: Category | null,
      entry: { name: string; icon?: string; color?: string },
    ): Promise<Category | null> => {
      const siblings = categories.filter(
        (c) => !c.isArchived && c.groupId === group.id && c.parentId === (parent?.id ?? null),
      );
      const existing = siblings.find((c) => c.normalizedName === normalizeText(entry.name));
      if (existing) {
        skipped += 1;
        return existing;
      }
      if (parent?.isSystem) return null;
      const category = Category.create({
        id: this.deps.ids.next(),
        group,
        parent,
        name: entry.name,
        icon: entry.icon ?? null,
        color: entry.color ?? null,
        sortOrder: siblings.length,
      });
      await this.deps.categories.insert(category);
      categories.push(category);
      created.push(category);
      createdCategories += 1;
      return category;
    };
    for (const g of catalog.groups) {
      let group = groups.find(
        (x) => !x.isArchived && x.kind === g.kind && x.normalizedName === normalizeText(g.name),
      );
      if (group) {
        skipped += 1;
      } else {
        group = CategoryGroup.create({
          id: this.deps.ids.next(),
          workspaceId,
          kind: g.kind,
          name: g.name,
          sortOrder: groups.filter((x) => x.kind === g.kind).length,
        });
        await this.deps.groups.insert(group);
        groups.push(group);
        createdGroups += 1;
      }
      for (const entry of g.categories) {
        const parent = await ensureCategory(group, null, entry);
        if (!parent) continue;
        for (const child of entry.children ?? []) {
          await ensureCategory(group, parent, {
            name: child,
            ...(entry.icon === undefined ? {} : { icon: entry.icon }),
            ...(entry.color === undefined ? {} : { color: entry.color }),
          });
        }
      }
    }
    return { catalogVersion: catalog.version, createdGroups, createdCategories, skipped };
  }

  // ------------------------------------------------------------------ tags

  async createTag(
    userId: string,
    workspaceId: string,
    cmd: { id?: string; name: string; color?: string | null },
  ): Promise<Tag> {
    return this.run(userId, workspaceId, async () => {
      const tag = Tag.create({
        id: cmd.id ?? this.deps.ids.next(),
        workspaceId,
        name: cmd.name,
        color: cmd.color ?? null,
      });
      await this.assertTagNameFree(tag);
      await this.deps.tags.insert(tag);
      await this.auditTag(userId, 'created', null, tag);
      return tag;
    });
  }

  async updateTag(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: { name?: string; color?: string | null },
  ): Promise<Tag> {
    return this.run(userId, workspaceId, async () => {
      const tag = await this.loadTag(workspaceId, id, expectedVersion);
      const before = tagView(tag);
      if (!tag.update(patch)) return tag;
      if (!tag.isArchived) await this.assertTagNameFree(tag);
      await this.saveTag(tag, expectedVersion);
      await this.auditTag(userId, 'updated', before, tag);
      return tag;
    });
  }

  async archiveTag(userId: string, workspaceId: string, id: string, expectedVersion: number): Promise<Tag> {
    return this.run(userId, workspaceId, async () => {
      const tag = await this.loadTag(workspaceId, id, expectedVersion);
      const before = tagView(tag);
      tag.archive(this.now());
      await this.saveTag(tag, expectedVersion);
      await this.auditTag(userId, 'archived', before, tag);
      return tag;
    });
  }

  async unarchiveTag(userId: string, workspaceId: string, id: string, expectedVersion: number): Promise<Tag> {
    return this.run(userId, workspaceId, async () => {
      const tag = await this.loadTag(workspaceId, id, expectedVersion);
      const before = tagView(tag);
      tag.unarchive();
      await this.assertTagNameFree(tag);
      await this.saveTag(tag, expectedVersion);
      await this.auditTag(userId, 'unarchived', before, tag);
      return tag;
    });
  }

  // ------------------------------------------------------------------ counterparties

  async createCounterparty(
    userId: string,
    workspaceId: string,
    cmd: CreateCounterpartyCommand,
  ): Promise<Counterparty> {
    return this.run(userId, workspaceId, async () => {
      const cp = Counterparty.create({
        id: cmd.id ?? this.deps.ids.next(),
        workspaceId,
        name: cmd.name,
        ...(cmd.kind === undefined ? {} : { kind: cmd.kind }),
        icon: cmd.icon ?? null,
        defaultCategoryId: cmd.defaultCategoryId ?? null,
        aliases: cmd.aliases ?? [],
        notes: cmd.notes ?? null,
        website: cmd.website ?? null,
      });
      await this.assertCounterpartyFree(cp);
      await this.assertDefaultCategory(workspaceId, cp.defaultCategoryId);
      await this.deps.counterparties.insert(cp);
      await this.auditCounterparty(userId, 'created', null, cp);
      return cp;
    });
  }

  async updateCounterparty(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
    patch: CounterpartyPatch,
  ): Promise<Counterparty> {
    return this.run(userId, workspaceId, async () => {
      const cp = await this.loadCounterparty(workspaceId, id, expectedVersion);
      const before = counterpartyView(cp);
      if (!cp.update(patch)) return cp;
      if (!cp.isArchived) await this.assertCounterpartyFree(cp);
      if (patch.defaultCategoryId !== undefined && patch.defaultCategoryId !== before['defaultCategoryId']) {
        await this.assertDefaultCategory(workspaceId, cp.defaultCategoryId);
      }
      await this.saveCounterparty(cp, expectedVersion);
      await this.auditCounterparty(userId, 'updated', before, cp);
      return cp;
    });
  }

  async archiveCounterparty(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Counterparty> {
    return this.run(userId, workspaceId, async () => {
      const cp = await this.loadCounterparty(workspaceId, id, expectedVersion);
      const before = counterpartyView(cp);
      cp.archive(this.now());
      await this.saveCounterparty(cp, expectedVersion);
      await this.auditCounterparty(userId, 'archived', before, cp);
      return cp;
    });
  }

  async unarchiveCounterparty(
    userId: string,
    workspaceId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Counterparty> {
    return this.run(userId, workspaceId, async () => {
      const cp = await this.loadCounterparty(workspaceId, id, expectedVersion);
      const before = counterpartyView(cp);
      cp.unarchive();
      await this.assertCounterpartyFree(cp);
      await this.saveCounterparty(cp, expectedVersion);
      await this.auditCounterparty(userId, 'unarchived', before, cp);
      return cp;
    });
  }

  // ------------------------------------------------------------------ helpers

  private async loadGroup(workspaceId: string, id: string, expected: number): Promise<CategoryGroup> {
    const g = await this.deps.groups.findById(workspaceId, id);
    if (!g) throw notFound('category group');
    if (g.version !== expected) throw preconditionFailed(g.version);
    return g;
  }

  private async loadCategory(workspaceId: string, id: string, expected: number): Promise<Category> {
    const c = await this.deps.categories.findById(workspaceId, id);
    if (!c) throw notFound('category');
    if (c.version !== expected) throw preconditionFailed(c.version);
    return c;
  }

  private async loadTag(workspaceId: string, id: string, expected: number): Promise<Tag> {
    const t = await this.deps.tags.findById(workspaceId, id);
    if (!t) throw notFound('tag');
    if (t.version !== expected) throw preconditionFailed(t.version);
    return t;
  }

  private async loadCounterparty(workspaceId: string, id: string, expected: number): Promise<Counterparty> {
    const c = await this.deps.counterparties.findById(workspaceId, id);
    if (!c) throw notFound('counterparty');
    if (c.version !== expected) throw preconditionFailed(c.version);
    return c;
  }

  private async saveGroup(group: CategoryGroup, expected: number): Promise<void> {
    if (!(await this.deps.groups.update(group, expected))) {
      throw await lostRace(this.deps.groups.findById(group.workspaceId, group.id));
    }
  }

  private async saveCategory(category: Category, expected: number): Promise<void> {
    if (!(await this.deps.categories.update(category, expected))) {
      throw await lostRace(this.deps.categories.findById(category.workspaceId, category.id));
    }
  }

  private async saveTag(tag: Tag, expected: number): Promise<void> {
    if (!(await this.deps.tags.update(tag, expected))) {
      throw await lostRace(this.deps.tags.findById(tag.workspaceId, tag.id));
    }
  }

  private async saveCounterparty(cp: Counterparty, expected: number): Promise<void> {
    if (!(await this.deps.counterparties.update(cp, expected))) {
      throw await lostRace(this.deps.counterparties.findById(cp.workspaceId, cp.id));
    }
  }

  private async assertGroupNameFree(group: CategoryGroup): Promise<void> {
    const clash = (await this.deps.groups.listAll(group.workspaceId)).find(
      (g) =>
        g.id !== group.id &&
        !g.isArchived &&
        g.kind === group.kind &&
        g.normalizedName === group.normalizedName,
    );
    if (clash) throw new NameTakenError(clash.id, 'category group');
  }

  private async assertCategoryNameFree(category: Category): Promise<void> {
    const clash = (await this.deps.categories.listAll(category.workspaceId)).find(
      (c) =>
        c.id !== category.id &&
        !c.isArchived &&
        c.groupId === category.groupId &&
        c.parentId === category.parentId &&
        c.normalizedName === category.normalizedName,
    );
    if (clash) throw new NameTakenError(clash.id, 'category');
  }

  private async assertTagNameFree(tag: Tag): Promise<void> {
    const clash = (await this.deps.tags.listAll(tag.workspaceId)).find(
      (t) => t.id !== tag.id && !t.isArchived && t.normalizedName === tag.normalizedName,
    );
    if (clash) throw new NameTakenError(clash.id, 'tag');
  }

  private async assertCounterpartyFree(cp: Counterparty): Promise<void> {
    const others = (await this.deps.counterparties.listAll(cp.workspaceId)).filter(
      (c) => c.id !== cp.id && !c.isArchived,
    );
    const clash = others.find((c) => c.normalizedName === cp.normalizedName);
    if (clash) throw new NameTakenError(clash.id, 'counterparty');
    const mine = aliasList(cp.aliases).map((a) => a.normalized);
    const taken = others.find((o) => o.normalizedAliases.some((a) => mine.includes(a)));
    if (taken) {
      throw new DomainError(
        'COUNTERPARTY_ALIAS_TAKEN',
        'an alias already belongs to another counterparty',
      ).at('/aliases');
    }
  }

  private async assertDefaultCategory(workspaceId: string, id: string | null): Promise<void> {
    if (id === null) return;
    const cat = await this.deps.categories.findById(workspaceId, id);
    if (!cat) throw referenceNotFound('category', '/defaultCategoryId');
    if (cat.isArchived) {
      throw new DomainError('CATEGORY_ARCHIVED', 'the default category is archived').at('/defaultCategoryId');
    }
  }

  private async emitArchived(
    userId: string,
    c: Category,
    cascadedFrom: string | null,
  ): Promise<LifecycleEventRefDto> {
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
      eventType: 'classification.CategoryArchived',
      eventVersion: 1,
      aggregateType: 'Category',
      aggregateId: c.id,
      aggregateVersion: c.version,
      workspaceId: c.workspaceId,
      occurredAt: c.archivedAt ?? this.now(),
      actor: { type: 'USER', id: userId },
      payload: {
        categoryId: c.id,
        parentId: c.parentId,
        groupId: c.groupId,
        kind: c.kind,
        archivedAt: c.archivedAt ?? this.now(),
        cascadedFromCategoryId: cascadedFrom,
        transition: 'ARCHIVE',
      },
    });
    return { eventId, eventType: 'classification.CategoryArchived.v1' };
  }

  /**
   * Auditoría + paso del recorrido en la unidad de trabajo del comando (add-lifecycle-timeline decisión 5, docs/31
   * D52): la transición validada por la máquina del agregado o, si el comando no cambió el estado, una anotación con
   * los nombres de los campos cambiados (sin valores).
   */
  private record(
    userId: string,
    entry: Omit<AuditEntry, 'actor'> & { readonly changes: readonly AuditChangeInput[] },
    transition: ClassificationTransitionRecord | null,
    machine: ClassificationLifecycleMachine,
    events: readonly LifecycleEventRefDto[] = [],
  ): Promise<void> {
    const changedFields = entry.changes.map((c) => c.field).filter((f) => f !== 'status');
    const step: LifecycleStepInput | null = transition
      ? { ...transitionStep(transition, machine), events }
      : changedFields.length > 0
        ? { kind: 'ANNOTATION', changedFields, events }
        : null;
    return this.deps.lifecycle.record({ ...entry, actor: { type: 'USER', userId } }, step ? [step] : []);
  }

  private auditCategory(
    userId: string,
    verb: string,
    before: Snap | null,
    c: Category,
    events: readonly LifecycleEventRefDto[] = [],
  ): Promise<void> {
    return this.record(
      userId,
      {
        workspaceId: c.workspaceId,
        action: `classification.category.${verb}`,
        aggregateType: 'Category',
        aggregateId: c.id,
        aggregateVersion: c.version,
        changes: diff(before, categoryView(c), CATEGORY_FIELDS),
      },
      c.lastTransition,
      CATEGORY_LIFECYCLE,
      events,
    );
  }

  /** Los tags no tienen máquina de estados (docs/31 D52): solo auditoría. */
  private auditTag(userId: string, verb: string, before: Snap | null, t: Tag): Promise<void> {
    return this.audit(userId, {
      workspaceId: t.workspaceId,
      action: `classification.tag.${verb}`,
      aggregateType: 'Tag',
      aggregateId: t.id,
      aggregateVersion: t.version,
      changes: diff(before, tagView(t), TAG_FIELDS),
    });
  }

  private auditCounterparty(
    userId: string,
    verb: string,
    before: Snap | null,
    c: Counterparty,
  ): Promise<void> {
    return this.record(
      userId,
      {
        workspaceId: c.workspaceId,
        action: `classification.counterparty.${verb}`,
        aggregateType: 'Counterparty',
        aggregateId: c.id,
        aggregateVersion: c.version,
        changes: diff(before, counterpartyView(c), COUNTERPARTY_FIELDS),
      },
      c.lastTransition,
      COUNTERPARTY_LIFECYCLE,
    );
  }
}

/** Paso `TRANSITION` desde el registro validado por la máquina (sin registro ⇒ error de programación). */
function transitionStep(
  t: ClassificationTransitionRecord | null,
  machine: ClassificationLifecycleMachine,
): LifecycleStepInput & { readonly kind: 'TRANSITION' } {
  if (!t) throw new Error(`${machine.aggregateType}: missing lifecycle transition`);
  return {
    kind: 'TRANSITION',
    transition: t.transition,
    fromState: t.from,
    toState: t.to,
    machineVersion: machine.version,
  };
}
