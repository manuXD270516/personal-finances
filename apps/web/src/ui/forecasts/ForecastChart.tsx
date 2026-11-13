import { formatDecimal } from '../AuditHistory';
import { highestAmount, lowestAmount, ratioBetween } from '../reports/logic';
import { formatPeriod } from './logic';
import type { ForecastPoint } from './types';

/**
 * Gráfico SVG propio del pronóstico (D368: sin dependencias nuevas; patrón de `CashFlowChart`): el valor esperado por
 * periodo (línea y círculos) y la banda del 80 % (área sombreada con bordes de trazos). El significado nunca depende
 * solo del color: la banda lleva borde de trazos, el esperado, círculo y la leyenda los nombra. La tabla equivalente
 * (NFR-USAB-105) la pinta la vista. La geometría usa enteros exactos (`ratioBetween`); las cifras que se leen salen de
 * los strings decimales.
 */
export const FORECAST_CHART_CSS = `
.pf-fcc-figure{display:grid;gap:0.5rem;min-width:0;margin:0}
.pf-fcc-svg{width:100%;height:auto;display:block;overflow:visible}
.pf-fcc-axis{stroke:var(--pf-border-strong);stroke-width:1}
.pf-fcc-grid{stroke:var(--pf-border);stroke-width:1}
.pf-fcc-tick{fill:var(--pf-fg-muted);font-size:11px;font-variant-numeric:tabular-nums}
.pf-fcc-band{fill:var(--pf-primary);fill-opacity:0.14;stroke:var(--pf-primary);stroke-width:1.5;stroke-dasharray:5 4}
.pf-fcc-line{stroke:var(--pf-primary);stroke-width:2.5;fill:none}
.pf-fcc-dot{fill:var(--pf-bg);stroke:var(--pf-primary);stroke-width:2.5}
.pf-fcc-dot[data-selected="true"]{fill:var(--pf-primary)}
.pf-fcc-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0.25rem 1rem;font-size:0.875rem;color:var(--pf-fg-muted)}
.pf-fcc-legend li{display:inline-flex;align-items:center;gap:0.375rem}
.pf-fcc-swatch{display:inline-block;width:1.5rem;height:0.75rem;border:1.5px dashed var(--pf-primary);background:color-mix(in srgb,var(--pf-primary) 14%,transparent)}
.pf-fcc-swatch[data-kind="expected"]{height:0;border:0;border-top:3px solid var(--pf-primary);background:none}
`;

const W = 640;
const G = { left: 84, right: 16, top: 16, bottom: 34, height: 260 } as const;

export interface ForecastChartLabels {
  readonly title: string;
  readonly description: string;
  readonly expected: string;
  readonly band: string;
}

export function ForecastChart(props: {
  readonly id: string;
  readonly points: readonly ForecastPoint[];
  readonly selectedPeriod: string | undefined;
  readonly locale: string;
  readonly labels: ForecastChartLabels;
}) {
  const { points, locale, labels, id, selectedPeriod } = props;
  const { left, right, top, bottom, height } = G;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const values = points.flatMap((p) => [
    p.interval80.lower.amount,
    p.interval80.upper.amount,
    p.prediction.amount,
  ]);
  const max = highestAmount(values);
  const min = lowestAmount(values);
  const n = points.length;
  const xAt = (i: number) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: string) => top + (1 - ratioBetween(v, min, max)) * plotH;
  const path = (pts: readonly { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const upper = points.map((p, i) => ({ x: xAt(i), y: yAt(p.interval80.upper.amount) }));
  const lower = points.map((p, i) => ({ x: xAt(i), y: yAt(p.interval80.lower.amount) })).reverse();
  const bandPath = n > 0 ? `${path(upper)} L${path(lower).slice(1)} Z` : '';
  const linePath = path(points.map((p, i) => ({ x: xAt(i), y: yAt(p.prediction.amount) })));
  const ticks = [max, min];
  return (
    <figure className="pf-fcc-figure" data-testid="forecast-chart">
      <svg
        className="pf-fcc-svg"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>{labels.title}</title>
        <desc id={`${id}-d`}>{labels.description}</desc>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line className="pf-fcc-grid" x1={left} x2={W - right} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="pf-fcc-tick" x={left - 6} y={yAt(tick) + 4} textAnchor="end">
              {formatDecimal(tick, locale)}
            </text>
          </g>
        ))}
        <line className="pf-fcc-axis" x1={left} x2={left} y1={top} y2={top + plotH} />
        {n > 0 ? <path className="pf-fcc-band" d={bandPath} data-testid="forecast-band" /> : null}
        {n > 0 ? <path className="pf-fcc-line" d={linePath} /> : null}
        {points.map((p, i) => (
          <circle
            key={p.period}
            className="pf-fcc-dot"
            data-selected={p.period === selectedPeriod ? 'true' : undefined}
            cx={xAt(i)}
            cy={yAt(p.prediction.amount)}
            r="4"
          >
            <title>{`${formatPeriod(p.period, locale)}: ${formatDecimal(p.prediction.amount, locale)}`}</title>
          </circle>
        ))}
        {points.map((p, i) => (
          <text key={p.period} className="pf-fcc-tick" x={xAt(i)} y={height - 12} textAnchor="middle">
            {p.period.slice(2)}
          </text>
        ))}
      </svg>
      <ul className="pf-fcc-legend">
        <li>
          <span className="pf-fcc-swatch" data-kind="expected" aria-hidden="true" />
          {labels.expected}
        </li>
        <li>
          <span className="pf-fcc-swatch" aria-hidden="true" />
          {labels.band}
        </li>
      </ul>
    </figure>
  );
}
