import type { Category, CategoryGroup, Tag } from '../common/types';
import { listAll, type WorkspaceContext } from '../common/workspace';
import type { TargetOptions } from './BudgetLineForm';
import type { TargetNames } from './BudgetLinesTable';

export interface Catalog {
  readonly names: TargetNames;
  readonly options: TargetOptions;
}

export async function loadCatalog(ctx: WorkspaceContext): Promise<Catalog> {
  const withArchived = new URLSearchParams({ includeArchived: 'true' });
  const [groups, categories, tags] = await Promise.all([
    listAll<CategoryGroup>(ctx.api, `${ctx.base}/category-groups`, withArchived),
    listAll<Category>(ctx.api, `${ctx.base}/categories`, withArchived),
    listAll<Tag>(ctx.api, `${ctx.base}/tags`, withArchived),
  ]);
  const active = <T extends { archivedAt?: string | null }>(items: readonly T[]) =>
    items.filter((i) => !i.archivedAt);
  return {
    names: {
      CATEGORY: new Map(categories.map((c) => [c.id, c.name])),
      GROUP: new Map(groups.map((g) => [g.id, g.name])),
      TAG: new Map(tags.map((t) => [t.id, t.name])),
    },
    options: {
      CATEGORY: active(categories).map((c) => ({ id: c.id, name: c.name, nature: c.kind })),
      GROUP: active(groups).map((g) => ({ id: g.id, name: g.name, nature: g.kind })),
      TAG: active(tags).map((t) => ({ id: t.id, name: t.name, nature: 'EXPENSE' as const })),
    },
  };
}
