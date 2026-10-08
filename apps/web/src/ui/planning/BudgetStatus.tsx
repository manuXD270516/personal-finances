import type { CSSProperties } from 'react';
import { badgeStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { statusPresentation, type BudgetLineStatus } from './budget-logic';

const TONES: Record<'ok' | 'warn' | 'danger' | 'neutral', CSSProperties> = {
  ok: { color: 'var(--pf-fin-ok)', borderColor: 'var(--pf-fin-ok)' },
  warn: { color: 'var(--pf-fin-warning)', borderColor: 'var(--pf-fin-warning)' },
  danger: { color: 'var(--pf-fin-over-budget)', borderColor: 'var(--pf-fin-over-budget)' },
  neutral: { color: 'var(--pf-fg)', borderColor: 'var(--pf-border-strong)' },
};

/**
 * Estado de una línea con TEXTO + ICONO (NFR-USAB-104): el color solo refuerza. El icono es decorativo
 * (`aria-hidden`); el texto lo lee el lector de pantalla.
 */
export function BudgetStatusBadge({ status, f }: { status: BudgetLineStatus; f: FormatContext }) {
  const p = statusPresentation(status);
  return (
    <span style={{ ...badgeStyle, ...TONES[p.tone] }} data-status={status} data-testid="budget-status">
      <span aria-hidden="true">{p.icon}</span> {f.t(`status.${p.textKey}`)}
    </span>
  );
}
