import { formatDecimal } from '../AuditHistory';
import { formatLocalDate } from '../dashboard/format';
import { highestAmount, lowestAmount, ratioBetween } from '../reports/logic';
import { compareDecimal } from './logic';
import type { CashFlowDay, Money } from './types';

/**
 * Gráfico SVG propio del saldo esperado (patrón de `ReportChart`, sin dependencias): la serie del saldo al cierre de cada
 * día (línea continua), la serie con el gasto planificado restante (línea de trazos) y la reserva mínima o el umbral
 * (línea de puntos con su rótulo). Los puntos cuyo saldo más bajo del día queda bajo el umbral van huecos y con rombo en
 * el mínimo: el significado nunca depende solo del color. La tabla equivalente la pinta la vista (NFR-USAB-105). La
 * geometría usa enteros exactos (`ratioBetween`); las cifras que se leen salen de los strings decimales.
 */
export const CASH_FLOW_CHART_CSS = `
.pf-cfc-figure{display:grid;gap:0.5rem;min-width:0;margin:0}
.pf-cfc-svg{width:100%;height:auto;display:block;overflow:visible}
.pf-cfc-axis{stroke:var(--pf-border-strong);stroke-width:1}
.pf-cfc-grid{stroke:var(--pf-border);stroke-width:1}
.pf-cfc-tick{fill:var(--pf-fg-muted);font-size:11px;font-variant-numeric:tabular-nums}
.pf-cfc-line{stroke:var(--pf-primary);stroke-width:2.5;fill:none}
.pf-cfc-planned{stroke:var(--pf-fin-warning);stroke-width:2.5;fill:none;stroke-dasharray:7 4}
.pf-cfc-threshold{stroke:var(--pf-error);stroke-width:2;stroke-dasharray:2 4}
.pf-cfc-dot{fill:var(--pf-primary);stroke:var(--pf-bg);stroke-width:1.5}
.pf-cfc-dot[data-flag="below"]{fill:var(--pf-bg);stroke:var(--pf-error);stroke-width:2.5}
.pf-cfc-low{fill:var(--pf-error);stroke:var(--pf-bg);stroke-width:1.5}
.pf-cfc-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0.25rem 1rem;font-size:0.875rem;color:var(--pf-fg-muted)}
.pf-cfc-legend li{display:inline-flex;align-items:center;gap:0.375rem}
.pf-cfc-swatch{display:inline-block;width:1.5rem;height:0;border-top:3px solid var(--pf-primary)}
.pf-cfc-swatch[data-kind="planned"]{border-top:3px dashed var(--pf-fin-warning)}
.pf-cfc-swatch[data-kind="threshold"]{border-top:3px dotted var(--pf-error)}
`;

const W = 640;
const G = { left: 84, right: 12, top: 16, bottom: 34, height: 280 } as const;

export interface CashFlowChartLabels {
  readonly title: string;
  readonly description: string;
  readonly balance: string;
  readonly planned: string;
  /** Rótulo de la línea del umbral (p. ej. «Reserva mínima: 1.500,00 BOB»); sin umbral no hay línea. */
  readonly threshold: string | undefined;
  /** Rótulo del mínimo (p. ej. «Mínimo»). */
  readonly lowest: string;
}

export function CashFlowChart(props: {
  readonly id: string;
  readonly series: readonly CashFlowDay[];
  readonly planned: readonly { readonly date: string; readonly balance: Money }[] | undefined;
  readonly threshold: Money | undefined;
  /** Fecha del saldo más bajo (se marca con un rombo). */
  readonly lowestDate: string | undefined;
  readonly locale: string;
  readonly labels: CashFlowChartLabels;
}) {
  const { series, planned, threshold, lowestDate, locale, labels, id } = props;
  const { left, right, top, bottom, height } = G;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const values = [
    ...series.map((d) => d.balance.amount),
    ...series.map((d) => d.low.amount),
    ...(planned ?? []).map((p) => p.balance.amount),
    ...(threshold ? [threshold.amount] : []),
  ];
  const max = highestAmount(values);
  const min = lowestAmount(values);
  const n = series.length;
  const xAt = (i: number) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: string) => top + (1 - ratioBetween(v, min, max)) * plotH;
  const indexOf = new Map(series.map((d, i) => [d.date, i]));
  const path = (pts: readonly { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const balancePath = path(series.map((d, i) => ({ x: xAt(i), y: yAt(d.balance.amount) })));
  const plannedPath = planned
    ? path(
        planned.flatMap((p) => {
          const i = indexOf.get(p.date);
          return i === undefined ? [] : [{ x: xAt(i), y: yAt(p.balance.amount) }];
        }),
      )
    : '';
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const ticks = [max, min];
  return (
    <figure className="pf-cfc-figure" data-testid="cash-flow-chart">
      <svg
        className="pf-cfc-svg"
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>{labels.title}</title>
        <desc id={`${id}-d`}>{labels.description}</desc>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line className="pf-cfc-grid" x1={left} x2={W - right} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="pf-cfc-tick" x={left - 6} y={yAt(tick) + 4} textAnchor="end">
              {formatDecimal(tick, locale)}
            </text>
          </g>
        ))}
        <line className="pf-cfc-axis" x1={left} x2={left} y1={top} y2={top + plotH} />
        {threshold ? (
          <line
            className="pf-cfc-threshold"
            data-testid="cash-flow-threshold-line"
            x1={left}
            x2={W - right}
            y1={yAt(threshold.amount)}
            y2={yAt(threshold.amount)}
          />
        ) : null}
        {n > 0 ? <path className="pf-cfc-line" d={balancePath} /> : null}
        {plannedPath ? <path className="pf-cfc-planned" d={plannedPath} /> : null}
        {n <= 100
          ? series.map((d, i) => {
              const below = threshold ? compareDecimal(d.low.amount, threshold.amount) < 0 : false;
              const isLowest = d.date === lowestDate;
              return isLowest ? (
                <polygon
                  key={d.date}
                  className="pf-cfc-low"
                  points={`${xAt(i)},${yAt(d.low.amount) - 7} ${xAt(i) + 7},${yAt(d.low.amount)} ${xAt(i)},${yAt(d.low.amount) + 7} ${xAt(i) - 7},${yAt(d.low.amount)}`}
                >
                  <title>{`${labels.lowest} · ${formatLocalDate(d.date, locale)}: ${formatDecimal(d.low.amount, locale)}`}</title>
                </polygon>
              ) : (
                <circle
                  key={d.date}
                  className="pf-cfc-dot"
                  data-flag={below ? 'below' : undefined}
                  cx={xAt(i)}
                  cy={yAt(d.balance.amount)}
                  r="3.5"
                >
                  <title>{`${formatLocalDate(d.date, locale)}: ${formatDecimal(d.balance.amount, locale)}`}</title>
                </circle>
              );
            })
          : null}
        {series.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.date} className="pf-cfc-tick" x={xAt(i)} y={height - 12} textAnchor="middle">
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="pf-cfc-legend">
        <li>
          <span className="pf-cfc-swatch" aria-hidden="true" />
          {labels.balance}
        </li>
        {planned ? (
          <li>
            <span className="pf-cfc-swatch" data-kind="planned" aria-hidden="true" />
            {labels.planned}
          </li>
        ) : null}
        {labels.threshold ? (
          <li>
            <span className="pf-cfc-swatch" data-kind="threshold" aria-hidden="true" />
            {labels.threshold}
          </li>
        ) : null}
      </ul>
    </figure>
  );
}
