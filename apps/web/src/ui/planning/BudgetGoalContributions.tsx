import { cardStyle, cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import type { BudgetGoalContributions } from '../goals/types';

/**
 * Aportes a metas del periodo (add-savings-goals, solo lectura): por meta con plan activa, lo planificado, lo
 * aportado y lo pendiente, y el total pendiente. NO son líneas del plan ni cambian el disponible para gastar.
 * Tolera que la sección falte (respuestas anteriores a la fase 4) y no se muestra sin metas planificadas.
 */
export function BudgetGoalContributionsView({
  section,
  f,
  href,
}: {
  section: BudgetGoalContributions | null | undefined;
  f: FormatContext;
  href: (path: string) => string;
}) {
  if (!section || section.items.length === 0) return null;
  const { pendingTotal } = section;
  const money = (m: Parameters<typeof formatMoney>[0]) => formatMoney(m, f.locale);
  return (
    <section
      aria-labelledby="budget-goals-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)', minWidth: 0 }}
      data-testid="budget-goal-contributions"
    >
      <h2 id="budget-goals-title" style={{ margin: 0 }}>
        {f.t('goalContributions.title')}
      </h2>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('goalContributions.intro')}</p>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('goalContributions.region')}>
        <table style={tableStyle}>
          <caption className="pf-sr-only">{f.t('goalContributions.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('goalContributions.goal')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('goalContributions.planned')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('goalContributions.contributed')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {f.t('goalContributions.pending')}
              </th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => (
              <tr key={item.goalId} data-testid="budget-goal-row" data-goal-id={item.goalId}>
                <th scope="row" style={cellStyle}>
                  <a href={href(`/goals/${item.goalId}`)}>{item.name}</a>
                </th>
                <td style={numCellStyle}>{money(item.planned)}</td>
                <td style={numCellStyle}>{money(item.contributed)}</td>
                <td style={numCellStyle} data-testid="budget-goal-pending">
                  {money(item.pending)}
                  {!/^-?0*(\.0*)?$/.test(item.exceededBy.amount) ? (
                    <div style={mutedStyle} data-testid="budget-goal-exceeded">
                      {f.t('goalContributions.exceededBy', { amount: money(item.exceededBy) })}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0 }} data-testid="budget-goal-pending-total">
        <strong>{f.t('goalContributions.pendingTotal')}</strong>{' '}
        {pendingTotal.base
          ? money(pendingTotal.base)
          : pendingTotal.native.length > 0
            ? pendingTotal.native.map((m) => money(m)).join(', ')
            : money({ amount: '0.00', currency: section.items[0]!.planned.currency })}
        {!pendingTotal.complete ? (
          <span style={mutedStyle} data-testid="budget-goal-incomplete">
            {' '}
            · {f.t('goalContributions.incomplete')}
          </span>
        ) : null}
      </p>
    </section>
  );
}
