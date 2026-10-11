'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  Field,
  cellStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { useCatalogs } from '../transactions/catalogs';
import { goalsHref, goalsPath, goalsQuery, expectedView, GOAL_FILTERS, type GoalFilter } from './logic';
import {
  ExpectedText,
  GoalProgressBar,
  GoalStatusBadge,
  IncompleteMark,
  OverAllocatedMark,
  RatesUsed,
  RequiredText,
} from './parts';
import { SuggestionsTray } from './Suggestions';
import type { Goal, GoalList } from './types';

/** Tabla de metas: progreso (barra + porcentaje en texto), estado, requerido mensual, fecha esperada y objetivo. */
export function GoalsTable({
  goals,
  f,
  href,
}: {
  goals: readonly Goal[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('list.region')}>
      <table style={tableStyle} data-testid="goals-table">
        <caption className="pf-sr-only">{f.t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('list.name')}
            </th>
            <th scope="col" style={{ ...cellStyle, minWidth: '12rem' }}>
              {f.t('list.progress')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.status')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('list.required')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.expected')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.targetDate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr
              key={g.id}
              data-testid="goal-row"
              data-goal-id={g.id}
              data-status={g.status}
              data-name={g.name}
              data-over-allocated={g.overAllocated ? 'true' : 'false'}
            >
              <th scope="row" style={cellStyle}>
                <a href={href(goalsHref(g.id))} data-testid="goal-link">
                  {g.name}
                </a>
                <div style={mutedStyle}>
                  {f.t(`types.${g.type}`)} · {f.t('list.priority', { priority: g.priority })}
                </div>
                {g.overAllocated ? <OverAllocatedMark f={f} /> : null}
                {g.archivedAt ? (
                  <div style={mutedStyle} data-testid="goal-archived">
                    {f.t('list.archived')}
                  </div>
                ) : null}
              </th>
              <td style={cellStyle}>
                <GoalProgressBar
                  percent={g.progress.percent}
                  label={f.t('progress.aria', { name: g.name })}
                  f={f}
                  current={g.progress.total}
                  target={g.target}
                />
                {!g.progress.complete ? <IncompleteMark f={f} unconverted={g.progress.unconverted} /> : null}
              </td>
              <td style={cellStyle}>
                <GoalStatusBadge tracking={g.tracking} f={f} />
              </td>
              <td style={numCellStyle} data-testid="goal-required">
                <RequiredText required={g.required} f={f} />
              </td>
              <td style={cellStyle} data-testid="goal-expected">
                <ExpectedText view={expectedView(g)} f={f} />
              </td>
              <td style={cellStyle} data-testid="goal-target-date">
                {g.targetDate ? formatBusinessDate(g.targetDate) : f.t('list.noDate')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `/goals`: listado de metas con filtro por estado, bandeja de sugerencias y enlace a las reservas por cuenta. */
export function GoalsListPage() {
  return <WithWorkspace>{(ctx) => <GoalsHome ctx={ctx} />}</WithWorkspace>;
}

function GoalsHome({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Goals', ctx);
  const dashboard = useFormat('Dashboard', ctx);
  const catalogs = useCatalogs(ctx);
  const [filter, setFilter] = useState<GoalFilter>('OPEN');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [list, setList] = useState<GoalList | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const { api, base } = ctx;

  const load = useCallback(async () => {
    try {
      const q = goalsQuery(filter, includeArchived).toString();
      const r = await api.get<GoalList>(q ? `${goalsPath(base)}?${q}` : goalsPath(base));
      setList(r.data);
      setProblem(undefined);
    } catch (err) {
      setList(undefined);
      setProblem(problemOf(err));
    }
  }, [api, base, filter, includeArchived]);
  useEffect(() => {
    setList(undefined);
    void load();
  }, [load]);

  return (
    <section aria-labelledby="goals-title" style={pageStyle} data-testid="goals-page">
      <h1 id="goals-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      <div style={rowStyle}>
        {ctx.canEdit ? (
          <a href={ctx.href('/goals/nuevo')} data-testid="new-goal">
            {f.t('list.new')}
          </a>
        ) : (
          <span style={mutedStyle}>{f.t('viewerNotice')}</span>
        )}
        <a href={ctx.href('/goals/reservas')} data-testid="goals-reservations-link">
          {f.t('list.reservations')}
        </a>
      </div>
      <div style={rowStyle} role="group" aria-label={f.t('list.filters')}>
        <Field label={f.t('list.filter')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={filter}
              data-testid="goals-filter"
              onChange={(e) => setFilter(e.target.value as GoalFilter)}
            >
              {GOAL_FILTERS.map((k) => (
                <option key={k} value={k}>
                  {f.t(`filters.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={includeArchived}
            data-testid="goals-include-archived"
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {f.t('list.includeArchived')}
        </label>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {list === undefined && !problem ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : list && list.data.length === 0 ? (
        <p style={mutedStyle} data-testid="goals-empty">
          {filter === 'OPEN' && !includeArchived ? f.t('list.empty') : f.t('list.emptyFiltered')}
        </p>
      ) : list ? (
        <>
          <GoalsTable goals={list.data} f={f} href={ctx.href} />
          <RatesUsed
            rates={list.meta.ratesUsed}
            windowDays={list.meta.rateWindowDays}
            f={f}
            dashboard={dashboard}
          />
        </>
      ) : null}
      <SuggestionsTray
        ctx={ctx}
        accountName={(id) => catalogs.names.account(id)}
        onChanged={() => void load()}
      />
    </section>
  );
}
