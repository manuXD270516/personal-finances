import type { CustomFieldValues } from '../common/types';
import { mutedStyle } from '../common/ui';
import { formatLocalDate } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { displayValue, valuesOf, type CustomFieldDefinition } from './logic';

/**
 * Valores de custom fields de un registro (split o cuenta) en solo lectura. Incluye los de campos archivados (el
 * archivado nunca borra historia, INV-019), marcados como tales. `f` es del namespace `CustomFields`.
 */
export function CustomFieldValuesView({
  definitions,
  values,
  f,
  testId = 'custom-field-values',
}: {
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues | undefined;
  f: FormatContext;
  testId?: string;
}) {
  const { t, locale } = f;
  const items = valuesOf(definitions, values);
  if (items.length === 0) return null;
  const labels = {
    yes: t('yes'),
    no: t('no'),
    date: (iso: string) => formatLocalDate(iso, locale),
  };
  return (
    <dl style={{ margin: 0, display: 'grid', gap: '0.125rem' }} data-testid={testId}>
      {items.map(({ def, key, value }) => (
        <div key={key} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 0.5rem' }} data-custom-field={key}>
          <dt style={mutedStyle}>
            {def?.label ?? key}
            {def?.archivedAt ? ` (${t('archivedBadge')})` : ''}
          </dt>
          <dd style={{ margin: 0 }}>{displayValue(def, value, labels)}</dd>
        </div>
      ))}
    </dl>
  );
}
