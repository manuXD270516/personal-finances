import { badgeStyle, cardStyle, Field, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { formatLocalDate } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import {
  categoriesOf,
  filterEntries,
  isSelectable,
  type AdoptionConflict,
  type CatalogFilters,
  type InstitutionCatalogData,
} from './catalog-logic';
import { SupportBadges } from './SupportBadges';

export interface CatalogViewProps {
  readonly catalog: InstitutionCatalogData;
  readonly f: FormatContext;
  readonly filters: CatalogFilters;
  readonly selected: ReadonlySet<string>;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly conflicts: readonly AdoptionConflict[];
  /** Nombre de la institución existente que ocupa el nombre de una entrada en conflicto. */
  readonly nameOfInstitution: (id: string) => string;
  readonly onFilters: (next: CatalogFilters) => void;
  readonly onToggle: (code: string) => void;
  readonly onAdopt: () => void;
  readonly onLink: (conflict: AdoptionConflict) => void;
}

/**
 * Catálogo de referencia de entidades del país (FR-ACCOUNTS-012): búsqueda, filtro por categoría, fuente con su
 * fecha de corte y versión, estado de soporte por dimensión y selección múltiple para adoptar. Las dadas de baja y las
 * casas de cambio (que nadie usa como cuenta) se muestran pero no se pueden seleccionar.
 */
export function CatalogView(p: CatalogViewProps) {
  const { catalog, f, filters } = p;
  const rows = filterEntries(catalog.entries, filters);
  const nameOfCode = (code: string) => catalog.entries.find((e) => e.code === code)?.name ?? code;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="institution-catalog">
      {catalog.fictitious ? (
        <p role="note" style={warningStyle} data-testid="catalog-fictitious">
          {f.t('catalog.fictitious')}
        </p>
      ) : null}
      <p style={mutedStyle} data-testid="catalog-source">
        {f.t('catalog.source', {
          name: catalog.source.name,
          cutoff: formatLocalDate(catalog.source.cutoffDate, f.locale),
          version: catalog.catalogVersion,
        })}
        {catalog.source.url ? (
          <>
            {' '}
            <a href={catalog.source.url} rel="noopener noreferrer" target="_blank">
              {f.t('catalog.sourceLink')}
            </a>
          </>
        ) : null}
      </p>
      <div style={rowStyle}>
        <Field label={f.t('catalog.search')}>
          {(props) => (
            <input
              {...props}
              type="search"
              name="catalog-search"
              style={inputStyle}
              value={filters.query}
              onChange={(e) => p.onFilters({ ...filters, query: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('catalog.category')}>
          {(props) => (
            <select
              {...props}
              name="catalog-category"
              style={inputStyle}
              value={filters.category}
              onChange={(e) => p.onFilters({ ...filters, category: e.target.value })}
            >
              <option value="">{f.t('catalog.allCategories')}</option>
              {categoriesOf(catalog.entries).map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(f, c)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {p.conflicts.length > 0 ? (
        <div role="alert" style={warningStyle} data-testid="catalog-conflicts">
          <strong>{f.t('catalog.conflictsTitle')}</strong>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {p.conflicts.map((c) => (
              <li key={c.code} data-testid="catalog-conflict" data-code={c.code}>
                {f.t('catalog.nameTaken', {
                  entry: nameOfCode(c.code),
                  name: p.nameOfInstitution(c.institutionId),
                })}{' '}
                {p.canEdit ? (
                  <button type="button" disabled={p.busy} onClick={() => p.onLink(c)}>
                    {f.t('catalog.linkExisting')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length === 0 ? <p>{f.t('catalog.noResults')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
        {rows.map((e) => {
          const selectable = isSelectable(e);
          const inputId = `catalog-${e.code}`;
          return (
            <li
              key={e.code}
              style={cardStyle}
              data-testid="catalog-entry"
              data-code={e.code}
              data-listing={e.listingStatus}
            >
              <div style={{ ...rowStyle, alignItems: 'center' }}>
                {p.canEdit ? (
                  <input
                    id={inputId}
                    type="checkbox"
                    disabled={!selectable || p.busy}
                    checked={p.selected.has(e.code)}
                    onChange={() => p.onToggle(e.code)}
                    aria-label={f.t('catalog.select', { name: e.name })}
                  />
                ) : null}
                <label htmlFor={inputId}>
                  <strong>{e.name}</strong>
                </label>
                <span style={mutedStyle}>
                  {e.code} · {categoryLabel(f, e.category)}
                </span>
                {e.adoptedInstitutionId ? (
                  <span style={badgeStyle} data-testid="catalog-adopted">
                    {f.t('catalog.adopted')}
                  </span>
                ) : null}
                {e.listingStatus === 'DELISTED' ? (
                  <span style={badgeStyle} data-testid="catalog-delisted">
                    {e.delistedSince
                      ? f.t('catalog.delistedSince', { date: formatLocalDate(e.delistedSince, f.locale) })
                      : f.t('catalog.delisted')}
                  </span>
                ) : null}
                {!e.adoptable ? (
                  <span
                    style={badgeStyle}
                    data-testid="catalog-not-adoptable"
                    title={f.t('catalog.notAdoptableHint')}
                  >
                    {f.t('catalog.notAdoptable')}
                  </span>
                ) : null}
                {e.verification === 'PENDING' ? (
                  <span style={badgeStyle} data-testid="catalog-pending-verification">
                    {f.t('catalog.verificationPending')}
                  </span>
                ) : null}
              </div>
              {e.legalName && e.legalName !== e.name ? <p style={mutedStyle}>{e.legalName}</p> : null}
              <SupportBadges support={e.support} f={f} />
            </li>
          );
        })}
      </ul>
      {p.canEdit ? (
        <div>
          <button type="button" disabled={p.busy || p.selected.size === 0} onClick={p.onAdopt}>
            {f.t('catalog.adoptSelected', { count: p.selected.size })}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Etiqueta de una categoría del catálogo; si es desconocida (conjunto abierto) se muestra el código. */
export const categoryLabel = (f: FormatContext, category: string): string =>
  f.has(`catalog.categories.${category}`) ? f.t(`catalog.categories.${category}`) : category;
