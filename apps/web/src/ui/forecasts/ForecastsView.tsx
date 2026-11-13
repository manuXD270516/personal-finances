import { formatInstant, formatLocalDate } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { ForecastChart } from './ForecastChart';
import {
  FORECAST_HORIZONS,
  formatForecastMoney,
  formatPeriod,
  formatSigned,
  hasReason,
  missingPeriods,
  pickSeries,
  pointsUpTo,
  seriesKey,
  sortSeries,
  type ForecastHorizon,
} from './logic';
import { FORECASTS_CSS } from './styles';
import type {
  ForecastConfidence,
  ForecastDriver,
  ForecastKnownItem,
  ForecastKnownItems,
  ForecastPoint,
  ForecastSeries,
  LatestForecast,
} from './types';

export interface ForecastsViewProps {
  readonly latest: LatestForecast;
  readonly selection: { readonly horizon: ForecastHorizon; readonly series: string | undefined };
  /** Periodo cuyo detalle se muestra; por omisión el primero del horizonte. */
  readonly selectedPeriod: string | undefined;
  /** Conocidos del periodo elegido de la serie elegida (`undefined` mientras se leen). */
  readonly known: ForecastKnownItems | undefined;
  /** Textos del namespace `Forecasts` y formato del workspace. */
  readonly f: FormatContext;
  /** Solo OWNER y EDITOR piden una corrida (la API decide; la UI oculta el botón). */
  readonly canRun: boolean;
  /** Estado de la solicitud de corrida en la UI. */
  readonly run: 'idle' | 'requesting' | 'pending' | 'failed';
  readonly onSelect: (next: { horizon?: ForecastHorizon; series?: string }) => void;
  readonly onSelectPeriod: (period: string) => void;
  readonly onRun: () => void;
  readonly href: (path: string) => string;
}

const CONFIDENCE_GLYPH: Record<ForecastConfidence, string> = { LOW: '◔', MEDIUM: '◑', HIGH: '●' };

function seriesLabel(s: ForecastSeries, f: FormatContext): string {
  if (s.scope === 'TOTAL_EXPENSE' || s.scope === 'TOTAL_INCOME') return f.t(`series.${s.scope}`);
  return f.t(`series.${s.scope}`, { name: s.name });
}

function ConfidenceBadge({ confidence, f }: { confidence: ForecastConfidence; f: FormatContext }) {
  return (
    <span className="pf-fc-badge" data-confidence={confidence} data-testid="forecast-confidence">
      <span aria-hidden="true">{CONFIDENCE_GLYPH[confidence]}</span> {f.t('confidence.label')}:{' '}
      {f.t(`confidence.${confidence}`)}
    </span>
  );
}

function Controls({
  latest,
  selection,
  selected,
  f,
  canRun,
  run,
  onSelect,
  onRun,
}: Pick<ForecastsViewProps, 'latest' | 'selection' | 'f' | 'canRun' | 'run' | 'onSelect' | 'onRun'> & {
  selected: ForecastSeries | undefined;
}) {
  const options = sortSeries(latest.series);
  return (
    <div className="pf-fc-controls" data-testid="forecast-controls">
      <div style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
        <label htmlFor="forecast-series">{f.t('controls.series')}</label>
        <select
          id="forecast-series"
          data-testid="forecast-series"
          value={selected ? seriesKey(selected) : ''}
          onChange={(e) => onSelect({ series: e.target.value })}
        >
          {options.map((s) => (
            <option key={seriesKey(s)} value={seriesKey(s)}>
              {seriesLabel(s, f)}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend>{f.t('controls.horizon')}</legend>
        {FORECAST_HORIZONS.map((n) => (
          <label key={n} className="pf-fc-choice">
            <input
              type="radio"
              name="forecast-horizon"
              data-testid={`forecast-horizon-${n}`}
              checked={selection.horizon === n}
              onChange={() => onSelect({ horizon: n })}
            />
            {f.t('controls.periods', { n })}
          </label>
        ))}
      </fieldset>
      {canRun ? (
        <button
          type="button"
          className="pf-fc-button"
          data-testid="forecast-run"
          disabled={run === 'requesting' || run === 'pending'}
          onClick={onRun}
        >
          {run === 'requesting' || run === 'pending' ? f.t('controls.running') : f.t('controls.run')}
        </button>
      ) : null}
    </div>
  );
}

function Headline({ point, f }: { point: ForecastPoint; f: FormatContext }) {
  const { locale } = f;
  return (
    <p className="pf-fc-headline" data-testid="forecast-headline">
      <strong>{f.t('headline.expected')}:</strong> ~{formatForecastMoney(point.prediction, locale)} ·{' '}
      <strong>{f.t('headline.range')}:</strong> {formatForecastMoney(point.interval80.lower, locale)} –{' '}
      {formatForecastMoney(point.interval80.upper, locale)} ({f.t('headline.level', { level: 80 })})
    </p>
  );
}

function driverText(d: ForecastDriver, f: FormatContext): string {
  const { locale } = f;
  switch (d.type) {
    case 'HISTORICAL_AVERAGE':
      return f.t('driver.HISTORICAL_AVERAGE', {
        value: d.value ? formatForecastMoney(d.value, locale) : '—',
      });
    case 'SEASONALITY':
      return f.t('driver.SEASONALITY', { effect: d.effect ? formatSigned(d.effect, locale) : '—' });
    case 'TREND_AND_LEVEL':
      return f.t('driver.TREND_AND_LEVEL', { effect: d.effect ? formatSigned(d.effect, locale) : '—' });
    case 'OUTLIERS':
      return f.t('driver.OUTLIERS', {
        periods: d.periods.map((p) => formatPeriod(p, locale)).join(', '),
        count: d.refCount,
      });
    case 'KNOWN_RECURRING':
      return f.t('driver.KNOWN_RECURRING', {
        value: d.value ? formatForecastMoney(d.value, locale) : '—',
        count: d.refCount,
      });
    default:
      return String(d.type);
  }
}

function Why({ point, f }: { point: ForecastPoint; f: FormatContext }) {
  if (!point.drivers || point.drivers.length === 0) return null;
  return (
    <section className="pf-fc-card" data-testid="forecast-why" aria-labelledby="forecast-why-title">
      <h3 id="forecast-why-title">{f.t('why.title')}</h3>
      <ul className="pf-fc-list">
        {point.drivers.map((d) => (
          <li key={d.type} data-driver={d.type}>
            {driverText(d, f)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KnownList({
  known,
  period,
  point,
  conversion,
  f,
}: {
  known: ForecastKnownItems | undefined;
  period: string;
  point: ForecastPoint | undefined;
  conversion: LatestForecast['meta'];
  f: FormatContext;
}) {
  const { locale } = f;
  const withoutAmount = point?.components?.knownWithoutAmountCount ?? 0;
  return (
    <section className="pf-fc-card" data-testid="forecast-known" aria-labelledby="forecast-known-title">
      <h3 id="forecast-known-title">{f.t('known.title', { period: formatPeriod(period, locale) })}</h3>
      <p className="pf-fc-muted">{f.t('known.intro')}</p>
      {known === undefined ? (
        <p role="status">{f.t('loading')}</p>
      ) : known.items.length === 0 ? (
        <p data-testid="forecast-known-empty">{f.t('known.empty')}</p>
      ) : (
        <ul className="pf-fc-list">
          {known.items.map((k: ForecastKnownItem, i) => (
            <li
              key={`${k.sourceRef.id}-${k.date}-${i}`}
              className="pf-fc-known-item"
              data-testid="forecast-known-item"
            >
              <span className="pf-fc-known-main">
                <strong>{k.label}</strong>
                <span className="pf-fc-muted">
                  {formatLocalDate(k.date, locale)} · {f.t(`known.kind.${k.kind}`)}
                </span>
              </span>
              <span className="pf-fc-num">
                {k.amount ? formatForecastMoney(k.amount, locale) : f.t('known.noAmount')}
                {k.originalAmount ? (
                  <span className="pf-fc-muted">
                    {' '}
                    ({f.t('known.original', { amount: formatForecastMoney(k.originalAmount, locale) })})
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {withoutAmount > 0 ? (
        <p className="pf-fc-muted" data-testid="forecast-known-without-amount">
          {f.t('known.withoutAmount', { count: withoutAmount })}
        </p>
      ) : null}
      {conversion?.conversion ? (
        <p className="pf-fc-muted" data-testid="forecast-conversion">
          {f.t('known.conversion', { date: formatLocalDate(conversion.conversion.rateDate, locale) })}
        </p>
      ) : null}
    </section>
  );
}

function ReadinessNotices({
  series,
  f,
  href,
}: {
  series: ForecastSeries;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const missing = missingPeriods(series);
  const label =
    series.scope === 'TOTAL_EXPENSE' || series.scope === 'TOTAL_INCOME'
      ? seriesLabel(series, f)
      : series.name;
  return (
    <div className="pf-fc-notices" data-testid="forecast-notices">
      {missing !== null && missing > 0 ? (
        <p className="pf-fc-notice" role="status" data-testid="forecast-insufficient">
          {series.historyPeriods === 0
            ? f.t('insufficient.noHistory', { name: label })
            : f.t('insufficient.missing', { n: missing, name: label })}{' '}
          {series.readiness === 'SIMPLE' ? f.t('insufficient.simple') : f.t('insufficient.onlyKnown')}
        </p>
      ) : null}
      {hasReason(series, 'LOW_CATEGORIZATION') ? (
        <p className="pf-fc-notice" role="status" data-testid="forecast-low-categorization">
          {f.t('insufficient.lowCategorization')}{' '}
          <a href={href('/transacciones')}>{f.t('insufficient.link')}</a>
        </p>
      ) : null}
      {hasReason(series, 'GAP_TRUNCATED') ? (
        <p className="pf-fc-notice" role="status">
          {f.t('insufficient.gap')}
        </p>
      ) : null}
    </div>
  );
}

/** Vista de pronósticos (`/pronosticos`; add-expense-forecasts, tareas 7.1 y 7.2). Presentacional: los datos los lee la página. */
export function ForecastsView(props: ForecastsViewProps) {
  const { latest, selection, selectedPeriod, known, f, canRun, run, onSelect, onSelectPeriod, onRun, href } =
    props;
  const { locale, timeZone } = f;
  const selected = pickSeries(latest.series, selection.series);
  const points = selected ? pointsUpTo(selected, selection.horizon) : [];
  const point = points.find((p) => p.period === selectedPeriod) ?? points[0];
  const gaps = points.filter((p) => p.coherenceGap);
  return (
    <div className="pf-fc" data-testid="forecasts-root">
      <style>{FORECASTS_CSS}</style>
      <header className="pf-fc-header">
        <h2>{f.t('title')}</h2>
        <p className="pf-fc-muted">{f.t('subtitle')}</p>
      </header>

      <p className="pf-fc-notice" role="note" data-testid="forecast-disclaimer">
        {f.t('disclaimer')}
      </p>

      {run === 'pending' ? (
        <p className="pf-fc-notice" role="status" data-testid="forecast-run-pending">
          {f.t('run.pending')}
        </p>
      ) : null}
      {run === 'failed' ? (
        <p className="pf-fc-notice" role="alert" data-testid="forecast-run-failed">
          {f.t('run.failed')}
        </p>
      ) : null}

      {latest.status === 'DISABLED' ? (
        <p className="pf-fc-card" data-testid="forecast-disabled">
          {f.t('status.disabled')}
        </p>
      ) : null}

      {latest.status === 'NONE' ? (
        <div className="pf-fc-card" data-testid="forecast-none">
          <p>{f.t('status.none')}</p>
          {canRun ? (
            <button
              type="button"
              className="pf-fc-button"
              data-testid="forecast-run"
              disabled={run === 'requesting' || run === 'pending'}
              onClick={onRun}
            >
              {run === 'requesting' || run === 'pending' ? f.t('controls.running') : f.t('controls.run')}
            </button>
          ) : null}
        </div>
      ) : null}

      {latest.status === 'AVAILABLE' ? (
        <>
          {latest.stale ? (
            <p className="pf-fc-notice" role="status" data-testid="forecast-stale">
              {f.t('stale')}
            </p>
          ) : null}
          <Controls
            latest={latest}
            selection={selection}
            selected={selected}
            f={f}
            canRun={canRun}
            run={run}
            onSelect={onSelect}
            onRun={onRun}
          />
          <p className="pf-fc-muted" data-testid="forecast-meta">
            {latest.generatedAt
              ? f.t('meta.generated', { at: formatInstant(latest.generatedAt, locale, timeZone) })
              : null}
            {selected?.model
              ? ` · ${f.t('meta.model', { name: selected.model.name, version: selected.model.version })}`
              : null}
            {selected?.model?.selectedBy ? ` · ${f.t(`meta.selectedBy.${selected.model.selectedBy}`)}` : null}
          </p>

          {selected ? (
            <section
              className="pf-fc-card"
              aria-labelledby="forecast-series-title"
              data-testid="forecast-series-card"
            >
              <div className="pf-fc-title-row">
                <h3 id="forecast-series-title">{seriesLabel(selected, f)}</h3>
                {selected.confidence ? <ConfidenceBadge confidence={selected.confidence} f={f} /> : null}
                {selected.readiness === 'SIMPLE' ? (
                  <span className="pf-fc-badge" data-testid="forecast-simple-badge">
                    {f.t('simpleBadge')}
                  </span>
                ) : null}
              </div>
              {selected.historyFrom && selected.historyTo ? (
                <p className="pf-fc-muted" data-testid="forecast-history">
                  {f.t('history', {
                    from: formatPeriod(selected.historyFrom, locale),
                    to: formatPeriod(selected.historyTo, locale),
                    count: selected.historyPeriods,
                  })}
                </p>
              ) : null}
              <ReadinessNotices series={selected} f={f} href={href} />
              {point ? <Headline point={point} f={f} /> : null}
              {gaps.length > 0 ? (
                <p className="pf-fc-notice" role="status" data-testid="forecast-coherence">
                  {f.t('coherence', {
                    gap: formatForecastMoney(
                      {
                        amount: (gaps[0]?.coherenceGap?.amount ?? '0').replace('-', ''),
                        currency: gaps[0]?.coherenceGap?.currency ?? '',
                      },
                      locale,
                    ),
                    period: formatPeriod(gaps[0]?.period ?? '', locale),
                  })}
                </p>
              ) : null}
              {points.length > 0 ? (
                <>
                  <ForecastChart
                    id="forecast-chart"
                    points={points}
                    selectedPeriod={point?.period}
                    locale={locale}
                    labels={{
                      title: f.t('chart.title', { name: seriesLabel(selected, f) }),
                      description: f.t('chart.description'),
                      expected: f.t('chart.expected'),
                      band: f.t('chart.band'),
                    }}
                  />
                  <div className="pf-fc-table-wrap">
                    <table className="pf-fc-table" data-testid="forecast-table">
                      <caption>{f.t('table.caption', { name: seriesLabel(selected, f) })}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{f.t('table.period')}</th>
                          <th scope="col" data-num>
                            {f.t('table.expected')}
                          </th>
                          <th scope="col" data-num>
                            {f.t('table.range')}
                          </th>
                          <th scope="col" data-num>
                            {f.t('table.known')}
                          </th>
                          <th scope="col" data-num>
                            {f.t('table.variable')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p) => (
                          <tr
                            key={p.period}
                            data-testid="forecast-row"
                            data-period={p.period}
                            aria-current={p.period === point?.period ? 'true' : undefined}
                          >
                            <th scope="row">
                              <label className="pf-fc-choice">
                                <input
                                  type="radio"
                                  name="forecast-period"
                                  checked={p.period === point?.period}
                                  onChange={() => onSelectPeriod(p.period)}
                                />
                                {formatPeriod(p.period, locale)}
                              </label>
                            </th>
                            <td data-num>~{formatForecastMoney(p.prediction, locale)}</td>
                            <td data-num>
                              {formatForecastMoney(p.interval80.lower, locale)} –{' '}
                              {formatForecastMoney(p.interval80.upper, locale)}
                            </td>
                            <td data-num>
                              {p.components ? formatForecastMoney(p.components.knownFuture, locale) : '—'}
                            </td>
                            <td data-num>
                              {p.components
                                ? formatForecastMoney(p.components.predictedVariable, locale)
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {selected && (point ?? selectedPeriod) ? (
            <div className="pf-fc-detail" data-testid="forecast-detail">
              {point ? (
                <section className="pf-fc-card" aria-labelledby="forecast-detail-title">
                  <h3 id="forecast-detail-title">
                    {f.t('detail.title', { period: formatPeriod(point.period, locale) })}
                  </h3>
                  <p data-testid="forecast-range-95">
                    {f.t('detail.range95', {
                      lower: formatForecastMoney(point.interval95.lower, locale),
                      upper: formatForecastMoney(point.interval95.upper, locale),
                    })}
                  </p>
                  {point.components ? (
                    <p data-testid="forecast-components">
                      {f.t('detail.components', {
                        known: formatForecastMoney(point.components.knownFuture, locale),
                        variable: formatForecastMoney(point.components.predictedVariable, locale),
                      })}
                    </p>
                  ) : null}
                  <p className="pf-fc-muted">
                    {f.t('detail.baseline', { value: formatForecastMoney(point.baseline.value, locale) })}
                  </p>
                </section>
              ) : null}
              {point ? <Why point={point} f={f} /> : null}
              <KnownList
                known={known}
                period={point?.period ?? (selectedPeriod as string)}
                point={point}
                conversion={latest.meta}
                f={f}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <footer className="pf-fc-footer">
        <p>{f.t('disclaimer')}</p>
      </footer>
    </div>
  );
}
