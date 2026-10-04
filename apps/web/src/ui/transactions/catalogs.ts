'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account, Category, CategoryGroup, Counterparty, Tag } from '../common/types';
import { listAll, type WorkspaceContext } from '../common/workspace';
import type { NameResolver } from './TransactionTimeline';

export interface Catalogs {
  readonly loaded: boolean;
  /** Todas las cuentas (incluidas archivadas, para mostrar nombres); los selectores usan `activeAccounts`. */
  readonly accounts: readonly Account[];
  readonly activeAccounts: readonly Account[];
  readonly categories: readonly Category[];
  readonly groups: readonly CategoryGroup[];
  readonly counterparties: readonly Counterparty[];
  readonly tags: readonly Tag[];
  readonly names: NameResolver;
  readonly reload: () => void;
  readonly addCounterparty: (c: Counterparty) => void;
}

const all = new URLSearchParams({ includeArchived: 'true' });

/** Catálogos para selectores y nombres (cuentas, categorías y grupos, contrapartes, tags) del workspace activo. */
export function useCatalogs(ctx: WorkspaceContext): Catalogs {
  const [state, setState] = useState<
    Omit<Catalogs, 'names' | 'reload' | 'activeAccounts' | 'addCounterparty'>
  >({
    loaded: false,
    accounts: [],
    categories: [],
    groups: [],
    counterparties: [],
    tags: [],
  });
  const { api, base } = ctx;

  const reload = useCallback(() => {
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    void Promise.all([
      safe(listAll<Account>(api, `${base}/accounts`, all)),
      safe(listAll<Category>(api, `${base}/categories`, all)),
      safe(listAll<CategoryGroup>(api, `${base}/category-groups`, all)),
      safe(listAll<Counterparty>(api, `${base}/counterparties`, all)),
      safe(listAll<Tag>(api, `${base}/tags`, all)),
    ]).then(([accounts, categories, groups, counterparties, tags]) =>
      setState({ loaded: true, accounts, categories, groups, counterparties, tags }),
    );
  }, [api, base]);

  useEffect(reload, [reload]);

  return useMemo(() => {
    const byId = <T extends { id: string; name: string }>(list: readonly T[]) => {
      const m = new Map(list.map((x) => [x.id, x.name]));
      return (id: string) => m.get(id);
    };
    return {
      ...state,
      activeAccounts: state.accounts.filter((a) => a.status === 'ACTIVE'),
      names: {
        account: byId(state.accounts),
        category: byId(state.categories),
        counterparty: byId(state.counterparties),
        tag: byId(state.tags),
      },
      reload,
      addCounterparty: (c: Counterparty) =>
        setState((s) => ({
          ...s,
          counterparties: s.counterparties.some((x) => x.id === c.id)
            ? s.counterparties
            : [...s.counterparties, c],
        })),
    };
  }, [state, reload]);
}

/**
 * Opciones de categoría para un tipo de movimiento: activas (nunca archivadas), del tipo (`EXPENSE` para gastos y
 * reembolsos, `INCOME` para ingresos), agrupadas por grupo en el orden persistente y con las subcategorías bajo su
 * padre.
 */
export function categoryOptions(
  categories: readonly Category[],
  groups: readonly CategoryGroup[],
  kind: 'EXPENSE' | 'INCOME',
): { group: string; options: { id: string; label: string; system: boolean }[] }[] {
  const active = categories.filter((c) => c.kind === kind && !c.archivedAt);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  // Orden persistente de los grupos (sortOrder, luego nombre): el mismo de la pantalla de clasificación.
  const groupRank = new Map(
    [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((g, i) => [g.id, i]),
  );
  const byGroup = new Map<string, Category[]>();
  for (const c of active) byGroup.set(c.groupId, [...(byGroup.get(c.groupId) ?? []), c]);
  const order = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  return [...byGroup.entries()]
    .map(([groupId, list]) => {
      const parents = list.filter((c) => !c.parentId).sort(order);
      const options: { id: string; label: string; system: boolean }[] = [];
      for (const p of parents) {
        options.push({ id: p.id, label: p.name, system: p.isSystem });
        for (const child of list.filter((c) => c.parentId === p.id).sort(order))
          options.push({ id: child.id, label: `${p.name} › ${child.name}`, system: child.isSystem });
      }
      // Subcategorías cuyo padre está archivado o fuera del filtro: se listan igual.
      for (const orphan of list.filter((c) => c.parentId && !parents.some((p) => p.id === c.parentId)))
        options.push({ id: orphan.id, label: orphan.name, system: orphan.isSystem });
      return {
        group: groupName.get(groupId) ?? '',
        rank: groupRank.get(groupId) ?? Number.MAX_SAFE_INTEGER,
        options,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group))
    .map(({ group, options }) => ({ group, options }));
}
