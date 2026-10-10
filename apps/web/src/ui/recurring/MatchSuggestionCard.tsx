import { Fragment, type ReactNode } from 'react';
import { badgeStyle, cardStyle, mutedStyle, rowStyle } from '../common/ui';
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { formatExpected } from './Badges';
import { matchReasons, CONFIDENCE_PRESENTATION, formatScore, isActionable } from './matching-logic';
import { occurrencePath } from './logic';
import type { MatchSuggestion } from './types';

export const matchButtonId = (id: string, action: 'confirm' | 'dismiss'): string => `match-${id}-${action}`;

/** Qué parte de la sugerencia es el contexto de la pantalla (la otra se muestra como enlace). */
export type MatchCardContext = 'tray' | 'transaction' | 'occurrence';

const TONES = {
  ok: { color: 'var(--pf-fin-ok)', borderColor: 'var(--pf-fin-ok)' },
  warn: { color: 'var(--pf-fin-warning)', borderColor: 'var(--pf-fin-warning)' },
  danger: { color: 'var(--pf-fin-over-budget)', borderColor: 'var(--pf-fin-over-budget)' },
  neutral: { color: 'var(--pf-fg)', borderColor: 'var(--pf-border-strong)' },
} as const;

/**
 * Tarjeta de una sugerencia de coincidencia (openspec add-commitment-matching 6.1; D132: se muestran también las de
 * confianza baja): la ocurrencia y la transacción, la confianza en TEXTO (Alta, Media, Baja) con su puntaje, los motivos
 * explicados, la marca de ambigüedad y las acciones Confirmar y Descartar solo para un EDITOR/OWNER (nada se vincula
 * hasta que el usuario confirma).
 */
export function MatchSuggestionCard({
  suggestion: s,
  f,
  canEdit,
  accountName,
  counterpartyName,
  href,
  context,
  busy,
  onConfirm,
  onDismiss,
}: {
  suggestion: MatchSuggestion;
  f: FormatContext;
  canEdit: boolean;
  accountName: (id: string) => string | undefined;
  counterpartyName?: (id: string) => string | undefined;
  href: (path: string) => string;
  context: MatchCardContext;
  busy?: boolean;
  onConfirm?: (s: MatchSuggestion) => void;
  onDismiss?: (s: MatchSuggestion) => void;
}) {
  const tone = CONFIDENCE_PRESENTATION[s.confidence];
  const o = s.occurrence;
  const t = s.transaction;
  const name = o?.definitionName ?? '—';
  const due = o ? formatBusinessDate(o.dueDate) : '—';
  const actionable = isActionable(s, canEdit) && onConfirm !== undefined && onDismiss !== undefined;
  const reasons = matchReasons(s, f);
  return (
    <li
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)', listStyle: 'none' }}
      data-testid="match-suggestion"
      data-suggestion-id={s.id}
      data-confidence={s.confidence}
      data-ambiguous={s.ambiguous ? 'true' : 'false'}
    >
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <strong data-testid="match-title">
          {context === 'transaction'
            ? f.t('matches.notice', { name, date: due })
            : context === 'occurrence' && t
              ? f.t('matches.noticeOccurrence', {
                  date: formatBusinessDate(t.businessDate),
                  amount: `${formatDecimal(t.amount.amount, f.locale)} ${t.amount.currency}`,
                })
              : name}
        </strong>
        <span
          style={{ ...badgeStyle, ...TONES[tone.tone] }}
          data-testid="match-confidence"
          data-confidence={s.confidence}
        >
          <span aria-hidden="true">{tone.icon}</span>{' '}
          {f.t('matches.score', {
            confidence: f.t(`matches.confidence.${s.confidence}`),
            score: formatScore(s.score, f.locale),
          })}
        </span>
        {s.ambiguous ? (
          <span style={{ ...badgeStyle, ...TONES.warn }} data-testid="match-ambiguous">
            <span aria-hidden="true">⚠</span> {f.t('matches.ambiguousBadge')}
          </span>
        ) : null}
      </div>
      {context !== 'transaction' || !t ? null : (
        <p style={{ margin: 0 }}>
          {f.t('matches.expectedPayment', {
            expected: o ? formatExpected(o.expected, f) : '—',
            account: o ? (accountName(o.accountId) ?? '—') : '—',
          })}
        </p>
      )}
      {t && context !== 'transaction' ? (
        <p style={{ margin: 0 }} data-testid="match-transaction">
          {f.t('matches.transaction', {
            date: formatBusinessDate(t.businessDate),
            amount: `${formatDecimal(t.amount.amount, f.locale)} ${t.amount.currency}`,
            account: accountName(t.accountId) ?? '—',
            source: f.t(sourceKey(t.source)),
          })}
          {t.counterpartyId && counterpartyName
            ? ` · ${f.t('matches.counterparty', { name: counterpartyName(t.counterpartyId) ?? '—' })}`
            : ''}
        </p>
      ) : null}
      {o && context !== 'occurrence' ? (
        <p style={{ margin: 0 }} data-testid="match-occurrence">
          {f.t('matches.occurrence', {
            expected: formatExpected(o.expected, f),
            date: due,
            account: accountName(o.accountId) ?? '—',
          })}
        </p>
      ) : null}
      <ul style={{ margin: 0, paddingInlineStart: '1.25rem' }} aria-label={f.t('matches.reasonsLabel')}>
        {reasons.map((reason) => (
          <li key={reason} data-testid="match-reason">
            {reason}
          </li>
        ))}
      </ul>
      {s.ambiguous ? (
        <p style={mutedStyle} data-testid="match-ambiguous-note">
          {f.t('matches.ambiguous')}
        </p>
      ) : null}
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        {actionable ? (
          <>
            <button
              type="button"
              id={matchButtonId(s.id, 'confirm')}
              data-action="confirm"
              disabled={busy}
              aria-label={f.t('matches.confirmLabel', { name, date: due })}
              onClick={() => onConfirm(s)}
            >
              {f.t('matches.confirm')}
            </button>
            <button
              type="button"
              id={matchButtonId(s.id, 'dismiss')}
              data-action="dismiss"
              disabled={busy}
              aria-label={f.t('matches.dismissLabel', { name, date: due })}
              onClick={() => onDismiss(s)}
            >
              {f.t('matches.dismiss')}
            </button>
          </>
        ) : null}
        {o && context !== 'occurrence' ? (
          <a href={href(occurrencePath(o.id))} data-testid="match-occurrence-link">
            {f.t('matches.viewOccurrence')}
          </a>
        ) : null}
        {t && context !== 'transaction' ? (
          <a href={href(`/transacciones/${t.id}`)} data-testid="match-transaction-link">
            {f.t('matches.viewTransaction')}
          </a>
        ) : null}
      </div>
    </li>
  );
}

function sourceKey(source: string): string {
  return source === 'MANUAL' || source === 'IMPORT' ? `matches.source.${source}` : 'matches.source.OTHER';
}

/** Lista accesible de tarjetas con su descripción. */
export function MatchSuggestionList({
  suggestions,
  caption,
  empty,
  children,
}: {
  suggestions: readonly MatchSuggestion[];
  caption: string;
  empty: string;
  children: (s: MatchSuggestion) => ReactNode;
}) {
  if (suggestions.length === 0)
    return (
      <p style={mutedStyle} data-testid="matches-empty">
        {empty}
      </p>
    );
  return (
    <ul
      aria-label={caption}
      style={{ display: 'grid', gap: 'var(--pf-space-3)', margin: 0, padding: 0 }}
      data-testid="matches-list"
    >
      {suggestions.map((s) => (
        <Fragment key={s.id}>{children(s)}</Fragment>
      ))}
    </ul>
  );
}
