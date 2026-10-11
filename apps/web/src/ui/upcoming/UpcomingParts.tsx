import { formatMoney, formatLocalDate } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import { periodName } from '../planning/logic';
import { cardHref, cardPaymentName, looksLikeCardPayment } from '../debt/cards/logic';
import { itemPath, joinMoney, statusLabel, statusPresentation } from './logic';
import type { CommittedBlock, UpcomingPaymentItem } from './types';

/** Estado de un pago: glifo decorativo, tono y texto (el significado nunca depende solo del color). */
export function StatusBadge({ item, f }: { item: UpcomingPaymentItem; f: FormatContext }) {
  const { icon, tone } = statusPresentation(item.status);
  return (
    <span className="pf-upc-badge" data-tone={tone} data-status={item.status} data-testid="upcoming-status">
      <span aria-hidden="true">{icon}</span>
      {statusLabel(item, f)}
    </span>
  );
}

/** Resuelve la tarjeta de un pago próximo a partir de la definición de su plan de pago. */
export type CardOf = (definitionId: string) => { readonly id: string; readonly name: string } | undefined;

/**
 * Nombre de un pago próximo. Los pagos del plan de una tarjeta se rotulan "Pago de tarjeta · <nombre>" con la marca de
 * estimado y un enlace a la tarjeta (los ítems no traen el tipo recurrente: se reconocen por la definición del plan o,
 * si aún no cargó la lista de tarjetas, por el prefijo del nombre que fija Deuda).
 */
export function ItemName({
  item,
  f,
  href,
  cardOf,
}: {
  item: UpcomingPaymentItem;
  f: FormatContext;
  href: (path: string) => string;
  cardOf?: CardOf | undefined;
}) {
  const card = item.definitionId ? cardOf?.(item.definitionId) : undefined;
  const isCard = card !== undefined || looksLikeCardPayment(item.name);
  if (!isCard) return <a href={href(itemPath(item))}>{item.name}</a>;
  const name = card?.name ?? cardPaymentName(item.name);
  return (
    <>
      <a href={href(itemPath(item))} data-testid="card-payment-item">
        {f.t('cardPayment.label', { name })}
      </a>
      {item.estimated ? (
        <>
          <br />
          <span className="pf-home-muted" data-testid="card-payment-estimated">
            {f.t('cardPayment.estimated')}
          </span>
        </>
      ) : null}
      {card ? (
        <>
          <br />
          <a href={href(cardHref(card.id))} className="pf-home-muted" data-testid="card-payment-link">
            {f.t('cardPayment.viewCard')}
          </a>
        </>
      ) : null}
    </>
  );
}

/** Aviso de total incompleto: lo que no tiene tasa vigente se lista sin convertir y nunca se asume 1:1. */
export function IncompleteNote({
  complete,
  unconverted,
  f,
  testId,
}: {
  complete: boolean;
  unconverted: readonly Money[];
  f: FormatContext;
  testId: string;
}) {
  if (complete) return null;
  return (
    <div role="note" className="pf-home-warning" data-testid={testId}>
      <strong>
        <span aria-hidden="true">⚠</span> {f.t('incomplete')}
      </strong>
      <p style={{ margin: 0 }}>{f.t('unconverted', { amounts: joinMoney(unconverted, f.locale) })}</p>
    </div>
  );
}

/** Origen de una pendiente que nació de un compromiso (se cuenta una sola vez, con su monto real). */
export const fromCommitment = (item: UpcomingPaymentItem): boolean =>
  item.kind === 'PENDING_TRANSACTION' && item.occurrenceId !== undefined;

/**
 * Tarjeta del total comprometido del periodo (Q4, FR-COMMITMENTS-011): consolidado en la moneda de reporte con la
 * valoración de los próximos pagos, desglose compromisos / pendientes, pagos sin monto y, aparte, lo vencido de
 * periodos anteriores (no suma al total).
 */
export function CommittedSummary({
  committed,
  f,
  compact,
}: {
  committed: CommittedBlock;
  f: FormatContext;
  compact?: boolean;
}) {
  const { total } = committed;
  return (
    <div data-testid="committed" data-complete={total.consolidated.complete ? 'true' : 'false'}>
      <p className="pf-home-muted" style={{ margin: 0 }} data-testid="committed-period">
        {f.t('committed.period', {
          name: periodName(committed.label, f.locale),
          from: formatLocalDate(committed.from, f.locale),
          to: formatLocalDate(committed.to, f.locale),
        })}
      </p>
      <p className="pf-home-amount" data-testid="committed-total" style={{ margin: '0.25rem 0' }}>
        {formatMoney(total.consolidated.amount, f.locale)}
      </p>
      <IncompleteNote
        complete={total.consolidated.complete}
        unconverted={total.consolidated.unconverted}
        f={f}
        testId="committed-incomplete"
      />
      {!compact ? (
        <p className="pf-home-muted" style={{ margin: 0 }} data-testid="committed-breakdown">
          {f.t('committed.breakdown', {
            commitments: formatMoney(committed.fromCommitments.consolidated.amount, f.locale),
            pending: formatMoney(committed.fromPending.consolidated.amount, f.locale),
          })}
        </p>
      ) : null}
      {total.byCurrency.length > 1 ? (
        <p className="pf-home-muted" style={{ margin: 0 }} data-testid="committed-by-currency">
          {f.t('committed.byCurrency', { amounts: joinMoney(total.byCurrency, f.locale) })}
        </p>
      ) : null}
      {committed.withoutAmountCount > 0 ? (
        <p style={{ margin: 0 }} data-testid="committed-without-amount">
          <span aria-hidden="true">ℹ</span> {f.t('withoutAmount', { count: committed.withoutAmountCount })}
        </p>
      ) : null}
      {committed.overdueFromPreviousPeriods.count > 0 ? (
        <p style={{ margin: 0 }} data-testid="committed-overdue-previous">
          <span aria-hidden="true">▲</span>{' '}
          {f.t('committed.overduePrevious', {
            count: committed.overdueFromPreviousPeriods.count,
            amount: formatMoney(committed.overdueFromPreviousPeriods.consolidated.amount, f.locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
