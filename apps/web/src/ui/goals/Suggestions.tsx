'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Field, cardStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { confirmBody, goalsPath, pendingSuggestions, suggestionNeedsGoal, suggestionsPath } from './logic';
import type { Goal, GoalContributionSuggestion, GoalList, GoalSuggestionList } from './types';

/**
 * Una sugerencia de aporte (transferencia manual hacia una cuenta vinculada): se confirma (registra el aporte) o se
 * descarta. Sin meta propuesta hay que elegirla. Presentacional: las acciones llegan por props.
 */
export function SuggestionRow({
  suggestion,
  f,
  goals,
  accountName,
  href,
  canEdit,
  chosenGoalId,
  onChoose,
  onConfirm,
  onDismiss,
  busy,
}: {
  suggestion: GoalContributionSuggestion;
  f: FormatContext;
  goals: readonly Pick<Goal, 'id' | 'name'>[];
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
  canEdit: boolean;
  chosenGoalId: string;
  onChoose: (goalId: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const needsGoal = suggestionNeedsGoal(suggestion);
  const proposed = goals.find((g) => g.id === suggestion.goalId);
  return (
    <li
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="goal-suggestion"
      data-suggestion-id={suggestion.id}
    >
      <p style={{ margin: 0 }}>
        {f.t('suggestions.item', {
          amount: formatMoney(suggestion.amount, f.locale),
          account: accountName(suggestion.accountId) ?? '…',
          date: formatBusinessDate(suggestion.businessDate),
        })}{' '}
        <a href={href(`/transacciones/${suggestion.transactionId}`)}>{f.t('suggestions.viewTransaction')}</a>
      </p>
      {!needsGoal ? (
        <p style={{ margin: 0 }} data-testid="goal-suggestion-goal">
          {f.t('suggestions.proposed', { goal: proposed?.name ?? '…' })}
        </p>
      ) : (
        <Field label={f.t('suggestions.chooseGoal')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={chosenGoalId}
              disabled={!canEdit || busy}
              data-testid="goal-suggestion-choose"
              onChange={(e) => onChoose(e.target.value)}
            >
              <option value="">{f.t('form.choose')}</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {canEdit ? (
        <div style={rowStyle}>
          <button
            type="button"
            data-testid="goal-suggestion-confirm"
            disabled={busy || (needsGoal && chosenGoalId === '')}
            onClick={onConfirm}
          >
            {f.t('suggestions.confirm')}
          </button>
          <button type="button" data-testid="goal-suggestion-dismiss" disabled={busy} onClick={onDismiss}>
            {f.t('suggestions.dismiss')}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** Bandeja de sugerencias con contador (D135 por analogía: sin notificación, solo contador en la pantalla). */
export function SuggestionsView({
  items,
  count,
  f,
  children,
}: {
  items: readonly GoalContributionSuggestion[];
  count: number;
  f: FormatContext;
  children: (s: GoalContributionSuggestion) => ReactNode;
}) {
  const pending = pendingSuggestions(items);
  return (
    <section
      aria-labelledby="goal-suggestions-title"
      style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="goal-suggestions"
    >
      <h2 id="goal-suggestions-title" style={{ margin: 0, fontSize: 'var(--pf-text-xl)' }}>
        {f.t('suggestions.title')}{' '}
        <span style={{ ...mutedStyle, fontSize: 'var(--pf-text-base)' }} data-testid="goal-suggestions-count">
          ({count})
        </span>
      </h2>
      <p style={mutedStyle}>{f.t('suggestions.intro')}</p>
      {pending.length === 0 ? (
        <p style={mutedStyle} data-testid="goal-suggestions-empty">
          {f.t('suggestions.empty')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          {pending.map((s) => children(s))}
        </ul>
      )}
    </section>
  );
}

export function SuggestionsTray({
  ctx,
  accountName,
  onChanged,
}: {
  ctx: WorkspaceContext;
  accountName: (id: string) => string | undefined;
  /** Se llama tras confirmar (cambia el progreso de las metas) para recargar el listado. */
  onChanged?: () => void;
}) {
  const f = useFormat('Goals', ctx);
  const [list, setList] = useState<GoalSuggestionList | undefined>();
  const [goals, setGoals] = useState<readonly Goal[]>([]);
  const [chosen, setChosen] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const { api, base } = ctx;

  const load = useCallback(async () => {
    try {
      const [sugs, gs] = await Promise.all([
        api.get<GoalSuggestionList>(suggestionsPath(base, 'PENDING')),
        api.get<GoalList>(goalsPath(base)).catch(() => undefined),
      ]);
      setList(sugs.data);
      setGoals(gs?.data?.data ?? []);
    } catch (err) {
      setProblem(problemOf(err));
      setList({ data: [], pendingCount: 0 });
    }
  }, [api, base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(s: GoalContributionSuggestion, action: 'confirm' | 'dismiss') {
    setProblem(undefined);
    setStatus(undefined);
    let body: Record<string, unknown> | undefined;
    if (action === 'confirm') {
      const built = confirmBody(s, chosen[s.id] ?? '');
      if (built === null) return;
      body = built;
    }
    setBusy(s.id);
    try {
      await api.command('POST', `${suggestionsPath(base)}/${s.id}/${action}`, body);
      setStatus(f.t(action === 'confirm' ? 'suggestions.confirmed' : 'suggestions.dismissed'));
      await load();
      if (action === 'confirm') onChanged?.();
    } catch (err) {
      setProblem(problemOf(err));
      // La sugerencia pudo vencer o resolverse en otra sesión: se recarga la bandeja.
      await load();
    } finally {
      setBusy(undefined);
    }
  }

  if (!list) return <p aria-busy="true">{f.t('loading')}</p>;
  const selectable = goals.filter((g) => g.status === 'ACTIVE' || g.status === 'PAUSED');
  return (
    <>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {status ? (
        <p role="status" data-testid="goal-suggestions-status">
          {status}
        </p>
      ) : null}
      <SuggestionsView items={list.data} count={list.pendingCount} f={f}>
        {(s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            f={f}
            goals={selectable.length > 0 ? selectable : goals}
            accountName={accountName}
            href={ctx.href}
            canEdit={ctx.canEdit}
            chosenGoalId={chosen[s.id] ?? ''}
            onChoose={(goalId) => setChosen((c) => ({ ...c, [s.id]: goalId }))}
            onConfirm={() => void decide(s, 'confirm')}
            onDismiss={() => void decide(s, 'dismiss')}
            busy={busy === s.id}
          />
        )}
      </SuggestionsView>
    </>
  );
}
