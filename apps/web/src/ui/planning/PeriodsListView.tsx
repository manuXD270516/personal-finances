import type { FormatContext } from '../dashboard/types';
import { badgeStyle, cellStyle, mutedStyle, tableStyle, tableWrapStyle } from '../common/ui';
import {
  canActivate,
  containsDate,
  formatBusinessDate,
  newestFirst,
  periodName,
  type FinancialPeriod,
} from './logic';

const pendingBadge = {
  ...badgeStyle,
  borderColor: 'var(--pf-warning-border)',
  background: 'var(--pf-warning-bg)',
  color: 'var(--pf-warning-fg)',
};

/**
 * Lista de periodos (openspec add-financial-periods 6.1): etiqueta y nombre del mes, rango en dd/MM/yyyy, estado,
 * marcas "pendiente de cierre" (terminado y no cerrado, docs/33 D60) y "transición", y activación manual para
 * EDITOR/OWNER de un DRAFT ya iniciado. Presentacional: los textos salen del namespace `Planning`.
 */
export function PeriodsListView({
  periods,
  today,
  canEdit,
  f,
  busyId,
  onActivate,
}: {
  periods: readonly FinancialPeriod[];
  today: string;
  canEdit: boolean;
  f: FormatContext;
  busyId?: string | undefined;
  onActivate?: (period: FinancialPeriod) => void;
}) {
  if (periods.length === 0) {
    return (
      <p data-testid="periods-empty" style={mutedStyle}>
        {f.t('empty')}
      </p>
    );
  }
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="periods-table">
        <caption style={{ ...mutedStyle, textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}>
          {f.t('caption')}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.period')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.range')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.status')}
            </th>
            {canEdit ? (
              <th scope="col" style={cellStyle}>
                {f.t('columns.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {newestFirst(periods).map((p) => {
            const current = containsDate(p, today);
            return (
              <tr
                key={p.id}
                data-testid="period-row"
                data-label={p.label}
                data-status={p.status}
                aria-current={current ? 'date' : undefined}
              >
                <th scope="row" style={{ ...cellStyle, fontWeight: current ? 600 : 400 }}>
                  <span>{periodName(p.label, f.locale)}</span> <span style={mutedStyle}>({p.label})</span>
                  {current ? (
                    <>
                      {' '}
                      <span style={badgeStyle}>{f.t('current')}</span>
                    </>
                  ) : null}
                </th>
                <td style={cellStyle}>
                  {f.t('range', {
                    from: formatBusinessDate(p.periodStart),
                    to: formatBusinessDate(p.periodEnd),
                  })}
                </td>
                <td style={cellStyle}>
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--pf-space-1)' }}>
                    <span style={badgeStyle} data-testid="period-status">
                      {f.t(`status.${p.status}`)}
                    </span>
                    {p.pendingClosure ? (
                      <span style={pendingBadge} data-testid="period-pending-closure">
                        {f.t('pendingClosure')}
                      </span>
                    ) : null}
                    {p.isTransition ? (
                      <span style={badgeStyle} data-testid="period-transition">
                        {f.t('transition')}
                      </span>
                    ) : null}
                  </span>
                </td>
                {canEdit ? (
                  <td style={cellStyle}>
                    {canActivate(p, today, canEdit) && onActivate ? (
                      <button
                        type="button"
                        onClick={() => onActivate(p)}
                        disabled={busyId === p.id}
                        aria-label={f.t('activateLabel', { name: periodName(p.label, f.locale) })}
                      >
                        {f.t('activate')}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
