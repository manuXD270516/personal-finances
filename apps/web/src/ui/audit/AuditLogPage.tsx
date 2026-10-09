'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatValue } from '../AuditHistory';
import {
  badgeStyle,
  cardStyle,
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { BFF_API } from '../session-context';
import {
  actionKey,
  AUDIT_ORIGINS,
  appendEntries,
  auditHref,
  canExport,
  canQuery,
  CATEGORY_FILTERS,
  EMPTY_AUDIT_FILTERS,
  entityHref,
  exportPath,
  filterErrors,
  listPath,
  MAX_EXPORT_ROWS,
  type AuditEntry,
  type AuditFilters,
  type AuditPage,
  type CategoryFilter,
  type FilterErrors,
} from './logic';

/** Pantalla "Auditoría" (`/configuracion/auditoria`): vista global del log, OWNER y EDITOR (docs/33 D105). */
export function AuditLogPage({ initial }: { initial: AuditFilters }) {
  return <WithWorkspace>{(ctx) => <AuditScreen ctx={ctx} initial={initial} />}</WithWorkspace>;
}

function AuditScreen({ ctx, initial }: { ctx: WorkspaceContext; initial: AuditFilters }) {
  const f = useFormat('AuditLog', ctx);
  const h = useFormat('AuditHistory', ctx);
  const [draft, setDraft] = useState<AuditFilters>(initial);
  const [applied, setApplied] = useState<AuditFilters>(initial);
  const [entries, setEntries] = useState<readonly AuditEntry[] | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const request = useRef(0);
  const allowed = canQuery(ctx.ws.role);
  const errors = filterErrors(draft);

  const load = useCallback(() => {
    if (!allowed) return;
    const mine = (request.current += 1);
    setEntries(undefined);
    setProblem(undefined);
    ctx.api
      .get<AuditPage>(`${ctx.base}${listPath(applied)}`)
      .then((r) => {
        if (mine !== request.current) return;
        setEntries(r.data?.data ?? []);
        setHasMore(r.data?.page.hasMore ?? false);
        setNextCursor(r.data?.page.nextCursor ?? null);
      })
      .catch((err: unknown) => {
        if (mine !== request.current) return;
        setProblem(problemOf(err));
        setEntries([]);
        setHasMore(false);
      });
  }, [allowed, ctx.api, ctx.base, applied]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const r = await ctx.api.get<AuditPage>(`${ctx.base}${listPath(applied, nextCursor)}`);
      if (mine !== request.current) return;
      setEntries((current) => appendEntries(current ?? [], r.data?.data ?? []));
      setHasMore(r.data?.page.hasMore ?? false);
      setNextCursor(r.data?.page.nextCursor ?? null);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const apply = (next: AuditFilters) => {
    if (Object.keys(filterErrors(next)).length > 0) return;
    setDraft(next);
    setApplied(next);
  };

  return (
    <AuditLogView
      f={f}
      h={h}
      role={ctx.ws.role}
      currentUserId={ctx.me.id}
      href={ctx.href}
      draft={draft}
      errors={errors}
      onDraft={setDraft}
      onApply={() => apply(draft)}
      onReset={() => apply(EMPTY_AUDIT_FILTERS)}
      onFilterBy={(patch) => apply({ ...draft, ...patch })}
      entries={entries}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={() => void loadMore()}
      exportHref={`${BFF_API}${ctx.base}${exportPath(applied)}`}
      problem={problem}
      uiLocale={ctx.uiLocale}
    />
  );
}

export interface AuditLogViewProps {
  /** Textos de `AuditLog`; `h` son los de `AuditHistory` (nombres de acciones y campos ya traducidos). */
  readonly f: FormatContext;
  readonly h: FormatContext;
  readonly role: string;
  readonly currentUserId?: string;
  readonly href: (path: string) => string;
  readonly draft: AuditFilters;
  readonly errors: FilterErrors;
  readonly onDraft: (next: AuditFilters) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly onFilterBy: (patch: Partial<AuditFilters>) => void;
  readonly entries: readonly AuditEntry[] | undefined;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly exportHref: string;
  readonly problem: ApiProblemBody | undefined;
  readonly uiLocale: string;
}

/** Vista de la pantalla (presentacional; testeable con `renderToStaticMarkup`). */
export function AuditLogView(p: AuditLogViewProps) {
  const { f } = p;
  if (!canQuery(p.role)) {
    return (
      <section style={pageStyle} aria-labelledby="audit-title" data-testid="audit-log-denied">
        <h1 id="audit-title">{f.t('title')}</h1>
        <p role="note" style={warningStyle}>
          {f.t('noAccess')}
        </p>
      </section>
    );
  }
  const hasErrors = Object.keys(p.errors).length > 0;
  return (
    <section style={pageStyle} aria-labelledby="audit-title" data-testid="audit-log">
      <header>
        <h1 id="audit-title">{f.t('title')}</h1>
        <p style={mutedStyle}>{f.t('subtitle')}</p>
      </header>
      <FiltersForm {...p} hasErrors={hasErrors} />
      {canExport(p.role) ? (
        <p>
          <a
            href={hasErrors ? undefined : p.exportHref}
            download
            data-testid="audit-export"
            aria-disabled={hasErrors ? true : undefined}
            style={linkButton}
          >
            {f.t('export.csv')}
          </a>{' '}
          <small style={mutedStyle}>{f.t('export.hint', { max: String(MAX_EXPORT_ROWS) })}</small>
        </p>
      ) : (
        <p style={mutedStyle} data-testid="audit-export-owner-only">
          {f.t('export.ownerOnly')}
        </p>
      )}
      {p.problem ? <ProblemMessage problem={p.problem} locale={p.uiLocale} /> : null}
      {p.entries === undefined ? (
        <p aria-busy="true" data-testid="audit-loading">
          {f.t('loading')}
        </p>
      ) : p.entries.length === 0 && !p.problem ? (
        <p data-testid="audit-empty">{f.t('empty')}</p>
      ) : (
        <EntriesTable {...p} entries={p.entries} />
      )}
      {p.hasMore ? (
        <p>
          <button type="button" onClick={p.onLoadMore} disabled={p.loadingMore} data-testid="audit-more">
            {p.loadingMore ? f.t('loadingMore') : f.t('loadMore')}
          </button>
        </p>
      ) : null}
    </section>
  );
}

const linkButton = {
  display: 'inline-block',
  padding: 'var(--pf-space-2) var(--pf-space-3)',
  border: '1px solid var(--pf-border-strong)',
  borderRadius: 'var(--pf-radius-sm)',
  textDecoration: 'none',
  color: 'inherit',
} as const;

function FiltersForm(p: AuditLogViewProps & { hasErrors: boolean }) {
  const { f, draft, errors, onDraft } = p;
  const set = (patch: Partial<AuditFilters>) => onDraft({ ...draft, ...patch });
  const err = (k: keyof FilterErrors) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);
  const textField = (
    key: 'actorUserId' | 'action' | 'aggregateType' | 'aggregateId' | 'correlationId',
    extra: { list?: string; placeholder?: string } = {},
  ) => (
    <Field
      label={f.t(`filters.${key}`)}
      error={err(key)}
      hint={f.has(`hints.${key}`) ? f.t(`hints.${key}`) : undefined}
    >
      {(props) => (
        <input
          {...props}
          name={key}
          type="text"
          style={inputStyle}
          value={draft[key]}
          autoComplete="off"
          spellCheck={false}
          {...(extra.list ? { list: extra.list } : {})}
          {...(extra.placeholder ? { placeholder: extra.placeholder } : {})}
          onChange={(e) => set({ [key]: e.target.value.trim() })}
        />
      )}
    </Field>
  );
  return (
    <form
      style={formStyle}
      aria-label={f.t('filters.label')}
      data-testid="audit-filters"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        p.onApply();
      }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend>{f.t('filters.category')}</legend>
        <div
          role="group"
          aria-label={f.t('filters.category')}
          style={{ display: 'flex', gap: 'var(--pf-space-2)' }}
        >
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={draft.category === c}
              data-testid={`audit-category-${c.toLowerCase()}`}
              onClick={() => p.onFilterBy({ category: c as CategoryFilter })}
              style={draft.category === c ? { fontWeight: 700, borderColor: 'var(--pf-primary)' } : undefined}
            >
              {f.t(`category.${c}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <div style={rowStyle}>
        {textField('actorUserId')}
        <p style={{ alignSelf: 'end' }}>
          {p.currentUserId ? (
            <button type="button" onClick={() => p.onFilterBy({ actorUserId: p.currentUserId! })}>
              {f.t('filters.onlyMine')}
            </button>
          ) : null}
        </p>
        {textField('action', { list: 'audit-actions', placeholder: 'transactions.transaction.voided' })}
        <datalist id="audit-actions">
          {KNOWN_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a, p.f, p.h)}
            </option>
          ))}
        </datalist>
      </div>
      <div style={rowStyle}>
        {textField('aggregateType', { placeholder: 'Transaction' })}
        {textField('aggregateId')}
        {textField('correlationId')}
        <Field label={f.t('filters.origin')}>
          {(props) => (
            <select
              {...props}
              name="origin"
              style={inputStyle}
              value={draft.origin}
              onChange={(e) => set({ origin: e.target.value })}
            >
              <option value="">{f.t('filters.anyOrigin')}</option>
              {AUDIT_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {f.has(`origin.${o}`) ? f.t(`origin.${o}`) : o}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field label={f.t('filters.from')} error={err('from')}>
          {(props) => (
            <input
              {...props}
              name="from"
              type="date"
              style={inputStyle}
              value={draft.from}
              onChange={(e) => set({ from: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('filters.to')} error={err('to')} hint={f.t('hints.range')}>
          {(props) => (
            <input
              {...props}
              name="to"
              type="date"
              style={inputStyle}
              value={draft.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={p.hasErrors} data-testid="audit-apply">
          {f.t('filters.apply')}
        </button>
        <button type="button" onClick={p.onReset} data-testid="audit-reset">
          {f.t('filters.reset')}
        </button>
      </div>
    </form>
  );
}

/** Acciones conocidas para sugerir en el filtro (el catálogo completo de la API es la autoridad). */
export const KNOWN_ACTIONS = [
  'security.authorization.denied',
  'identity.session.started',
  'identity.session.ended',
  'identity.workspace.settings_changed',
  'audit.log.exported',
  'audit.lifecycle.exported',
  'planning.period.reopened',
  'transactions.transaction.created',
  'transactions.transaction.updated',
  'transactions.transaction.voided',
  'transactions.transaction.bulk_edited',
  'accounts.account.opened',
  'accounts.account.archived',
] as const;

function actionLabel(action: string, f: FormatContext, h: FormatContext): string {
  const key = actionKey(action);
  if (f.has(key)) return f.t(key);
  if (h.has(key)) return h.t(key);
  return action;
}

function fieldLabel(field: string, f: FormatContext, h: FormatContext): string {
  if (f.has(`fields.${field}`)) return f.t(`fields.${field}`);
  if (h.has(`fields.${field}`)) return h.t(`fields.${field}`);
  return field;
}

function actorLabel(e: AuditEntry, f: FormatContext, currentUserId: string | undefined): string {
  if (e.actor.type === 'USER') {
    return e.actor.userId === currentUserId
      ? f.t('actor.you')
      : f.t('actor.user', { id: (e.actor.userId ?? '').slice(-8) });
  }
  return f.t('actor.system', { process: e.actor.process ?? '' });
}

function EntriesTable(p: AuditLogViewProps & { entries: readonly AuditEntry[] }) {
  const { f, h } = p;
  const [open, setOpen] = useState<string | undefined>();
  const when = new Intl.DateTimeFormat(f.locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: f.timeZone,
  });
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="audit-entries">
        <caption style={{ textAlign: 'left', padding: 'var(--pf-space-2) var(--pf-space-3)' }}>
          {f.t('table.caption')}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('table.when')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('table.action')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('table.actor')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('table.entity')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('table.detail')}
            </th>
          </tr>
        </thead>
        <tbody>
          {p.entries.map((e) => {
            const expanded = open === e.id;
            const detailId = `audit-detail-${e.id}`;
            return (
              <Row key={e.id}>
                <tr data-testid="audit-row" data-action={e.action} data-category={e.category ?? 'DATA'}>
                  <td style={cellStyle}>
                    <time dateTime={e.occurredAt}>{when.format(new Date(e.occurredAt))}</time>
                  </td>
                  <td style={cellStyle}>
                    <strong>{actionLabel(e.action, f, h)}</strong>{' '}
                    {e.category === 'SECURITY' ? (
                      <span style={badgeStyle} data-testid="audit-chip-security">
                        {f.t('category.SECURITY')}
                      </span>
                    ) : null}
                    <br />
                    <small style={mutedStyle}>
                      <code>{e.action}</code>
                    </small>
                  </td>
                  <td style={cellStyle}>{actorLabel(e, f, p.currentUserId)}</td>
                  <td style={cellStyle}>
                    {f.has(`entityTypes.${e.aggregateType}`)
                      ? f.t(`entityTypes.${e.aggregateType}`)
                      : e.aggregateType}
                    <br />
                    <small style={mutedStyle}>
                      <code>{e.aggregateId.slice(-8)}</code>
                    </small>
                  </td>
                  <td style={cellStyle}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      data-testid="audit-toggle"
                      onClick={() => setOpen(expanded ? undefined : e.id)}
                    >
                      {expanded ? f.t('table.hide') : f.t('table.show')}
                    </button>
                  </td>
                </tr>
                {expanded ? (
                  <tr id={detailId} data-testid="audit-detail">
                    <td colSpan={5} style={cellStyle}>
                      <EntryDetail {...p} entry={e} />
                    </td>
                  </tr>
                ) : null}
              </Row>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

/** Detalle de un registro: diff antes/después, motivo, origen y enlaces (misma operación, recorrido, elemento). */
export function EntryDetail(p: AuditLogViewProps & { entry: AuditEntry }) {
  const { f, h, entry: e } = p;
  const entity = entityHref(e.aggregateType, e.aggregateId);
  return (
    <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.25rem 1rem', margin: 0 }}>
        <dt>{f.t('detail.origin')}</dt>
        <dd style={{ margin: 0 }}>{f.has(`origin.${e.origin}`) ? f.t(`origin.${e.origin}`) : e.origin}</dd>
        {e.aggregateVersion !== null ? (
          <>
            <dt>{f.t('detail.version')}</dt>
            <dd style={{ margin: 0 }}>{e.aggregateVersion}</dd>
          </>
        ) : null}
        {e.reason ? (
          <>
            <dt>{f.t('detail.reason')}</dt>
            <dd style={{ margin: 0 }}>{e.reason}</dd>
          </>
        ) : null}
        <dt>{f.t('detail.correlation')}</dt>
        <dd style={{ margin: 0 }}>
          <code>{e.correlationId}</code>
        </dd>
      </dl>
      {e.changes.length > 0 ? (
        <table style={tableStyle}>
          <caption style={{ textAlign: 'left' }}>{f.t('detail.changes')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('detail.field')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('detail.before')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('detail.after')}
              </th>
            </tr>
          </thead>
          <tbody>
            {e.changes.map((c) => (
              <tr key={c.field} data-field={c.field}>
                <th scope="row" style={cellStyle}>
                  {fieldLabel(c.field, f, h)}
                </th>
                <td style={cellStyle}>{formatValue(c.before, f.locale, f.t('detail.none'))}</td>
                <td style={cellStyle}>{formatValue(c.after, f.locale, f.t('detail.none'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={mutedStyle}>{f.t('detail.noChanges')}</p>
      )}
      <nav
        aria-label={f.t('detail.links')}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-3)' }}
      >
        <a href={p.href(auditHref({ correlationId: e.correlationId }))} data-testid="audit-link-operation">
          {f.t('detail.sameOperation')}
        </a>
        <a
          href={p.href(auditHref({ aggregateType: e.aggregateType, aggregateId: e.aggregateId }))}
          data-testid="audit-link-entity-log"
        >
          {f.t('detail.entityLog')}
        </a>
        {entity ? (
          <a href={p.href(entity)} data-testid="audit-link-entity">
            {f.t('detail.openEntity')}
          </a>
        ) : null}
        {e.actor.type === 'USER' && e.actor.userId ? (
          <button type="button" onClick={() => p.onFilterBy({ actorUserId: e.actor.userId! })}>
            {f.t('detail.byActor')}
          </button>
        ) : null}
      </nav>
    </div>
  );
}
