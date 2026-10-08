import { useId } from 'react';
import type { FormatContext } from '../dashboard/types';
import { inputStyle } from '../common/ui';
import { defaultPeriodId, formatBusinessDate, newestFirst, periodName, type FinancialPeriod } from './logic';

/**
 * Selector de periodo financiero reutilizable (openspec add-financial-periods 6.2; lo usarán pf-p2b y
 * `add-month-closing`). Controlado: sin `value`, muestra el periodo que contiene hoy en la zona del workspace
 * (`today` ya calculado en esa zona). Usa el namespace `Planning` (`selector.*`, `status.*`).
 */
export function PeriodSelector({
  periods,
  today,
  value,
  onChange,
  f,
  label,
  name = 'periodId',
}: {
  periods: readonly FinancialPeriod[];
  today: string;
  value?: string | undefined;
  onChange: (periodId: string) => void;
  f: FormatContext;
  label?: string;
  name?: string;
}) {
  const id = useId();
  const selected = value ?? defaultPeriodId(periods, today) ?? '';
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-1)', minWidth: 0 }}>
      <label htmlFor={id}>{label ?? f.t('selector.label')}</label>
      <select
        id={id}
        name={name}
        style={inputStyle}
        value={selected}
        disabled={periods.length === 0}
        onChange={(e) => onChange(e.target.value)}
        data-testid="period-selector"
      >
        {newestFirst(periods).map((p) => (
          <option key={p.id} value={p.id}>
            {f.t('selector.option', {
              name: periodName(p.label, f.locale),
              from: formatBusinessDate(p.periodStart),
              to: formatBusinessDate(p.periodEnd),
              status: f.t(`status.${p.status}`),
            })}
            {p.periodStart <= today && today <= p.periodEnd ? ` ${f.t('selector.current')}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
