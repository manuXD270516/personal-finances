import { problemMessage } from '../../errors/error-messages';
import { cellStyle, mutedStyle, numCellStyle, rowStyle, tableStyle, tableWrapStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { AmountText, OccurrenceStatusBadge } from './Badges';
import { paymentHref } from '../debt/logic';
import {
  availableOccurrenceActions,
  canRegisterLoanPayment,
  isCardPayment,
  isLoanInstallment,
  occurrencePath,
  type OccurrenceAction,
} from './logic';
import { cardHref, cardPaymentName } from '../debt/cards/logic';
import type { RecurringOccurrence } from './types';

export const actionButtonId = (id: string, action: OccurrenceAction): string => `occ-${id}-${action}`;

/**
 * Lista de ocurrencias (Próximos, Por aprobar y las de una definición): estado con texto + icono, monto con la escala de
 * su moneda (rango para `MIN_MAX`, "Sin monto" para `VARIABLE`), el error de la última creación automática rechazada
 * (D129) y las acciones Aprobar, Vincular, Omitir y Editar solo para un EDITOR/OWNER y mientras no esté resuelta.
 */
export function OccurrencesTable({
  occurrences,
  f,
  uiLocale,
  canEdit,
  accountName,
  href,
  caption,
  empty,
  onAction,
  busyId,
  loanOf,
  cardOf,
}: {
  occurrences: readonly RecurringOccurrence[];
  f: FormatContext;
  uiLocale: string;
  canEdit: boolean;
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
  caption: string;
  empty: string;
  onAction?: (action: OccurrenceAction, occurrence: RecurringOccurrence) => void;
  busyId?: string | undefined;
  /** Préstamo de origen de una definición de cuotas (add-loans). */
  loanOf?: (definitionId: string) => { id: string; name: string } | undefined;
  /** Tarjeta de origen de una definición `CARD_PAYMENT` (add-credit-cards). */
  cardOf?: (definitionId: string) => { id: string; name: string } | undefined;
}) {
  if (occurrences.length === 0)
    return (
      <p style={mutedStyle} data-testid="occurrences-empty">
        {empty}
      </p>
    );
  const withActions = canEdit && onAction !== undefined;
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="occurrences-table">
        <caption className="pf-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.payment')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.due')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.account')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('columns.amount')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.status')}
            </th>
            {withActions ? (
              <th scope="col" style={cellStyle}>
                {f.t('columns.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => {
            const actions = withActions ? availableOccurrenceActions(o, canEdit) : [];
            const due = formatBusinessDate(o.dueDate);
            return (
              <tr
                key={o.id}
                data-testid="occurrence-row"
                data-occurrence-id={o.id}
                data-status={o.status}
                data-name={o.definitionName}
                data-mode={o.mode}
              >
                <td style={cellStyle}>
                  <a href={href(occurrencePath(o.id))} data-testid="occurrence-link">
                    {isCardPayment(o)
                      ? f.t('cardPayment.label', { name: cardPaymentName(o.definitionName) })
                      : o.definitionName}
                  </a>
                  <div style={mutedStyle}>
                    {f.t(`kinds.${o.kind}`)} · {f.t(`modes.${o.mode}`)}
                    {o.overridden ? ` · ${f.t('overridden')}` : ''}
                  </div>
                  {isCardPayment(o) ? (
                    <div style={mutedStyle} data-testid="occurrence-card">
                      {o.expected.type === 'ESTIMATED' ? (
                        <span data-testid="occurrence-card-estimated">{f.t('cardPayment.estimated')} · </span>
                      ) : null}
                      <a
                        href={href(
                          cardOf?.(o.definitionId)
                            ? cardHref(cardOf(o.definitionId)!.id)
                            : '/debts?vista=tarjetas',
                        )}
                      >
                        {cardOf?.(o.definitionId)
                          ? f.t('cardPayment.viewCard', { name: cardOf(o.definitionId)!.name })
                          : f.t('cardPayment.viewCards')}
                      </a>
                    </div>
                  ) : null}
                  {isLoanInstallment(o) ? (
                    <div style={mutedStyle} data-testid="occurrence-loan">
                      {f.t('loan.origin')}{' '}
                      {loanOf?.(o.definitionId) ? (
                        <a href={href(`/debts/${loanOf(o.definitionId)!.id}`)}>
                          {loanOf(o.definitionId)!.name}
                        </a>
                      ) : (
                        <a href={href('/debts')}>{f.t('loan.viewLoans')}</a>
                      )}
                    </div>
                  ) : null}
                </td>
                <td style={cellStyle}>{due}</td>
                <td style={cellStyle}>
                  {accountName(o.accountId) ?? '—'}
                  {o.toAccountId ? ` → ${accountName(o.toAccountId) ?? '—'}` : ''}
                </td>
                <td style={numCellStyle}>
                  <AmountText expected={o.expected} f={f} />
                </td>
                <td style={cellStyle}>
                  <OccurrenceStatusBadge status={o.status} f={f} />
                  {o.lastAutoCreateError ? (
                    <p
                      role="note"
                      style={{ ...mutedStyle, margin: 'var(--pf-space-1) 0 0', color: 'var(--pf-error)' }}
                      data-testid="auto-create-error"
                      data-error-code={o.lastAutoCreateError}
                    >
                      <span aria-hidden="true">⚠</span>{' '}
                      {f.t('autoCreateError', {
                        error: problemMessage({ code: o.lastAutoCreateError }, uiLocale),
                      })}
                    </p>
                  ) : null}
                </td>
                {withActions ? (
                  <td style={cellStyle}>
                    <div style={{ ...rowStyle, gap: 'var(--pf-space-1)' }}>
                      {canRegisterLoanPayment(o, canEdit) ? (
                        <a
                          href={href(
                            loanOf?.(o.definitionId)
                              ? paymentHref(loanOf(o.definitionId)!.id, { date: o.dueDate })
                              : '/debts',
                          )}
                          data-testid="occurrence-register-payment"
                          aria-label={f.t('loan.registerPaymentLabel', { name: o.definitionName, date: due })}
                        >
                          {f.t('loan.registerPayment')}
                        </a>
                      ) : null}
                      {actions.map((a) => (
                        <button
                          key={a}
                          type="button"
                          id={actionButtonId(o.id, a)}
                          data-action={a}
                          disabled={busyId === o.id}
                          aria-label={f.t(`actions.${a}Label`, { name: o.definitionName, date: due })}
                          onClick={() => onAction(a, o)}
                        >
                          {f.t(`actions.${a}`)}
                        </button>
                      ))}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
