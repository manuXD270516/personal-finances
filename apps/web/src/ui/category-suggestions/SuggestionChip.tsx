import type { FormatContext } from '../dashboard/types';
import { mutedStyle, rowStyle, warningStyle } from '../common/ui';
import {
  chipCategoryId,
  reasonText,
  type ChipSuggestion,
  type HistorySuggestion,
  type SuggestionKind,
} from './logic';

const chipStyle = {
  display: 'grid',
  gap: 'var(--pf-space-1)',
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  border: '1px solid var(--pf-border)',
  borderRadius: 'var(--pf-radius-2, 0.5rem)',
  background: 'var(--pf-surface-2, transparent)',
} as const;

/**
 * Sugerencia de categoría (openspec add-category-suggestions): el chip muestra la categoría con su nivel de confianza y
 * su motivo, y ofrece «Aceptar» u «Otra». Nada se asigna sin esa acción (D476). Con una regla de alta manual que
 * clasificará el gasto solo avisa. El texto del nivel acompaña al color: nunca solo color (accesibilidad).
 */
export function SuggestionChip({
  f,
  chip,
  kind,
  categoryName,
  counterpartyName,
  accepted,
  disabled,
  onAccept,
  onOther,
}: {
  f: FormatContext;
  chip: ChipSuggestion;
  kind: SuggestionKind;
  categoryName: (id: string) => string;
  counterpartyName: (id: string | null) => string | undefined;
  /** El usuario ya aceptó la sugerencia (la categoría del formulario es la sugerida). */
  accepted: boolean;
  disabled?: boolean | undefined;
  onAccept: () => void;
  onOther: () => void;
}) {
  if (chip.source === 'RULE_APPLIES') {
    return (
      <p role="status" style={warningStyle} data-testid="category-suggestion-rule">
        {f.t('chip.ruleApplies')}
      </p>
    );
  }
  const categoryId = chipCategoryId(chip) as string;
  const category = categoryName(categoryId);
  const history: HistorySuggestion | null = chip.source === 'HISTORY' ? chip.suggestion : null;
  const label = history
    ? f.t('chip.suggestedLevel', { category, level: f.t(`level.${history.level}`) })
    : chip.source === 'DEFAULT'
      ? f.t('chip.default', { category })
      : f.t('chip.lastUsed', { category });
  return (
    <div
      role="status"
      style={chipStyle}
      data-testid="category-suggestion"
      data-source={chip.source}
      data-level={history?.level ?? ''}
      data-accepted={accepted}
    >
      <p style={{ margin: 0 }}>
        <strong data-testid="category-suggestion-label">
          {accepted ? f.t('chip.accepted', { category }) : label}
        </strong>
      </p>
      {history ? (
        <small style={mutedStyle} data-testid="category-suggestion-reason">
          {reasonText(f, history, {
            category,
            counterparty: counterpartyName(history.counterpartyId),
            kind,
          })}
        </small>
      ) : null}
      {accepted ? null : (
        <div style={rowStyle}>
          <button
            type="button"
            disabled={disabled}
            data-testid="category-suggestion-accept"
            aria-label={f.t('chip.acceptAria', { category })}
            onClick={onAccept}
          >
            {f.t('chip.accept')}
          </button>
          <button
            type="button"
            disabled={disabled}
            data-testid="category-suggestion-other"
            aria-label={f.t('chip.otherAria')}
            onClick={onOther}
          >
            {f.t('chip.other')}
          </button>
        </div>
      )}
    </div>
  );
}
