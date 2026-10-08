import { cardStyle, ConfirmPanel, Field, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { ClosingChecklistView } from './ClosingChecklistView';
import { canReopen, NOTE_MAX, REASON_MAX, type CloseBlock, type CloseChecklist } from './closing-logic';
import { formatBusinessDate, periodName, type FinancialPeriod } from './logic';

/**
 * Cuerpo presentacional de la pantalla "Cierre de mes" (openspec add-month-closing 6.1): periodo cerrado con
 * "Reabrir" (solo OWNER, con motivo obligatorio y confirmación), checklist con su resumen y panel de cierre
 * (reconocimiento explícito de advertencias, nota y "Cerrar mes"). Sin llamadas a la API: la página le pasa el estado y
 * los manejadores, de modo que se prueba con fixtures. `pf` es el contexto del namespace `Planning` (estados).
 */
export function ClosingBody({
  f,
  pf,
  href,
  period,
  today,
  checklist,
  block,
  busy,
  canEdit,
  isOwner,
  acknowledged,
  note,
  onAcknowledged,
  onNote,
  onClose,
  reopening,
  reason,
  reasonError,
  onAskReopen,
  onReason,
  onCancelReopen,
  onReopen,
}: {
  f: FormatContext;
  pf: FormatContext;
  href: (path: string) => string;
  period: FinancialPeriod;
  today: string;
  checklist: CloseChecklist | undefined;
  block: CloseBlock | null;
  busy: boolean;
  canEdit: boolean;
  isOwner: boolean;
  acknowledged: boolean;
  note: string;
  onAcknowledged: (v: boolean) => void;
  onNote: (v: string) => void;
  onClose: () => void;
  reopening: boolean;
  reason: string;
  reasonError: 'REQUIRED' | 'TOO_LONG' | undefined;
  onAskReopen: () => void;
  onReason: (v: string) => void;
  onCancelReopen: () => void;
  onReopen: () => void;
}) {
  const closed = period.status === 'CLOSED';
  const closable = period.status === 'ACTIVE' || period.status === 'REOPENED';
  return (
    <>
      {closed ? (
        <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="close-closed">
          <p style={{ margin: 0 }}>
            {f.t('alreadyClosed', { closeNo: period.latestCloseNo ?? period.closeCount })}
          </p>
          <p style={{ margin: 0 }}>
            <a href={href(`/planificacion/periodos/${period.id}/reporte`)} data-testid="closed-report-link">
              {f.t('viewReport')}
            </a>
          </p>
          {canReopen(isOwner, period) ? (
            reopening ? (
              <ConfirmPanel
                title={f.t('reopen.confirmTitle', { name: periodName(period.label, f.locale) })}
                description={f.t('reopen.confirmBody')}
                confirmLabel={f.t('reopen.confirm')}
                cancelLabel={f.t('reopen.cancel')}
                busy={busy}
                onConfirm={onReopen}
                onCancel={onCancelReopen}
                testId="confirm-reopen"
              >
                <Field
                  label={f.t('reopen.reason')}
                  error={reasonError ? f.t(`reopen.errors.${reasonError}`, { max: REASON_MAX }) : undefined}
                  hint={f.t('reopen.reasonHint', { max: REASON_MAX })}
                >
                  {(props) => (
                    <textarea
                      {...props}
                      name="reason"
                      rows={3}
                      value={reason}
                      required
                      maxLength={REASON_MAX + 200}
                      style={inputStyle}
                      onChange={(e) => onReason(e.target.value)}
                      data-testid="reopen-reason"
                    />
                  )}
                </Field>
              </ConfirmPanel>
            ) : (
              <div style={rowStyle}>
                <button type="button" onClick={onAskReopen} disabled={busy} data-testid="reopen">
                  {f.t('reopen.action')}
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
      {!closed && !closable ? (
        <p role="note" style={warningStyle} data-testid="close-not-closable">
          {f.t('notClosable', { status: pf.t(`status.${period.status}`) })}
        </p>
      ) : null}
      {closable ? (
        <>
          {period.periodEnd >= today ? (
            <p role="note" style={warningStyle} data-testid="close-not-ended">
              {f.t('notEnded', { end: formatBusinessDate(period.periodEnd) })}
            </p>
          ) : null}
          <section aria-labelledby="checklist-title" style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
            <h2 id="checklist-title">{f.t('checklist.title')}</h2>
            {checklist ? (
              <>
                <p style={mutedStyle}>
                  {f.t('checklist.evaluated', {
                    at: new Intl.DateTimeFormat(f.locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: f.timeZone,
                    }).format(new Date(checklist.evaluatedAt)),
                  })}
                </p>
                <p
                  role="status"
                  data-testid="close-summary"
                  data-can-close={String(checklist.canClose)}
                  data-requires-ack={String(checklist.requiresAcknowledgement)}
                  style={checklist.canClose && !checklist.requiresAcknowledgement ? undefined : warningStyle}
                >
                  {!checklist.canClose
                    ? f.t('checklist.blocked')
                    : checklist.requiresAcknowledgement
                      ? f.t('checklist.warningsOnly')
                      : f.t('checklist.clear')}
                </p>
                <ClosingChecklistView items={checklist.items} f={f} href={href} titleId="checklist-title" />
              </>
            ) : (
              <p aria-busy="true">{f.t('checklist.loading')}</p>
            )}
          </section>
          <section
            aria-labelledby="close-action-title"
            style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
          >
            <h2 id="close-action-title">{f.t('close.title')}</h2>
            {checklist?.requiresAcknowledgement && checklist.canClose ? (
              <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'start' }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={busy || !canEdit}
                  onChange={(e) => onAcknowledged(e.target.checked)}
                  data-testid="acknowledge-warnings"
                />
                <span>{f.t('close.acknowledge')}</span>
              </label>
            ) : null}
            <Field label={f.t('close.note')} hint={f.t('close.noteHint', { max: NOTE_MAX })}>
              {(props) => (
                <textarea
                  {...props}
                  name="note"
                  rows={2}
                  value={note}
                  maxLength={NOTE_MAX}
                  disabled={busy || !canEdit}
                  style={inputStyle}
                  onChange={(e) => onNote(e.target.value)}
                  data-testid="close-note"
                />
              )}
            </Field>
            <div style={rowStyle}>
              <button
                type="button"
                onClick={onClose}
                disabled={busy || block !== null}
                aria-describedby={block ? 'close-block-reason' : undefined}
                data-testid="close-month"
              >
                {busy ? f.t('close.closing') : f.t('close.action')}
              </button>
            </div>
            {block ? (
              <p
                id="close-block-reason"
                style={mutedStyle}
                data-testid="close-block-reason"
                data-block={block}
              >
                {f.t(`close.blocked.${block}`)}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
