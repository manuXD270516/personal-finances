'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, ConfirmPanel, mutedStyle, warningStyle } from '../common/ui';
import { BFF_API, localized, useSession } from '../session-context';
import {
  POLL_MS,
  canDownload,
  checkImportFile,
  exportInProgress,
  filenameFrom,
  formatBytes,
  importInProgress,
  importStep,
  IMPORT_STEPS,
  needsReauth,
  reauthUrl,
  type WorkspaceExportView,
  type WorkspaceImportView,
} from './logic';

const problemOf = (err: unknown): ApiProblemBody =>
  err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' };

/** Aviso de reautenticación: el export/import exige un inicio de sesión de los últimos 10 minutos. */
function ReauthNotice({ locale }: { locale: string }) {
  const t = useTranslations('Portability');
  return (
    <div
      role="alert"
      data-testid="portability-reauth"
      style={{ ...warningStyle, display: 'grid', gap: '0.5rem' }}
    >
      <p style={{ margin: 0 }}>{t('reauthBody')}</p>
      <div>
        <a href={reauthUrl(localized(locale, '/configuracion'))} data-testid="portability-reauth-link">
          {t('reauthAction')}
        </a>
      </div>
    </div>
  );
}

/**
 * "Exportar el espacio de trabajo" (solo OWNER; openspec add-workspace-export 6.x): solicita el export completo,
 * muestra su estado y permite descargarlo o eliminarlo antes de que venza. La API exige reautenticación reciente; la
 * UI solo la facilita. El aviso de "listo" no incluye cifras ni datos financieros.
 */
export function ExportPanel() {
  const t = useTranslations('Portability');
  const locale = useLocale();
  const { state } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const active = ready?.active;
  const api = ready?.api;
  const csrf = ready?.csrfToken;
  const [items, setItems] = useState<WorkspaceExportView[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [confirm, setConfirm] = useState<'request' | { discard: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!api || !active || active.role !== 'OWNER') return;
    try {
      const r = await api.get<{ data: WorkspaceExportView[] }>(`/workspaces/${active.workspaceId}/exports`);
      setItems(r.data?.data ?? []);
    } catch (err) {
      setProblem(problemOf(err));
    }
  }, [api, active]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = items?.some(exportInProgress) ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [running, items, refresh]);

  if (!ready || !active || active.role !== 'OWNER') return null;
  const workspaceId = active.workspaceId;

  async function request() {
    if (!api) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.command<WorkspaceExportView>('POST', `/workspaces/${workspaceId}/exports`, undefined);
      setConfirm(null);
      await refresh();
    } catch (err) {
      setConfirm(null);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function discard(exportId: string) {
    if (!api) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.command<WorkspaceExportView>(
        'POST',
        `/workspaces/${workspaceId}/exports/${exportId}/discard`,
        undefined,
      );
      setConfirm(null);
      await refresh();
    } catch (err) {
      setConfirm(null);
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function download(exportId: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      const res = await fetch(`${BFF_API}/workspaces/${workspaceId}/exports/${exportId}/download`, {
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf ?? '' },
      });
      if (!res.ok) {
        setProblem((await res.json().catch(() => ({}))) as ApiProblemBody);
        await refresh();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFrom(res.headers.get('content-disposition'), `pfos-export-${exportId}.zip`);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setProblem({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
      : '—';
  const readyExport = items?.find(canDownload);

  return (
    <section
      aria-labelledby="export-title"
      data-testid="export-panel"
      style={{ ...cardStyle, display: 'grid', gap: '0.5rem' }}
    >
      <h2 id="export-title">{t('export.title')}</h2>
      <p style={{ margin: 0 }}>{t('export.description')}</p>
      <p style={{ ...mutedStyle, margin: 0 }}>{t('export.security')}</p>

      {readyExport ? (
        <p role="status" data-testid="export-ready-notice" style={{ margin: 0 }}>
          {t('export.readyNotice')}
        </p>
      ) : null}

      {confirm !== 'request' ? (
        <div>
          <button
            type="button"
            data-testid="export-request"
            disabled={running || busy}
            onClick={() => setConfirm('request')}
          >
            {t('export.request')}
          </button>
        </div>
      ) : (
        <ConfirmPanel
          testId="export-request-confirm"
          title={t('export.confirmTitle')}
          description={t('export.confirmBody')}
          confirmLabel={t('export.confirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void request()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {needsReauth(problem) ? <ReauthNotice locale={locale} /> : null}
      {problem && !needsReauth(problem) ? <ProblemMessage problem={problem} locale={locale} /> : null}

      {items && items.length > 0 ? (
        <ul
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}
          data-testid="export-list"
        >
          {items.map((e) => (
            <li
              key={e.id}
              data-testid="export-item"
              data-status={e.status}
              style={{ display: 'grid', gap: '0.25rem' }}
            >
              <span>
                <strong>{t(`export.status.${e.status}`)}</strong>
                {' · '}
                {fmt(e.requestedAt)}
                {e.sizeBytes !== null ? ` · ${formatBytes(e.sizeBytes)}` : ''}
              </span>
              {exportInProgress(e) ? (
                <progress aria-label={t('export.running')} data-testid="export-progress" />
              ) : null}
              {e.status === 'READY' ? (
                <span style={mutedStyle}>{t('export.expires', { date: fmt(e.expiresAt) })}</span>
              ) : null}
              {e.status === 'FAILED' ? <span role="alert">{t('export.failed')}</span> : null}
              {canDownload(e) ? (
                <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid="export-download"
                    disabled={busy}
                    onClick={() => void download(e.id)}
                  >
                    {t('export.download')}
                  </button>
                  <button
                    type="button"
                    data-testid="export-discard"
                    disabled={busy}
                    onClick={() => setConfirm({ discard: e.id })}
                  >
                    {t('export.discard')}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {typeof confirm === 'object' && confirm ? (
        <ConfirmPanel
          testId="export-discard-confirm"
          title={t('export.discardTitle')}
          description={t('export.discardBody')}
          confirmLabel={t('export.discardConfirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void discard(confirm.discard)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * "Importar un export" (openspec add-workspace-export): SIEMPRE crea un espacio de trabajo NUEVO; jamás escribe en un
 * espacio existente. Sube el archivo (multipart), muestra el progreso y, si termina, ofrece abrir el espacio nuevo.
 */
export function ImportPanel() {
  const t = useTranslations('Portability');
  const locale = useLocale();
  const { state, reload, selectWorkspace } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const active = ready?.active;
  const api = ready?.api;
  const csrf = ready?.csrfToken;
  const [job, setJob] = useState<WorkspaceImportView | null>(null);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const announced = useRef<string | null>(null);

  const running = importInProgress(job);
  useEffect(() => {
    if (!running || !api || !job) return;
    const timer = setTimeout(async () => {
      try {
        const r = await api.get<WorkspaceImportView>(`/workspace-imports/${job.id}`);
        if (r.data) setJob(r.data);
      } catch (err) {
        setProblem(problemOf(err));
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [running, job, api]);

  useEffect(() => {
    if (job?.status === 'SUCCEEDED' && announced.current !== job.id) {
      announced.current = job.id;
      void reload();
    }
  }, [job, reload]);

  if (!ready || !active || active.role !== 'OWNER') return null;

  async function upload() {
    const file = input.current?.files?.[0];
    setProblem(undefined);
    setFileError(undefined);
    if (!file) {
      setFileError(t('import.fileCheck.none'));
      return;
    }
    const check = checkImportFile(file);
    if (check !== 'ok') {
      setFileError(t(`import.fileCheck.${check}`));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${BFF_API}/workspace-imports`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf ?? '', 'idempotency-key': uuidv7() },
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as WorkspaceImportView & ApiProblemBody;
      if (!res.ok) setProblem(body);
      else {
        setJob(body);
        if (input.current) input.current.value = '';
      }
    } catch {
      setProblem({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      setBusy(false);
    }
  }

  const rows = job ? Object.values(job.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <section
      aria-labelledby="import-title"
      data-testid="import-panel"
      style={{ ...cardStyle, display: 'grid', gap: '0.5rem' }}
    >
      <h2 id="import-title">{t('import.title')}</h2>
      <p style={{ margin: 0 }}>{t('import.description')}</p>
      <p style={{ ...mutedStyle, margin: 0 }}>{t('import.security')}</p>
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <label htmlFor="import-file">{t('import.file')}</label>
        <input
          id="import-file"
          ref={input}
          type="file"
          accept=".zip,application/zip"
          data-testid="import-file"
          disabled={busy || running}
          aria-invalid={fileError ? true : undefined}
          aria-describedby={fileError ? 'import-file-error' : undefined}
        />
        {fileError ? (
          <p id="import-file-error" role="alert" data-testid="import-file-error" style={{ margin: 0 }}>
            {fileError}
          </p>
        ) : null}
      </div>
      <div>
        <button
          type="button"
          data-testid="import-submit"
          disabled={busy || running}
          onClick={() => void upload()}
        >
          {t('import.submit')}
        </button>
      </div>

      {needsReauth(problem) ? <ReauthNotice locale={locale} /> : null}
      {problem && !needsReauth(problem) ? <ProblemMessage problem={problem} locale={locale} /> : null}

      {job && running ? (
        <div role="status" data-testid="import-status" data-status={job.status}>
          <p style={{ margin: 0 }}>{t(`import.status.${job.status}`)}</p>
          <progress
            max={IMPORT_STEPS.length}
            value={importStep(job.status)}
            aria-label={t('import.progress')}
          />
        </div>
      ) : null}
      {job?.status === 'SUCCEEDED' && job.workspaceId ? (
        <div
          role="status"
          data-testid="import-status"
          data-status="SUCCEEDED"
          style={{ display: 'grid', gap: '0.5rem' }}
        >
          <p style={{ margin: 0 }}>{t('import.succeeded', { rows })}</p>
          <div>
            <button
              type="button"
              data-testid="import-open"
              onClick={() => void selectWorkspace(job.workspaceId as string)}
            >
              {t('import.open')}
            </button>
          </div>
        </div>
      ) : null}
      {job?.status === 'FAILED' ? (
        <div role="alert" data-testid="import-status" data-status="FAILED">
          <ProblemMessage problem={{ code: job.errorCode ?? 'INTERNAL_ERROR' }} locale={locale} />
          <p style={{ ...mutedStyle, margin: 0 }}>{t('import.failedNothing')}</p>
        </div>
      ) : null}
    </section>
  );
}
