import type { FormatContext } from '../dashboard/types';
import { mutedStyle, rowStyle } from '../common/ui';
import { reasonText, type HistorySuggestion, type SuggestionKind } from './logic';

/**
 * Sugerencia de categoría de una fila de la vista previa del import (add-category-suggestions): la categoría con su nivel
 * de confianza y su motivo, y —para quien escribe— «Aceptar» en la fila. Lo que no se acepta se crea sin categoría.
 */
export function RowSuggestion({
  f,
  suggestion,
  kind,
  line,
  categoryName,
  counterpartyName,
  canEdit,
  busy,
  onAccept,
}: {
  f: FormatContext;
  suggestion: HistorySuggestion;
  kind: SuggestionKind;
  line: number;
  categoryName: (id: string) => string;
  counterpartyName: (id: string | null) => string | undefined;
  canEdit: boolean;
  busy: boolean;
  onAccept: () => void;
}) {
  const category = categoryName(suggestion.categoryId);
  return (
    <div
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
      data-testid="import-row-suggestion"
      data-level={suggestion.level}
      data-category-id={suggestion.categoryId}
    >
      <p style={{ margin: 0 }}>
        <strong>{f.t('import.suggestedLevel', { category, level: f.t(`level.${suggestion.level}`) })}</strong>
      </p>
      <small style={mutedStyle} data-testid="import-row-suggestion-reason">
        {reasonText(f, suggestion, {
          category,
          counterparty: counterpartyName(suggestion.counterpartyId),
          kind,
        })}
      </small>
      {canEdit ? (
        <div style={rowStyle}>
          <button
            type="button"
            disabled={busy}
            data-testid="import-row-suggestion-accept"
            aria-label={f.t('import.acceptAria', { category, line })}
            onClick={onAccept}
          >
            {f.t('import.accept')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
