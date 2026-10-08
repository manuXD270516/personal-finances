import { useState } from 'react';
import { formatInstant, formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import type { Money, Transaction } from '../common/types';
import {
  badgeStyle,
  cardStyle,
  ConfirmPanel,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  warningStyle,
} from '../common/ui';
import { describe, SignedAmount, StatusBadge } from '../transactions/TransactionsListView';
import type { NameResolver } from '../transactions/TransactionTimeline';
import {
  absMoney,
  adjustmentDirection,
  differenceState,
  type Reconciliation,
  type ReconciliationStatus,
} from './logic';

const okBadge = { ...badgeStyle, borderColor: 'var(--pf-fin-ok)', color: 'var(--pf-fin-ok)' };
const pendingBadge = {
  ...badgeStyle,
  borderColor: 'var(--pf-warning-border)',
  background: 'var(--pf-warning-bg)',
  color: 'var(--pf-warning-fg)',
};

/** Estado de la sesión como insignia (el color nunca es la única señal: lleva texto). */
export function SessionStatusBadge({ status, f }: { status: Reconciliation['status']; f: FormatContext }) {
  return (
    <span data-testid="reconciliation-status" data-status={status} style={badgeStyle}>
      {f.t(`status.${status}`)}
    </span>
  );
}

/**
 * Cabecera de la sesión: fecha y saldo del extracto, saldo confirmado y diferencia en vivo. Los pasivos se expresan
 * como deuda positiva (igual que el extracto). La diferencia se anuncia (`aria-live`) y siempre lleva su explicación
 * en texto: cero ⇒ cuadra; positiva ⇒ el extracto supera lo confirmado; negativa ⇒ lo confirmado supera al extracto.
 */
export function SessionSummary({ session, f }: { session: Reconciliation; f: FormatContext }) {
  const { t, locale } = f;
  const state = differenceState(session.difference);
  return (
    <section aria-labelledby="rec-summary-title" style={cardStyle} data-testid="reconciliation-summary">
      <h2 id="rec-summary-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
        {t('summary.title')} <SessionStatusBadge status={session.status} f={f} />
      </h2>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(9rem, max-content) 1fr',
          gap: '0.25rem 1rem',
          margin: 0,
        }}
      >
        <dt>{t('summary.statementDate')}</dt>
        <dd style={{ margin: 0 }} data-testid="rec-statement-date">
          {formatLocalDate(session.statementDate, locale)}
        </dd>
        <dt>{t('summary.statementBalance')}</dt>
        <dd style={{ margin: 0 }} data-testid="rec-statement-balance">
          {formatMoney(session.statementBalance, locale)}
        </dd>
        <dt>{t('summary.clearedBalance')}</dt>
        <dd style={{ margin: 0 }} data-testid="rec-cleared-balance">
          {session.clearedBalance ? formatMoney(session.clearedBalance, locale) : t('summary.none')}
        </dd>
        <dt>{t('summary.difference')}</dt>
        <dd style={{ margin: 0 }} data-testid="rec-difference" data-state={state ?? ''} aria-live="polite">
          <strong>{session.difference ? formatMoney(session.difference, locale) : t('summary.none')}</strong>{' '}
          {state ? (
            <span style={state === 'ZERO' ? okBadge : pendingBadge}>
              {t(`summary.differenceState.${state}`)}
            </span>
          ) : null}
        </dd>
      </dl>
      {session.status === 'IN_PROGRESS' && state && state !== 'ZERO' ? (
        <p style={mutedStyle} data-testid="rec-difference-hint">
          {t(`summary.hint.${state}`, {
            amount: formatMoney(session.difference ? absMoney(session.difference) : zero(session), locale),
          })}
        </p>
      ) : null}
    </section>
  );
}

const zero = (s: Reconciliation): Money => ({ amount: '0', currency: s.statementBalance.currency });

/**
 * Transacciones de la cuenta hasta la fecha del extracto, cada una con su casilla "Confirmada" (cleared). Solo
 * `posted` y `cleared`: las reconciliadas de extractos anteriores y las pendientes no suman. Lista (no tabla) para que
 * en 360 px no haya scroll horizontal.
 */
export function SessionTransactions({
  transactions,
  accountId,
  names,
  f,
  txf,
  href,
  editable,
  busy,
  onToggle,
}: {
  transactions: readonly Transaction[];
  accountId: string;
  names: NameResolver;
  f: FormatContext;
  /** Formato del namespace `Transactions` (descripciones, estados, montos). */
  txf: FormatContext;
  href: (path: string) => string;
  editable: boolean;
  busy?: boolean;
  onToggle?: (tx: Transaction, cleared: boolean) => void;
}) {
  const { t, locale } = f;
  if (transactions.length === 0) {
    return (
      <p data-testid="reconciliation-empty" style={mutedStyle}>
        {t('list.empty')}
      </p>
    );
  }
  return (
    <ul
      data-testid="reconciliation-transactions"
      aria-label={t('list.label')}
      style={{ listStyle: 'none', padding: 0, margin: 0 }}
    >
      {transactions.map((tx) => {
        const title = describe(tx, names, txf);
        const cleared = tx.status === 'CLEARED';
        return (
          <li
            key={tx.id}
            data-testid="reconciliation-row"
            data-transaction-id={tx.id}
            data-status={tx.status}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.25rem 0.75rem',
              alignItems: 'baseline',
              padding: '0.5rem 0',
              borderBottom: '1px solid var(--pf-border)',
            }}
          >
            {editable ? (
              <input
                type="checkbox"
                aria-label={t('list.confirm', { name: title })}
                checked={cleared}
                disabled={busy}
                onChange={(e) => onToggle?.(tx, e.target.checked)}
              />
            ) : null}
            <time dateTime={tx.transactionDate} style={{ ...mutedStyle, minWidth: '6rem' }}>
              {formatLocalDate(tx.transactionDate, locale)}
            </time>
            <a href={href(`/transacciones/${tx.id}`)} style={{ flex: '1 1 10rem', minWidth: 0 }}>
              {title}
            </a>
            <strong>
              <SignedAmount tx={tx} accountId={accountId} f={txf} />
            </strong>
            <StatusBadge status={tx.status} f={txf} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Finalizar con diferencia distinta de cero: confirmación explícita de un ajuste contra el ajuste de patrimonio, con
 * motivo obligatorio (FR-TRANSACTIONS-030). Muestra la dirección y el monto que se crearán.
 */
export function AdjustmentPanel({
  difference,
  f,
  locale,
  busy,
  onConfirm,
  onCancel,
}: {
  difference: Money;
  f: FormatContext;
  locale: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const direction = adjustmentDirection(difference);
  return (
    <ConfirmPanel
      testId="adjustment-panel"
      title={f.t('adjustment.title')}
      description={
        direction
          ? f.t(`adjustment.description.${direction}`, { amount: formatMoney(absMoney(difference), locale) })
          : f.t('adjustment.title')
      }
      confirmLabel={f.t('adjustment.confirm')}
      cancelLabel={f.t('adjustment.cancel')}
      busy={busy}
      confirmDisabled={!reason.trim()}
      onConfirm={() => onConfirm(reason.trim())}
      onCancel={onCancel}
    >
      <Field label={f.t('adjustment.reason')} hint={f.t('adjustment.reasonHint')}>
        {(p) => (
          <input
            {...p}
            name="adjustmentReason"
            required
            maxLength={500}
            style={inputStyle}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </ConfirmPanel>
  );
}

/** Formulario "Iniciar una conciliación": fecha y saldo del extracto en la moneda de la cuenta. */
export function StartForm({
  f,
  currency,
  liability,
  today,
  busy,
  error,
  onSubmit,
}: {
  f: FormatContext;
  currency: string;
  liability: boolean;
  today: string;
  busy: boolean;
  error?: { readonly balance?: string; readonly date?: string };
  onSubmit: (values: { statementDate: string; statementBalance: string }) => void;
}) {
  const [statementDate, setStatementDate] = useState(today);
  const [statementBalance, setStatementBalance] = useState('');
  return (
    <form
      style={formStyle}
      aria-labelledby="rec-start-title"
      data-testid="reconciliation-start"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ statementDate, statementBalance });
      }}
    >
      <h2 id="rec-start-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {f.t('start.title')}
      </h2>
      <p style={mutedStyle}>{f.t('start.intro')}</p>
      <div style={rowStyle}>
        <Field label={f.t('start.statementDate')} error={error?.date}>
          {(p) => (
            <input
              {...p}
              type="date"
              name="statementDate"
              required
              max={today}
              style={inputStyle}
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={f.t('start.statementBalance', { currency })}
          error={error?.balance}
          hint={liability ? f.t('start.liabilityHint') : undefined}
        >
          {(p) => (
            <input
              {...p}
              name="statementBalance"
              required
              inputMode="decimal"
              autoComplete="off"
              style={inputStyle}
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={busy}>
          {f.t('start.submit')}
        </button>
      </div>
    </form>
  );
}

/** Historial de sesiones de la cuenta, de la más reciente a la más antigua. */
export function SessionHistory({
  sessions,
  f,
  href,
  currentId,
}: {
  sessions: readonly Reconciliation[];
  f: FormatContext;
  href: (reconciliationId: string) => string;
  currentId?: string | undefined;
}) {
  const { t, locale, timeZone } = f;
  if (sessions.length === 0) {
    return (
      <p data-testid="reconciliation-history-empty" style={mutedStyle}>
        {t('history.empty')}
      </p>
    );
  }
  return (
    <ul data-testid="reconciliation-history" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {sessions.map((s) => (
        <li
          key={s.id}
          data-testid="reconciliation-history-item"
          data-status={s.status}
          aria-current={s.id === currentId ? 'true' : undefined}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.25rem 0.75rem',
            alignItems: 'baseline',
            padding: '0.5rem 0',
            borderBottom: '1px solid var(--pf-border)',
          }}
        >
          <a href={href(s.id)}>{t('history.item', { date: formatLocalDate(s.statementDate, locale) })}</a>
          <strong>{formatMoney(s.statementBalance, locale)}</strong>
          <SessionStatusBadge status={s.status} f={f} />
          {s.completedAt ? (
            <span style={mutedStyle}>
              {t('history.completedAt', { at: formatInstant(s.completedAt, locale, timeZone) })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Indicador de reconciliación de una cuenta (detalle de la cuenta): última sesión completada, transacciones sin
 * reconciliar y conciliadas sin extracto (con enlace al listado filtrado). El texto siempre dice si está conciliada al
 * corte y con qué base; el color no es la única señal.
 */
export function ReconciliationIndicator({
  status,
  f,
  through,
  withoutStatementHref,
}: {
  status: ReconciliationStatus;
  f: FormatContext;
  /** Fecha de corte del estado (hoy en la zona del workspace). */
  through: string;
  withoutStatementHref: string;
}) {
  const { t, locale } = f;
  const open = status.unreconciledPostedCountThrough + status.unreconciledClearedCountThrough;
  return (
    <section
      aria-labelledby="rec-indicator-title"
      style={cardStyle}
      data-testid="reconciliation-indicator"
      data-reconciled={String(status.reconciledThrough)}
      data-basis={status.reconciliationBasis ?? ''}
    >
      <h2 id="rec-indicator-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
        {t('indicator.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="reconciliation-indicator-state">
        <span style={status.reconciledThrough ? okBadge : pendingBadge}>
          {status.reconciledThrough
            ? status.reconciliationBasis === 'WITHOUT_STATEMENT'
              ? t('indicator.reconciledWithoutStatement', { date: formatLocalDate(through, locale) })
              : t('indicator.reconciled', { date: formatLocalDate(through, locale) })
            : t('indicator.notReconciled', { date: formatLocalDate(through, locale) })}
        </span>
      </p>
      <p style={mutedStyle}>
        {status.lastCompleted
          ? t('indicator.last', {
              date: formatLocalDate(status.lastCompleted.statementDate, locale),
              balance: formatMoney(status.lastCompleted.statementBalance, locale),
            })
          : t('indicator.never')}
      </p>
      {open > 0 ? (
        <p style={mutedStyle} data-testid="reconciliation-indicator-open">
          {t('indicator.open', { n: open })}
        </p>
      ) : null}
      {status.reconciledWithoutStatementCount > 0 ? (
        <p data-testid="reconciliation-indicator-without-statement" style={warningStyle}>
          {t('indicator.withoutStatement', { n: status.reconciledWithoutStatementCount })}{' '}
          <a href={withoutStatementHref}>{t('indicator.reviewWithoutStatement')}</a>
        </p>
      ) : null}
    </section>
  );
}
