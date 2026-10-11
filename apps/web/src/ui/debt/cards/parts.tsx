import type { CSSProperties } from 'react';
import { formatDecimal } from '../../AuditHistory';
import { badgeStyle, mutedStyle } from '../../common/ui';
import type { FormatContext } from '../../dashboard/types';
import { Badge } from '../../recurring/Badges';
import {
  STATEMENT_PRESENTATION,
  UTILIZATION_PRESENTATION,
  utilizationView,
  type UtilizationView,
} from './logic';
import type { CardStatementStatus, CardUtilization } from './types';

/** Piezas presentacionales compartidas por el listado, el detalle y el formulario de transferencia de tarjetas. */

const LEVEL_COLOR: Record<UtilizationView['level'], string> = {
  ok: 'var(--pf-fin-ok)',
  warn: 'var(--pf-fin-warning)',
  danger: 'var(--pf-fin-over-budget)',
  unknown: 'var(--pf-border-strong)',
};

const trackStyle: CSSProperties = {
  height: '0.625rem',
  borderRadius: 'var(--pf-radius-full)',
  background: 'var(--pf-surface-sunken)',
  border: '1px solid var(--pf-border-strong)',
  overflow: 'hidden',
  minWidth: '6rem',
};

/** Estado de un estado de cuenta con TEXTO + icono (NFR-USAB-104): Abierto, Emitido, Pagado, Pago parcial, Vencido. */
export function StatementStatusBadge({ status, f }: { status: CardStatementStatus; f: FormatContext }) {
  return (
    <Badge
      presentation={STATEMENT_PRESENTATION[status]}
      label={f.t(`statementStatus.${status}`)}
      status={status}
      testId="statement-status"
    />
  );
}

/**
 * Utilización del crédito: porcentaje en TEXTO con su nivel (Normal / Atención / Crítica) y una barra con
 * `role="progressbar"`. El color solo refuerza: el texto y el icono dicen lo mismo. Sin tasa para valorar un límite
 * compartido no se inventa un porcentaje: se dice qué falta.
 */
export function UtilizationMeter({
  utilization,
  thresholds,
  f,
  label,
}: {
  utilization: CardUtilization | null;
  thresholds?: readonly string[];
  f: FormatContext;
  /** Nombre accesible de la barra (p. ej. "Utilización de Visa Oro BOB"). */
  label: string;
}) {
  const view = utilizationView(utilization, thresholds);
  const { icon } = UTILIZATION_PRESENTATION[view.level];
  if (view.percent === null) {
    return (
      <p style={{ ...mutedStyle, margin: 0 }} data-testid="utilization" data-level="unknown">
        <span aria-hidden="true">{icon}</span>{' '}
        {view.missingRates.length > 0
          ? f.t('utilization.missingRates', { currencies: view.missingRates.join(', ') })
          : f.t('utilization.unknown')}
      </p>
    );
  }
  const text = f.t('utilization.value', { percent: formatDecimal(view.percent, f.locale) });
  const levelText = view.overdrawn ? f.t('utilization.overdrawn') : f.t(`utilization.level.${view.level}`);
  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="utilization"
      data-level={view.level}
    >
      <p style={{ margin: 0 }}>
        <strong data-testid="utilization-text">{text}</strong>{' '}
        <span style={{ ...badgeStyle, color: LEVEL_COLOR[view.level], borderColor: LEVEL_COLOR[view.level] }}>
          <span aria-hidden="true">{icon}</span> {levelText}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.width}
        aria-valuetext={`${text} · ${levelText}`}
        style={trackStyle}
        data-testid="utilization-bar"
      >
        <div
          aria-hidden="true"
          style={{ width: `${view.width}%`, height: '100%', background: LEVEL_COLOR[view.level] }}
        />
      </div>
    </div>
  );
}
