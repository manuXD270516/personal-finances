'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  Field,
  badgeStyle,
  cardStyle,
  cellStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { formatMoney } from '../dashboard/format';
import { formatBusinessDate } from '../planning/logic';
import { useCatalogs, type Catalogs } from '../transactions/catalogs';
import {
  DEFAULT_SUGGESTION_WINDOW,
  SUGGESTION_WINDOWS,
  confidenceIcon,
  hiddenPreviewItems,
  percentText,
  suggestionQuery,
  suggestionsPath,
} from './logic';
import type { RuleSuggestion, SuggestionEvidence, SuggestionList, SuggestionPreview } from './types';

type Names = Catalogs['names'];

function EvidenceList({
  items,
  kind,
  f,
  names,
  locale,
}: {
  items: readonly SuggestionEvidence[];
  kind: 'evidence' | 'counter';
  f: FormatContext;
  names: Names;
  locale: string;
}) {
  return (
    <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid={`suggestion-${kind}-list`}>
      {items.map((e) => (
        <li key={e.transactionId} data-testid={`suggestion-${kind}-item`}>
          {kind === 'evidence'
            ? f.t('suggestions.evidenceItem', {
                date: formatBusinessDate(e.date),
                description: e.description ?? f.t('suggestions.noDescription'),
                amount: formatMoney(e.amount, locale),
                account: names.account(e.accountId) ?? e.accountId.slice(0, 8),
              })
            : f.t('suggestions.counterItem', {
                date: formatBusinessDate(e.date),
                description: e.description ?? f.t('suggestions.noDescription'),
                amount: formatMoney(e.amount, locale),
                category: names.category(e.categoryId) ?? e.categoryId.slice(0, 8),
              })}
        </li>
      ))}
    </ul>
  );
}

/** Tarjeta de una sugerencia: patrón, categoría, apoyo, confianza (texto e icono), evidencia, contraejemplos y conflictos. */
export function SuggestionCard({
  suggestion: s,
  f,
  names,
  locale,
  canEdit,
  busy,
  onTest,
  acceptHref,
  onDismiss,
  onRestore,
  children,
}: {
  suggestion: RuleSuggestion;
  f: FormatContext;
  names: Names;
  locale: string;
  canEdit: boolean;
  busy: boolean;
  onTest?: (s: RuleSuggestion) => void;
  /** «Aceptar…» es navegación: abre el editor de reglas prellenado (no guarda nada). */
  acceptHref?: (s: RuleSuggestion) => string;
  onDismiss?: (s: RuleSuggestion) => void;
  onRestore?: (s: RuleSuggestion) => void;
  children?: React.ReactNode;
}) {
  const dismissed = s.status === 'DISMISSED';
  const label =
    s.pattern.type === 'COUNTERPARTY'
      ? (s.patternLabel ?? names.counterparty(s.pattern.value) ?? s.pattern.value)
      : s.pattern.value;
  const kindText = f.t(`suggestions.kinds.${s.pattern.kind}`);
  return (
    <li
      style={{ ...cardStyle, listStyle: 'none', display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="suggestion-card"
      data-suggestion-id={s.suggestionId}
      data-status={s.status}
      data-level={s.confidenceLevel}
    >
      <h3 style={{ margin: 0 }} data-testid="suggestion-pattern">
        {f.t(`suggestions.pattern.${s.pattern.type}`, { value: label })}
      </h3>
      <p style={{ margin: 0 }} data-testid="suggestion-summary">
        {f.t('suggestions.summary', { kind: kindText, category: s.categoryName })}
      </p>
      <p
        style={{
          margin: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--pf-space-2)',
          alignItems: 'center',
        }}
      >
        <span data-testid="suggestion-support">
          {f.t('suggestions.support', { support: s.support, total: s.evidenceCount })}
        </span>
        <span style={badgeStyle} data-testid="suggestion-confidence">
          <span aria-hidden="true">{confidenceIcon(s.confidenceLevel)}</span>{' '}
          {f.has(`suggestions.level.${s.confidenceLevel}`)
            ? f.t(`suggestions.level.${s.confidenceLevel}`)
            : s.confidenceLevel}
          {' · '}
          {f.t('suggestions.confidence', { confidence: percentText(s.confidence, locale) })}
        </span>
        {dismissed ? (
          <span style={badgeStyle} data-testid="suggestion-dismissed">
            <span aria-hidden="true">✕</span> {f.t('suggestions.status.DISMISSED')}
          </span>
        ) : null}
      </p>
      <p style={mutedStyle}>{f.t('suggestions.proposedName', { name: s.proposedRule.name })}</p>
      <details data-testid="suggestion-evidence">
        <summary>{f.t('suggestions.evidence', { count: s.evidence.length })}</summary>
        <EvidenceList items={s.evidence} kind="evidence" f={f} names={names} locale={locale} />
      </details>
      {s.counterExamples.length > 0 ? (
        <details data-testid="suggestion-counter">
          <summary>{f.t('suggestions.counterExamples', { count: s.counterExamples.length })}</summary>
          <EvidenceList items={s.counterExamples} kind="counter" f={f} names={names} locale={locale} />
        </details>
      ) : null}
      {s.conflicts.length > 0 ? (
        <div style={warningStyle} data-testid="suggestion-conflicts">
          <strong>
            <span aria-hidden="true">⚠</span> {f.t('suggestions.conflicts')}
          </strong>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {s.conflicts.map((c) => (
              <li key={`${c.ruleId}-${c.categoryId}`}>
                {f.t('suggestions.conflictItem', {
                  name: c.name,
                  version: c.version,
                  priority: c.priority,
                  count: c.count,
                  category: names.category(c.categoryId) ?? c.categoryId.slice(0, 8),
                })}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0 }} data-testid="suggestion-priority">
            {f.t('suggestions.proposedPriority', { priority: s.proposedRule.priority })}
          </p>
          {s.warnings.includes('CANNOT_OUTRANK') ? (
            <p style={{ margin: 0 }} data-testid="suggestion-cannot-outrank">
              {f.t('suggestions.cannotOutrank')}
            </p>
          ) : null}
        </div>
      ) : null}
      <div style={rowStyle}>
        {onTest ? (
          <button type="button" disabled={busy} onClick={() => onTest(s)} data-testid="suggestion-test">
            {f.t('suggestions.test')}
          </button>
        ) : null}
        {canEdit && !dismissed && acceptHref ? (
          <a href={acceptHref(s)} data-testid="suggestion-accept">
            {f.t('suggestions.accept')}
          </a>
        ) : null}
        {canEdit && !dismissed && onDismiss ? (
          <button type="button" disabled={busy} onClick={() => onDismiss(s)} data-testid="suggestion-dismiss">
            {f.t('suggestions.dismiss')}
          </button>
        ) : null}
        {canEdit && dismissed && onRestore ? (
          <button type="button" disabled={busy} onClick={() => onRestore(s)} data-testid="suggestion-restore">
            {f.t('suggestions.restore')}
          </button>
        ) : null}
      </div>
      {children}
    </li>
  );
}

/** Resultado de probar una sugerencia: conteos y las transacciones que coinciden (hasta 200), sin cambiar nada. */
export function SuggestionPreviewView({
  preview,
  f,
  names,
  locale,
}: {
  preview: SuggestionPreview;
  f: FormatContext;
  names: Names;
  locale: string;
}) {
  const hidden = hiddenPreviewItems(preview);
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="suggestion-preview">
      <h4 style={{ margin: 0 }}>{f.t('suggestions.preview.title')}</h4>
      <p style={{ margin: 0 }} role="status" data-testid="suggestion-preview-counts">
        {f.t('suggestions.preview.counts', {
          matched: preview.matched,
          wouldFill: preview.wouldFill,
          alreadyInCategory: preview.alreadyInCategory,
          otherCategory: preview.otherCategory,
          notApplicable: preview.notApplicable,
        })}
      </p>
      {preview.truncated ? (
        <p style={warningStyle} data-testid="suggestion-preview-truncated">
          {f.t('suggestions.preview.truncated')}
        </p>
      ) : null}
      {preview.items.length === 0 ? (
        <p style={mutedStyle} data-testid="suggestion-preview-none">
          {f.t('suggestions.preview.none')}
        </p>
      ) : (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('suggestions.preview.region')}>
          <table style={tableStyle} data-testid="suggestion-preview-table">
            <caption className="pf-sr-only">{f.t('suggestions.preview.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('suggestions.preview.date')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('suggestions.preview.transaction')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('suggestions.preview.current')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('suggestions.preview.outcome')}
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((i) => (
                <tr key={i.transactionId} data-testid="suggestion-preview-row" data-outcome={i.outcome}>
                  <td style={cellStyle}>{formatBusinessDate(i.date)}</td>
                  <th scope="row" style={cellStyle}>
                    {i.description ?? f.t('suggestions.noDescription')}
                    <div style={mutedStyle}>{formatMoney(i.amount, locale)}</div>
                  </th>
                  <td style={cellStyle}>
                    {i.currentCategoryId === null
                      ? f.t('suggestions.preview.uncategorized')
                      : (names.category(i.currentCategoryId) ?? i.currentCategoryId.slice(0, 8))}
                  </td>
                  <td style={cellStyle}>
                    {f.has(`suggestions.preview.outcomes.${i.outcome}`)
                      ? f.t(`suggestions.preview.outcomes.${i.outcome}`)
                      : i.outcome}
                    {i.reasons.length > 0 ? (
                      <div style={mutedStyle}>
                        {i.reasons.map((r) => (f.has(`skip.${r}`) ? f.t(`skip.${r}`) : r)).join(', ')}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 ? (
        <p style={mutedStyle} data-testid="suggestion-preview-shown">
          {f.t('suggestions.preview.shown', { shown: preview.items.length, total: preview.matched })}
        </p>
      ) : null}
    </div>
  );
}

/** Pestaña «Sugerencias»: se calculan al abrirla (a pedido), nunca en segundo plano; aceptar abre el editor prellenado. */
export function SuggestionsPanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Rules', ctx);
  const catalogs = useCatalogs(ctx);
  const [windowDays, setWindowDays] = useState(DEFAULT_SUGGESTION_WINDOW);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [list, setList] = useState<SuggestionList | undefined>();
  const [previews, setPreviews] = useState<Readonly<Record<string, SuggestionPreview>>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const { api, base } = ctx;

  const load = useCallback(async () => {
    try {
      const r = await api.get<SuggestionList>(
        `${suggestionsPath(base)}?windowDays=${windowDays}${includeDismissed ? '&includeDismissed=true' : ''}`,
      );
      setList(r.data);
      setProblem(undefined);
    } catch (err) {
      setList(undefined);
      setProblem(problemOf(err));
    }
  }, [api, base, windowDays, includeDismissed]);
  useEffect(() => {
    setList(undefined);
    void load();
  }, [load]);

  const test = async (s: RuleSuggestion) => {
    setBusy(true);
    try {
      const r = await api.command<SuggestionPreview>(
        'POST',
        suggestionsPath(base, '/preview'),
        { suggestionId: s.suggestionId, pattern: s.pattern, windowDays },
        { idempotent: false },
      );
      if (r.data) setPreviews((p) => ({ ...p, [s.suggestionId]: r.data as SuggestionPreview }));
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (s: RuleSuggestion, action: 'dismiss' | 'restore') => {
    setBusy(true);
    try {
      await api.command(
        'POST',
        suggestionsPath(base, `/${s.suggestionId}/${action}`),
        action === 'dismiss' ? { pattern: s.pattern } : undefined,
        action === 'dismiss' ? undefined : { idempotent: false },
      );
      setAnnounce(
        f.t(action === 'dismiss' ? 'suggestions.dismissed' : 'suggestions.restored', {
          name: s.proposedRule.name,
        }),
      );
      setProblem(undefined);
      await load();
    } catch (err) {
      setProblem(problemOf(err));
      // 409: ya estaba decidida (otra pestaña u otro EDITOR); se recarga el listado.
      if (problemOf(err).code === 'RULE_SUGGESTION_DECIDED') await load();
    } finally {
      setBusy(false);
    }
  };

  const acceptHref = (s: RuleSuggestion) => ctx.href(`/reglas/nueva?${suggestionQuery(s)}`);

  const items = (list?.items ?? []).filter((s) => (includeDismissed ? true : s.status !== 'DISMISSED'));
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="suggestions-panel">
      <p style={mutedStyle}>{f.t('suggestions.intro')}</p>
      <div style={rowStyle}>
        <Field label={f.t('suggestions.window')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={windowDays}
              data-testid="suggestions-window"
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              {SUGGESTION_WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {f.t('suggestions.windowOption', { days: d })}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={includeDismissed}
            data-testid="suggestions-include-dismissed"
            onChange={(e) => setIncludeDismissed(e.target.checked)}
          />
          {f.t('suggestions.includeDismissed')}
        </label>
      </div>
      {!ctx.canEdit ? <p style={mutedStyle}>{f.t('suggestions.viewerNotice')}</p> : null}
      <div role="status" aria-live="polite" className="pf-sr-only" data-testid="suggestions-announce">
        {announce}
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {list === undefined && !problem ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : list ? (
        <>
          <p style={mutedStyle} data-testid="suggestions-range">
            {f.t('suggestions.range', {
              from: formatBusinessDate(list.from),
              to: formatBusinessDate(list.to),
              scanned: list.scanned,
            })}
          </p>
          {list.truncated ? (
            <p style={warningStyle} role="status" data-testid="suggestions-truncated">
              {f.t('suggestions.truncated', { scanned: list.scanned })}
            </p>
          ) : null}
          {items.length === 0 ? (
            <p style={mutedStyle} data-testid="suggestions-empty">
              {f.t(includeDismissed ? 'suggestions.emptyDismissed' : 'suggestions.empty')}
            </p>
          ) : (
            <ul
              aria-label={f.t('suggestions.list')}
              style={{ display: 'grid', gap: 'var(--pf-space-3)', margin: 0, padding: 0 }}
              data-testid="suggestions-list"
            >
              {items.map((s) => (
                <SuggestionCard
                  key={s.suggestionId}
                  suggestion={s}
                  f={f}
                  names={catalogs.names}
                  locale={ctx.formatLocale}
                  canEdit={ctx.canEdit}
                  busy={busy}
                  onTest={(x) => void test(x)}
                  acceptHref={acceptHref}
                  onDismiss={(x) => void decide(x, 'dismiss')}
                  onRestore={(x) => void decide(x, 'restore')}
                >
                  {previews[s.suggestionId] ? (
                    <SuggestionPreviewView
                      preview={previews[s.suggestionId] as SuggestionPreview}
                      f={f}
                      names={catalogs.names}
                      locale={ctx.formatLocale}
                    />
                  ) : null}
                </SuggestionCard>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
