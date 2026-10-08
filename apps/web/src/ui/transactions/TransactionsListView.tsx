import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import type { Transaction } from '../common/types';
import { badgeStyle, mutedStyle } from '../common/ui';
import { displayValue, valuesOf, type CustomFieldDefinition } from '../custom-fields/logic';
import { amountFor } from './logic';
import type { NameResolver } from './TransactionTimeline';

/** Monto con signo explícito (+ ingreso / − salida, U+2212) y su sentido también en texto (no solo color). */
export function SignedAmount({
  tx,
  accountId,
  f,
}: {
  tx: Transaction;
  accountId?: string;
  f: FormatContext;
}) {
  const { money, direction } = amountFor(tx, accountId);
  const sign = direction === 'in' ? '+' : direction === 'out' ? '−' : '';
  return (
    <span data-testid="tx-amount" data-direction={direction}>
      {sign}
      {formatMoney(money, f.locale)}
      <span className="sr-only" style={{ position: 'absolute', left: '-10000px' }}>
        {' '}
        {f.t(`direction.${direction}`)}
      </span>
    </span>
  );
}

export function StatusBadge({ status, f }: { status: string; f: FormatContext }) {
  return (
    <span data-testid="tx-status" data-status={status} style={badgeStyle}>
      {f.t(`status.${status}`)}
    </span>
  );
}

/** Texto principal de una fila: descripción, contraparte o el tipo. */
export function describe(tx: Transaction, names: NameResolver, f: FormatContext): string {
  if (tx.description) return tx.description;
  if (tx.counterpartyId && names.counterparty(tx.counterpartyId))
    return names.counterparty(tx.counterpartyId)!;
  return f.t(`kinds.${tx.kind}`);
}

/**
 * Registro de transacciones (add-transaction-recording 6.2): una fila por transacción con fecha, descripción,
 * cuentas, categorías, monto con signo, estado y medio de pago; casillas para marcar como confirmadas en lote.
 * Lista (no tabla) para que en 360 px no haya scroll horizontal.
 */
export function TransactionsListView({
  transactions,
  names,
  f,
  href,
  accountId,
  selected,
  onToggle,
  selectable,
  customFields,
}: {
  transactions: readonly Transaction[];
  names: NameResolver;
  f: FormatContext;
  href: (path: string) => string;
  accountId?: string;
  selected: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  selectable: boolean;
  /** Definiciones (activas y archivadas) para mostrar los custom fields de los splits; `cf` es del namespace `CustomFields`. */
  customFields?: { readonly definitions: readonly CustomFieldDefinition[]; readonly cf: FormatContext };
}) {
  const { t, locale } = f;
  if (transactions.length === 0) return <p data-testid="transactions-empty">{t('list.empty')}</p>;
  return (
    <ul data-testid="transactions-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {transactions.map((tx) => {
        const accounts = [...new Set(tx.legs.map((l) => l.accountId))].map((id) => names.account(id) ?? '…');
        const categories = [...new Set(tx.splits.map((s) => names.category(s.categoryId) ?? ''))].filter(
          Boolean,
        );
        const canSelect = selectable && (tx.status === 'POSTED' || tx.status === 'CLEARED');
        const fieldTexts = customFields
          ? customFieldTexts(tx, customFields.definitions, customFields.cf)
          : [];
        const title = describe(tx, names, f);
        return (
          <li
            key={tx.id}
            data-testid="transaction-row"
            data-transaction-id={tx.id}
            data-status={tx.status}
            data-kind={tx.kind}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.25rem 0.75rem',
              alignItems: 'baseline',
              padding: '0.5rem 0',
              borderBottom: '1px solid #eaeef2',
              opacity: tx.status === 'VOIDED' ? 0.7 : 1,
            }}
          >
            {selectable ? (
              <input
                type="checkbox"
                aria-label={t('list.select', { name: title })}
                disabled={!canSelect}
                checked={selected.has(tx.id)}
                onChange={() => onToggle?.(tx.id)}
              />
            ) : null}
            <time dateTime={tx.transactionDate} style={{ ...mutedStyle, minWidth: '6rem' }}>
              {formatLocalDate(tx.transactionDate, locale)}
            </time>
            <a
              href={href(`/transacciones/${tx.id}`)}
              data-testid="tx-title"
              style={{ flex: '1 1 10rem', minWidth: 0 }}
            >
              {title}
            </a>
            <strong style={tx.status === 'VOIDED' ? { textDecoration: 'line-through' } : undefined}>
              <SignedAmount tx={tx} {...(accountId ? { accountId } : {})} f={f} />
            </strong>
            <StatusBadge status={tx.status} f={f} />
            <span style={{ ...mutedStyle, flexBasis: '100%' }}>
              {t(`kinds.${tx.kind}`)} · {accounts.join(' → ')}
              {categories.length ? ` · ${categories.join(', ')}` : ''}
              {tx.paymentMethod ? (
                <>
                  {' · '}
                  <span data-testid="tx-payment-method" data-method={tx.paymentMethod}>
                    {t(`paymentMethods.${tx.paymentMethod}`)}
                  </span>
                </>
              ) : null}
            </span>
            {fieldTexts.length > 0 ? (
              <span style={{ ...mutedStyle, flexBasis: '100%' }} data-testid="tx-custom-fields">
                {fieldTexts.join(' · ')}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** "Centro de costo: Oficina" por cada valor distinto de los splits (opcional en el registro). */
export function customFieldTexts(
  tx: Transaction,
  definitions: readonly CustomFieldDefinition[],
  cf: FormatContext,
): string[] {
  const labels = {
    yes: cf.t('yes'),
    no: cf.t('no'),
    date: (iso: string) => formatLocalDate(iso, cf.locale),
  };
  const out = new Set<string>();
  for (const s of tx.splits) {
    for (const { def, key, value } of valuesOf(definitions, s.customFields)) {
      out.add(`${def?.label ?? key}: ${displayValue(def, value, labels)}`);
    }
  }
  return [...out];
}
