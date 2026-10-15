import { cardStyle, cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import { formatLocalDate } from '../dashboard/format';
import type { InstitutionCatalogData } from './catalog-logic';
import { categoryLabel } from './CatalogView';

const pct = (v: string, locale: string): string => `${formatDecimal(v, locale)} %`;

/**
 * Panel de cobertura de soporte (Configuración): del censo oficial por categoría y del estado por dimensión. Las
 * entidades "no elegibles" se informan aparte, por razón, para no contarlas como soportadas. Dice "completo" solo
 * con el censo al 100 % y ninguna entrada vigente pendiente (design.md decisión 6).
 */
export function CoverageView({ catalog, f }: { catalog: InstitutionCatalogData; f: FormatContext }) {
  const c = catalog.coverage;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="coverage">
      <p style={mutedStyle}>
        {f.t('coverage.source', {
          name: catalog.source.name,
          cutoff: formatLocalDate(catalog.source.cutoffDate, f.locale),
          version: catalog.catalogVersion,
        })}
      </p>
      {catalog.fictitious ? (
        <p role="note" data-testid="coverage-fictitious" style={mutedStyle}>
          {f.t('catalog.fictitious')}
        </p>
      ) : null}
      <p data-testid="coverage-summary">
        <strong>{c.complete ? f.t('coverage.complete') : f.t('coverage.incomplete')}</strong>{' '}
        {f.t('coverage.census', { pct: pct(c.censusCoveragePct, f.locale) })}
      </p>

      <h3 style={{ margin: 0, fontSize: '0.9375rem' }}>{f.t('coverage.byCategory')}</h3>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('catalog.category')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('coverage.census_')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('coverage.entries')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('coverage.coveragePct')}
              </th>
            </tr>
          </thead>
          <tbody>
            {c.byCategory.map((r) => (
              <tr key={r.category} data-testid="coverage-category" data-category={r.category}>
                <td style={cellStyle}>{categoryLabel(f, r.category)}</td>
                <td style={numCellStyle}>{r.census}</td>
                <td style={numCellStyle}>{r.entries}</td>
                <td style={numCellStyle}>{pct(r.censusCoveragePct, f.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
        {c.byDimension.map((d) => (
          <section
            key={d.dimension}
            style={cardStyle}
            data-testid="coverage-dimension"
            data-dimension={d.dimension}
            aria-label={f.t(`support.dimensions.${d.dimension}`)}
          >
            <h3 style={{ margin: 0, fontSize: '0.9375rem' }}>{f.t(`support.dimensions.${d.dimension}`)}</h3>
            <p data-testid="coverage-resolved">
              {f.t('coverage.resolved', {
                resolved: d.resolved,
                pending: d.pending,
                pct: pct(d.resolvedPct, f.locale),
              })}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {d.byStatus.map((s) => (
                <li
                  key={`${s.status}|${s.reason ?? ''}`}
                  data-testid="coverage-status"
                  data-status={s.status}
                >
                  {f.has(`support.states.${s.status}`) ? f.t(`support.states.${s.status}`) : s.status}
                  {s.reason
                    ? ` (${f.has(`support.reasons.${s.reason}`) ? f.t(`support.reasons.${s.reason}`) : s.reason})`
                    : ''}
                  : {s.count}
                </li>
              ))}
            </ul>
            {d.notEligible.length > 0 ? (
              <p style={mutedStyle} data-testid="coverage-not-eligible">
                {f.t('coverage.notEligibleApart')}{' '}
                {d.notEligible
                  .map(
                    (n) =>
                      `${f.has(`support.reasons.${n.reason}`) ? f.t(`support.reasons.${n.reason}`) : n.reason}: ${n.count}`,
                  )
                  .join(' · ')}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
