import { DomainError } from '@pf/shared-kernel';
import {
  CATEGORY_LIFECYCLE,
  classificationStatus,
  type ClassificationStatus,
  type ClassificationTransition,
  type ClassificationTransitionRecord,
} from './classification-lifecycle.js';
import { invalidTransition, validation } from './errors.js';
import { normalizeText } from './normalized-text.js';
import { SystemCategoryPolicy, type CategoryKind, type SystemCode } from './system-categories.js';

const NAME_MAX = 80;

function checkName(raw: string, max = NAME_MAX): string {
  const name = raw.trim().replace(/\s+/gu, ' ');
  if (name.length < 1 || name.length > max) throw validation(`name must have 1..${max} characters`, '/name');
  return name;
}

const archivedError = (what: string) => new DomainError('CATEGORY_ARCHIVED', `${what} is archived`);

export interface CategoryGroupSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: CategoryKind;
  readonly name: string;
  readonly sortOrder: number;
  readonly archivedAt: string | null;
  readonly version: number;
}

/** AR `CategoryGroup` (design §1-§2): nivel de agregación de categorías del mismo tipo. */
export class CategoryGroup {
  private constructor(private s: CategoryGroupSnapshot) {}

  static create(input: {
    id: string;
    workspaceId: string;
    kind: CategoryKind;
    name: string;
    sortOrder?: number;
  }): CategoryGroup {
    return new CategoryGroup({
      id: input.id,
      workspaceId: input.workspaceId,
      kind: input.kind,
      name: checkName(input.name),
      sortOrder: input.sortOrder ?? 0,
      archivedAt: null,
      version: 1,
    });
  }

  static restore(s: CategoryGroupSnapshot): CategoryGroup {
    return new CategoryGroup({ ...s });
  }

  get id(): string {
    return this.s.id;
  }
  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get kind(): CategoryKind {
    return this.s.kind;
  }
  get name(): string {
    return this.s.name;
  }
  get normalizedName(): string {
    return normalizeText(this.s.name);
  }
  get sortOrder(): number {
    return this.s.sortOrder;
  }
  get archivedAt(): string | null {
    return this.s.archivedAt;
  }
  get isArchived(): boolean {
    return this.s.archivedAt !== null;
  }
  get version(): number {
    return this.s.version;
  }

  snapshot(): CategoryGroupSnapshot {
    return { ...this.s };
  }

  update(patch: { name?: string; sortOrder?: number }): boolean {
    const next = { ...this.s };
    if (patch.name !== undefined) next.name = checkName(patch.name);
    if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
    if (next.name === this.s.name && next.sortOrder === this.s.sortOrder) return false;
    this.s = { ...next, version: this.s.version + 1 };
    return true;
  }

  /** Solo si todas sus categorías están archivadas (`CATEGORY_GROUP_NOT_EMPTY`). */
  archive(at: string, activeCategories: number): void {
    if (this.isArchived) throw invalidTransition('category group is already archived');
    if (activeCategories > 0) {
      throw new DomainError('CATEGORY_GROUP_NOT_EMPTY', 'the group still has active categories');
    }
    this.s = { ...this.s, archivedAt: at, version: this.s.version + 1 };
  }

  unarchive(): void {
    if (!this.isArchived) throw invalidTransition('category group is not archived');
    this.s = { ...this.s, archivedAt: null, version: this.s.version + 1 };
  }
}

export interface CategorySnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly groupId: string;
  readonly parentId: string | null;
  readonly kind: CategoryKind;
  readonly name: string;
  readonly systemCode: SystemCode | null;
  readonly icon: string | null;
  readonly color: string | null;
  readonly sortOrder: number;
  readonly archivedAt: string | null;
  readonly version: number;
}

export interface CategoryPatch {
  readonly name?: string;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly sortOrder?: number;
}

/**
 * AR `Category` (design §2-§6): tipo inmutable heredado del grupo, un único nivel de subcategoría
 * (`CATEGORY_DEPTH_EXCEEDED`), sin eliminación (solo archivado, INV-019) y protecciones de sistema.
 */
export class Category {
  /** Paso del flujo de esta unidad de trabajo, validado contra `CATEGORY_LIFECYCLE` (docs/31 D52). */
  private transitionRecord: ClassificationTransitionRecord | null = null;

  private constructor(private s: CategorySnapshot) {}

  /** Transición del último comando (`null` si fue un cambio descriptivo: anotación). */
  get lastTransition(): ClassificationTransitionRecord | null {
    return this.transitionRecord;
  }

  /** Estado de la máquina (`ACTIVE` | `ARCHIVED`). */
  get status(): ClassificationStatus {
    return classificationStatus(this.s.archivedAt);
  }

  private mark(code: ClassificationTransition): void {
    this.transitionRecord = CATEGORY_LIFECYCLE.transition(code, code === 'CREATE' ? null : this.status);
  }

  /**
   * Crea una categoría en `group` (y bajo `parent` si es subcategoría). El grupo y el padre deben estar activos
   * (`CATEGORY_ARCHIVED`); el padre no puede ser subcategoría (`CATEGORY_DEPTH_EXCEEDED`) ni de sistema
   * (`SYSTEM_CATEGORY_IMMUTABLE`). La subcategoría hereda grupo y tipo del padre.
   */
  static create(input: {
    id: string;
    group: CategoryGroup;
    parent?: Category | null;
    name: string;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
    systemCode?: SystemCode | null;
  }): Category {
    const { group } = input;
    const parent = input.parent ?? null;
    if (group.isArchived) throw archivedError('category group');
    if (parent) {
      if (parent.parentId !== null) {
        throw new DomainError('CATEGORY_DEPTH_EXCEEDED', 'a subcategory cannot have subcategories');
      }
      if (parent.isSystem)
        throw SystemCategoryPolicy.immutable('system categories cannot have subcategories');
      if (parent.isArchived) throw archivedError('parent category');
      if (parent.kind !== group.kind) {
        throw new DomainError('CATEGORY_KIND_MISMATCH', 'parent and group kinds differ');
      }
      if (parent.groupId !== group.id) {
        throw validation('a subcategory belongs to the group of its parent', '/groupId');
      }
    }
    const category = new Category({
      id: input.id,
      workspaceId: group.workspaceId,
      groupId: group.id,
      parentId: parent?.id ?? null,
      kind: group.kind,
      name: checkName(input.name),
      systemCode: input.systemCode ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? 0,
      archivedAt: null,
      version: 1,
    });
    category.mark('CREATE');
    return category;
  }

  static restore(s: CategorySnapshot): Category {
    return new Category({ ...s });
  }

  get id(): string {
    return this.s.id;
  }
  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get groupId(): string {
    return this.s.groupId;
  }
  get parentId(): string | null {
    return this.s.parentId;
  }
  get kind(): CategoryKind {
    return this.s.kind;
  }
  get name(): string {
    return this.s.name;
  }
  get normalizedName(): string {
    return normalizeText(this.s.name);
  }
  get systemCode(): SystemCode | null {
    return this.s.systemCode;
  }
  get isSystem(): boolean {
    return this.s.systemCode !== null;
  }
  get icon(): string | null {
    return this.s.icon;
  }
  get color(): string | null {
    return this.s.color;
  }
  get sortOrder(): number {
    return this.s.sortOrder;
  }
  get archivedAt(): string | null {
    return this.s.archivedAt;
  }
  get isArchived(): boolean {
    return this.s.archivedAt !== null;
  }
  get version(): number {
    return this.s.version;
  }

  snapshot(): CategorySnapshot {
    return { ...this.s };
  }

  /** Renombrar/icono/color/orden. Una categoría de sistema no se renombra (`SYSTEM_CATEGORY_IMMUTABLE`). */
  update(patch: CategoryPatch): boolean {
    const next = { ...this.s };
    if (patch.name !== undefined) {
      const name = checkName(patch.name);
      if (name !== this.s.name && this.isSystem) {
        throw SystemCategoryPolicy.immutable('system categories cannot be renamed');
      }
      next.name = name;
    }
    if (patch.icon !== undefined) next.icon = patch.icon;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
    const changed = (Object.keys(next) as (keyof CategorySnapshot)[]).some((k) => next[k] !== this.s[k]);
    if (!changed) return false;
    this.s = { ...next, version: this.s.version + 1 };
    return true;
  }

  /**
   * Mover a otro grupo y/o padre. El tipo es inmutable (`CATEGORY_KIND_MISMATCH`); una categoría con
   * subcategorías no puede volverse subcategoría (`CATEGORY_DEPTH_EXCEEDED`); una de sistema no tiene padre.
   */
  moveTo(group: CategoryGroup, parent: Category | null, hasChildren: boolean): boolean {
    if (group.kind !== this.kind || (parent !== null && parent.kind !== this.kind)) {
      throw new DomainError('CATEGORY_KIND_MISMATCH', 'the category kind is immutable');
    }
    if (parent !== null) {
      if (this.isSystem) throw SystemCategoryPolicy.immutable('system categories cannot have a parent');
      if (parent.id === this.id || parent.parentId !== null || hasChildren) {
        throw new DomainError('CATEGORY_DEPTH_EXCEEDED', 'at most group → category → subcategory');
      }
      if (parent.isSystem)
        throw SystemCategoryPolicy.immutable('system categories cannot have subcategories');
      if (parent.isArchived) throw archivedError('parent category');
      if (parent.groupId !== group.id) {
        throw validation('a subcategory belongs to the group of its parent', '/groupId');
      }
    }
    if (group.isArchived) throw archivedError('category group');
    const parentId = parent?.id ?? null;
    if (group.id === this.s.groupId && parentId === this.s.parentId) return false;
    this.s = { ...this.s, groupId: group.id, parentId, version: this.s.version + 1 };
    return true;
  }

  /** El grupo de una subcategoría sigue al de su padre (mover un padre mueve sus subcategorías). */
  followParentGroup(groupId: string): boolean {
    if (this.s.groupId === groupId) return false;
    this.s = { ...this.s, groupId, version: this.s.version + 1 };
    return true;
  }

  archive(at: string): void {
    if (this.isSystem) throw SystemCategoryPolicy.immutable('system categories cannot be archived');
    if (this.isArchived) throw invalidTransition('category is already archived');
    this.mark('ARCHIVE');
    this.s = { ...this.s, archivedAt: at, version: this.s.version + 1 };
  }

  /** Padre o grupo archivados ⇒ `CATEGORY_ARCHIVED`. */
  unarchive(group: CategoryGroup, parent: Category | null): void {
    if (!this.isArchived) throw invalidTransition('category is not archived');
    if (group.isArchived) throw archivedError('category group');
    if (parent?.isArchived) throw archivedError('parent category');
    this.mark('UNARCHIVE');
    this.s = { ...this.s, archivedAt: null, version: this.s.version + 1 };
  }
}
