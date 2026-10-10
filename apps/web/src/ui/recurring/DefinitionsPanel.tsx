'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { Page } from '../common/types';
import { Field, inputStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import type { Catalogs } from '../transactions/catalogs';
import { DefinitionFormView } from './DefinitionForm';
import { DefinitionsList } from './DefinitionsList';
import { definitionsQuery, emptyForm } from './logic';
import { OFFERED_KINDS, RECURRING_STATUSES, type RecurringDefinition } from './types';

/** Pestaña **Definiciones**: filtros por estado y tipo, lista y alta de una definición nueva. */
export function DefinitionsPanel({
  ctx,
  f,
  catalogs,
  today,
  refreshKey,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  today: string;
  refreshKey: number;
  onChanged: (message: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<readonly RecurringDefinition[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Page<RecurringDefinition>>(`${ctx.base}/recurring?${definitionsQuery({ status, kind })}`)
      .then((r) => {
        if (cancelled) return;
        setItems(r.data?.data ?? []);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, status, kind, refreshKey]);

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="definitions-panel">
      <div style={rowStyle}>
        <Field label={f.t('definitions.filterStatus')} style={{ flex: '0 1 12rem' }}>
          {(p) => (
            <select
              {...p}
              name="status"
              style={inputStyle}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{f.t('definitions.all')}</option>
              {RECURRING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {f.t(`definitionStatus.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('definitions.filterKind')} style={{ flex: '0 1 12rem' }}>
          {(p) => (
            <select
              {...p}
              name="kind"
              style={inputStyle}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">{f.t('definitions.all')}</option>
              {OFFERED_KINDS.map((k) => (
                <option key={k} value={k}>
                  {f.t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {ctx.canEdit && !creating ? (
          <button type="button" data-testid="new-definition" onClick={() => setCreating(true)}>
            {f.t('definitions.new')}
          </button>
        ) : null}
      </div>
      {creating ? (
        <DefinitionFormView
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          today={today}
          mode="create"
          initial={emptyForm(today)}
          onCancel={() => setCreating(false)}
          onSaved={({ definition }) => {
            setCreating(false);
            onChanged(f.t('form.created', { name: definition.name, count: definition.generatedCount ?? 0 }));
          }}
        />
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <DefinitionsList
          definitions={items}
          f={f}
          accountName={(id) => catalogs.names.account(id)}
          href={ctx.href}
        />
      )}
    </div>
  );
}
