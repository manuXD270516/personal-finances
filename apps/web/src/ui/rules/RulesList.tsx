'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Tabs } from '../common/Tabs';
import {
  ConfirmPanel,
  badgeStyle,
  cellStyle,
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
import { CoveragePanel } from './Coverage';
import { DryRunPanel } from './DryRun';
import { actionTarget, moveId, rulesPath, type NameResolver } from './logic';
import { RuleStatusBadge, TriggerList } from './parts';
import type { Rule, RuleList } from './types';

/** Tabla de reglas en orden de evaluación: estado, disparadores, resumen, estadísticas y acciones por regla. */
export function RulesTable({
  rules,
  f,
  href,
  names,
  canEdit,
  busy,
  onMove,
  onToggle,
  onArchive,
}: {
  rules: readonly Rule[];
  f: FormatContext;
  href: (path: string) => string;
  names: NameResolver;
  canEdit: boolean;
  busy: boolean;
  onMove?: (rule: Rule, delta: -1 | 1) => void;
  onToggle?: (rule: Rule) => void;
  onArchive?: (rule: Rule) => void;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('list.region')}>
      <table style={tableStyle} data-testid="rules-table">
        <caption className="pf-sr-only">{f.t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('list.priority')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.name')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.summary')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.stats')}
            </th>
            {canEdit ? (
              <th scope="col" style={cellStyle}>
                {f.t('list.actions')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr
              key={r.id}
              data-testid="rule-row"
              data-rule-id={r.id}
              data-name={r.name}
              data-status={r.status}
              data-attention={r.needsAttention ? 'true' : 'false'}
            >
              <td style={numCellStyle}>{r.priority}</td>
              <th scope="row" style={cellStyle}>
                <a href={href(`/reglas/${r.id}`)} data-testid="rule-link">
                  {r.name}
                </a>
                <div style={mutedStyle}>{f.t('list.version', { version: r.version })}</div>
                {r.needsAttention ? (
                  <div>
                    <span style={badgeStyle} data-testid="rule-attention">
                      <span aria-hidden="true">⚠</span> {f.t('list.attention')}
                    </span>
                  </div>
                ) : null}
              </th>
              <td style={cellStyle}>
                <RuleStatusBadge status={r.status} f={f} />
                <div style={mutedStyle}>
                  <TriggerList triggers={r.triggers} f={f} />
                </div>
              </td>
              <td style={cellStyle}>
                <div>
                  {f.t('list.conditionsCount', { count: r.conditions.length })} ·{' '}
                  {f.t(`match.${r.matchMode}`)}
                </div>
                <div style={mutedStyle}>
                  {r.actions
                    .map((a) => {
                      const target = actionTarget(a, names);
                      return target
                        ? `${f.t(`actionTypes.${a.type}`)}: ${target}`
                        : f.t(`actionTypes.${a.type}`);
                    })
                    .join(' · ')}
                </div>
              </td>
              <td style={cellStyle}>
                {r.stats ? (
                  <>
                    <div data-testid="rule-classified">
                      {f.t('list.classified', { count: r.stats.classifiedTransactions })}
                    </div>
                    <div style={mutedStyle}>
                      {r.stats.lastAppliedAt
                        ? f.t('list.lastApplied', {
                            date: formatBusinessDate(r.stats.lastAppliedAt.slice(0, 10)),
                          })
                        : f.t('list.neverApplied')}
                    </div>
                    {r.stats.unusedFor90Days ? (
                      <span style={badgeStyle} data-testid="rule-unused">
                        <span aria-hidden="true">◌</span> {f.t('list.unused')}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </td>
              {canEdit ? (
                <td style={cellStyle}>
                  {r.status !== 'ARCHIVED' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-1)' }}>
                      {onMove ? (
                        <>
                          <button
                            type="button"
                            disabled={busy || i === 0}
                            onClick={() => onMove(r, -1)}
                            data-testid="rule-move-up"
                            aria-label={f.t('list.moveUp', { name: r.name })}
                          >
                            <span aria-hidden="true">↑</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy || i === rules.length - 1}
                            onClick={() => onMove(r, 1)}
                            data-testid="rule-move-down"
                            aria-label={f.t('list.moveDown', { name: r.name })}
                          >
                            <span aria-hidden="true">↓</span>
                          </button>
                        </>
                      ) : null}
                      {onToggle ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onToggle(r)}
                          data-testid="rule-toggle"
                        >
                          {r.enabled ? f.t('list.disable') : f.t('list.enable')}
                        </button>
                      ) : null}
                      {onArchive ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onArchive(r)}
                          data-testid="rule-archive"
                        >
                          {f.t('list.archive')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `/reglas`: reglas, ejecución sobre el historial (dry-run) y cobertura de clasificación en pestañas. */
export function RulesPage() {
  return <WithWorkspace>{(ctx) => <RulesHome ctx={ctx} />}</WithWorkspace>;
}

function RulesHome({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Rules', ctx);
  return (
    <section aria-labelledby="rules-title" style={pageStyle} data-testid="rules-page">
      <h1 id="rules-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      <Tabs
        label={f.t('tabs.label')}
        idPrefix="rules"
        tabs={[
          { id: 'rules', label: f.t('tabs.rules'), content: <RulesTab ctx={ctx} /> },
          { id: 'run', label: f.t('tabs.run'), content: <DryRunPanel ctx={ctx} /> },
          { id: 'coverage', label: f.t('tabs.coverage'), content: <CoveragePanel ctx={ctx} /> },
        ]}
      />
    </section>
  );
}

function RulesTab({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Rules', ctx);
  const catalogs = useCatalogs(ctx);
  const [list, setList] = useState<RuleList | undefined>();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [archiving, setArchiving] = useState<Rule | undefined>();
  const { api, base } = ctx;

  const load = useCallback(async () => {
    try {
      const r = await api.get<RuleList>(
        `${rulesPath(base)}${includeArchived ? '?includeArchived=true' : ''}`,
      );
      setList(r.data);
      setProblem(undefined);
    } catch (err) {
      setList(undefined);
      setProblem(problemOf(err));
    }
  }, [api, base, includeArchived]);
  useEffect(() => {
    setList(undefined);
    void load();
  }, [load]);

  const names: NameResolver = useMemo(
    () => ({
      category: catalogs.names.category,
      tag: catalogs.names.tag,
      counterparty: catalogs.names.counterparty,
      account: catalogs.names.account,
    }),
    [catalogs.names],
  );

  const run = async (op: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await op();
      setProblem(undefined);
      await load();
      if (message) setAnnounce(message);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  const move = (rule: Rule, delta: -1 | 1) => {
    const ids = (list?.data ?? []).filter((r) => r.status !== 'ARCHIVED').map((r) => r.id);
    const next = moveId(ids, rule.id, delta);
    if (next.join() === ids.join()) return;
    void run(
      () => api.command('PUT', rulesPath(base, '/order'), { ruleIds: next }, { idempotent: false }),
      f.t('list.moved', { name: rule.name, position: next.indexOf(rule.id) + 1 }),
    );
  };

  const toggle = (rule: Rule) =>
    void run(() =>
      api.command('POST', rulesPath(base, `/${rule.id}/${rule.enabled ? 'disable' : 'enable'}`), undefined, {
        ifMatch: rule.rowVersion,
        idempotent: false,
      }),
    );

  const archive = (rule: Rule) =>
    void run(
      () =>
        api.command('POST', rulesPath(base, `/${rule.id}/archive`), undefined, {
          ifMatch: rule.rowVersion,
          idempotent: false,
        }),
      f.t('list.archived', { name: rule.name }),
    ).then(() => setArchiving(undefined));

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
      <div style={rowStyle}>
        {ctx.canEdit ? (
          <a href={ctx.href('/reglas/nueva')} data-testid="new-rule">
            {f.t('list.new')}
          </a>
        ) : (
          <span style={mutedStyle}>{f.t('viewerNotice')}</span>
        )}
        <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={includeArchived}
            data-testid="rules-include-archived"
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {f.t('list.includeArchived')}
        </label>
      </div>
      <p style={mutedStyle}>{f.t('list.orderHint')}</p>
      <div role="status" aria-live="polite" className="pf-sr-only" data-testid="rules-announce">
        {announce}
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {archiving ? (
        <ConfirmPanel
          title={f.t('list.archiveTitle', { name: archiving.name })}
          description={f.t('list.archiveBody')}
          confirmLabel={f.t('list.archive')}
          cancelLabel={f.t('list.cancel')}
          busy={busy}
          onConfirm={() => archive(archiving)}
          onCancel={() => setArchiving(undefined)}
          testId="rule-archive-confirm"
        />
      ) : null}
      {list === undefined && !problem ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : list && list.data.length === 0 ? (
        <p style={mutedStyle} data-testid="rules-empty">
          {f.t('list.empty')}
        </p>
      ) : list ? (
        <RulesTable
          rules={list.data}
          f={f}
          href={ctx.href}
          names={names}
          canEdit={ctx.canEdit}
          busy={busy}
          onMove={move}
          onToggle={toggle}
          onArchive={setArchiving}
        />
      ) : null}
    </div>
  );
}
