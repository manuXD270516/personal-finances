'use client';

import { useState } from 'react';
import { formatInstant, formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { reasonsText, SPENDING_ANOMALIES_PATH, type AnomalyFilters } from './logic';
import {
  DISMISS_REASONS,
  STATUS_FILTERS,
  type AnomalyNames,
  type DismissReason,
  type SpendingAnomaly,
  type SpendingAnomalyPage,
  type StatusFilter,
} from './types';
import './spending-anomalies.css';

export interface SpendingAnomaliesViewProps {
  readonly page: Pick<SpendingAnomalyPage, 'featureStatus'>;
  readonly items: readonly SpendingAnomaly[];
  readonly names: AnomalyNames;
  readonly filters: AnomalyFilters;
  /** Textos del namespace `SpendingAnomalies` y formato del workspace. */
  readonly f: FormatContext;
  /** Solo OWNER y EDITOR descartan y restauran (la API decide; la UI oculta los botones). */
  readonly canDecide: boolean;
  /** Id del gasto atípico con una decisión en curso. */
  readonly busyId?: string | undefined;
  readonly hasMore: boolean;
  readonly onFilters: (next: Partial<AnomalyFilters>) => void;
  readonly onDismiss: (id: string, reason: DismissReason | undefined) => void;
  readonly onRestore: (id: string) => void;
  readonly onMore: () => void;
  readonly href: (path: string) => string;
}

function DismissControl({
  anomaly,
  f,
  busy,
  onDismiss,
}: {
  anomaly: SpendingAnomaly;
  f: FormatContext;
  busy: boolean;
  onDismiss: (id: string, reason: DismissReason | undefined) => void;
}) {
  const [reason, setReason] = useState<DismissReason | ''>('');
  const selectId = `anomaly-reason-${anomaly.id}`;
  return (
    <div className="pf-sa-dismiss">
      <label htmlFor={selectId} className="pf-sa-label">
        {f.t('dismiss.reasonLabel')}
      </label>
      <select
        id={selectId}
        value={reason}
        onChange={(e) => setReason(e.target.value as DismissReason | '')}
        data-testid="anomaly-dismiss-reason"
      >
        <option value="">{f.t('dismiss.none')}</option>
        {DISMISS_REASONS.map((r) => (
          <option key={r} value={r}>
            {f.t(`dismiss.${r}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={() => onDismiss(anomaly.id, reason === '' ? undefined : reason)}
        data-testid="anomaly-dismiss"
      >
        {f.t('dismiss.label')}
      </button>
    </div>
  );
}

function AnomalyRow({
  anomaly,
  f,
  names,
  canDecide,
  busy,
  onDismiss,
  onRestore,
  href,
}: {
  anomaly: SpendingAnomaly;
  f: FormatContext;
  names: AnomalyNames;
  canDecide: boolean;
  busy: boolean;
  onDismiss: SpendingAnomaliesViewProps['onDismiss'];
  onRestore: SpendingAnomaliesViewProps['onRestore'];
  href: (path: string) => string;
}) {
  const categories = anomaly.categoryIds.map((id) => names.category(id)).filter((n): n is string => !!n);
  const counterparty = anomaly.counterpartyId ? names.counterparty(anomaly.counterpartyId) : undefined;
  const foreign = anomaly.amount.currency !== anomaly.reportingAmount.currency;
  const dismissedAt = anomaly.decidedAt ? formatInstant(anomaly.decidedAt, f.locale, f.timeZone) : '';
  return (
    <tr data-testid="anomaly-row" data-anomaly-id={anomaly.id} data-status={anomaly.status}>
      <td data-label={f.t('table.date')}>
        <time dateTime={anomaly.transactionDate}>{formatLocalDate(anomaly.transactionDate, f.locale)}</time>
      </td>
      <td data-label={f.t('table.amount')} className="pf-sa-amount">
        <strong>{formatMoney(anomaly.amount, f.locale)}</strong>
        {foreign ? (
          <span className="pf-sa-muted">
            {' '}
            {f.t('reportingAmount', { amount: formatMoney(anomaly.reportingAmount, f.locale) })}
          </span>
        ) : null}
      </td>
      <td data-label={f.t('table.category')}>{categories.join(', ') || '—'}</td>
      <td data-label={f.t('table.counterparty')}>{counterparty ?? '—'}</td>
      <td data-label={f.t('table.reasons')}>
        <ul className="pf-sa-reasons" data-testid="anomaly-reasons">
          {reasonsText(anomaly, f, names).map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
        {anomaly.transactionChanged ? (
          <p className="pf-sa-muted" data-testid="anomaly-changed">
            {f.t('changed')}
          </p>
        ) : null}
        <a href={href(`/transacciones/${anomaly.transactionId}`)} data-testid="anomaly-transaction-link">
          {f.t('openTransaction')}
        </a>
      </td>
      <td data-label={f.t('table.status')}>
        <span className="pf-sa-status" data-status={anomaly.status}>
          {f.t(`status.${anomaly.status}`)}
        </span>
        {anomaly.status === 'DISMISSED' && dismissedAt ? (
          <p className="pf-sa-muted">
            {anomaly.dismissReason && f.has(`dismiss.${anomaly.dismissReason}`)
              ? f.t('decidedReason', { at: dismissedAt, reason: f.t(`dismiss.${anomaly.dismissReason}`) })
              : f.t('decided', { at: dismissedAt })}
          </p>
        ) : null}
      </td>
      {canDecide ? (
        <td data-label={f.t('table.actions')}>
          {anomaly.status === 'OPEN' ? (
            <DismissControl anomaly={anomaly} f={f} busy={busy} onDismiss={onDismiss} />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRestore(anomaly.id)}
              data-testid="anomaly-restore"
            >
              {f.t('restore.label')}
            </button>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Vista de gastos atípicos (add-spending-anomaly-detection, decisión 14): filtros de estado y rango, tabla accesible con el
 * motivo de cada gasto por plantilla y los botones «No es atípico» y «Restaurar» para OWNER y EDITOR. Los textos no hablan
 * de error ni de fraude: la marca solo dice que el monto se aleja de lo habitual.
 */
export function SpendingAnomaliesView(props: SpendingAnomaliesViewProps) {
  const { f, filters, items, names, canDecide } = props;
  return (
    <div className="pf-sa" data-testid="spending-anomalies-view">
      <header>
        <h1>{f.t('title')}</h1>
        <p className="pf-sa-muted">{f.t('subtitle')}</p>
      </header>
      {props.page.featureStatus === 'DISABLED' ? (
        <p role="status" className="pf-sa-notice" data-testid="anomalies-disabled">
          {f.t('disabled')}
        </p>
      ) : null}
      <p className="pf-sa-muted">{f.t('disclaimer')}</p>
      <form
        className="pf-sa-filters"
        aria-label={f.t('filters.label')}
        onSubmit={(e) => e.preventDefault()}
        data-testid="anomaly-filters"
      >
        <div>
          <label htmlFor="anomaly-status" className="pf-sa-label">
            {f.t('filters.status')}
          </label>
          <select
            id="anomaly-status"
            value={filters.status}
            onChange={(e) => props.onFilters({ status: e.target.value as StatusFilter })}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {f.t(`filters.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="anomaly-from" className="pf-sa-label">
            {f.t('filters.from')}
          </label>
          <input
            id="anomaly-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => props.onFilters({ from: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="anomaly-to" className="pf-sa-label">
            {f.t('filters.to')}
          </label>
          <input
            id="anomaly-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => props.onFilters({ to: e.target.value })}
          />
        </div>
      </form>
      {items.length === 0 ? (
        <p data-testid="anomalies-empty">
          {filters.status === 'OPEN' && !filters.from && !filters.to ? f.t('empty') : f.t('emptyFiltered')}
        </p>
      ) : (
        <table className="pf-sa-table" data-testid="anomalies-table">
          <caption className="pf-sr-only">{f.t('table.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{f.t('table.date')}</th>
              <th scope="col">{f.t('table.amount')}</th>
              <th scope="col">{f.t('table.category')}</th>
              <th scope="col">{f.t('table.counterparty')}</th>
              <th scope="col">{f.t('table.reasons')}</th>
              <th scope="col">{f.t('table.status')}</th>
              {canDecide ? <th scope="col">{f.t('table.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <AnomalyRow
                key={a.id}
                anomaly={a}
                f={f}
                names={names}
                canDecide={canDecide}
                busy={props.busyId === a.id}
                onDismiss={props.onDismiss}
                onRestore={props.onRestore}
                href={props.href}
              />
            ))}
          </tbody>
        </table>
      )}
      {props.hasMore ? (
        <button type="button" onClick={props.onMore} data-testid="anomalies-more">
          {f.t('more')}
        </button>
      ) : null}
    </div>
  );
}

export { SPENDING_ANOMALIES_PATH };
