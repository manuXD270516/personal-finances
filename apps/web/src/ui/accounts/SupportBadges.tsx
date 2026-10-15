import type { InstitutionCatalogRef, SupportByDimension } from '../common/types';
import { badgeStyle, mutedStyle } from '../common/ui';
import { formatLocalDate } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { catalogStanding, supportLabelKey, supportTone } from './catalog-logic';

/** Insignia que puede partirse en varias líneas: los textos de soporte con razón son largos y en móvil no caben en una. */
export const wrapBadgeStyle = {
  ...badgeStyle,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  minWidth: 0,
} as const;

const TONE_STYLE = {
  ok: { borderColor: 'var(--pf-success-border, var(--pf-border-strong))' },
  pending: { borderColor: 'var(--pf-warning-border, var(--pf-border-strong))' },
  neutral: {},
} as const;

/**
 * Estado de soporte de una entrada por dimensión (tasas de cambio e importación de extractos). El estado siempre se
 * dice con texto (no solo con color) y `NOT_ELIGIBLE` muestra su razón: nunca se presenta como soportada.
 */
export function SupportBadges({ support, f }: { support: SupportByDimension; f: FormatContext }) {
  const dims = [
    ['rates', support.rates],
    ['statementImport', support.statementImport],
  ] as const;
  return (
    <ul
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}
      aria-label={f.t('support.title')}
      data-testid="support-badges"
    >
      {dims.map(([dim, s]) => (
        <li
          key={dim}
          style={{ ...wrapBadgeStyle, ...TONE_STYLE[supportTone(s)] }}
          data-testid={`support-${dim}`}
          data-state={s.status}
        >
          {f.t(`support.dimensions.${dim}`)}: {f.t(supportLabelKey(s, f.has))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pie de una institución adoptada: aviso si ya no figura en el registro oficial (con la fecha de baja) o en el
 * catálogo de esta instalación, y el soporte vigente. Sin aviso para las que siguen vigentes.
 */
export function CatalogStanding({ catalogRef, f }: { catalogRef: InstitutionCatalogRef; f: FormatContext }) {
  const standing = catalogStanding(catalogRef);
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }} data-testid="catalog-standing" data-standing={standing}>
      <span style={mutedStyle}>
        {f.t('catalog.adoptedFrom', { code: catalogRef.code, version: catalogRef.catalogVersion })}
      </span>
      {standing === 'DELISTED' ? (
        <span role="note" style={wrapBadgeStyle} data-testid="delisted-notice">
          {catalogRef.delistedSince
            ? f.t('catalog.delistedSince', { date: formatLocalDate(catalogRef.delistedSince, f.locale) })
            : f.t('catalog.delisted')}
        </span>
      ) : null}
      {standing === 'NOT_IN_CATALOG' ? (
        <span role="note" style={wrapBadgeStyle} data-testid="not-in-catalog-notice">
          {f.t('catalog.notInCatalog')}
        </span>
      ) : null}
      {catalogRef.support ? <SupportBadges support={catalogRef.support} f={f} /> : null}
    </div>
  );
}
