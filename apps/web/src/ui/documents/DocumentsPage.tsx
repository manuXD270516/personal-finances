'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import {
  ConfirmPanel,
  Field,
  cellStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { BFF_API } from '../session-context';
import {
  ATTACHMENT_TARGET_TYPES,
  DOCUMENT_PURPOSES,
  DOCUMENT_STATUS_FILTERS,
  downloadPath,
  formatBytes,
  quotaPercent,
  type DocumentView,
  type UsageView,
} from './logic';

type Action = { readonly kind: 'delete'; readonly doc: DocumentView } | undefined;

/** `/documentos`: todos los documentos del workspace con filtros, uso de la cuota y acciones (docs/28; tarea 6.2). */
export function DocumentsPageView() {
  return <WithWorkspace>{(ctx) => <Documents ctx={ctx} />}</WithWorkspace>;
}

function Documents({ ctx }: { ctx: WorkspaceContext }) {
  const t = useTranslations('Documents');
  const { api, base } = ctx;
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState<'exclude' | 'only' | 'include'>('exclude');
  const [targetType, setTargetType] = useState('');
  const [items, setItems] = useState<readonly DocumentView[] | undefined>();
  const [usage, setUsage] = useState<UsageView | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [action, setAction] = useState<Action>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ archived, limit: '200' });
      if (purpose) q.set('purpose', purpose);
      if (status) q.set('status', status);
      const [list, used] = await Promise.all([
        api.get<{ data: DocumentView[] }>(`${base}/documents?${q.toString()}`),
        api.get<UsageView>(`${base}/documents/usage`),
      ]);
      const rows = list.data?.data ?? [];
      setItems(targetType ? rows.filter((d) => d.links.some((l) => l.targetType === targetType)) : rows);
      setUsage(used.data);
      setProblem(undefined);
    } catch (err) {
      setProblem(problemOf(err));
    }
  }, [api, base, purpose, status, archived, targetType]);
  useEffect(() => {
    setItems(undefined);
    void load();
  }, [load]);

  async function archive(doc: DocumentView, on: boolean) {
    setBusy(true);
    try {
      await api.command('POST', `${base}/documents/${doc.id}/${on ? 'archive' : 'unarchive'}`, undefined, {
        ifMatch: doc.version,
        idempotent: false,
      });
      await load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: DocumentView) {
    setBusy(true);
    try {
      await api.command('DELETE', `${base}/documents/${doc.id}`, undefined, {
        ifMatch: doc.version,
        idempotent: false,
      });
      setAction(undefined);
      await load();
    } catch (err) {
      setAction(undefined);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const percent = usage ? quotaPercent(usage) : 0;
  const hasPending = items?.some((d) => d.status === 'CONTENT_PENDING') ?? false;
  const hasLoose =
    items?.some((d) => d.status === 'AVAILABLE' && d.links.length === 0 && !d.archivedAt) ?? false;

  return (
    <section aria-labelledby="documents-title" style={pageStyle} data-testid="documents-page">
      <h1 id="documents-title">{t('page.title')}</h1>
      <p style={mutedStyle}>{t('page.intro')}</p>

      {usage ? (
        <div data-testid="documents-usage">
          <p style={{ margin: 0 }}>
            {t('usage.text', {
              used: formatBytes(usage.usedBytes + usage.reservedBytes, ctx.formatLocale),
              quota: formatBytes(usage.quotaBytes, ctx.formatLocale),
              percent,
            })}
          </p>
          <progress value={percent} max={100} aria-label={t('usage.label')} style={{ width: '100%' }} />
          <p style={mutedStyle}>
            {t('usage.pending', { count: usage.pendingUploads, max: usage.maxPendingUploads })}
          </p>
        </div>
      ) : null}

      {hasPending ? (
        <p role="note" style={warningStyle} data-testid="documents-content-pending">
          {t('page.contentPendingNotice')}
        </p>
      ) : null}
      {hasLoose ? (
        <p role="note" style={warningStyle} data-testid="documents-purge-notice">
          {t('page.purgeNotice')}
        </p>
      ) : null}

      <div style={rowStyle} role="group" aria-label={t('page.filters')}>
        <Field label={t('page.purpose')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={purpose}
              data-testid="documents-purpose"
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="">{t('page.all')}</option>
              {DOCUMENT_PURPOSES.map((k) => (
                <option key={k} value={k}>
                  {t(`purposes.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('page.status')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={status}
              data-testid="documents-status"
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t('page.usable')}</option>
              {DOCUMENT_STATUS_FILTERS.map((k) => (
                <option key={k} value={k}>
                  {t(`statuses.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('page.element')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={targetType}
              data-testid="documents-target"
              onChange={(e) => setTargetType(e.target.value)}
            >
              <option value="">{t('page.all')}</option>
              {ATTACHMENT_TARGET_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`targets.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('page.archived')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={archived}
              data-testid="documents-archived"
              onChange={(e) => setArchived(e.target.value as 'exclude' | 'only' | 'include')}
            >
              <option value="exclude">{t('page.archivedExclude')}</option>
              <option value="only">{t('page.archivedOnly')}</option>
              <option value="include">{t('page.archivedInclude')}</option>
            </select>
          )}
        </Field>
      </div>

      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined && !problem ? <p aria-busy="true">{t('loading')}</p> : null}
      {items && items.length === 0 ? (
        <p style={mutedStyle} data-testid="documents-empty">
          {t('page.empty')}
        </p>
      ) : null}
      {items && items.length > 0 ? (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={t('page.region')}>
          <table style={tableStyle} data-testid="documents-table">
            <caption className="pf-sr-only">{t('page.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {t('page.name')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('page.purpose')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('page.status')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('page.size')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('page.links')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('page.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} data-testid="documents-row">
                  <td style={cellStyle}>{d.originalName}</td>
                  <td style={cellStyle}>{t(`purposes.${d.purpose}` as never)}</td>
                  <td style={cellStyle}>
                    {t(`statuses.${d.status}` as never)}
                    {d.archivedAt ? ` · ${t('page.archivedTag')}` : ''}
                  </td>
                  <td style={cellStyle}>{formatBytes(d.sizeBytes, ctx.formatLocale)}</td>
                  <td style={cellStyle}>{d.links.length}</td>
                  <td style={cellStyle}>
                    <span style={rowStyle}>
                      {d.status === 'AVAILABLE' ? (
                        <a
                          href={downloadPath(BFF_API, ctx.ws.id, d.id)}
                          download
                          aria-label={t('downloadNamed', { name: d.originalName })}
                        >
                          {t('download')}
                        </a>
                      ) : null}
                      {ctx.canEdit && (d.status === 'AVAILABLE' || d.status === 'CONTENT_PENDING') ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            data-testid="document-archive"
                            aria-label={t(d.archivedAt ? 'unarchiveNamed' : 'archiveNamed', {
                              name: d.originalName,
                            })}
                            onClick={() => void archive(d, !d.archivedAt)}
                          >
                            {d.archivedAt ? t('page.unarchive') : t('page.archive')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            data-testid="document-delete"
                            aria-label={t('deleteNamed', { name: d.originalName })}
                            onClick={() => setAction({ kind: 'delete', doc: d })}
                          >
                            {t('page.delete')}
                          </button>
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {action?.kind === 'delete' ? (
        <ConfirmPanel
          title={t('page.deleteTitle')}
          description={t('page.deleteBody', { name: action.doc.originalName })}
          confirmLabel={t('page.delete')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void remove(action.doc)}
          onCancel={() => setAction(undefined)}
          testId="document-delete-confirm"
        />
      ) : null}
    </section>
  );
}
