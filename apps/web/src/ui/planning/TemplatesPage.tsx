'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import {
  badgeStyle,
  cardStyle,
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
import { formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { buildLineBody, emptyLineForm, type LineFormErrors, type LineFormValues } from './budget-logic';
import { BudgetLineForm, natureOf, type TargetOptions } from './BudgetLineForm';
import { targetName, type TargetNames } from './BudgetLinesTable';
import { loadCatalog, type Catalog } from './catalog';
import { PlanningNav } from './PlanningNav';
import { PropagationPanel } from './PropagationPanel';
import { TemplateLinesTable } from './TemplateLinesTable';
import {
  compareVersions,
  draftLine,
  formFromTemplateLine,
  specInput,
  type PropagationSource,
  type Template,
  type TemplateLine,
  type TemplateSummary,
  type TemplateVersion,
  type VersionDiffRow,
} from './template-logic';
import { SpecSummary } from './TemplateLinesTable';

const NO_NAMES: TargetNames = { CATEGORY: new Map(), GROUP: new Map(), TAG: new Map() };
const NO_OPTIONS: TargetOptions = { CATEGORY: [], GROUP: [], TAG: [] };

export function TemplatesPage() {
  return <WithWorkspace>{(ctx) => <Templates ctx={ctx} />}</WithWorkspace>;
}

interface Draft {
  readonly lines: readonly TemplateLine[];
  readonly note: string;
  readonly panel: { readonly type: 'add' } | { readonly type: 'edit'; readonly key: string } | undefined;
}

/** Cambios del borrador respecto de la versión vigente, en filas legibles. */
function DiffTable({
  rows,
  names,
  f,
  fb,
  title,
}: {
  rows: readonly VersionDiffRow[];
  names: TargetNames;
  f: FormatContext;
  fb: FormatContext;
  title: string;
}) {
  if (rows.length === 0) return <p style={mutedStyle}>{f.t('compare.none')}</p>;
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="version-diff">
        <caption style={{ textAlign: 'left' }}>{title}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('lines.columns.target')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('compare.change')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('compare.before')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('compare.after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.target.kind}:${r.target.id}`} data-testid="version-diff-row" data-kind={r.kind}>
              <th scope="row" style={{ ...cellStyle, textAlign: 'left' }}>
                {targetName(names, r.target.kind, r.target.id)}
              </th>
              <td style={cellStyle}>
                <span style={badgeStyle}>{f.t(`compare.${r.kind}`)}</span>
              </td>
              <td style={cellStyle}>{r.before ? <SpecSummary spec={r.before} fb={fb} /> : '—'}</td>
              <td style={cellStyle}>{r.after ? <SpecSummary spec={r.after} fb={fb} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pantalla "Templates" (`/planificacion/templates`, openspec add-budget-templates 6.1): lista con el predeterminado
 * marcado con texto, versiones inmutables con su nota de cambio, comparación entre versiones, edición en borrador
 * (publicar una versión nueva o propagarla a meses futuros con vista previa), clonar, archivar y predeterminado.
 * Los errores de la API se muestran por `code` (NFR-USAB-009). Un VIEWER solo lee.
 */
function Templates({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Templates', ctx);
  const fb = useFormat('Budgets', ctx);
  const [templates, setTemplates] = useState<readonly TemplateSummary[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [detail, setDetail] = useState<Template | undefined>();
  const [viewing, setViewing] = useState<TemplateVersion | undefined>();
  const [compareTo, setCompareTo] = useState<{ a: number; b: number } | undefined>();
  const [compared, setCompared] = useState<readonly VersionDiffRow[] | undefined>();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newError, setNewError] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [draft, setDraft] = useState<Draft | undefined>();
  const [form, setForm] = useState<LineFormValues>(emptyLineForm());
  const [errors, setErrors] = useState<LineFormErrors>({});
  const [archiving, setArchiving] = useState(false);
  const [propagation, setPropagation] = useState<PropagationSource | undefined>();

  const names = catalog?.names ?? NO_NAMES;
  const options = catalog?.options ?? NO_OPTIONS;
  const currency = ctx.ws.baseCurrency;
  const scale = scaleFor(currency, ctx.scales);

  const loadList = useCallback(() => {
    ctx.api
      .get<{ data: TemplateSummary[] }>(`${ctx.base}/templates?limit=100`)
      .then((r) => setTemplates(r.data?.data ?? []))
      .catch((err: unknown) => {
        setProblem(problemOf(err));
        setTemplates([]);
      });
  }, [ctx]);
  useEffect(() => {
    loadList();
    loadCatalog(ctx)
      .then(setCatalog)
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx, loadList]);

  const loadDetail = useCallback(
    (id: string) => {
      ctx.api
        .get<Template>(`${ctx.base}/templates/${id}`)
        .then((r) => {
          setDetail(r.data);
          setViewing(r.data?.currentVersion);
        })
        .catch((err: unknown) => setProblem(problemOf(err)));
    },
    [ctx],
  );
  useEffect(() => {
    if (selected) loadDetail(selected);
    else {
      setDetail(undefined);
      setViewing(undefined);
    }
  }, [selected, loadDetail]);

  async function run<T>(action: () => Promise<T>, done?: string): Promise<T | undefined> {
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      const result = await action();
      if (done) setStatus(done);
      return result;
    } catch (err) {
      setProblem(problemOf(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (newName.trim() === '') {
      setNewError(true);
      return;
    }
    setNewError(false);
    const created = await run(
      () =>
        ctx.api.command<Template>('POST', `${ctx.base}/templates`, {
          name: newName.trim(),
          ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
          lines: [],
        }),
      f.t('create.done'),
    );
    if (created?.data) {
      setNewName('');
      setNewDescription('');
      loadList();
      setSelected(created.data.id);
    }
  }

  async function act(path: 'archive' | 'unarchive' | 'set-default', done: string) {
    if (!detail) return;
    const result = await run(
      () =>
        ctx.api.command<Template>('POST', `${ctx.base}/templates/${detail.id}/${path}`, undefined, {
          idempotent: false,
        }),
      done,
    );
    setArchiving(false);
    if (result) {
      loadList();
      loadDetail(detail.id);
    }
  }

  async function clone() {
    if (!detail || cloneName.trim() === '') return;
    const result = await run(
      () =>
        ctx.api.command<Template>('POST', `${ctx.base}/templates/${detail.id}/clone`, {
          name: cloneName.trim(),
          ...(viewing ? { versionNo: viewing.versionNo } : {}),
        }),
      f.t('clone.done'),
    );
    if (result?.data) {
      setCloneName('');
      loadList();
      setSelected(result.data.id);
    }
  }

  async function viewVersion(versionNo: number) {
    if (!detail) return;
    if (versionNo === detail.currentVersionNo) {
      setViewing(detail.currentVersion);
      return;
    }
    const r = await run(() =>
      ctx.api.get<TemplateVersion>(`${ctx.base}/templates/${detail.id}/versions/${versionNo}`),
    );
    if (r?.data) setViewing(r.data);
  }

  async function compare(a: number, b: number) {
    if (!detail) return;
    setCompareTo({ a, b });
    const fetchVersion = async (n: number): Promise<TemplateVersion | undefined> =>
      n === detail.currentVersionNo
        ? detail.currentVersion
        : (await ctx.api.get<TemplateVersion>(`${ctx.base}/templates/${detail.id}/versions/${n}`)).data;
    const out = await run(async () => {
      const [va, vb] = await Promise.all([fetchVersion(a), fetchVersion(b)]);
      return compareVersions(va?.lines ?? [], vb?.lines ?? []);
    });
    setCompared(out);
  }

  // ------------------------------------------------------------------ borrador de una versión nueva
  const draftRows = useMemo(
    () => (draft && detail ? compareVersions(detail.currentVersion.lines, draft.lines) : []),
    [draft, detail],
  );

  function openDraft() {
    if (!detail) return;
    setDraft({ lines: detail.currentVersion.lines, note: '', panel: undefined });
    setForm(emptyLineForm());
    setErrors({});
  }

  function submitLine() {
    if (!draft) return;
    const nature = natureOf(options, form);
    const adjusted: LineFormValues = nature === 'INCOME' ? { ...form, kind: 'FIXED' } : form;
    const built = buildLineBody(adjusted, { currency, scale, locale: ctx.formatLocale, nature });
    const formErrors: Record<string, 'required' | 'invalid' | 'scale'> = built.ok ? {} : { ...built.errors };
    if (draft.panel?.type === 'add' && adjusted.targetId === '') formErrors['targetId'] = 'required';
    if (!built.ok || Object.keys(formErrors).length > 0) {
      setErrors(formErrors as LineFormErrors);
      return;
    }
    setErrors({});
    const key =
      draft.panel?.type === 'edit' ? draft.panel.key : `draft-${adjusted.targetKind}-${adjusted.targetId}`;
    const line = draftLine({ key, values: adjusted, body: built.body, nature, currency });
    const exists = draft.lines.some((l) => l.id === key);
    const duplicate =
      draft.panel?.type === 'add' &&
      draft.lines.some((l) => l.target.kind === line.target.kind && l.target.id === line.target.id);
    if (duplicate) {
      setErrors({ targetId: 'invalid' });
      return;
    }
    setDraft({
      ...draft,
      lines: exists ? draft.lines.map((l) => (l.id === key ? line : l)) : [...draft.lines, line],
      panel: undefined,
    });
  }

  const draftInputs = (lines: readonly TemplateLine[]) => lines.map((l) => specInput(l.target, l));

  async function publish() {
    if (!detail || !draft) return;
    const result = await run(
      () =>
        ctx.api.command<Template>('POST', `${ctx.base}/templates/${detail.id}/versions`, {
          baseVersionNo: detail.currentVersionNo,
          lines: draftInputs(draft.lines),
          ...(draft.note.trim() ? { changeNote: draft.note.trim() } : {}),
        }),
      undefined,
    );
    if (result?.data) {
      setStatus(f.t('draft.published', { versionNo: result.data.currentVersionNo }));
      setDraft(undefined);
      loadList();
      loadDetail(detail.id);
    }
  }

  const canWrite = ctx.canEdit;
  const archived = detail?.status === 'ARCHIVED';
  const editing = draft !== undefined;

  return (
    <section
      aria-labelledby="templates-title"
      style={{ ...pageStyle, gridTemplateColumns: 'minmax(0, 1fr)' }}
    >
      <PlanningNav f={fb} current="templates" />
      <h1 id="templates-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}

      {templates === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <>
          {templates.length === 0 ? (
            <p style={mutedStyle} data-testid="templates-empty">
              {f.t('empty')}
            </p>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle} data-testid="templates-list">
                <caption style={{ textAlign: 'left' }}>{f.t('list.caption')}</caption>
                <thead>
                  <tr>
                    {(['name', 'status', 'version', 'lines', 'actions'] as const).map((c) => (
                      <th key={c} scope="col" style={cellStyle}>
                        {f.t(`list.columns.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} data-testid="template-row" data-template-name={t.name}>
                      <th scope="row" style={{ ...cellStyle, textAlign: 'left' }}>
                        {t.name}
                        {t.isDefault ? (
                          <>
                            {' '}
                            <span style={badgeStyle} data-testid="template-default">
                              <span aria-hidden="true">★</span> {f.t('list.default')}
                            </span>
                          </>
                        ) : null}
                      </th>
                      <td style={cellStyle}>{f.t(`list.status.${t.status}`)}</td>
                      <td style={cellStyle}>{t.currentVersionNo}</td>
                      <td style={cellStyle}>{t.lineCount}</td>
                      <td style={cellStyle}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(t.id);
                            setDraft(undefined);
                            setCompareTo(undefined);
                            setCompared(undefined);
                            setPropagation(undefined);
                            setArchiving(false);
                          }}
                          aria-label={f.t('list.openLabel', { name: t.name })}
                          aria-pressed={selected === t.id}
                          data-testid="template-open"
                        >
                          {f.t('list.open')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canWrite ? (
            <form
              style={formStyle}
              aria-label={f.t('create.title')}
              data-testid="template-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <h2 style={{ margin: 0 }}>{f.t('create.title')}</h2>
              <div style={rowStyle}>
                <Field label={f.t('create.name')} error={newError ? f.t('create.nameRequired') : undefined}>
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      value={newName}
                      maxLength={120}
                      onChange={(e) => setNewName(e.target.value)}
                      data-testid="template-name"
                    />
                  )}
                </Field>
                <Field label={f.t('create.description')}>
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      value={newDescription}
                      maxLength={500}
                      onChange={(e) => setNewDescription(e.target.value)}
                      data-testid="template-description"
                    />
                  )}
                </Field>
              </div>
              <div style={rowStyle}>
                <button type="submit" disabled={busy} data-testid="template-create">
                  {f.t('create.submit')}
                </button>
              </div>
            </form>
          ) : null}

          {detail ? (
            <section
              aria-labelledby="template-detail-title"
              style={{ display: 'grid', gap: 'var(--pf-space-3)', minWidth: 0 }}
              data-testid="template-detail"
            >
              <h2 id="template-detail-title">{f.t('detail.title', { name: detail.name })}</h2>
              <p style={mutedStyle}>
                {f.t(`list.status.${detail.status}`)}
                {detail.isDefault ? ` · ${f.t('list.default')}` : ''}
                {' · '}
                {f.t('detail.currentVersion', { versionNo: detail.currentVersionNo })}
                {detail.description ? ` · ${detail.description}` : ''}
              </p>

              {canWrite && !editing ? (
                <div style={rowStyle}>
                  {!archived ? (
                    <>
                      <button type="button" onClick={openDraft} disabled={busy} data-testid="template-edit">
                        {f.t('actions.edit')}
                      </button>
                      {!detail.isDefault ? (
                        <button
                          type="button"
                          onClick={() => void act('set-default', f.t('actions.defaultDone'))}
                          disabled={busy}
                          data-testid="template-set-default"
                        >
                          {f.t('actions.setDefault')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setArchiving(true)}
                        disabled={busy}
                        data-testid="template-archive"
                      >
                        {f.t('actions.archive')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void act('unarchive', f.t('actions.unarchiveDone'))}
                      disabled={busy}
                      data-testid="template-unarchive"
                    >
                      {f.t('actions.unarchive')}
                    </button>
                  )}
                </div>
              ) : null}

              {archiving ? (
                <ConfirmPanel
                  title={f.t('archive.title', { name: detail.name })}
                  description={f.t('archive.body')}
                  confirmLabel={f.t('actions.archive')}
                  cancelLabel={f.t('actions.cancel')}
                  busy={busy}
                  onConfirm={() => void act('archive', f.t('actions.archiveDone'))}
                  onCancel={() => setArchiving(false)}
                  testId="confirm-archive-template"
                />
              ) : null}

              {draft ? (
                <section
                  aria-labelledby="draft-title"
                  style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
                  data-testid="template-draft"
                >
                  <h3 id="draft-title" style={{ margin: 0 }}>
                    {f.t('draft.title', { versionNo: detail.currentVersionNo + 1 })}
                  </h3>
                  <p style={mutedStyle}>{f.t('draft.intro', { versionNo: detail.currentVersionNo })}</p>
                  <TemplateLinesTable
                    lines={draft.lines}
                    names={names}
                    f={f}
                    fb={fb}
                    caption={f.t('draft.linesCaption')}
                    onEdit={(line) => {
                      setForm(formFromTemplateLine(line));
                      setErrors({});
                      setDraft({ ...draft, panel: { type: 'edit', key: line.id } });
                    }}
                    onRemove={(line) =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.filter((l) => l.id !== line.id),
                        panel: undefined,
                      })
                    }
                  />
                  {!draft.panel ? (
                    <div style={rowStyle}>
                      <button
                        type="button"
                        onClick={() => {
                          setForm(emptyLineForm());
                          setErrors({});
                          setDraft({ ...draft, panel: { type: 'add' } });
                        }}
                        data-testid="draft-add-line"
                      >
                        {f.t('draft.addLine')}
                      </button>
                    </div>
                  ) : (
                    <BudgetLineForm
                      mode={draft.panel.type}
                      values={form}
                      errors={errors}
                      targets={options}
                      currency={currency}
                      f={fb}
                      busy={busy}
                      onChange={setForm}
                      onSubmit={submitLine}
                      onCancel={() => {
                        setErrors({});
                        setDraft({ ...draft, panel: undefined });
                      }}
                    />
                  )}
                  <DiffTable
                    rows={draftRows}
                    names={names}
                    f={f}
                    fb={fb}
                    title={f.t('draft.changesTitle', { versionNo: detail.currentVersionNo })}
                  />
                  <Field label={f.t('draft.note')} hint={f.t('draft.noteHint')}>
                    {(p) => (
                      <input
                        {...p}
                        style={inputStyle}
                        value={draft.note}
                        maxLength={500}
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                        data-testid="draft-note"
                      />
                    )}
                  </Field>
                  <div style={rowStyle}>
                    <button
                      type="button"
                      onClick={() => void publish()}
                      disabled={busy || draftRows.length === 0}
                      data-testid="draft-publish"
                    >
                      {f.t('draft.publish')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPropagation({
                          kind: 'TEMPLATE',
                          templateId: detail.id,
                          baseVersionNo: detail.currentVersionNo,
                          lines: draftInputs(draft.lines),
                        })
                      }
                      disabled={busy || draftRows.length === 0}
                      data-testid="draft-propagate"
                    >
                      {f.t('draft.propagate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(undefined)}
                      disabled={busy}
                      data-testid="draft-discard"
                    >
                      {f.t('draft.discard')}
                    </button>
                  </div>
                  {propagation ? (
                    <PropagationPanel
                      ctx={ctx}
                      source={propagation}
                      names={names}
                      onClose={(applied) => {
                        setPropagation(undefined);
                        if (applied) {
                          setDraft(undefined);
                          loadList();
                          loadDetail(detail.id);
                        }
                      }}
                    />
                  ) : null}
                </section>
              ) : null}

              {viewing ? (
                <TemplateLinesTable
                  lines={viewing.lines}
                  names={names}
                  f={f}
                  fb={fb}
                  caption={f.t('lines.caption', { versionNo: viewing.versionNo })}
                />
              ) : null}

              <div style={tableWrapStyle}>
                <table style={tableStyle} data-testid="template-versions">
                  <caption style={{ textAlign: 'left' }}>{f.t('versions.caption')}</caption>
                  <thead>
                    <tr>
                      {(['version', 'note', 'date', 'lines', 'actions'] as const).map((c) => (
                        <th key={c} scope="col" style={cellStyle}>
                          {f.t(`versions.columns.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.versions.map((v) => (
                      <tr key={v.versionNo} data-testid="template-version" data-version={v.versionNo}>
                        <th scope="row" style={{ ...cellStyle, textAlign: 'left' }}>
                          {f.t('versions.version', { versionNo: v.versionNo })}
                          {v.versionNo === detail.currentVersionNo ? ` (${f.t('versions.current')})` : ''}
                        </th>
                        <td style={cellStyle}>{v.changeNote ?? '—'}</td>
                        <td style={cellStyle}>
                          {formatInstant(v.createdAt, ctx.formatLocale, ctx.timeZone)}
                        </td>
                        <td style={cellStyle}>{v.lineCount}</td>
                        <td style={cellStyle}>
                          <button
                            type="button"
                            onClick={() => void viewVersion(v.versionNo)}
                            aria-label={f.t('versions.viewLabel', { versionNo: v.versionNo })}
                            aria-pressed={viewing?.versionNo === v.versionNo}
                          >
                            {f.t('versions.view')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.versions.length > 1 ? (
                <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}>
                  <h3 style={{ margin: 0 }}>{f.t('compare.title')}</h3>
                  <div style={rowStyle}>
                    <Field label={f.t('compare.from')}>
                      {(p) => (
                        <select
                          {...p}
                          style={inputStyle}
                          value={compareTo?.a ?? detail.versions.at(-1)!.versionNo}
                          onChange={(e) =>
                            void compare(Number(e.target.value), compareTo?.b ?? detail.currentVersionNo)
                          }
                          data-testid="compare-from"
                        >
                          {detail.versions.map((v) => (
                            <option key={v.versionNo} value={v.versionNo}>
                              {f.t('versions.version', { versionNo: v.versionNo })}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label={f.t('compare.to')}>
                      {(p) => (
                        <select
                          {...p}
                          style={inputStyle}
                          value={compareTo?.b ?? detail.currentVersionNo}
                          onChange={(e) =>
                            void compare(
                              compareTo?.a ?? detail.versions.at(-1)!.versionNo,
                              Number(e.target.value),
                            )
                          }
                          data-testid="compare-to"
                        >
                          {detail.versions.map((v) => (
                            <option key={v.versionNo} value={v.versionNo}>
                              {f.t('versions.version', { versionNo: v.versionNo })}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <button
                      type="button"
                      onClick={() =>
                        void compare(
                          compareTo?.a ?? detail.versions.at(-1)!.versionNo,
                          compareTo?.b ?? detail.currentVersionNo,
                        )
                      }
                      data-testid="compare-run"
                    >
                      {f.t('compare.run')}
                    </button>
                  </div>
                  {compared ? (
                    <DiffTable
                      rows={compared}
                      names={names}
                      f={f}
                      fb={fb}
                      title={f.t('compare.caption', { a: compareTo?.a ?? 0, b: compareTo?.b ?? 0 })}
                    />
                  ) : null}
                </div>
              ) : null}

              {canWrite ? (
                <form
                  style={formStyle}
                  aria-label={f.t('clone.title')}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void clone();
                  }}
                  data-testid="template-clone-form"
                >
                  <h3 style={{ margin: 0 }}>{f.t('clone.title')}</h3>
                  <p style={mutedStyle}>
                    {f.t('clone.intro', { versionNo: viewing?.versionNo ?? detail.currentVersionNo })}
                  </p>
                  <div style={rowStyle}>
                    <Field label={f.t('clone.name')}>
                      {(p) => (
                        <input
                          {...p}
                          style={inputStyle}
                          value={cloneName}
                          maxLength={120}
                          onChange={(e) => setCloneName(e.target.value)}
                          data-testid="clone-name"
                        />
                      )}
                    </Field>
                    <button
                      type="submit"
                      disabled={busy || cloneName.trim() === ''}
                      data-testid="clone-submit"
                    >
                      {f.t('clone.submit')}
                    </button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
