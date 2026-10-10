'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { AuditHistory } from '../AuditHistory';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import {
  cellStyle,
  ConfirmPanel,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { formatBusinessDate } from '../planning/logic';
import { useCatalogs, type Catalogs } from '../transactions/catalogs';
import { AmountText, DefinitionStatusBadge } from './Badges';
import { DefinitionFormView } from './DefinitionForm';
import { cadenceSummary } from './DefinitionsList';
import { OccurrencesPanel } from './OccurrencesPanel';
import { RevisionResult } from './RevisionResult';
import { formFromVersion, notifyRecurringChanged } from './logic';
import {
  OFFERED_KINDS,
  type OfferedKind,
  type RecurringDefinition,
  type RecurringDefinitionVersion,
  type RecurringRevisionResult,
} from './types';

export function DefinitionDetailPage({ definitionId }: { definitionId: string }) {
  return <WithWorkspace>{(ctx) => <Detail ctx={ctx} definitionId={definitionId} />}</WithWorkspace>;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly definition: RecurringDefinition };

type Panel = 'pause' | 'resume' | 'end' | 'annotate' | 'revise' | undefined;

const isOffered = (kind: string): kind is OfferedKind => (OFFERED_KINDS as readonly string[]).includes(kind);

/**
 * Detalle de una definición (`/recurring/{id}`): versión vigente, versiones (append-only), ocurrencias, acciones Pausar,
 * Reanudar, Terminar y "Cambiar esta y las siguientes" (informa cuántas ocurrencias se reescribieron, cancelaron, crearon,
 * reinstauraron y cuántas ediciones individuales se descartaron, D123) y el recorrido con su exportación.
 */
function Detail({ ctx, definitionId }: { ctx: WorkspaceContext; definitionId: string }) {
  const f = useFormat('Recurring', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [panel, setPanel] = useState<Panel>();
  const [status, setStatus] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState<RecurringRevisionResult | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await ctx.api.get<RecurringDefinition>(`${ctx.base}/recurring/${definitionId}`);
      setLoaded({ status: 'ready', definition: r.data! });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    }
  }, [ctx.api, ctx.base, definitionId]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p data-testid="definition-loading">{f.t('loading')}</p>
      </section>
    );
  if (loaded.status === 'notFound' || loaded.status === 'error')
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        {loaded.status === 'notFound' ? (
          <p role="alert" data-error-code="RESOURCE_NOT_FOUND" data-testid="definition-not-found">
            {f.t('detail.notFound')}
          </p>
        ) : (
          <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        )}
        <p>
          <a href={ctx.href('/recurring')}>{f.t('detail.back')}</a>
        </p>
      </section>
    );

  const def = loaded.definition;
  const reload = () => {
    setRefreshKey((k) => k + 1);
    notifyRecurringChanged();
  };

  async function transition(kind: 'pause' | 'resume' | 'end', body?: unknown) {
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/recurring/${def.id}/${kind}`, body, {
        ifMatch: def.version,
        idempotent: false,
      });
      setPanel(undefined);
      setRevision(undefined);
      setStatus(f.t(`detail.done.${kind}`, { name: def.name }));
      reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const canRevise = ctx.canEdit && def.status !== 'ENDED' && isOffered(def.kind);
  return (
    <section
      aria-labelledby="definition-title"
      style={pageStyle}
      data-testid="definition-detail"
      data-status={def.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/recurring')} data-testid="definition-back">
          {f.t('detail.back')}
        </a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="definition-title" style={{ margin: 0 }}>
          {def.name}
        </h1>
        <DefinitionStatusBadge status={def.status} f={f} />
      </div>
      <p style={mutedStyle}>
        {f.t(`kinds.${def.kind}`)} · {cadenceSummary(def, f)} ·{' '}
        {f.t(`modes.${def.current.materialization.mode}`)}
      </p>
      {def.description ? <p style={{ margin: 0 }}>{def.description}</p> : null}
      {def.notes ? <p style={mutedStyle}>{def.notes}</p> : null}
      {status ? (
        <p role="status" data-testid="definition-status-message">
          {status}
        </p>
      ) : null}
      {revision ? <RevisionResult result={revision} f={f} /> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      {ctx.canEdit ? (
        <div style={rowStyle} role="group" aria-label={f.t('detail.actions')}>
          {def.status === 'ACTIVE' ? (
            <button
              type="button"
              data-testid="pause-definition"
              disabled={busy}
              onClick={() => setPanel('pause')}
            >
              {f.t('detail.pause')}
            </button>
          ) : null}
          {def.status === 'PAUSED' ? (
            <button
              type="button"
              data-testid="resume-definition"
              disabled={busy}
              onClick={() => setPanel('resume')}
            >
              {f.t('detail.resume')}
            </button>
          ) : null}
          {def.status !== 'ENDED' ? (
            <button
              type="button"
              data-testid="end-definition"
              disabled={busy}
              onClick={() => setPanel('end')}
            >
              {f.t('detail.end')}
            </button>
          ) : null}
          {canRevise ? (
            <button
              type="button"
              data-testid="revise-definition"
              disabled={busy}
              onClick={() => setPanel('revise')}
            >
              {f.t('detail.revise')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="annotate-definition"
            disabled={busy}
            onClick={() => setPanel('annotate')}
          >
            {f.t('detail.annotate')}
          </button>
        </div>
      ) : null}

      {panel === 'pause' ? (
        <ConfirmPanel
          testId="pause-panel"
          title={f.t('detail.pauseTitle', { name: def.name })}
          description={f.t('detail.pauseDescription')}
          confirmLabel={f.t('detail.pause')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void transition('pause')}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'resume' ? (
        <ConfirmPanel
          testId="resume-panel"
          title={f.t('detail.resumeTitle', { name: def.name })}
          description={f.t('detail.resumeDescription')}
          confirmLabel={f.t('detail.resume')}
          cancelLabel={f.t('cancel')}
          busy={busy}
          onConfirm={() => void transition('resume')}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'end' ? (
        <EndPanel
          f={f}
          name={def.name}
          today={today}
          busy={busy}
          onConfirm={(endDate) => void transition('end', endDate ? { endDate } : undefined)}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'annotate' ? (
        <AnnotationForm
          ctx={ctx}
          f={f}
          definition={def}
          onSaved={() => {
            setPanel(undefined);
            setStatus(f.t('detail.annotated'));
            reload();
          }}
          onCancel={() => setPanel(undefined)}
        />
      ) : null}
      {panel === 'revise' && isOffered(def.kind) ? (
        <DefinitionFormView
          ctx={ctx}
          f={f}
          catalogs={catalogs}
          today={today}
          mode="revise"
          definition={def}
          initial={formFromVersion(def.current, {
            name: def.name,
            description: def.description,
            notes: def.notes,
            kind: def.kind,
          })}
          defaultEffectiveFrom={today}
          onCancel={() => setPanel(undefined)}
          onSaved={({ revision: result }) => {
            setPanel(undefined);
            setStatus(undefined);
            setRevision(result);
            reload();
          }}
        />
      ) : null}

      <Tabs
        idPrefix="definition"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <>
                <CurrentVersion definition={def} f={f} catalogs={catalogs} />
                <VersionsTable definition={def} f={f} catalogs={catalogs} />
                <section
                  aria-labelledby="definition-occurrences-title"
                  style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
                >
                  <h2 id="definition-occurrences-title">{f.t('detail.occurrences')}</h2>
                  <OccurrencesPanel
                    ctx={ctx}
                    f={f}
                    catalogs={catalogs}
                    today={today}
                    variant="definition"
                    definitionId={def.id}
                    refreshKey={refreshKey}
                    onChanged={(message) => {
                      setStatus(message);
                      reload();
                    }}
                  />
                </section>
              </>
            ),
          },
          {
            id: 'lifecycle',
            label: lf.t('tabs.lifecycle'),
            content: (
              <LifecycleTab
                ctx={ctx}
                path={`recurring/${def.id}`}
                refreshKey={`${def.version}-${refreshKey}`}
                stateLabel={(code) =>
                  f.has(`definitionStatus.${code}`) ? f.t(`definitionStatus.${code}`) : code
                }
                idPrefix="definition-lifecycle"
              />
            ),
          },
          ...(ctx.canEdit
            ? [
                {
                  id: 'history',
                  label: lf.t('tabs.history'),
                  content: (
                    <AuditHistory
                      workspaceId={ctx.ws.id}
                      aggregateType="RecurringDefinition"
                      aggregateId={def.id}
                      role={ctx.ws.role}
                      locale={ctx.formatLocale}
                      timeZone={ctx.timeZone}
                      refreshKey={def.version}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

function EndPanel({
  f,
  name,
  today,
  busy,
  onConfirm,
  onCancel,
}: {
  f: FormatContext;
  name: string;
  today: string;
  busy: boolean;
  onConfirm: (endDate: string | undefined) => void;
  onCancel: () => void;
}) {
  const [endDate, setEndDate] = useState('');
  return (
    <ConfirmPanel
      testId="end-panel"
      title={f.t('detail.endTitle', { name })}
      description={f.t('detail.endDescription')}
      confirmLabel={f.t('detail.end')}
      cancelLabel={f.t('cancel')}
      busy={busy}
      onConfirm={() => onConfirm(endDate || undefined)}
      onCancel={onCancel}
    >
      <Field label={f.t('detail.endDate')} hint={f.t('detail.endDateHint')}>
        {(p) => (
          <input
            {...p}
            type="date"
            name="endDate"
            min={today}
            style={inputStyle}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        )}
      </Field>
    </ConfirmPanel>
  );
}

/** Nombre, descripción y notas son anotaciones (`PATCH`, sin versión nueva ni efecto en las ocurrencias). */
function AnnotationForm({
  ctx,
  f,
  definition,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  definition: RecurringDefinition;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(definition.name);
  const [description, setDescription] = useState(definition.description ?? '');
  const [notes, setNotes] = useState(definition.notes ?? '');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, string | null> = {};
    if (name.trim() !== definition.name) patch['name'] = name.trim();
    if (description.trim() !== (definition.description ?? ''))
      patch['description'] = description.trim() || null;
    if (notes.trim() !== (definition.notes ?? '')) patch['notes'] = notes.trim() || null;
    if (name.trim() === '') {
      setMessage(f.t('errors.REQUIRED'));
      return;
    }
    if (Object.keys(patch).length === 0) {
      setMessage(f.t('errors.NO_CHANGES'));
      return;
    }
    setMessage(undefined);
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('PATCH', `${ctx.base}/recurring/${definition.id}`, patch, {
        ifMatch: definition.version,
      });
      onSaved();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      style={formStyle}
      aria-labelledby="annotate-title"
      data-testid="annotation-form"
      noValidate
    >
      <h2 id="annotate-title" style={{ margin: 0 }}>
        {f.t('detail.annotateTitle')}
      </h2>
      <p style={mutedStyle}>{f.t('detail.annotateNote')}</p>
      <div style={rowStyle}>
        <Field label={f.t('form.name')}>
          {(p) => (
            <input
              {...p}
              name="name"
              maxLength={120}
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('form.description')}>
          {(p) => (
            <input
              {...p}
              name="description"
              maxLength={1000}
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('form.notes')}>
          {(p) => (
            <input
              {...p}
              name="notes"
              maxLength={2000}
              style={inputStyle}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
      {message ? (
        <p role="alert" style={{ margin: 0 }}>
          {message}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy}>
          {f.t('form.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}

function VersionSummary({
  v,
  f,
  catalogs,
}: {
  v: RecurringDefinitionVersion;
  f: FormatContext;
  catalogs: Catalogs;
}) {
  const names = catalogs.names;
  const rows: [string, ReactNode][] = [
    [
      f.t('summary.account'),
      `${names.account(v.accountId) ?? '—'}${v.toAccountId ? ` → ${names.account(v.toAccountId) ?? '—'}` : ''} (${v.currency})`,
    ],
    [f.t('summary.amount'), <AmountText key="a" expected={v.amount} f={f} />],
    [f.t('summary.category'), v.categoryId ? (names.category(v.categoryId) ?? '—') : '—'],
    [f.t('summary.counterparty'), v.counterpartyId ? (names.counterparty(v.counterpartyId) ?? '—') : '—'],
    [f.t('summary.tags'), v.tagIds.map((t) => names.tag(t) ?? '—').join(', ') || '—'],
    [f.t('summary.paymentMethod'), v.paymentMethod ? f.t(`paymentMethods.${v.paymentMethod}`) : '—'],
    [
      f.t('summary.schedule'),
      `${f.t(`cadences.${v.schedule.cadence}`)}${v.schedule.interval > 1 && v.schedule.cadence !== 'CUSTOM' ? ` (${f.t('summary.every', { interval: v.schedule.interval })})` : ''}`,
    ],
    [f.t('summary.start'), formatBusinessDate(v.schedule.startDate)],
    [
      f.t('summary.end'),
      v.schedule.endDate
        ? formatBusinessDate(v.schedule.endDate)
        : v.schedule.maxOccurrences
          ? f.t('summary.afterCount', { count: v.schedule.maxOccurrences })
          : f.t('summary.noEnd'),
    ],
    [f.t('summary.weekend'), f.t(`weekend.${v.schedule.weekendAdjustment}`)],
    [
      f.t('summary.mode'),
      `${f.t(`modes.${v.materialization.mode}`)}${
        v.materialization.mode === 'AUTO_CREATE' && v.materialization.autoCreateStatus
          ? ` (${f.t(v.materialization.autoCreateStatus === 'POSTED' ? 'form.statusPosted' : 'form.statusPending')})`
          : ''
      }`,
    ],
    [f.t('summary.leadDays'), String(v.materialization.leadDays)],
  ];
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        gap: 'var(--pf-space-1) var(--pf-space-4)',
        margin: 0,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt style={mutedStyle}>{label}</dt>
          <dd style={{ margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CurrentVersion({
  definition,
  f,
  catalogs,
}: {
  definition: RecurringDefinition;
  f: FormatContext;
  catalogs: Catalogs;
}) {
  return (
    <section aria-labelledby="current-version-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h2 id="current-version-title">{f.t('detail.current', { version: definition.currentVersionNo })}</h2>
      <VersionSummary v={definition.current} f={f} catalogs={catalogs} />
    </section>
  );
}

/** Versiones de la definición (append-only), la más reciente primero. */
function VersionsTable({
  definition,
  f,
  catalogs,
}: {
  definition: RecurringDefinition;
  f: FormatContext;
  catalogs: Catalogs;
}) {
  const versions = [...(definition.versions ?? [definition.current])].reverse();
  return (
    <section aria-labelledby="versions-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h2 id="versions-title">{f.t('detail.versions')}</h2>
      <div style={tableWrapStyle}>
        <table style={tableStyle} data-testid="versions-table">
          <caption className="pf-sr-only">{f.t('detail.versionsCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('columns.version')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.effectiveFrom')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.amount')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.schedule')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('columns.mode')}
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.versionNo} data-testid="version-row" data-version-no={v.versionNo}>
                <th scope="row" style={cellStyle}>
                  v{v.versionNo}
                  {v.versionNo === definition.currentVersionNo ? ` · ${f.t('detail.currentTag')}` : ''}
                </th>
                <td style={cellStyle}>{formatBusinessDate(v.effectiveFrom)}</td>
                <td style={cellStyle}>
                  <AmountText expected={v.amount} f={f} />
                </td>
                <td style={cellStyle}>{f.t(`cadences.${v.schedule.cadence}`)}</td>
                <td style={cellStyle}>
                  {f.t(`modes.${v.materialization.mode}`)} · {catalogs.names.account(v.accountId) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
