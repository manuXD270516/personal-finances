import { formatDecimal } from '../AuditHistory';
import { highestAmount, lowestAmount, ratioBetween } from './logic';

/**
 * Gráficos SVG propios de los reportes (add-financial-reports, D368; patrón de `NetWorthEvolutionChart`, sin
 * dependencias): barras agrupadas y línea/escalón. Cada gráfico es una imagen con título y descripción; la tabla de
 * datos equivalente (NFR-USAB-105) la pinta la vista. El significado nunca depende solo del color: las series
 * distinguen relleno sólido y rayado, y los puntos llevan marcador.
 */
export const REPORT_CHART_CSS = `
.pf-rc-figure{display:grid;gap:0.5rem;min-width:0}
.pf-rc-svg{width:100%;height:auto;display:block;overflow:visible}
.pf-rc-axis{stroke:var(--pf-border-strong);stroke-width:1}
.pf-rc-grid{stroke:var(--pf-border);stroke-width:1}
.pf-rc-tick{fill:var(--pf-fg-muted);font-size:11px;font-variant-numeric:tabular-nums}
.pf-rc-bar-a{fill:var(--pf-fin-income)}
.pf-rc-bar-b{fill:url(#pf-rc-hatch);stroke:var(--pf-fin-over-budget);stroke-width:1}
.pf-rc-hatch-bg{fill:var(--pf-bg)}
.pf-rc-hatch-line{stroke:var(--pf-fin-over-budget);stroke-width:2}
.pf-rc-line{stroke:var(--pf-primary);stroke-width:2.5;fill:none}
.pf-rc-dot{fill:var(--pf-primary);stroke:var(--pf-bg);stroke-width:1.5}
.pf-rc-dot[data-flag="hollow"]{fill:var(--pf-bg);stroke:var(--pf-primary);stroke-width:2}
.pf-rc-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0.25rem 1rem;font-size:0.875rem;color:var(--pf-fg-muted)}
.pf-rc-legend li{display:inline-flex;align-items:center;gap:0.375rem}
.pf-rc-swatch{display:inline-block;width:0.875rem;height:0.875rem;border:1px solid var(--pf-border-strong)}
.pf-rc-swatch[data-kind="a"]{background:var(--pf-fin-income)}
.pf-rc-swatch[data-kind="b"]{background:repeating-linear-gradient(45deg,var(--pf-fin-over-budget) 0 2px,var(--pf-bg) 2px 5px)}
`;

const W = 640;
const GEOMETRY = { left: 84, right: 12, top: 14, bottom: 34, height: 260 } as const;

export interface BarSeries {
  readonly name: string;
  readonly kind: 'a' | 'b';
  readonly values: readonly string[];
}

function Axis({
  min,
  max,
  locale,
  zeroY,
  plotH,
}: {
  min: string;
  max: string;
  locale: string;
  zeroY: number;
  plotH: number;
}) {
  const { left, top } = GEOMETRY;
  const ticks = [max, min];
  return (
    <g>
      <line className="pf-rc-axis" x1={left} x2={W - GEOMETRY.right} y1={zeroY} y2={zeroY} />
      {ticks.map((t, i) => {
        const y = top + (1 - ratioBetween(t, min, max)) * plotH;
        return (
          <g key={i}>
            <line className="pf-rc-grid" x1={left} x2={W - GEOMETRY.right} y1={y} y2={y} />
            <text className="pf-rc-tick" x={left - 6} y={y + 4} textAnchor="end">
              {formatDecimal(t, locale)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Barras agrupadas por categoría (periodo): una barra por serie, hacia arriba (positivo) o abajo (negativo). */
export function BarsChart(p: {
  readonly categories: readonly string[];
  readonly series: readonly BarSeries[];
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  readonly id: string;
}) {
  const { left, right, top, bottom, height } = GEOMETRY;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const all = p.series.flatMap((s) => s.values);
  const max = highestAmount(['0', ...all]);
  const min = lowestAmount(['0', ...all]);
  const zeroY = top + (1 - ratioBetween('0', min, max)) * plotH;
  const group = plotW / Math.max(1, p.categories.length);
  const bar = Math.max(4, Math.min(28, (group - 8) / Math.max(1, p.series.length)));
  return (
    <figure className="pf-rc-figure" data-testid="report-chart">
      <svg
        className="pf-rc-svg"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${p.id}-t ${p.id}-d`}
      >
        <title id={`${p.id}-t`}>{p.title}</title>
        <desc id={`${p.id}-d`}>{p.description}</desc>
        <defs>
          <pattern
            id="pf-rc-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect className="pf-rc-hatch-bg" width="6" height="6" />
            <line className="pf-rc-hatch-line" x1="0" y1="0" x2="0" y2="6" />
          </pattern>
        </defs>
        <Axis min={min} max={max} locale={p.locale} zeroY={zeroY} plotH={plotH} />
        {p.categories.map((c, i) => {
          const x0 = left + i * group + (group - bar * p.series.length) / 2;
          return (
            <g key={c}>
              {p.series.map((s, j) => {
                const v = s.values[i] ?? '0';
                const y = top + (1 - ratioBetween(v, min, max)) * plotH;
                const y0 = Math.min(y, zeroY);
                return (
                  <rect
                    key={s.name}
                    className={s.kind === 'a' ? 'pf-rc-bar-a' : 'pf-rc-bar-b'}
                    x={x0 + j * bar}
                    y={y0}
                    width={bar - 2}
                    height={Math.max(1, Math.abs(zeroY - y))}
                  >
                    <title>{`${s.name} · ${c}: ${formatDecimal(v, p.locale)}`}</title>
                  </rect>
                );
              })}
              <text
                className="pf-rc-tick"
                x={left + i * group + group / 2}
                y={height - 12}
                textAnchor="middle"
              >
                {c}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="pf-rc-legend">
        {p.series.map((s) => (
          <li key={s.name}>
            <span className="pf-rc-swatch" data-kind={s.kind} aria-hidden="true" />
            {s.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Línea (o escalón, para el historial de saldo) de una serie de puntos `{label, value}`; hueco = incompleto. */
export function LineChart(p: {
  readonly points: readonly { label: string; value: string; hollow?: boolean }[];
  readonly step?: boolean;
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  readonly id: string;
}) {
  const { left, right, top, bottom, height } = GEOMETRY;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const values = p.points.map((x) => x.value);
  const max = highestAmount(values);
  const min = lowestAmount(values);
  const n = p.points.length;
  const xAt = (i: number) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: string) => top + (1 - ratioBetween(v, min, max)) * plotH;
  const path = p.points
    .map((pt, i) => {
      const x = xAt(i);
      const y = yAt(pt.value);
      if (i === 0) return `M${x} ${y}`;
      return p.step ? `H${x} V${y}` : `L${x} ${y}`;
    })
    .join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <figure className="pf-rc-figure" data-testid="report-chart">
      <svg
        className="pf-rc-svg"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${p.id}-t ${p.id}-d`}
      >
        <title id={`${p.id}-t`}>{p.title}</title>
        <desc id={`${p.id}-d`}>{p.description}</desc>
        <Axis min={min} max={max} locale={p.locale} zeroY={top + plotH} plotH={plotH} />
        {n > 0 && <path className="pf-rc-line" d={path} />}
        {n <= 60 &&
          p.points.map((pt, i) => (
            <circle
              key={pt.label}
              className="pf-rc-dot"
              data-flag={pt.hollow ? 'hollow' : undefined}
              cx={xAt(i)}
              cy={yAt(pt.value)}
              r="3.5"
            >
              <title>{`${pt.label}: ${formatDecimal(pt.value, p.locale)}`}</title>
            </circle>
          ))}
        {p.points.map((pt, i) =>
          i % labelEvery === 0 ? (
            <text key={pt.label} className="pf-rc-tick" x={xAt(i)} y={height - 12} textAnchor="middle">
              {pt.label}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}
