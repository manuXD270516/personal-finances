import type { CSSProperties } from 'react';
import { badgeStyle, cardStyle, mutedStyle } from '../common/ui';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import {
  detailHref,
  hasObservations,
  itemHref,
  sortedItems,
  toneOf,
  TONE_ICON,
  type CloseChecklistItem,
  type ItemTone,
} from './closing-logic';
import { formatBusinessDate } from './logic';

const toneStyle: Readonly<Record<ItemTone, CSSProperties>> = {
  BLOCKING: {
    borderColor: 'var(--pf-error)',
    background: 'var(--pf-surface-raised)',
    color: 'var(--pf-error)',
  },
  WARNING: {
    borderColor: 'var(--pf-warning-border)',
    background: 'var(--pf-warning-bg)',
    color: 'var(--pf-warning-fg)',
  },
  INFO: {},
  NOT_AVAILABLE: {},
};

/**
 * Checklist de cierre (openspec add-month-closing 6.1): un bloque por ítem con su severidad en TEXTO e icono (no solo
 * color), el conteo, los montos por moneda (nunca convertidos) y el detalle con enlaces a las transacciones y cuentas.
 * El ítem informativo "conciliada sin extracto" se lista como pendiente de revisión, sin bloquear ni pedir
 * reconocimiento (D111). Un ítem NO DISPONIBLE (recurrentes hasta Phase 3) se muestra como tal. Presentacional.
 */
export function ClosingChecklistView({
  items,
  f,
  href,
  titleId,
  testId = 'close-checklist',
}: {
  items: readonly CloseChecklistItem[];
  f: FormatContext;
  /** Ruta localizada de la app (`/transacciones/{id}` → `/es/transacciones/{id}`). */
  href: (path: string) => string;
  titleId?: string;
  testId?: string;
}) {
  return (
    <ul
      aria-labelledby={titleId}
      data-testid={testId}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-3)' }}
    >
      {sortedItems(items).map((item) => (
        <ItemBlock key={item.kind} item={item} f={f} href={href} />
      ))}
    </ul>
  );
}

function ItemBlock({
  item,
  f,
  href,
}: {
  item: CloseChecklistItem;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const tone = toneOf(item);
  const observed = hasObservations(item);
  const listHref = observed ? itemHref(item.kind, href) : null;
  const kindLabel = f.t(`kinds.${item.kind}`);
  return (
    <li
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      data-testid="checklist-item"
      data-kind={item.kind}
      data-tone={tone}
      data-count={item.count}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--pf-text-base)' }}>{kindLabel}</h3>
        <span style={{ ...badgeStyle, ...toneStyle[tone] }} data-testid="checklist-tone">
          <span aria-hidden="true">{TONE_ICON[tone]}</span> {f.t(`tone.${tone}`)}
        </span>
      </div>
      {tone === 'NOT_AVAILABLE' ? (
        <p style={{ ...mutedStyle, margin: 0 }} data-testid="checklist-not-available">
          {f.t('notAvailable')}
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }} data-testid="checklist-count">
            {observed ? f.t('count', { count: item.count }) : f.t('noObservations')}
          </p>
          {observed && item.amounts.length > 0 ? (
            <p style={{ ...mutedStyle, margin: 0 }} data-testid="checklist-amounts">
              {f.t('amounts', { amounts: item.amounts.map((m) => formatMoney(m, f.locale)).join(' · ') })}
            </p>
          ) : null}
          {observed && item.kind === 'RECONCILED_WITHOUT_STATEMENT' ? (
            <p style={{ ...mutedStyle, margin: 0 }} data-testid="checklist-info-hint">
              {f.t('withoutStatementHint')}
            </p>
          ) : null}
          {observed && item.details.length > 0 ? (
            <ul
              aria-label={f.t('detailLabel', { kind: kindLabel })}
              style={{
                margin: 0,
                paddingLeft: 'var(--pf-space-4)',
                display: 'grid',
                gap: 'var(--pf-space-1)',
              }}
            >
              {item.details.map((d) => {
                const link = detailHref(d, href);
                return (
                  <li
                    key={`${d.refType}-${d.refId}`}
                    data-testid="checklist-detail"
                    data-ref-type={d.refType}
                  >
                    {link ? <a href={link}>{d.label}</a> : <span>{d.label}</span>}
                    {d.date ? <span style={mutedStyle}> · {formatBusinessDate(d.date)}</span> : null}
                    {d.amount ? (
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {' · '}
                        {formatMoney(d.amount, f.locale)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {observed && item.truncated ? (
            <p style={{ ...mutedStyle, margin: 0 }} data-testid="checklist-truncated">
              {f.t('truncated', { shown: item.details.length, total: item.count })}
            </p>
          ) : null}
          {listHref ? (
            <p style={{ margin: 0 }}>
              <a href={listHref} data-testid="checklist-item-link">
                {f.t('reviewAll', { kind: kindLabel })}
              </a>
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}
