import { formatDecimal } from '../AuditHistory';
import { formatMoney, formatSignedDecimal } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { buildChart, pointStates, totalChange, type ChartModel, type PointState } from './chart-model';
import type { NetWorthHistory, NetWorthPoint } from './types';

/** Etiqueta corta del mes de un periodo (`2026-02` → "feb 26"): día 1 en UTC, sin zona del proceso. */
export function shortPeriod(label: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return label;
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)),
  );
}

/** `2026-02-28` → `28/02/2026` (fechas de negocio, sin conversión de zona). */
export function businessDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

const GEOMETRY = {
  compact: { width: 640, height: 220, left: 80, right: 12, top: 14, bottom: 34 },
  full: { width: 640, height: 300, left: 80, right: 12, top: 14, bottom: 34 },
} as const;

/** Estados de un punto en texto (nunca solo color ni forma). */
export function stateLabels(p: NetWorthPoint, f: FormatContext): string[] {
  return pointStates(p).map((s: PointState) => f.t(`state.${s}`));
}

function pointTitle(p: NetWorthPoint, currency: string, f: FormatContext): string {
  const flags = stateLabels(p, f).join(', ');
  return f.t('chart.point', {
    period: shortPeriod(p.period, f.locale),
    date: businessDate(p.asOf),
    net: `${formatDecimal(p.netWorth, f.locale)} ${currency}`,
    assets: `${formatDecimal(p.assets, f.locale)} ${currency}`,
    liabilities: `${formatDecimal(p.liabilities, f.locale)} ${currency}`,
    flags,
  });
}

/** Descripción accesible del gráfico completo (la tabla de datos es la alternativa equivalente). */
export function chartDescription(history: NetWorthHistory, f: FormatContext): string {
  const { points, reportingCurrency: currency } = history;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return f.t('chart.descEmpty');
  const incomplete = points.filter((p) => !p.complete).length;
  const change = totalChange(points);
  const base = f.t(change === null ? 'chart.descSingle' : 'chart.desc', {
    from: shortPeriod(first.period, f.locale),
    to: shortPeriod(last.period, f.locale),
    first: `${formatDecimal(first.netWorth, f.locale)} ${currency}`,
    last: `${formatDecimal(last.netWorth, f.locale)} ${currency}`,
    change: change === null ? '' : `${formatSignedDecimal(change, f.locale)} ${currency}`,
  });
  return incomplete > 0 ? `${base} ${f.t('chart.descIncomplete', { n: incomplete })}` : base;
}

function Lock({ x, y }: { x: number; y: number }) {
  // Candado de 10×10 (cuerpo y arco): marca los periodos cerrados además del texto de la tabla.
  return (
    <g transform={`translate(${x - 5} ${y})`} className="pf-nw-lock" aria-hidden="true">
      <rect x="1" y="4.5" width="8" height="5.5" rx="1" />
      <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" />
    </g>
  );
}

/** Marcador del patrimonio neto: círculo lleno (completo), hueco (incompleto) y cuadrado (periodo en curso). */
function Marker({ x, y, point }: { x: number; y: number; point: NetWorthPoint }) {
  if (point.partial)
    return <rect x={x - 4} y={y - 4} width="8" height="8" className="pf-nw-marker" data-kind="partial" />;
  return (
    <circle
      cx={x}
      cy={y}
      r="4.5"
      className="pf-nw-marker"
      data-kind={point.complete ? 'complete' : 'incomplete'}
    />
  );
}

function Plot({
  model,
  history,
  f,
  titleId,
  descId,
  compact,
}: {
  model: ChartModel;
  history: NetWorthHistory;
  f: FormatContext;
  titleId: string;
  descId: string;
  compact: boolean;
}) {
  const { geometry: g, columns, baseline, barWidth } = model;
  const currency = history.reportingCurrency;
  const plotBottom = g.height - g.bottom;
  const showEvery = columns.length > 8 && compact ? 2 : 1;
  return (
    <svg
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      viewBox={`0 0 ${g.width} ${g.height}`}
      className="pf-nw-svg"
      data-testid="net-worth-chart"
    >
      <title id={titleId}>{f.t('chart.title', { currency })}</title>
      <desc id={descId}>{chartDescription(history, f)}</desc>
      <defs>
        <pattern
          id={`${titleId}-hatch`}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" className="pf-nw-hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="5" className="pf-nw-hatch-line" strokeWidth="2" />
        </pattern>
      </defs>
      <line x1={g.left} x2={g.width - g.right} y1={baseline} y2={baseline} className="pf-nw-axis" />
      <line x1={g.left} x2={g.left} y1={g.top} y2={plotBottom} className="pf-nw-axis" />
      <text x={g.left - 6} y={g.top + 4} textAnchor="end" className="pf-nw-tick">
        {formatDecimal(model.highest, f.locale)}
      </text>
      <text x={g.left - 6} y={baseline + 4} textAnchor="end" className="pf-nw-tick">
        {formatDecimal('0', f.locale)}
      </text>
      {columns.slice(0, -1).map((c, i) => {
        const next = columns[i + 1]!;
        const solid = c.point.complete && next.point.complete;
        return (
          <line
            key={`seg-${c.point.periodId}`}
            x1={c.x}
            y1={c.netY}
            x2={next.x}
            y2={next.netY}
            className="pf-nw-line"
            data-solid={solid ? 'true' : 'false'}
          />
        );
      })}
      {columns.map((c, i) => (
        <g key={c.point.periodId} data-testid="net-worth-column" data-period={c.point.period}>
          <title>{pointTitle(c.point, currency, f)}</title>
          <rect
            x={c.x - barWidth - 1}
            y={c.assets.y}
            width={barWidth}
            height={c.assets.h}
            className="pf-nw-bar-assets"
          />
          <rect
            x={c.x + 1}
            y={c.liabilities.y}
            width={barWidth}
            height={c.liabilities.h}
            fill={`url(#${titleId}-hatch)`}
            className="pf-nw-bar-liabilities"
          />
          <Marker x={c.x} y={c.netY} point={c.point} />
          {i % showEvery === 0 ? (
            <text x={c.x} y={plotBottom + 14} textAnchor="middle" className="pf-nw-tick">
              {shortPeriod(c.point.period, f.locale)}
            </text>
          ) : null}
          {c.point.closed ? <Lock x={c.x} y={plotBottom + 18} /> : null}
        </g>
      ))}
    </svg>
  );
}

function Legend({ f }: { f: FormatContext }) {
  return (
    <ul className="pf-nw-legend" data-testid="net-worth-legend">
      <li>
        <svg width="14" height="12" aria-hidden="true">
          <rect width="14" height="12" className="pf-nw-bar-assets" />
        </svg>
        {f.t('legend.assets')}
      </li>
      <li>
        <svg width="14" height="12" aria-hidden="true">
          <defs>
            <pattern
              id="pf-nw-legend-hatch"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" className="pf-nw-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="5" className="pf-nw-hatch-line" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="14" height="12" fill="url(#pf-nw-legend-hatch)" className="pf-nw-bar-liabilities" />
        </svg>
        {f.t('legend.liabilities')}
      </li>
      <li>
        <svg width="22" height="12" aria-hidden="true">
          <line x1="0" y1="6" x2="22" y2="6" className="pf-nw-line" data-solid="true" />
          <circle cx="11" cy="6" r="4" className="pf-nw-marker" data-kind="complete" />
        </svg>
        {f.t('legend.net')}
      </li>
      <li>
        <svg width="22" height="12" aria-hidden="true">
          <line x1="0" y1="6" x2="22" y2="6" className="pf-nw-line" data-solid="false" />
          <circle cx="11" cy="6" r="4" className="pf-nw-marker" data-kind="incomplete" />
        </svg>
        {f.t('legend.incomplete')}
      </li>
      <li>
        <svg width="12" height="12" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" className="pf-nw-marker" data-kind="partial" />
        </svg>
        {f.t('legend.partial')}
      </li>
      <li>
        <svg width="12" height="12" aria-hidden="true">
          <Lock x={6} y={1} />
        </svg>
        {f.t('legend.closed')}
      </li>
    </ul>
  );
}

function changeCell(p: NetWorthPoint, currency: string, f: FormatContext): string {
  if (p.change === null) return f.t('table.noChange');
  const value = `${formatSignedDecimal(p.change, f.locale)} ${currency}`;
  return p.comparable ? value : `${value} (${f.t('table.notComparable')})`;
}

/** Tabla de datos: alternativa accesible equivalente al gráfico (cifras, estado y montos sin valorar de cada periodo). */
export function NetWorthTable({
  history,
  f,
  hidden = false,
}: {
  history: NetWorthHistory;
  f: FormatContext;
  /** Solo para lectores de pantalla (tarjeta compacta del Home, que enlaza a la vista completa). */
  hidden?: boolean;
}) {
  const currency = history.reportingCurrency;
  const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const;
  return (
    <div className={hidden ? 'pf-home-sr' : 'pf-nw-table-wrap'}>
      <table data-testid="net-worth-table" className="pf-nw-table">
        <caption>{f.t('table.caption', { currency })}</caption>
        <thead>
          <tr>
            <th scope="col">{f.t('table.period')}</th>
            <th scope="col">{f.t('table.asOf')}</th>
            <th scope="col" style={num}>
              {f.t('table.assets')}
            </th>
            <th scope="col" style={num}>
              {f.t('table.liabilities')}
            </th>
            <th scope="col" style={num}>
              {f.t('table.net')}
            </th>
            <th scope="col" style={num}>
              {f.t('table.change')}
            </th>
            <th scope="col">{f.t('table.status')}</th>
          </tr>
        </thead>
        <tbody>
          {history.points.map((p) => (
            <tr key={p.periodId} data-testid="net-worth-row" data-period={p.period}>
              <th scope="row">{shortPeriod(p.period, f.locale)}</th>
              <td>{businessDate(p.asOf)}</td>
              <td style={num}>{formatDecimal(p.assets, f.locale)}</td>
              <td style={num}>{formatDecimal(p.liabilities, f.locale)}</td>
              <td style={num} data-testid="net-worth-row-net">
                {formatDecimal(p.netWorth, f.locale)}
              </td>
              <td style={num}>{changeCell(p, currency, f)}</td>
              <td>
                {stateLabels(p, f).join(', ')}
                {p.unconverted.length > 0 ? (
                  <>
                    {' · '}
                    <span data-testid="net-worth-row-unconverted">
                      {f.t('table.unconverted', {
                        amounts: p.unconverted.map((m) => formatMoney(m, f.locale)).join(' · '),
                      })}
                    </span>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Evolución del patrimonio neto (reporting/net-worth, FR-REPORTING-006): barras de activos (sólidas) y pasivos
 * (rayadas) y línea del patrimonio neto. Los puntos incompletos van con marcador hueco y tramo discontinuo, el periodo
 * en curso con marcador cuadrado y los cerrados con candado: ninguna distinción depende solo del color. El gráfico
 * tiene título y descripción accesibles y la tabla de datos es su alternativa equivalente.
 */
export function NetWorthChart({
  history,
  f,
  variant,
  idPrefix,
}: {
  history: NetWorthHistory;
  f: FormatContext;
  variant: 'compact' | 'full';
  idPrefix: string;
}) {
  const model = buildChart(history.points, GEOMETRY[variant]);
  return (
    <figure className="pf-nw-figure" data-variant={variant} style={{ margin: 0 }}>
      <Plot
        model={model}
        history={history}
        f={f}
        titleId={`${idPrefix}-title`}
        descId={`${idPrefix}-desc`}
        compact={variant === 'compact'}
      />
      <figcaption>
        <Legend f={f} />
      </figcaption>
    </figure>
  );
}
