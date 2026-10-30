'use client';

import { useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  Field,
  cardStyle,
  cellStyle,
  inputStyle,
  mutedStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useCatalogs, type Catalogs } from '../transactions/catalogs';
import { APPLY_PAGE_SIZE, applicableItems, changeFieldKey, chunk, rulesPath } from './logic';
import type { DryRun, DryRunApplyResult, DryRunChange, DryRunItem, RuleMode } from './types';

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Valor de un cambio del diff con el nombre del catálogo cuando el campo es una referencia. */
function ChangeValue({
  change,
  side,
  names,
  f,
}: {
  change: DryRunChange;
  side: 'before' | 'after';
  names: Catalogs['names'];
  f: FormatContext;
}) {
  const v = change[side];
  if (v === null || v === '') return <span style={mutedStyle}>{f.t('run.empty')}</span>;
  if (typeof v === 'boolean') return <>{v ? f.t('run.yes') : f.t('run.no')}</>;
  const key = changeFieldKey(change.field);
  if (key === 'categoryId') return <>{names.category(v) ?? v}</>;
  if (key === 'counterpartyId') return <>{names.counterparty(v) ?? v}</>;
  if (key === 'tagAdded' || key === 'tagRemoved') return <>{names.tag(v) ?? v}</>;
  return <>{v}</>;
}

/** Diff por transacción: campo, valor actual → propuesto, y la regla con su versión. */
export function DryRunTable({
  items,
  selected,
  onToggle,
  f,
  names,
  ruleNames,
}: {
  items: readonly DryRunItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  f: FormatContext;
  names: Catalogs['names'];
  ruleNames: ReadonlyMap<string, string>;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('run.region')}>
      <table style={tableStyle} data-testid="dry-run-table">
        <caption className="pf-sr-only">{f.t('run.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('run.select')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('run.transaction')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('run.changes')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.transactionId}
              data-testid="dry-run-row"
              data-transaction-id={item.transactionId}
              data-applicable={item.applicable ? 'true' : 'false'}
            >
              <td style={cellStyle}>
                <input
                  type="checkbox"
                  disabled={!item.applicable}
                  checked={selected.has(item.transactionId)}
                  data-testid="dry-run-select"
                  aria-label={f.t('run.selectOne', { id: item.transactionId.slice(0, 8) })}
                  onChange={() => onToggle(item.transactionId)}
                />
              </td>
              <th scope="row" style={cellStyle}>
                <code>{item.transactionId.slice(0, 8)}</code>
                {!item.applicable ? (
                  <div style={mutedStyle} data-testid="dry-run-reason">
                    {item.reasons.map((r) => (f.has(`skip.${r}`) ? f.t(`skip.${r}`) : r)).join(', ')}
                  </div>
                ) : null}
              </th>
              <td style={cellStyle}>
                <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                  {item.changes.map((c, i) => (
                    <li
                      key={`${c.field}-${i}`}
                      data-testid="dry-run-change"
                      data-field={changeFieldKey(c.field)}
                    >
                      <strong>
                        {f.has(`run.fields.${changeFieldKey(c.field)}`)
                          ? f.t(`run.fields.${changeFieldKey(c.field)}`)
                          : c.field}
                      </strong>
                      : <ChangeValue change={c} side="before" names={names} f={f} />{' '}
                      <span aria-hidden="true">→</span>
                      <span className="pf-sr-only"> {f.t('run.to')} </span>{' '}
                      <ChangeValue change={c} side="after" names={names} f={f} />{' '}
                      <span style={mutedStyle}>
                        {f.t('run.byRule', {
                          name: ruleNames.get(c.ruleId) ?? c.ruleId.slice(0, 8),
                          version: c.ruleVersion,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ejecuta las reglas sobre el historial sin cambiar nada y aplica el diff por páginas de 500 como edición masiva. */
export function DryRunPanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Rules', ctx);
  const catalogs = useCatalogs(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<RuleMode>('FILL_EMPTY');
  const [result, setResult] = useState<DryRun | undefined>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [ruleNames, setRuleNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; size: number } | undefined>();
  const [summary, setSummary] = useState<
    { applied: number; notApplicable: DryRunApplyResult['notApplicable'] } | undefined
  >();
  const { api, base } = ctx;

  const run = async () => {
    setBusy(true);
    setSummary(undefined);
    setStale(false);
    try {
      const [dry, rules] = await Promise.all([
        api.command<DryRun>('POST', rulesPath(base, '/dry-run'), { from, to, mode }, { idempotent: false }),
        api.get<{ data: { id: string; name: string }[] }>(`${rulesPath(base)}?includeArchived=true`),
      ]);
      setResult(dry.data);
      setRuleNames(new Map((rules.data?.data ?? []).map((r) => [r.id, r.name])));
      setSelected(new Set(applicableItems(dry.data?.items ?? []).map((i) => i.transactionId)));
      setProblem(undefined);
    } catch (err) {
      setResult(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    const chosen = result.items.filter((i) => selected.has(i.transactionId));
    const pages = chunk(chosen, APPLY_PAGE_SIZE);
    setBusy(true);
    setStale(false);
    let applied = 0;
    const notApplicable: DryRunApplyResult['notApplicable'][number][] = [];
    try {
      setProgress({ done: 0, size: chosen.length });
      for (const page of pages) {
        const r = await api.command<DryRunApplyResult>('POST', rulesPath(base, '/dry-run/apply'), {
          token: result.token,
          mode,
          items: page.map((i) => ({ transactionId: i.transactionId, version: i.version })),
        });
        applied += r.data?.applied ?? 0;
        notApplicable.push(...(r.data?.notApplicable ?? []));
        setProgress({ done: applied + notApplicable.length, size: chosen.length });
      }
      setSummary({ applied, notApplicable });
      setProblem(undefined);
      setResult(undefined);
    } catch (err) {
      const p = problemOf(err);
      // Una regla o una transacción cambió desde el dry-run: se pide volver a ejecutarlo (409 RULE_DRY_RUN_STALE).
      if (p.code === 'RULE_DRY_RUN_STALE') {
        setStale(true);
        setProblem(undefined);
        setSummary(applied > 0 ? { applied, notApplicable } : undefined);
      } else setProblem(p);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  const items = result?.items ?? [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pages = useMemo(() => Math.max(1, Math.ceil(selected.size / APPLY_PAGE_SIZE)), [selected.size]);

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="dry-run-panel">
      <p style={mutedStyle}>{f.t('run.intro')}</p>
      <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}>
        <div style={rowStyle}>
          <Field label={f.t('run.from')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={from}
                data-testid="run-from"
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={f.t('run.to')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={to}
                data-testid="run-to"
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
          <Field label={f.t('run.mode')} hint={f.t(`run.modeHint.${mode}`)}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={mode}
                data-testid="run-mode"
                onChange={(e) => setMode(e.target.value as RuleMode)}
              >
                <option value="FILL_EMPTY">{f.t('run.mode_FILL_EMPTY')}</option>
                <option value="OVERWRITE">{f.t('run.mode_OVERWRITE')}</option>
              </select>
            )}
          </Field>
        </div>
        <div>
          <button
            type="button"
            disabled={busy || from === '' || to === ''}
            onClick={() => void run()}
            data-testid="run-submit"
          >
            {f.t('run.submit')}
          </button>
        </div>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {stale ? (
        <p role="alert" style={warningStyle} data-testid="run-stale">
          {f.t('run.stale')}
        </p>
      ) : null}
      {summary ? (
        <p role="status" data-testid="run-summary">
          {f.t('run.summary', { applied: summary.applied, notApplicable: summary.notApplicable.length })}
        </p>
      ) : null}
      {result ? (
        <>
          <p data-testid="run-counts">
            {f.t('run.counts', { scanned: result.scanned, changed: result.changed })}
          </p>
          {result.truncated ? (
            <p style={warningStyle} role="status" data-testid="run-truncated">
              {f.t('run.truncated')}
            </p>
          ) : null}
          {mode === 'OVERWRITE' ? <p style={warningStyle}>{f.t('run.overwriteWarning')}</p> : null}
          {items.length === 0 ? (
            <p style={mutedStyle} data-testid="run-empty">
              {f.t('run.none')}
            </p>
          ) : (
            <>
              <DryRunTable
                items={items}
                selected={selected}
                onToggle={toggle}
                f={f}
                names={catalogs.names}
                ruleNames={ruleNames}
              />
              {ctx.canEdit ? (
                <div style={rowStyle}>
                  <button
                    type="button"
                    disabled={busy || selected.size === 0}
                    onClick={() => void apply()}
                    data-testid="run-apply"
                  >
                    {f.t('run.apply', { count: selected.size })}
                  </button>
                  {pages > 1 ? (
                    <span style={mutedStyle}>{f.t('run.pages', { pages, size: APPLY_PAGE_SIZE })}</span>
                  ) : null}
                  {progress ? (
                    <progress
                      value={progress.done}
                      max={progress.size}
                      aria-label={f.t('run.progress')}
                      data-testid="run-progress"
                    />
                  ) : null}
                </div>
              ) : (
                <p style={mutedStyle}>{f.t('viewerNotice')}</p>
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
