'use client';

import { useState } from 'react';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, Field, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { targetName, type TargetNames } from './BudgetLinesTable';
import { type Budget } from './budget-logic';
import { PropagationPanel } from './PropagationPanel';
import { linesFromPlan, type PropagationSource } from './template-logic';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import type { FormatContext } from '../dashboard/types';

/**
 * Acciones del plan ligadas a templates (openspec add-budget-templates 6.2): con template de origen, "Aplicar a meses
 * futuros" (elige las líneas y ve la vista previa); sin él, la propagación se rechaza (`BUDGET_NO_TEMPLATE_ORIGIN`,
 * docs/33 D84) y se ofrece "crear template con estas líneas" (`createTemplate`, sin endpoint nuevo).
 */
export function PlanTemplateActions({
  ctx,
  f,
  budget,
  names,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  budget: Budget;
  names: TargetNames;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'select' | 'preview' | 'create' | undefined>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [source, setSource] = useState<PropagationSource | undefined>();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (budget.lines.length === 0) return null;
  const hasOrigin = Boolean(budget.templateVersion);

  function open() {
    setProblem(undefined);
    setStatus(undefined);
    if (hasOrigin) {
      setPicked(new Set(budget.lines.filter((l) => l.overridden).map((l) => l.id)));
      setMode('select');
    } else setMode('create');
  }

  async function createTemplate() {
    if (name.trim() === '') return;
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/templates`, {
        name: name.trim(),
        lines: linesFromPlan(budget.lines),
      });
      setStatus(f.t('propagate.templateCreated', { name: name.trim(), count: budget.lines.length }));
      setMode(undefined);
      setName('');
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="plan-template-actions">
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!mode ? (
        <div style={rowStyle}>
          <button type="button" onClick={open} data-testid="propagate-open">
            {hasOrigin ? f.t('propagate.open') : f.t('propagate.createTemplate')}
          </button>
          {!hasOrigin ? <small style={mutedStyle}>{f.t('propagate.noOrigin')}</small> : null}
        </div>
      ) : null}

      {mode === 'select' ? (
        <fieldset
          style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
          data-testid="propagate-select"
        >
          <legend>{f.t('propagate.selectTitle')}</legend>
          <p style={mutedStyle}>{f.t('propagate.selectHint')}</p>
          {budget.lines.map((l) => {
            const label = targetName(names, l.target.kind, l.target.id);
            return (
              <label key={l.id} style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={picked.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    setPicked(next);
                  }}
                  data-testid="propagate-line"
                />
                {label}
                {l.overridden ? ` (${f.t('propagate.edited')})` : ''}
              </label>
            );
          })}
          <div style={rowStyle}>
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => {
                setSource({ kind: 'BUDGET', budgetId: budget.id, lineIds: [...picked] });
                setMode('preview');
              }}
              data-testid="propagate-preview"
            >
              {f.t('propagate.preview')}
            </button>
            <button type="button" onClick={() => setMode(undefined)}>
              {f.t('form.cancel')}
            </button>
          </div>
        </fieldset>
      ) : null}

      {mode === 'preview' && source ? (
        <PropagationPanel
          ctx={ctx}
          source={source}
          names={names}
          onClose={(applied) => {
            setMode(undefined);
            setSource(undefined);
            if (applied) {
              setStatus(f.t('propagate.applied'));
              onChanged();
            }
          }}
        />
      ) : null}

      {mode === 'create' ? (
        <form
          style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
          aria-label={f.t('propagate.createTemplate')}
          data-testid="plan-create-template"
          onSubmit={(e) => {
            e.preventDefault();
            void createTemplate();
          }}
        >
          <p style={mutedStyle}>{f.t('propagate.createHint', { count: budget.lines.length })}</p>
          <Field label={f.t('propagate.templateName')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                data-testid="plan-template-name"
              />
            )}
          </Field>
          <div style={rowStyle}>
            <button type="submit" disabled={busy || name.trim() === ''} data-testid="plan-template-submit">
              {f.t('propagate.createSubmit')}
            </button>
            <button type="button" onClick={() => setMode(undefined)}>
              {f.t('form.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
