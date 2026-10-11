import type { ReactNode } from 'react';
import { formatDecimal } from '../AuditHistory';
import {
  cardStyle,
  cellStyle,
  mutedStyle,
  numCellStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { formatMoney, formatSignedMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { definitionPath } from '../recurring/logic';
import { expectedView, isInverse, isReassignment, reversedIds, reservationsHref } from './logic';
import {
  DeviationText,
  ExpectedText,
  GoalProgressBar,
  IncompleteMark,
  OverAllocatedMark,
  RequiredText,
} from './parts';
import type { Goal, GoalMovement, GoalSimulation } from './types';

/** Piezas presentacionales del detalle de una meta (resumen, cuentas, plan, simulación y movimientos). */

const h2Style = { fontSize: '1rem', marginTop: 0 } as const;

/** Progreso, restante y cifras de seguimiento (requerido, ritmo, fecha esperada, desvío). */
export function GoalOverview({ goal, f }: { goal: Goal; f: FormatContext }) {
  const { progress } = goal;
  const rows: [string, string, ReactNode][] = [
    [f.t('overview.remaining'), 'goal-remaining', formatMoney(progress.remaining, f.locale)],
    [f.t('overview.target'), 'goal-target', formatMoney(goal.target, f.locale)],
    [
      f.t('overview.targetDate'),
      'goal-target-date',
      goal.targetDate ? formatBusinessDate(goal.targetDate) : f.t('list.noDate'),
    ],
    [f.t('overview.required'), 'goal-required', <RequiredText key="r" required={goal.required} f={f} />],
    [
      f.t('overview.pace'),
      'goal-pace',
      goal.pace.amount
        ? f.t('overview.paceValue', {
            amount: formatMoney(goal.pace.amount, f.locale),
            periods: goal.pace.periods,
            source: f.t(`pace.${goal.pace.source}`),
          })
        : f.t('expected.noPace'),
    ],
    [f.t('overview.expected'), 'goal-expected', <ExpectedText key="e" view={expectedView(goal)} f={f} />],
    [f.t('overview.deviation'), 'goal-deviation', <DeviationText key="d" tracking={goal.tracking} f={f} />],
    [
      f.t('overview.tolerance'),
      'goal-tolerance',
      `${formatDecimal(goal.tolerancePercent, f.locale)} % · ${f.t('overview.paceWindow', { periods: goal.pacePeriods })}`,
    ],
    [f.t('overview.startDate'), 'goal-start-date', formatBusinessDate(goal.startDate)],
  ];
  if (goal.closedOn)
    rows.push([f.t('overview.closedOn'), 'goal-closed-on', formatBusinessDate(goal.closedOn)]);
  if (goal.cancelledOn)
    rows.push([f.t('overview.cancelledOn'), 'goal-cancelled-on', formatBusinessDate(goal.cancelledOn)]);
  if (goal.cancelReason) rows.push([f.t('overview.cancelReason'), 'goal-cancel-reason', goal.cancelReason]);
  return (
    <section aria-labelledby="goal-overview-title" style={cardStyle} data-testid="goal-overview">
      <h2 id="goal-overview-title" style={h2Style}>
        {f.t('overview.title')}
      </h2>
      <GoalProgressBar
        percent={progress.percent}
        label={f.t('progress.aria', { name: goal.name })}
        f={f}
        current={progress.total}
        target={goal.target}
        testIdPrefix="goal"
      />
      {!progress.complete ? (
        <p role="status" style={{ ...warningStyle, margin: 'var(--pf-space-2) 0 0' }}>
          <IncompleteMark f={f} unconverted={progress.unconverted} />
        </p>
      ) : null}
      {progress.byCurrency.length > 1 ? (
        <ul
          style={{ ...mutedStyle, margin: 'var(--pf-space-2) 0 0', paddingLeft: '1.25rem' }}
          data-testid="goal-by-currency"
        >
          {progress.byCurrency.map((m) => (
            <li key={m.currency}>{formatMoney(m, f.locale)}</li>
          ))}
        </ul>
      ) : null}
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
          gap: 'var(--pf-space-1) var(--pf-space-4)',
          margin: 'var(--pf-space-3) 0 0',
        }}
      >
        {rows.map(([label, testId, value]) => (
          <div key={testId} style={{ display: 'contents' }}>
            <dt style={mutedStyle}>{label}</dt>
            <dd style={{ margin: 0 }} data-testid={testId}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {goal.notes ? <p style={{ ...mutedStyle, marginBottom: 0 }}>{goal.notes}</p> : null}
    </section>
  );
}

/** Cuentas vinculadas con los fondos reales y las reservas de la meta; marca las sobre-asignadas. */
export function LinkedAccountsTable({
  goal,
  f,
  accountName,
  href,
}: {
  goal: Goal;
  f: FormatContext;
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
}) {
  return (
    <section aria-labelledby="goal-accounts-title" style={cardStyle} data-testid="goal-linked-accounts">
      <h2 id="goal-accounts-title" style={h2Style}>
        {f.t('accounts.title')}
      </h2>
      {goal.linkedAccounts.length === 0 ? (
        <p style={mutedStyle}>{f.t('accounts.none')}</p>
      ) : (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('accounts.region')}>
          <table style={tableStyle}>
            <caption className="pf-sr-only">{f.t('accounts.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('accounts.account')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('accounts.real')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('accounts.earmark')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('accounts.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {goal.linkedAccounts.map((l) => (
                <tr key={l.accountId} data-testid="goal-linked-account" data-account-id={l.accountId}>
                  <th scope="row" style={cellStyle}>
                    <a href={href(`/cuentas/${l.accountId}`)}>{accountName(l.accountId) ?? '…'}</a>
                  </th>
                  <td style={numCellStyle}>{formatMoney(l.funds.real, f.locale)}</td>
                  <td style={numCellStyle}>{formatMoney(l.funds.earmark, f.locale)}</td>
                  <td style={cellStyle}>
                    {l.overAllocated ? (
                      <>
                        <OverAllocatedMark f={f} />{' '}
                        <a href={href(reservationsHref(l.accountId))}>{f.t('accounts.seeReservations')}</a>
                      </>
                    ) : (
                      <span style={mutedStyle}>{f.t('accounts.ok')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Plan mensual y programación recurrente. Con aporte recurrente la definición la administra la meta (sin acciones
 * de usuario en Recurrentes) y puede haber un "aporte en proceso" esperando su transferencia posteada.
 */
export function PlanCard({
  goal,
  f,
  href,
  accountName,
  actions,
}: {
  goal: Goal;
  f: FormatContext;
  href: (path: string) => string;
  accountName: (id: string) => string | undefined;
  actions?: ReactNode;
}) {
  const plan = goal.plan;
  return (
    <section aria-labelledby="goal-plan-title" style={cardStyle} data-testid="goal-plan">
      <h2 id="goal-plan-title" style={h2Style}>
        {f.t('plan.title')}
      </h2>
      {!plan ? (
        <p style={mutedStyle} data-testid="goal-plan-none">
          {f.t('plan.none')}
        </p>
      ) : (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
              gap: 'var(--pf-space-1) var(--pf-space-4)',
              margin: 0,
            }}
          >
            <dt style={mutedStyle}>{f.t('plan.monthly')}</dt>
            <dd style={{ margin: 0 }} data-testid="goal-plan-monthly">
              {formatMoney(plan.monthlyAmount, f.locale)}
            </dd>
            <dt style={mutedStyle}>{f.t('panels.fund')}</dt>
            <dd style={{ margin: 0 }}>{f.t(`funds.${plan.fund}`)}</dd>
            {plan.dayOfMonth !== null ? (
              <>
                <dt style={mutedStyle}>{f.t('plan.dayOfMonth')}</dt>
                <dd style={{ margin: 0 }}>{plan.dayOfMonth}</dd>
              </>
            ) : null}
            {plan.automation === 'RECURRING' ? (
              <>
                <dt style={mutedStyle}>{f.t('plan.source')}</dt>
                <dd style={{ margin: 0 }}>
                  {plan.sourceAccountId ? (accountName(plan.sourceAccountId) ?? '…') : '—'}
                </dd>
                <dt style={mutedStyle}>{f.t('plan.destination')}</dt>
                <dd style={{ margin: 0 }}>
                  {plan.destinationAccountId ? (accountName(plan.destinationAccountId) ?? '…') : '—'}
                </dd>
                {plan.materialization ? (
                  <>
                    <dt style={mutedStyle}>{f.t('plan.materialization')}</dt>
                    <dd style={{ margin: 0 }} data-testid="goal-plan-mode">
                      {f.t(`plan.modes.${plan.materialization.mode}`)}
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
          {plan.automation === 'RECURRING' ? (
            <p role="note" style={{ margin: 'var(--pf-space-2) 0 0' }} data-testid="goal-plan-managed">
              <span aria-hidden="true">ℹ</span> {f.t('plan.managedNotice')}{' '}
              {plan.definitionId ? (
                <a href={href(definitionPath(plan.definitionId))}>{f.t('plan.viewDefinition')}</a>
              ) : null}
            </p>
          ) : (
            <p style={{ ...mutedStyle, margin: 'var(--pf-space-2) 0 0' }}>{f.t('plan.manualNotice')}</p>
          )}
          {plan.pendingContribution ? (
            <p
              role="status"
              style={{ ...warningStyle, margin: 'var(--pf-space-2) 0 0' }}
              data-testid="goal-plan-pending"
            >
              <span aria-hidden="true">⏳</span> {f.t('plan.pending')}
            </p>
          ) : null}
        </>
      )}
      {actions}
    </section>
  );
}

/** Resultado de la simulación what-if: no persiste nada. */
export function SimulationResult({ sim, f }: { sim: GoalSimulation; f: FormatContext }) {
  const rows: [string, string, ReactNode][] = [
    [
      f.t('simulation.required'),
      'sim-required',
      <RequiredText key="r" required={{ monthly: sim.requiredMonthly, overdue: sim.overdue }} f={f} />,
    ],
    [f.t('simulation.periods'), 'sim-periods', sim.periods === null ? '—' : String(sim.periods)],
    [
      f.t('simulation.expected'),
      'sim-expected',
      <ExpectedText
        key="e"
        view={expectedView({ status: sim.tracking.lifecycleStatus, expectedDate: sim.expectedDate })}
        f={f}
      />,
    ],
    [
      f.t('simulation.progress'),
      'sim-progress',
      f.t('progress.percent', { percent: formatDecimal(sim.progress.percent, f.locale) }),
    ],
  ];
  return (
    <div style={cardStyle} role="status" data-testid="goal-simulation-result">
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('simulation.notSaved')}</p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(8rem, max-content) 1fr',
          gap: 'var(--pf-space-1) var(--pf-space-4)',
          margin: 'var(--pf-space-2) 0 0',
        }}
      >
        {rows.map(([label, testId, value]) => (
          <div key={testId} style={{ display: 'contents' }}>
            <dt style={mutedStyle}>{label}</dt>
            <dd style={{ margin: 0 }} data-testid={testId}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Movimientos de la meta, del más reciente al más antiguo: los inversos y las reasignaciones se distinguen con
 * texto (no solo color) y el movimiento revertido queda marcado sin borrarse (los movimientos son inmutables).
 */
export function MovementsTable({
  movements,
  f,
  accountName,
  href,
}: {
  movements: readonly GoalMovement[];
  f: FormatContext;
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
}) {
  if (movements.length === 0)
    return (
      <p style={mutedStyle} data-testid="goal-movements-empty">
        {f.t('movements.empty')}
      </p>
    );
  const reversed = reversedIds(movements);
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('movements.region')}>
      <table style={tableStyle} data-testid="goal-movements">
        <caption className="pf-sr-only">{f.t('movements.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('movements.date')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('movements.kind')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('movements.account')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('movements.amount')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('movements.origin')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('movements.detail')}
            </th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr
              key={m.id}
              data-testid="goal-movement"
              data-movement={m.movement}
              data-fund={m.fund}
              data-reversed={reversed.has(m.id) ? 'true' : 'false'}
            >
              <td style={cellStyle}>{formatBusinessDate(m.occurredOn)}</td>
              <th scope="row" style={{ ...cellStyle, fontWeight: 400 }}>
                <span style={reversed.has(m.id) ? { textDecoration: 'line-through' } : undefined}>
                  {f.t(`movementKinds.${m.movement}`)}
                </span>{' '}
                <span style={mutedStyle}>({f.t(`funds.${m.fund}`)})</span>
                {reversed.has(m.id) ? (
                  <div data-testid="goal-movement-reversed">
                    <span aria-hidden="true">↺</span> {f.t('movements.reversed')}
                  </div>
                ) : null}
                {isInverse(m) ? (
                  <div style={mutedStyle} data-testid="goal-movement-inverse">
                    {f.t('movements.inverseOf')}
                  </div>
                ) : null}
                {isReassignment(m) && m.reassignmentId ? (
                  <div style={mutedStyle} data-testid="goal-movement-reassignment">
                    {f.t('movements.reassignment', { id: m.reassignmentId.slice(0, 8) })}
                  </div>
                ) : null}
              </th>
              <td style={cellStyle}>{accountName(m.accountId) ?? '…'}</td>
              <td style={numCellStyle} data-testid="goal-movement-amount">
                {formatSignedMoney(m.amount, f.locale)}
              </td>
              <td style={cellStyle}>{f.t(`origins.${m.origin}`)}</td>
              <td style={cellStyle}>
                {m.note ? <div>{m.note}</div> : null}
                {m.transactionId ? (
                  <a href={href(`/transacciones/${m.transactionId}`)}>{f.t('movements.viewTransaction')}</a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
