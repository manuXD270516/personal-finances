import type { CSSProperties } from 'react';
import { badgeStyle } from '../common/ui';
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import {
  DEFINITION_PRESENTATION,
  OCCURRENCE_PRESENTATION,
  type StatusPresentation,
  type Tone,
} from './logic';
import type { OccurrenceStatus, RecurringAmount, RecurringStatus } from './types';

const TONES: Record<Tone, CSSProperties> = {
  ok: { color: 'var(--pf-fin-ok)', borderColor: 'var(--pf-fin-ok)' },
  warn: { color: 'var(--pf-fin-warning)', borderColor: 'var(--pf-fin-warning)' },
  danger: { color: 'var(--pf-fin-over-budget)', borderColor: 'var(--pf-fin-over-budget)' },
  neutral: { color: 'var(--pf-fg)', borderColor: 'var(--pf-border-strong)' },
};

function Badge({
  presentation,
  label,
  status,
  testId,
}: {
  presentation: StatusPresentation;
  label: string;
  status: string;
  testId: string;
}) {
  return (
    <span style={{ ...badgeStyle, ...TONES[presentation.tone] }} data-status={status} data-testid={testId}>
      <span aria-hidden="true">{presentation.icon}</span> {label}
    </span>
  );
}

/**
 * Estado de una ocurrencia con TEXTO + ICONO (NFR-USAB-104): Programada, Próxima, Atrasada, Creada, Vinculada, Omitida,
 * Cancelada. El icono es decorativo (`aria-hidden`); el color solo refuerza.
 */
export function OccurrenceStatusBadge({ status, f }: { status: OccurrenceStatus; f: FormatContext }) {
  return (
    <Badge
      presentation={OCCURRENCE_PRESENTATION[status]}
      label={f.t(`status.${status}`)}
      status={status}
      testId="occurrence-status"
    />
  );
}

/** Estado de una definición (Activa, Pausada, Terminada) con texto + icono. */
export function DefinitionStatusBadge({ status, f }: { status: RecurringStatus; f: FormatContext }) {
  return (
    <Badge
      presentation={DEFINITION_PRESENTATION[status]}
      label={f.t(`definitionStatus.${status}`)}
      status={status}
      testId="definition-status"
    />
  );
}

/**
 * Monto esperado con la escala de su moneda (los strings de la API ya la traen): fijo `199,00 BOB`, estimado
 * `≈ 150,00 BOB`, rango `100,00 – 180,00 BOB` y "Sin monto" para `VARIABLE`.
 */
export function formatExpected(expected: RecurringAmount, f: FormatContext): string {
  switch (expected.type) {
    case 'MIN_MAX': {
      if (!expected.min || !expected.max) return f.t('amount.none');
      return f.t('amount.range', {
        min: formatDecimal(expected.min.amount, f.locale),
        max: formatDecimal(expected.max.amount, f.locale),
        currency: expected.max.currency,
      });
    }
    case 'VARIABLE':
      return f.t('amount.none');
    default: {
      if (!expected.amount) return f.t('amount.none');
      const text = `${formatDecimal(expected.amount.amount, f.locale)} ${expected.amount.currency}`;
      return expected.type === 'ESTIMATED' ? f.t('amount.estimated', { amount: text }) : text;
    }
  }
}

export function AmountText({ expected, f }: { expected: RecurringAmount; f: FormatContext }) {
  return (
    <span data-testid="expected-amount" data-amount-type={expected.type}>
      {formatExpected(expected, f)}
    </span>
  );
}
