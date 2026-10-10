'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cellStyle, mutedStyle, pageStyle, rowStyle, tableStyle, tableWrapStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { Badge } from '../recurring/Badges';
import { JOB_PRESENTATION, isResumable, listImportsPath } from './logic';
import { useAccounts } from './useAccounts';
import type { ImportJob, ImportPage } from './types';

export function ImportsListPage({ accountId }: { accountId?: string | undefined }) {
  return <WithWorkspace>{(ctx) => <ImportsList ctx={ctx} accountId={accountId} />}</WithWorkspace>;
}

/** Tabla de importaciones (la más reciente primero): permite retomar las que esperan columnas, revisión o decisión. */
export function ImportsTable({
  items,
  f,
  accountName,
  href,
  timeZone,
}: {
  items: readonly ImportJob[];
  f: FormatContext;
  accountName: (id: string) => string | undefined;
  href: (path: string) => string;
  timeZone: string;
}) {
  return (
    <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('list.region')}>
      <table style={tableStyle} data-testid="imports-table">
        <caption className="pf-sr-only">{f.t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('list.file')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.account')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.status')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.date')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('list.actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((job) => (
            <tr key={job.id} data-testid="import-item" data-status={job.status}>
              <th scope="row" style={cellStyle}>
                {job.originalName ?? '—'}
              </th>
              <td style={cellStyle}>{accountName(job.accountId) ?? '—'}</td>
              <td style={cellStyle}>
                <Badge
                  presentation={JOB_PRESENTATION[job.status]}
                  label={f.t(`status.${job.status}`)}
                  status={job.status}
                  testId="import-item-status"
                />
              </td>
              <td style={cellStyle}>{formatInstant(job.createdAt, f.locale, timeZone)}</td>
              <td style={cellStyle}>
                <a href={href(`/imports/${job.id}`)} data-testid="import-open">
                  {isResumable(job.status) ? f.t('list.resume') : f.t('list.open')}
                  <span className="pf-sr-only"> {job.originalName ?? ''}</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportsList({ ctx, accountId }: { ctx: WorkspaceContext; accountId?: string | undefined }) {
  const f = useFormat('Imports', ctx);
  const accounts = useAccounts(ctx);
  const [items, setItems] = useState<readonly ImportJob[] | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<ImportPage>(listImportsPath(ctx.base, accountId))
      .then((r) => {
        if (cancelled) return;
        setItems(r.data?.data ?? []);
        setCursor(r.data?.page.hasMore ? (r.data.page.nextCursor ?? null) : null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, accountId]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await ctx.api.get<ImportPage>(
        `${listImportsPath(ctx.base, accountId)}&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...(prev ?? []), ...(r.data?.data ?? [])]);
      setCursor(r.data?.page.hasMore ? (r.data.page.nextCursor ?? null) : null);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="imports-title" style={pageStyle} data-testid="imports-page">
      <h1 id="imports-title">{f.t('listTitle')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {ctx.canEdit ? (
        <p style={{ margin: 0 }}>
          <a
            href={ctx.href(`/imports/nueva${accountId ? `?cuenta=${encodeURIComponent(accountId)}` : ''}`)}
            data-testid="new-import"
          >
            {f.t('newImport')}
          </a>
        </p>
      ) : (
        <p style={mutedStyle} data-testid="import-viewer-note">
          {f.t('viewerNotice')}
        </p>
      )}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : items.length === 0 ? (
        <p style={mutedStyle} data-testid="imports-empty">
          {f.t('empty')}
        </p>
      ) : (
        <ImportsTable
          items={items}
          f={f}
          accountName={(id) => accounts.byId(id)?.name}
          href={ctx.href}
          timeZone={ctx.timeZone}
        />
      )}
      {cursor ? (
        <div style={rowStyle}>
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? f.t('loading') : f.t('loadMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
