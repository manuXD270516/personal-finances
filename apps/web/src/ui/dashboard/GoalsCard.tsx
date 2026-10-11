import { formatDecimal } from '../AuditHistory';
import {
  barWidth,
  GOAL_STATUS_PRESENTATION,
  homeExpectedView,
  statusView,
  TRACKING_PRESENTATION,
} from '../goals/logic';
import type { GoalHomeItem } from '../goals/types';
import { formatBusinessDate } from '../planning/logic';
import { formatMoney } from './format';
import { statusOf } from './QuestionWidgets';
import type { FormatContext, ReportSummary } from './types';

function GoalItem({
  item,
  ctx,
  goalHref,
}: {
  item: GoalHomeItem;
  ctx: FormatContext;
  goalHref: string | undefined;
}) {
  const { t, locale } = ctx;
  const view = statusView(item.tracking);
  const presentation =
    view.kind === 'TRACKING' ? TRACKING_PRESENTATION[view.value] : GOAL_STATUS_PRESENTATION[view.value];
  const label =
    view.kind === 'TRACKING' ? t(`goals.tracking.${view.value}`) : t(`goals.status.${view.value}`);
  const percentText = t('goals.percent', { percent: formatDecimal(item.percent, locale) });
  const detail = t('goals.progressOf', {
    current: formatDecimal(item.progress.amount, locale),
    target: formatMoney(item.target, locale),
  });
  const expected = homeExpectedView(item);
  return (
    <li
      className="pf-home-card"
      data-testid="home-goal"
      data-goal-id={item.goalId}
      data-status={view.value}
      data-over-allocated={item.overAllocated ? 'true' : 'false'}
    >
      <h4 className="pf-home-goal-name">{goalHref ? <a href={goalHref}>{item.name}</a> : item.name}</h4>
      <p>
        <strong data-testid="home-goal-percent">{percentText}</strong>{' '}
        <span className="pf-home-muted" data-testid="home-goal-detail">
          · {detail}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label={t('goals.aria', { name: item.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barWidth(item.percent)}
        aria-valuetext={`${percentText} · ${detail}`}
        className="pf-home-meter"
        data-testid="home-goal-bar"
      >
        <span
          className="pf-home-meter-fill"
          data-kind="goal"
          style={{ width: `${barWidth(item.percent)}%` }}
        />
      </div>
      <p>
        <span className="pf-home-badge" data-tone={presentation.tone} data-testid="home-goal-status">
          <span aria-hidden="true">{presentation.icon}</span> {label}
        </span>
        {item.overAllocated ? (
          <>
            {' '}
            <span className="pf-home-badge" data-tone="warn" data-testid="home-goal-over-allocated">
              <span aria-hidden="true">⚠</span> {t('goals.overAllocated')}
            </span>
          </>
        ) : null}
        {!item.complete ? (
          <>
            {' '}
            <span className="pf-home-muted" data-testid="home-goal-partial">
              <span aria-hidden="true">ⓘ</span> {t('goals.partial')}
            </span>
          </>
        ) : null}
      </p>
      <p className="pf-home-muted" data-testid="home-goal-required">
        {item.requiredMonthly
          ? item.overdue
            ? t('goals.requiredOverdue', { amount: formatMoney(item.requiredMonthly, locale) })
            : t('goals.required', { amount: formatMoney(item.requiredMonthly, locale) })
          : t('goals.requiredNone')}
      </p>
      <p className="pf-home-muted" data-testid="home-goal-expected">
        {expected.kind === 'DATE'
          ? t('goals.expected', { date: formatBusinessDate(expected.date) })
          : expected.kind === 'NO_PACE'
            ? t('goals.noPace')
            : t('goals.expectedNone')}
      </p>
    </li>
  );
}

/**
 * Q9 "¿Voy a cumplir mis metas?" (add-savings-goals): hasta 3 metas por prioridad y fecha objetivo con progreso en
 * texto y barra, estado (texto + icono), requerido mensual y fecha esperada; "N más" y, sin metas, un estado vacío con
 * "Crear meta" (nunca un 0 % inventado). Tolera que el bloque falte en la respuesta.
 */
export function GoalsCard({
  summary,
  ctx,
  goalsHref,
  createGoalHref,
  goalHref,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  goalsHref?: string | undefined;
  createGoalHref?: string | undefined;
  goalHref?: ((goalId: string) => string) | undefined;
}) {
  const { t } = ctx;
  const q9 = statusOf(summary, 'Q9');
  const block = summary.goals ?? null;
  if (!block && q9.status !== 'NO_DATA') return null;
  const empty = block ? block.status === 'NO_DATA' || block.items.length === 0 : true;
  return (
    <section
      data-testid="question-Q9"
      data-question="Q9"
      data-status={empty ? 'NO_DATA' : 'AVAILABLE'}
      aria-labelledby="question-Q9-title"
      className="pf-home-group"
    >
      <div className="pf-home-group-head">
        <h2 id="question-Q9-title">{t('questions.Q9')}</h2>
        {goalsHref ? (
          <p className="pf-home-muted" style={{ margin: 0 }}>
            <a href={goalsHref} data-testid="home-goals-link">
              {t('goals.viewAll')}
            </a>
          </p>
        ) : null}
      </div>
      {empty || !block ? (
        <div className="pf-home-empty" data-testid="question-Q9-no-data">
          <p>{t('goals.empty')}</p>
          {createGoalHref ? (
            <p>
              <a href={createGoalHref} data-testid="home-create-goal" data-action="CREATE_GOAL">
                {t('goals.create')}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="pf-home-list pf-home-goals" data-testid="home-goals">
            {block.items.map((item) => (
              <GoalItem key={item.goalId} item={item} ctx={ctx} goalHref={goalHref?.(item.goalId)} />
            ))}
          </ul>
          {block.moreCount > 0 ? (
            <p className="pf-home-muted" data-testid="home-goals-more">
              {goalsHref ? (
                <a href={goalsHref}>{t('goals.more', { count: block.moreCount })}</a>
              ) : (
                t('goals.more', { count: block.moreCount })
              )}
            </p>
          ) : null}
          {!block.complete ? (
            <p className="pf-home-warning" role="status" data-testid="home-goals-incomplete">
              {t('goals.incomplete')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
