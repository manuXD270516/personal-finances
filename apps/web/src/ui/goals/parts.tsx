import type { CSSProperties, ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import { badgeStyle, mutedStyle } from '../common/ui';
import { formatMoney, formatSignedDecimal } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { RateSourceBadge } from '../dashboard/RateSourceBadge';
import { formatBusinessDate } from '../planning/logic';
import { Badge } from '../recurring/Badges';
import {
  barWidth,
  exceedsTarget,
  GOAL_STATUS_PRESENTATION,
  statusView,
  TRACKING_PRESENTATION,
  type ExpectedView,
} from './logic';
import type { GoalRequired, GoalTracking, Money, ResolvedRate } from './types';

/** Piezas presentacionales compartidas por el listado, el detalle, las reservas y la tarjeta del Home. */

const trackStyle: CSSProperties = {
  height: '0.625rem',
  borderRadius: 'var(--pf-radius-full)',
  background: 'var(--pf-surface-sunken)',
  border: '1px solid var(--pf-border-strong)',
  overflow: 'hidden',
  minWidth: '6rem',
};

const warnBadge: CSSProperties = {
  ...badgeStyle,
  borderColor: 'var(--pf-warning-border)',
  background: 'var(--pf-warning-bg)',
  color: 'var(--pf-warning-fg)',
};

/**
 * Estado de la meta con TEXTO + ICONO (NFR-USAB-104): el de avance (Atrasada, En ritmo, Adelantada) cuando aplica
 * y, si no, el de ciclo de vida (Activa, Pausada, Alcanzada, Cerrada, Cancelada). El color solo refuerza.
 */
export function GoalStatusBadge({
  tracking,
  f,
}: {
  tracking: Pick<GoalTracking, 'status' | 'lifecycleStatus'>;
  f: FormatContext;
}) {
  const view = statusView(tracking);
  return view.kind === 'TRACKING' ? (
    <Badge
      presentation={TRACKING_PRESENTATION[view.value]}
      label={f.t(`tracking.${view.value}`)}
      status={view.value}
      testId="goal-status"
    />
  ) : (
    <Badge
      presentation={GOAL_STATUS_PRESENTATION[view.value]}
      label={f.t(`status.${view.value}`)}
      status={view.value}
      testId="goal-status"
    />
  );
}

/** Marca "Sobre-asignada": alguna cuenta de la meta tiene más reservado que su saldo (texto + icono). */
export function OverAllocatedMark({ f }: { f: FormatContext }) {
  return (
    <span style={warnBadge} data-testid="goal-over-allocated">
      <span aria-hidden="true">⚠</span> {f.t('overAllocated.badge')}
    </span>
  );
}

/** Aviso de progreso parcial: hay fondos en otra moneda sin tasa vigente (nunca se convierten 1:1). */
export function IncompleteMark({ f, unconverted }: { f: FormatContext; unconverted: readonly Money[] }) {
  return (
    <span style={mutedStyle} data-testid="goal-incomplete">
      <span aria-hidden="true">ⓘ</span>{' '}
      {unconverted.length > 0
        ? f.t('progress.incompleteWith', {
            amounts: unconverted.map((m) => formatMoney(m, f.locale)).join(', '),
          })
        : f.t('progress.incomplete')}
    </span>
  );
}

/**
 * Progreso: porcentaje en TEXTO ("33,33 %" y "5.000,00 de 15.000,00 BOB") más una barra `role="progressbar"` con
 * nombre y valor. Sobre 100 % la barra queda llena y el texto sigue diciendo el porcentaje real (104,17 %).
 */
export function GoalProgressBar({
  percent,
  label,
  f,
  current,
  target,
  testIdPrefix = 'goal',
}: {
  percent: string;
  label: string;
  f: FormatContext;
  current?: Money | undefined;
  target?: Money | undefined;
  testIdPrefix?: string;
}) {
  const text = f.t('progress.percent', { percent: formatDecimal(percent, f.locale) });
  const detail =
    current && target
      ? f.t('progress.of', {
          current: formatDecimal(current.amount, f.locale),
          target: formatMoney(target, f.locale),
        })
      : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-1)', minWidth: 0 }}>
      <p style={{ margin: 0 }}>
        <strong data-testid={`${testIdPrefix}-progress-text`}>{text}</strong>
        {detail ? (
          <span style={mutedStyle} data-testid={`${testIdPrefix}-progress-detail`}>
            {' '}
            · {detail}
          </span>
        ) : null}
        {exceedsTarget(percent) ? <span style={mutedStyle}> · {f.t('progress.exceeded')}</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barWidth(percent)}
        aria-valuetext={detail ? `${text} · ${detail}` : text}
        style={trackStyle}
        data-testid={`${testIdPrefix}-progress-bar`}
      >
        <div
          aria-hidden="true"
          style={{
            width: `${barWidth(percent)}%`,
            height: '100%',
            background: exceedsTarget(percent) ? 'var(--pf-fin-ok)' : 'var(--pf-primary)',
          }}
        />
      </div>
    </div>
  );
}

/** Aporte mensual requerido: el monto por mes, el restante íntegro si la fecha venció, o guion sin fecha. */
export function RequiredText({
  required,
  f,
}: {
  required: Pick<GoalRequired, 'monthly' | 'overdue'>;
  f: FormatContext;
}) {
  if (required.monthly === null) return <>{f.t('required.none')}</>;
  const amount = formatMoney(required.monthly, f.locale);
  return (
    <>
      {required.overdue ? (
        <span data-testid="goal-overdue">
          <span aria-hidden="true">⚠</span> {f.t('required.overdue', { amount })}
        </span>
      ) : (
        f.t('required.monthly', { amount })
      )}
    </>
  );
}

/** Fecha esperada, o "sin ritmo suficiente" cuando no hay aportes para estimarla. */
export function ExpectedText({ view, f }: { view: ExpectedView; f: FormatContext }): ReactNode {
  switch (view.kind) {
    case 'ACHIEVED':
      return f.t('expected.achieved', { date: formatBusinessDate(view.date) });
    case 'DATE':
      return formatBusinessDate(view.date);
    case 'NO_PACE':
      return f.t('expected.noPace');
    case 'BEYOND_HORIZON':
      return f.t('expected.beyondHorizon');
    default:
      return '—';
  }
}

/** Desvío contra el esperado lineal: "−4,00 % respecto de lo esperado (5.000,00 BOB)". */
export function DeviationText({ tracking, f }: { tracking: GoalTracking; f: FormatContext }) {
  if (tracking.deviationPercent === null || tracking.expected === null) return <>—</>;
  return (
    <>
      {f.t('tracking.deviation', {
        percent: formatSignedDecimal(tracking.deviationPercent, f.locale),
        expected: formatMoney(tracking.expected, f.locale),
      })}
    </>
  );
}

/**
 * Tasas usadas para convertir fondos en otra moneda (FR-FX-014): par, valor, tipo, fecha y "Fuente: …" con la
 * atribución del proveedor. `ctx` es el formato del namespace `Dashboard` (el de `RateSourceBadge`).
 */
export function RatesUsed({
  rates,
  windowDays,
  f,
  dashboard,
}: {
  rates: readonly ResolvedRate[];
  windowDays?: number | undefined;
  f: FormatContext;
  dashboard: FormatContext;
}) {
  if (rates.length === 0) return null;
  return (
    <details data-testid="goal-rates" style={{ margin: 0 }}>
      <summary>{f.t('rates.title', { count: rates.length })}</summary>
      <div style={{ display: 'grid', gap: 'var(--pf-space-1)', marginTop: 'var(--pf-space-2)' }}>
        {rates.map((r, i) => (
          <RateSourceBadge key={`${r.rate.base}-${r.rate.quote}-${r.asOf}-${i}`} rate={r} ctx={dashboard} />
        ))}
        {windowDays !== undefined ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{f.t('rates.window', { days: windowDays })}</p>
        ) : null}
      </div>
    </details>
  );
}
