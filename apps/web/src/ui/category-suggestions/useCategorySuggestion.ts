'use client';

import { useEffect, useState } from 'react';
import type { WorkspaceContext } from '../common/workspace';
import {
  SUGGEST_DEBOUNCE_MS,
  counterpartySuggestionPath,
  queryBody,
  queryPath,
  resolveChip,
  type ChipSuggestion,
  type CounterpartySuggestion,
  type SuggestionKind,
  type SuggestionResult,
} from './logic';

/**
 * Sugerencia de categoría del alta manual (openspec add-category-suggestions, decisión 5): mientras la categoría está
 * vacía consulta, con *debounce* de 400 ms, la categoría por defecto o la última usada de la contraparte y la
 * sugerencia por historial (`POST`, la descripción viaja en el cuerpo). Una falla de la consulta solo oculta el chip:
 * la sugerencia nunca bloquea registrar el movimiento.
 */
export function useCategorySuggestion(
  ctx: WorkspaceContext,
  input: {
    readonly enabled: boolean;
    readonly kind: SuggestionKind;
    readonly description: string;
    readonly counterpartyId: string;
    readonly accountId: string;
    readonly date: string;
  },
): ChipSuggestion | null {
  const { api, base } = ctx;
  const { enabled, kind, description, counterpartyId, accountId, date } = input;
  const [chip, setChip] = useState<ChipSuggestion | null>(null);

  useEffect(() => {
    const body = enabled ? queryBody({ kind, description, counterpartyId, accountId, date }) : null;
    if (body === null) {
      setChip(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const history = api
        .command<SuggestionResult>('POST', queryPath(base), body, { idempotent: false })
        .then((r) => r.data ?? null)
        .catch(() => null);
      const counterparty =
        counterpartyId === ''
          ? Promise.resolve<CounterpartySuggestion | null>(null)
          : api
              .get<CounterpartySuggestion>(counterpartySuggestionPath(base, counterpartyId, kind))
              .then((r) => r.data ?? null)
              .catch(() => null);
      void Promise.all([counterparty, history]).then(([c, h]) => {
        if (!cancelled) setChip(resolveChip(c, h));
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, base, enabled, kind, description, counterpartyId, accountId, date]);

  return chip;
}
