import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import {
  cardStyle,
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import {
  excludedAmounts,
  filterError,
  type ConversionCostAnalysis,
  type ConversionCostGroup,
  type CostFilters,
} from './conversion-costs-logic';

const linkButton = {
  display: 'inline-block',
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  border: '1px solid var(--pf-border-strong)',
  borderRadius: 'var(--pf-radius-sm)',
  textDecoration: 'none',
  color: 'inherit',
} as const;

export interface ConversionCostsViewProps {
  readonly f: FormatContext;
  readonly draft: CostFilters;
  readonly onDraft: (next: CostFilters) => void;
  readonly onApply: () => void;
  /** `undefined` mientras carga. */
  readonly analysis: ConversionCostAnalysis | undefined;
  readonly exportHref: string;
  /** Mensaje de error de la API ya renderizado (p. ej. `ProblemMessage`). */
  readonly problem?: ReactNode;
  readonly fxHref: string;
}

/** `0,5833 %` (el porcentaje ya viene a 4 decimales HALF_EVEN de la API). */
const percent = (value: string | null, locale: string, empty: string): string =>
  value === null ? empty : `${formatDecimal(value, locale)} %`;

const channelName = (g: ConversionCostGroup, f: FormatContext): string =>
  g.channel.kind === 'NONE' ? f.t('channel.none') : (g.channel.name ?? f.t('channel.none'));

/**
 * Vista "Costo de conversiones" (US-183; docs/28): por periodo, canal (contraparte y par de cuentas) y par, el spread
 * promedio ponderado por el monto convertido y las comisiones en la moneda de reporte, con las conversiones excluidas
 * (sin referencia, sin tasa cotizada o sin tasa a la moneda de reporte) contadas aparte. Presentacional: los datos y los
 * filtros llegan por props (testeable con `renderToStaticMarkup`).
 */
export function ConversionCostsView(p: ConversionCostsViewProps) {
  const { f, analysis } = p;
  const error = filterError(p.draft);
  return (
    <section style={pageStyle} aria-labelledby="costs-title" data-testid="conversion-costs">
      <header>
        <h1 id="costs-title">{f.t('title')}</h1>
        <p style={mutedStyle}>{f.t('subtitle')}</p>
        <p>
          <a href={p.fxHref}>{f.t('backToFx')}</a>
        </p>
      </header>
      <form
        style={formStyle}
        aria-label={f.t('filters.title')}
        data-testid="costs-filters"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) p.onApply();
        }}
      >
        <div style={rowStyle}>
          <Field label={f.t('filters.from')} error={error ? f.t(`errors.${error}`) : undefined}>
            {(c) => (
              <input
                {...c}
                type="date"
                name="from"
                style={inputStyle}
                value={p.draft.from}
                onChange={(e) => p.onDraft({ ...p.draft, from: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('filters.to')}>
            {(c) => (
              <input
                {...c}
                type="date"
                name="to"
                style={inputStyle}
                value={p.draft.to}
                onChange={(e) => p.onDraft({ ...p.draft, to: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('filters.grouping')}>
            {(c) => (
              <select
                {...c}
                name="grouping"
                style={inputStyle}
                value={p.draft.grouping}
                onChange={(e) =>
                  p.onDraft({ ...p.draft, grouping: e.target.value as CostFilters['grouping'] })
                }
              >
                <option value="FINANCIAL_PERIOD">{f.t('grouping.FINANCIAL_PERIOD')}</option>
                <option value="CALENDAR_MONTH">{f.t('grouping.CALENDAR_MONTH')}</option>
              </select>
            )}
          </Field>
        </div>
        <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="compare"
            checked={p.draft.compare}
            onChange={(e) => p.onDraft({ ...p.draft, compare: e.target.checked })}
          />
          {f.t('filters.compare')}
        </label>
        <div style={rowStyle}>
          <button type="submit" disabled={error !== null}>
            {f.t('filters.apply')}
          </button>
          <a href={error ? undefined : p.exportHref} download data-testid="costs-export" style={linkButton}>
            {f.t('export')}
          </a>
        </div>
      </form>
      {p.problem}
      {analysis === undefined ? (
        <p aria-busy="true" data-testid="costs-loading">
          {f.t('loading')}
        </p>
      ) : (
        <Results f={f} analysis={analysis} />
      )}
    </section>
  );
}

function Results({ f, analysis }: { f: FormatContext; analysis: ConversionCostAnalysis }) {
  const { locale } = f;
  const money = (m: Money) => formatMoney(m, locale);
  if (analysis.groups.length === 0) {
    return (
      <p data-testid="costs-empty">
        {f.t('empty', {
          from: formatLocalDate(analysis.from, locale),
          to: formatLocalDate(analysis.to, locale),
        })}
      </p>
    );
  }
  const compare = analysis.groups.some((g) => g.alternative !== null);
  return (
    <>
      <p style={mutedStyle} data-testid="costs-range">
        {f.t('range', {
          from: formatLocalDate(analysis.from, locale),
          to: formatLocalDate(analysis.to, locale),
          currency: analysis.reportingCurrency,
        })}
      </p>
      {!analysis.totals.costComplete ? (
        <p role="note" style={warningStyle} data-testid="costs-incomplete">
          {f.t('incomplete')}
        </p>
      ) : null}
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('tableRegion')}>
        <table style={tableStyle} data-testid="costs-table">
          <caption
            style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}
          >
            {f.t('caption', { currency: analysis.reportingCurrency })}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('columns.period')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.channel')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.pair')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('columns.conversions')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('columns.converted')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('columns.spreadPct')}
              </th>
              {compare ? (
                <th scope="col" style={numCellStyle}>
                  {f.t('columns.alternative')}
                </th>
              ) : null}
              <th scope="col" style={numCellStyle}>
                {f.t('columns.spreadAmount')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('columns.fees')}
              </th>
              <th scope="col" style={numCellStyle}>
                {f.t('columns.costTotal')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.excluded')}
              </th>
            </tr>
          </thead>
          <tbody>
            {analysis.groups.map((g) => (
              <tr
                key={`${g.period.label}|${g.channel.kind}|${g.channel.counterpartyId ?? g.channel.name ?? ''}|${g.sourceAccountId}|${g.targetAccountId}|${g.pair.base}${g.pair.quote}`}
                data-testid="cost-row"
                data-channel={channelName(g, f)}
              >
                <td style={cellStyle}>{g.period.label}</td>
                <td style={cellStyle}>
                  <strong data-testid="cost-channel">{channelName(g, f)}</strong>
                  <br />
                  <span style={mutedStyle}>
                    {f.t('accounts', { source: g.sourceAccountName, target: g.targetAccountName })}
                  </span>
                </td>
                <td style={cellStyle}>{`${g.pair.base}/${g.pair.quote}`}</td>
                <td style={numCellStyle}>{g.conversions}</td>
                <td style={numCellStyle} data-testid="cost-converted">
                  {money(g.converted)}
                </td>
                <td style={numCellStyle} data-testid="cost-spread-pct">
                  {percent(g.spreadPct, locale, f.t('noValue'))}
                </td>
                {compare ? (
                  <td style={numCellStyle} data-testid="cost-alternative">
                    {g.alternative ? (
                      <>
                        {percent(g.alternative.spreadPct, locale, f.t('noValue'))}
                        {g.alternative.excludedCount > 0 ? (
                          <span style={mutedStyle}>
                            {' '}
                            {f.t('alternativeExcluded', { count: String(g.alternative.excludedCount) })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      f.t('noValue')
                    )}
                  </td>
                ) : null}
                <td style={numCellStyle}>{money(g.spreadAmount)}</td>
                <td style={numCellStyle}>{money(g.fees)}</td>
                <td style={numCellStyle} data-testid="cost-total">
                  {money(g.costTotal)}
                  {!g.costComplete ? (
                    <span style={mutedStyle} data-testid="cost-unvalued">
                      <br />
                      {f.t('unvaluedFees', { fees: excludedAmounts(g.unvaluedFees, money) })}
                    </span>
                  ) : null}
                </td>
                <td style={cellStyle}>
                  {g.excluded.length === 0 ? (
                    <span style={mutedStyle}>{f.t('noValue')}</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: '1rem' }} data-testid="cost-excluded">
                      {g.excluded.map((b) => (
                        <li key={b.reason} data-reason={b.reason}>
                          {f.t(`excluded.${b.reason}`, {
                            count: String(b.count),
                            amount: excludedAmounts(b.amounts, money),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-testid="cost-totals">
              <th scope="row" style={cellStyle} colSpan={3}>
                {f.t('totals')}
              </th>
              <td style={numCellStyle}>{analysis.totals.conversions}</td>
              <td style={numCellStyle}>{money(analysis.totals.converted)}</td>
              <td style={numCellStyle} />
              {compare ? <td style={numCellStyle} /> : null}
              <td style={numCellStyle}>{money(analysis.totals.spreadAmount)}</td>
              <td style={numCellStyle}>{money(analysis.totals.fees)}</td>
              <td style={numCellStyle}>{money(analysis.totals.costTotal)}</td>
              <td style={cellStyle}>
                {analysis.totals.excludedCount > 0
                  ? f.t('excludedTotal', { count: String(analysis.totals.excludedCount) })
                  : f.t('noValue')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <aside style={cardStyle}>
        <p style={{ margin: 0, ...mutedStyle }}>{f.t('method')}</p>
      </aside>
    </>
  );
}
