'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { mutedStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { Catalogs } from '../transactions/catalogs';
import {
  MatchSuggestionCard,
  MatchSuggestionList,
  matchButtonId,
  type MatchCardContext,
} from './MatchSuggestionCard';
import { notifyRecurringChanged } from './logic';
import {
  forOccurrenceQuery,
  forTransactionQuery,
  matchSuggestionsPath,
  proposedQuery,
} from './matching-logic';
import type { MatchSuggestion, MatchSuggestionPage } from './types';

/** Qué sugerencias se listan: las pendientes del workspace, las de una transacción o las de una ocurrencia. */
export type MatchScope =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'transaction'; readonly transactionId: string }
  | { readonly kind: 'occurrence'; readonly occurrenceId: string };

const queryOf = (scope: MatchScope): string =>
  scope.kind === 'workspace'
    ? proposedQuery()
    : scope.kind === 'transaction'
      ? forTransactionQuery(scope.transactionId)
      : forOccurrenceQuery(scope.occurrenceId);

/**
 * Carga las sugerencias propuestas y expone Confirmar y Descartar (`POST …/match-suggestions/{id}/confirm|dismiss`, con
 * `Idempotency-Key` por intento). Tras una acción recarga la lista y avisa a la pantalla (`onChanged`) y a la sidebar.
 */
function useMatchSuggestions(
  ctx: WorkspaceContext,
  f: FormatContext,
  scope: MatchScope,
  refreshKey: number,
  onChanged: ((message: string) => void) | undefined,
  onCount: ((count: number) => void) | undefined,
) {
  const [items, setItems] = useState<readonly MatchSuggestion[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [reload, setReload] = useState(0);
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const url = matchSuggestionsPath(ctx.base, queryOf(scope));

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<MatchSuggestionPage>(url)
      .then((r) => {
        if (cancelled) return;
        setItems(r.data?.data ?? []);
        setHasMore(r.data?.page.hasMore ?? false);
        setProblem(undefined);
        countRef.current?.(r.data?.proposedCount ?? 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, url, refreshKey, reload]);

  const act = useCallback(
    async (s: MatchSuggestion, action: 'confirm' | 'dismiss') => {
      setBusyId(s.id);
      setProblem(undefined);
      try {
        await ctx.api.command(
          'POST',
          `${ctx.base}/recurring/match-suggestions/${s.id}/${action}`,
          undefined,
          {
            ifMatch: s.version,
          },
        );
        notifyRecurringChanged();
        setReload((n) => n + 1);
        onChanged?.(
          f.t(action === 'confirm' ? 'matches.confirmed' : 'matches.dismissed', {
            name: s.occurrence?.definitionName ?? '—',
          }),
        );
      } catch (err) {
        setProblem(problemOf(err));
        // Una sugerencia que ya no está pendiente (409) desaparece de la lista.
        setReload((n) => n + 1);
        // El foco vuelve al botón (la fila sigue ahí si el error no la quitó).
        setTimeout(() => document.getElementById(matchButtonId(s.id, action))?.focus(), 0);
      } finally {
        setBusyId(undefined);
      }
    },
    [ctx.api, ctx.base, f, onChanged],
  );
  return { items, hasMore, problem, busyId, act };
}

/** Pestaña "Coincidencias por revisar" de `/recurring` (docs/28 §4.8): todas las sugerencias pendientes con su confianza. */
export function MatchSuggestionsPanel({
  ctx,
  f,
  catalogs,
  refreshKey,
  onChanged,
  onCount,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  refreshKey: number;
  onChanged: (message: string) => void;
  onCount?: (count: number) => void;
}) {
  const { items, hasMore, problem, busyId, act } = useMatchSuggestions(
    ctx,
    f,
    { kind: 'workspace' },
    refreshKey,
    onChanged,
    onCount,
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="matches-panel">
      <p style={mutedStyle}>{f.t('matches.intro')}</p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <MatchSuggestionList
          suggestions={items}
          caption={f.t('matches.caption')}
          empty={f.t('matches.empty')}
        >
          {(s) => (
            <MatchSuggestionCard
              suggestion={s}
              f={f}
              canEdit={ctx.canEdit}
              accountName={(id) => catalogs.names.account(id)}
              counterpartyName={(id) => catalogs.names.counterparty(id)}
              href={ctx.href}
              context="tray"
              busy={busyId === s.id}
              onConfirm={(x) => void act(x, 'confirm')}
              onDismiss={(x) => void act(x, 'dismiss')}
            />
          )}
        </MatchSuggestionList>
      )}
      {hasMore ? (
        <p style={mutedStyle} data-testid="matches-truncated">
          {f.t('truncated', { limit: 100 })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Aviso en el detalle de una transacción o de una ocurrencia ("Esto parece el pago de Internet (20/10)") con las mismas
 * acciones. No muestra nada mientras no haya sugerencias propuestas (ni ocupa lugar mientras carga).
 */
export function MatchSuggestionsNotice({
  ctx,
  f,
  catalogs,
  scope,
  refreshKey = 0,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  scope: Exclude<MatchScope, { kind: 'workspace' }>;
  refreshKey?: number;
  onChanged?: (message: string) => void;
}) {
  const { items, problem, busyId, act } = useMatchSuggestions(
    ctx,
    f,
    scope,
    refreshKey,
    onChanged,
    undefined,
  );
  const context: MatchCardContext = scope.kind;
  if ((items === undefined || items.length === 0) && !problem) return null;
  return (
    <section
      aria-labelledby="matches-notice-title"
      data-testid="matches-notice"
      style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
    >
      <h2 id="matches-notice-title" style={{ margin: 0, fontSize: '1.125rem' }}>
        {f.t('matches.noticeTitle')}
      </h2>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <MatchSuggestionList suggestions={items ?? []} caption={f.t('matches.noticeTitle')} empty="">
        {(s) => (
          <MatchSuggestionCard
            suggestion={s}
            f={f}
            canEdit={ctx.canEdit}
            accountName={(id) => catalogs.names.account(id)}
            counterpartyName={(id) => catalogs.names.counterparty(id)}
            href={ctx.href}
            context={context}
            busy={busyId === s.id}
            onConfirm={(x) => void act(x, 'confirm')}
            onDismiss={(x) => void act(x, 'dismiss')}
          />
        )}
      </MatchSuggestionList>
    </section>
  );
}
