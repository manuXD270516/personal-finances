import { mutedStyle, rowStyle } from '../../common/ui';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext, Money } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import { cardHref, type PaymentSuggestions } from './logic';
import { StatementStatusBadge } from './parts';

/**
 * Pago de tarjeta en el formulario de transferencia (docs/28 §4.2): rótulo "Pago de tarjeta", enlace al estado de cuenta y
 * las sugerencias "Total para no generar intereses" y "Pago mínimo" del último estado emitido. Si la moneda del origen
 * difiere de la de la tarjeta no se convierte aquí: la sugerencia enlaza al flujo de conversión (sin monto: el sugerido está en la moneda de la tarjeta).
 */
export function CardPaymentHint({
  suggestions,
  f,
  href,
  mismatch,
  onPick,
  conversionLink,
}: {
  suggestions: PaymentSuggestions;
  f: FormatContext;
  href: (path: string) => string;
  /** Las monedas del origen y del destino difieren: se enlaza a la conversión en lugar de rellenar el monto. */
  mismatch: boolean;
  onPick: (amount: string) => void;
  /** Conversión prellenada con origen y destino (el monto sugerido está en la moneda de la tarjeta, no en la del origen). */
  conversionLink: string;
}) {
  const options: { key: 'noInterest' | 'minimum'; money: Money }[] = [];
  if (suggestions.noInterest) options.push({ key: 'noInterest', money: suggestions.noInterest });
  if (suggestions.minimum) options.push({ key: 'minimum', money: suggestions.minimum });
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-1)' }} data-testid="card-payment-hint">
      <p style={{ margin: 0 }}>
        <strong data-testid="card-payment-label">{f.t('transfer.label')}</strong> · {suggestions.cardName}{' '}
        <a
          href={href(cardHref(suggestions.cardId, suggestions.statementId ?? undefined))}
          data-testid="card-payment-link"
        >
          {f.t('transfer.viewStatement')}
        </a>
      </p>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {f.t('transfer.statementInfo', { due: formatBusinessDate(suggestions.dueDate) })}{' '}
        <StatementStatusBadge status={suggestions.status} f={f} />
      </p>
      {options.length === 0 ? (
        <p style={{ margin: 0 }} data-testid="card-payment-nothing">
          {f.t('transfer.nothingMissing')}
        </p>
      ) : (
        <ul style={{ ...rowStyle, listStyle: 'none', padding: 0, margin: 0 }}>
          {options.map(({ key, money }) => (
            <li key={key}>
              {mismatch ? (
                <a href={conversionLink} data-testid={`card-suggest-${key}`}>
                  {f.t(`transfer.${key}Convert`, { amount: formatMoney(money, f.locale) })}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => onPick(money.amount)}
                  data-testid={`card-suggest-${key}`}
                >
                  {f.t(`transfer.${key}`, { amount: formatMoney(money, f.locale) })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
