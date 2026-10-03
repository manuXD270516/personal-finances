import { formatInstant, formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import type { AuditLogEntry, Money } from '../common/types';
import { badgeStyle, cardStyle, cellStyle, mutedStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { buildTimeline, statusAfterEach } from './logic';

/** Resolución de ids a nombres legibles (cuentas, categorías, contrapartes, tags). */
export interface NameResolver {
  readonly account: (id: string) => string | undefined;
  readonly category: (id: string) => string | undefined;
  readonly counterparty: (id: string) => string | undefined;
  readonly tag: (id: string) => string | undefined;
}

const isMoney = (v: unknown): v is Money =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Money).amount === 'string' &&
  typeof (v as Money).currency === 'string';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Valor de un cambio del historial, legible: montos es-BO, fechas, nombres en lugar de ids y splits resumidos. */
export function formatChangeValue(
  field: string,
  value: unknown,
  ctx: FormatContext,
  names: NameResolver,
): string {
  const { t, has, locale } = ctx;
  if (value === null || value === undefined || value === '') return t('history.none');
  if (isMoney(value)) return formatMoney(value, locale);
  if (field === 'splits' && typeof value === 'string') {
    try {
      const splits = JSON.parse(value) as { amount: Money; categoryId: string }[];
      return splits
        .map(
          (s) =>
            `${names.category(s.categoryId) ?? t('history.unknownCategory')}: ${formatMoney(s.amount, locale)}`,
        )
        .join(' · ');
    } catch {
      return value;
    }
  }
  if (typeof value === 'string') {
    if (
      (field === 'accountId' || field === 'toAccountId' || field === 'fromAccountId') &&
      names.account(value)
    )
      return names.account(value)!;
    if (field === 'counterpartyId') return names.counterparty(value) ?? value;
    if (field === 'categoryId') return names.category(value) ?? value;
    if (field === 'paymentMethod' && has(`paymentMethods.${value}`)) return t(`paymentMethods.${value}`);
    if (field === 'kind' && has(`kinds.${value}`)) return t(`kinds.${value}`);
    if (field === 'adjustmentDirection' && has(`direction.${value}`)) return t(`direction.${value}`);
    if (DATE.test(value)) return formatLocalDate(value, locale);
    return value;
  }
  if (typeof value === 'boolean') return value ? t('history.yes') : t('history.no');
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

const statusLabel = (status: string | null, ctx: FormatContext): string =>
  status === null ? ctx.t('history.none') : ctx.has(`status.${status}`) ? ctx.t(`status.${status}`) : status;

/**
 * Historial de la transacción como línea de tiempo de su ciclo de vida (FR-TRANSACTIONS-014; visible para VIEWER,
 * D28): cada entrada muestra la transición de estado (estado → estado), la revisión contable cuando hubo reversa y
 * nuevo asiento, quién, cuándo (zona del workspace), por qué y el diff de los campos de negocio.
 */
export function TransactionTimeline({
  entries,
  ctx,
  names,
  currentUserId,
}: {
  entries: readonly AuditLogEntry[];
  ctx: FormatContext;
  names: NameResolver;
  currentUserId?: string;
}) {
  const { t, has, locale, timeZone } = ctx;
  const items = buildTimeline(entries);
  const statusAfter = statusAfterEach(items);
  const actorOf = (a: AuditLogEntry['actor']) =>
    a.type === 'USER'
      ? a.userId === currentUserId
        ? t('history.actor.you')
        : t('history.actor.user', { id: (a.userId ?? '').slice(-8) })
      : t('history.actor.system', { process: a.process ?? '' });
  const actionLabel = (action: string) => {
    const key = `history.actions.${action.replaceAll('.', '_')}`;
    return has(key) ? t(key) : action;
  };
  const fieldLabel = (field: string) =>
    has(`history.fields.${field}`) ? t(`history.fields.${field}`) : field;

  return (
    <section aria-labelledby="tx-history-title" data-testid="transaction-history" style={cardStyle}>
      <h2 id="tx-history-title" style={{ fontSize: '1.1rem', marginTop: 0 }}>
        {t('history.title')}
      </h2>
      <p style={mutedStyle}>{t('history.subtitle')}</p>
      {items.length === 0 ? (
        <p>{t('history.empty')}</p>
      ) : (
        <ol data-testid="timeline" style={{ paddingLeft: '1.25rem', display: 'grid', gap: '0.75rem' }}>
          {items.map((item, idx) => (
            <li
              key={item.id}
              data-testid="timeline-entry"
              data-action={item.action}
              data-from={item.transition?.from ?? ''}
              data-to={item.transition?.to ?? statusAfter[idx] ?? ''}
            >
              <p style={{ margin: 0 }}>
                <strong>{actionLabel(item.action)}</strong>
              </p>
              <p style={{ margin: '0.25rem 0' }} data-testid="timeline-transition">
                {item.transition ? (
                  <>
                    <span style={badgeStyle}>{statusLabel(item.transition.from, ctx)}</span> →{' '}
                    <span style={badgeStyle}>{statusLabel(item.transition.to, ctx)}</span>
                  </>
                ) : (
                  <span style={mutedStyle}>
                    {t('history.sameStatus', { status: statusLabel(statusAfter[idx] ?? null, ctx) })}
                  </span>
                )}
              </p>
              {item.revision ? (
                <p style={{ margin: '0.25rem 0' }} data-testid="timeline-revision">
                  {t('history.revision', { from: String(item.revision.from), to: String(item.revision.to) })}
                </p>
              ) : null}
              <p style={{ ...mutedStyle, margin: '0.25rem 0' }} data-testid="timeline-who">
                {actorOf(item.actor)} ·{' '}
                <time dateTime={item.at}>{formatInstant(item.at, locale, timeZone)}</time>
              </p>
              {item.related.length > 0 ? (
                <p style={{ ...mutedStyle, margin: '0.25rem 0' }} data-testid="timeline-ledger">
                  {t('history.ledgerEffect', {
                    actions: item.related.map((r) => actionLabel(r.action)).join(' · '),
                  })}
                </p>
              ) : null}
              {item.reason ? (
                <p style={{ margin: '0.25rem 0' }} data-testid="timeline-reason">
                  {t('history.reason', { reason: item.reason })}
                </p>
              ) : null}
              {item.changes.length > 0 ? (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <caption style={{ ...mutedStyle, textAlign: 'left' }}>
                      {t('history.changesCaption')}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" style={cellStyle}>
                          {t('history.field')}
                        </th>
                        <th scope="col" style={cellStyle}>
                          {t('history.before')}
                        </th>
                        <th scope="col" style={cellStyle}>
                          {t('history.after')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.changes.map((c) => (
                        <tr key={c.field} data-field={c.field}>
                          <th scope="row" style={cellStyle}>
                            {fieldLabel(c.field)}
                          </th>
                          <td style={cellStyle}>{formatChangeValue(c.field, c.before, ctx, names)}</td>
                          <td style={cellStyle}>{formatChangeValue(c.field, c.after, ctx, names)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
