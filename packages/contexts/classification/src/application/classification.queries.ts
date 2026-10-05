import type { LifecycleDto } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { Category, CategoryGroup } from '../domain/category.js';
import { CounterpartyMatcher, type Counterparty, type CounterpartyKind } from '../domain/counterparty.js';
import { notFound, referenceNotFound } from '../domain/errors.js';
import { normalizeText } from '../domain/normalized-text.js';
import type { CategoryKind } from '../domain/system-categories.js';
import type { Tag } from '../domain/tag.js';
import type { ClassificationDeps } from './ports/index.js';

export interface ListFilter {
  readonly includeArchived?: boolean;
  readonly q?: string;
}

/** Tipo de la porción de una transacción que referencia la clasificación (Transactions). */
export type SplitKind = 'EXPENSE' | 'INCOME' | 'REFUND';

export interface ValidateClassificationInput {
  readonly categoryIds?: readonly { readonly categoryId: string; readonly splitKind: SplitKind }[];
  readonly tagIds?: readonly string[];
  readonly counterpartyId?: string | null;
}

export interface CounterpartyResolution {
  readonly counterparty: Counterparty | null;
  readonly matchedOn: 'NAME' | 'ALIAS' | null;
  readonly matchedText: string | null;
}

export interface CategorySuggestion {
  readonly categoryId: string | null;
  readonly source: 'DEFAULT' | 'LAST_USED' | 'NONE';
}

const byOrder = <T extends { sortOrder: number; name: string; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

const visible = <T extends { isArchived: boolean; name: string }>(items: T[], f: ListFilter): T[] =>
  items.filter(
    (i) =>
      (f.includeArchived === true || !i.isArchived) &&
      (f.q === undefined || normalizeText(i.name).includes(normalizeText(f.q))),
  );

/** Tipo de categoría admitido por una porción: el reembolso reduce un gasto (spec "Compatibilidad del tipo"). */
const categoryKindFor = (split: SplitKind): CategoryKind => (split === 'INCOME' ? 'INCOME' : 'EXPENSE');

/**
 * Consultas de CLASSIFICATION (design §1): listados (excluyen archivados salvo `includeArchived`), árbol, resolución
 * de counterparties, sugerencia de categoría y `ValidateClassification` (pública para Transactions, INV-019).
 */
export class ClassificationQueries {
  constructor(private readonly deps: ClassificationDeps) {}

  private run<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.uow.run({ userId, workspaceId }, fn);
  }

  listCategoryGroups(
    userId: string,
    workspaceId: string,
    f: ListFilter & { kind?: CategoryKind } = {},
  ): Promise<CategoryGroup[]> {
    return this.run(userId, workspaceId, async () =>
      visible(await this.deps.groups.listAll(workspaceId), f)
        .filter((g) => f.kind === undefined || g.kind === f.kind)
        .sort((a, b) => a.kind.localeCompare(b.kind) || byOrder(a, b)),
    );
  }

  /**
   * `GetLifecycle` de una categoría o contraparte (add-lifecycle-timeline decisión 7, docs/31 D52; VIEWER+):
   * verifica que el agregado existe en el workspace (404 idéntico a inexistente si es de otro, RLS) y pide el recorrido
   * a AUDIT con su estado actual (`ACTIVE` | `ARCHIVED`) como fuente de verdad.
   */
  lifecycleOf(
    userId: string,
    workspaceId: string,
    aggregateType: 'Category' | 'Counterparty',
    id: string,
  ): Promise<LifecycleDto> {
    return this.run(userId, workspaceId, async () => {
      const item: Category | Counterparty | null =
        aggregateType === 'Category'
          ? await this.deps.categories.findById(workspaceId, id)
          : await this.deps.counterparties.findById(workspaceId, id);
      if (!item) throw notFound(aggregateType === 'Category' ? 'category' : 'counterparty');
      return this.deps.lifecycleQuery.lifecycleOf({
        userId,
        workspaceId,
        aggregateType,
        aggregateId: item.id,
        currentState: item.status,
      });
    });
  }

  getCategoryGroup(userId: string, workspaceId: string, id: string): Promise<CategoryGroup> {
    return this.run(userId, workspaceId, async () => {
      const g = await this.deps.groups.findById(workspaceId, id);
      if (!g) throw notFound('category group');
      return g;
    });
  }

  /** Orden de árbol: grupo (tipo, orden) → categoría (orden) → sus subcategorías (orden). */
  listCategories(
    userId: string,
    workspaceId: string,
    f: ListFilter & { kind?: CategoryKind; groupId?: string } = {},
  ): Promise<Category[]> {
    return this.run(userId, workspaceId, async () => {
      const groups = (await this.deps.groups.listAll(workspaceId)).sort(
        (a, b) => a.kind.localeCompare(b.kind) || byOrder(a, b),
      );
      const all = await this.deps.categories.listAll(workspaceId);
      const tree: Category[] = [];
      for (const g of groups) {
        const roots = all.filter((c) => c.groupId === g.id && c.parentId === null).sort(byOrder);
        for (const r of roots) {
          tree.push(r, ...all.filter((c) => c.parentId === r.id).sort(byOrder));
        }
      }
      const placed = new Set(tree.map((c) => c.id));
      tree.push(...all.filter((c) => !placed.has(c.id)).sort(byOrder));
      return visible(tree, f).filter(
        (c) =>
          (f.kind === undefined || c.kind === f.kind) && (f.groupId === undefined || c.groupId === f.groupId),
      );
    });
  }

  getCategory(userId: string, workspaceId: string, id: string): Promise<Category> {
    return this.run(userId, workspaceId, async () => {
      const c = await this.deps.categories.findById(workspaceId, id);
      if (!c) throw notFound('category');
      return c;
    });
  }

  listTags(userId: string, workspaceId: string, f: ListFilter = {}): Promise<Tag[]> {
    return this.run(userId, workspaceId, async () =>
      visible(await this.deps.tags.listAll(workspaceId), f).sort(
        (a, b) => a.normalizedName.localeCompare(b.normalizedName) || a.id.localeCompare(b.id),
      ),
    );
  }

  getTag(userId: string, workspaceId: string, id: string): Promise<Tag> {
    return this.run(userId, workspaceId, async () => {
      const t = await this.deps.tags.findById(workspaceId, id);
      if (!t) throw notFound('tag');
      return t;
    });
  }

  listCounterparties(
    userId: string,
    workspaceId: string,
    f: ListFilter & { kind?: CounterpartyKind } = {},
  ): Promise<Counterparty[]> {
    return this.run(userId, workspaceId, async () =>
      visible(await this.deps.counterparties.listAll(workspaceId), f)
        .filter((c) => f.kind === undefined || c.kind === f.kind)
        .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || a.id.localeCompare(b.id)),
    );
  }

  getCounterparty(userId: string, workspaceId: string, id: string): Promise<Counterparty> {
    return this.run(userId, workspaceId, async () => {
      const c = await this.deps.counterparties.findById(workspaceId, id);
      if (!c) throw notFound('counterparty');
      return c;
    });
  }

  /** `ResolveCounterparty(description)`: solo sugiere; ignora counterparties archivadas. */
  resolveCounterparty(
    userId: string,
    workspaceId: string,
    description: string,
  ): Promise<CounterpartyResolution> {
    return this.run(userId, workspaceId, async () => {
      const match = CounterpartyMatcher.match(
        description,
        await this.deps.counterparties.listAll(workspaceId),
      );
      return match
        ? { counterparty: match.counterparty, matchedOn: match.matchedOn, matchedText: match.matchedText }
        : { counterparty: null, matchedOn: null, matchedText: null };
    });
  }

  /**
   * `GetCategorySuggestion`: categoría por defecto activa del tipo pedido; si no, la última usada (puerto de
   * Transactions) si sigue activa y es del tipo; si no, ninguna. Nunca asigna.
   */
  getCategorySuggestion(
    userId: string,
    workspaceId: string,
    counterpartyId: string,
    kind: CategoryKind,
  ): Promise<CategorySuggestion> {
    return this.run(userId, workspaceId, async () => {
      const cp = await this.deps.counterparties.findById(workspaceId, counterpartyId);
      if (!cp) throw notFound('counterparty');
      const usable = async (id: string | null) => {
        if (id === null) return false;
        const c = await this.deps.categories.findById(workspaceId, id);
        return c !== null && !c.isArchived && c.kind === kind;
      };
      if (await usable(cp.defaultCategoryId)) return { categoryId: cp.defaultCategoryId, source: 'DEFAULT' };
      const last = await this.deps.lastCategoryUsed.lastCategoryUsed({ workspaceId, counterpartyId, kind });
      if (await usable(last)) return { categoryId: last, source: 'LAST_USED' };
      return { categoryId: null, source: 'NONE' };
    });
  }

  /** Id de la categoría de sistema (`UNCATEGORIZED`/`UNCATEGORIZED_INCOME`) del workspace (Transactions). */
  systemCategoryId(userId: string, workspaceId: string, systemCode: string): Promise<string | null> {
    return this.run(userId, workspaceId, async () => {
      const all = await this.deps.categories.listAll(workspaceId);
      return all.find((c) => c.systemCode === systemCode)?.id ?? null;
    });
  }

  /** `CategoryCatalogQuery.categoriesByIds` (Reporting): incluye archivadas; ids inexistentes se omiten. */
  categoriesByIds(userId: string, workspaceId: string, categoryIds: readonly string[]): Promise<Category[]> {
    return this.run(userId, workspaceId, async () => {
      const wanted = new Set(categoryIds);
      return (await this.deps.categories.listAll(workspaceId)).filter((c) => wanted.has(c.id));
    });
  }

  /** Las categorías dadas más todas sus subcategorías (filtro `categoryId` de listTransactions). */
  categoryIdsWithDescendants(
    userId: string,
    workspaceId: string,
    categoryIds: readonly string[],
  ): Promise<string[]> {
    return this.run(userId, workspaceId, async () => {
      const all = await this.deps.categories.listAll(workspaceId);
      const wanted = new Set(categoryIds);
      for (const c of all) if (c.parentId !== null && wanted.has(c.parentId)) wanted.add(c.id);
      return [...wanted];
    });
  }

  /**
   * `ValidateClassification` (INV-019): Transactions la invoca con los IDs NUEVOS o MODIFICADOS de cada porción.
   * Inexistente ⇒ `REFERENCE_NOT_FOUND`; archivado ⇒ `CATEGORY_ARCHIVED` / `TAG_ARCHIVED` /
   * `COUNTERPARTY_ARCHIVED`; tipo incompatible ⇒ `CATEGORY_KIND_MISMATCH`.
   */
  validateClassification(
    userId: string,
    workspaceId: string,
    input: ValidateClassificationInput,
  ): Promise<void> {
    return this.run(userId, workspaceId, async () => {
      for (const [i, ref] of (input.categoryIds ?? []).entries()) {
        const c = await this.deps.categories.findById(workspaceId, ref.categoryId);
        if (!c) throw referenceNotFound('category', `/splits/${i}/categoryId`);
        if (c.isArchived) {
          throw new DomainError('CATEGORY_ARCHIVED', 'the category is archived').at(
            `/splits/${i}/categoryId`,
          );
        }
        if (c.kind !== categoryKindFor(ref.splitKind)) {
          throw new DomainError(
            'CATEGORY_KIND_MISMATCH',
            `a ${ref.splitKind} split cannot use a ${c.kind} category`,
          ).at(`/splits/${i}/categoryId`);
        }
      }
      for (const [i, id] of (input.tagIds ?? []).entries()) {
        const t = await this.deps.tags.findById(workspaceId, id);
        if (!t) throw referenceNotFound('tag', `/tagIds/${i}`);
        if (t.isArchived) throw new DomainError('TAG_ARCHIVED', 'the tag is archived').at(`/tagIds/${i}`);
      }
      if (input.counterpartyId) {
        const c = await this.deps.counterparties.findById(workspaceId, input.counterpartyId);
        if (!c) throw referenceNotFound('counterparty', '/counterpartyId');
        if (c.isArchived) {
          throw new DomainError('COUNTERPARTY_ARCHIVED', 'the counterparty is archived').at(
            '/counterpartyId',
          );
        }
      }
    });
  }
}
