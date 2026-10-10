'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Account } from '../common/types';
import { listAll, type WorkspaceContext } from '../common/workspace';

export interface AccountsLookup {
  readonly loaded: boolean;
  readonly all: readonly Account[];
  /** Cuentas activas: las únicas que admiten importar. */
  readonly active: readonly Account[];
  readonly byId: (id: string) => Account | undefined;
}

const includeArchived = new URLSearchParams({ includeArchived: 'true' });

/** Cuentas del workspace (incluidas archivadas, para mostrar nombres de importaciones antiguas). */
export function useAccounts(ctx: WorkspaceContext): AccountsLookup {
  const [state, setState] = useState<{ loaded: boolean; all: readonly Account[] }>({
    loaded: false,
    all: [],
  });
  const { api, base } = ctx;
  useEffect(() => {
    let cancelled = false;
    listAll<Account>(api, `${base}/accounts`, includeArchived)
      .then((all) => {
        if (!cancelled) setState({ loaded: true, all });
      })
      .catch(() => {
        if (!cancelled) setState({ loaded: true, all: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, base]);
  return useMemo(() => {
    const map = new Map(state.all.map((a) => [a.id, a]));
    return {
      loaded: state.loaded,
      all: state.all,
      active: state.all.filter((a) => a.status === 'ACTIVE'),
      byId: (id: string) => map.get(id),
    };
  }, [state]);
}
