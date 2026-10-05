'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../bff/finance-api-client';
import { ProblemMessage } from '../errors/ProblemMessage';
import { cardStyle, ConfirmPanel } from './common/ui';
import { useSession } from './session-context';

/** `DemoDataStatus` del contrato (add-demo-data). */
export interface DemoDataStatus {
  readonly demoWorkspaceId: string;
  readonly originWorkspaceId: string;
  readonly status: 'LOADING' | 'READY' | 'FAILED' | 'CLEANING' | 'PURGED';
  readonly datasetVersion: string;
  readonly anchorDate: string;
  readonly progress: { readonly completedModules: readonly string[]; readonly totalModules: number } | null;
  readonly errorCode: string | null;
}

const POLL_MS = 2000;
const problemOf = (err: unknown): ApiProblemBody =>
  err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' };

/**
 * "Datos de demostración" en la configuración del workspace (solo OWNER; openspec add-demo-data 6.1, ADR-0026):
 * cargar crea un workspace de demostración DEDICADO (nunca escribe en el actual) y limpiar lo archiva al instante y lo
 * purga. La acción de carga se oculta si el entorno la deshabilita (`features.demoData`); limpiar siempre está.
 */
export function DemoDataPanel() {
  const t = useTranslations('Demo');
  const locale = useLocale();
  const { state, reload, selectWorkspace } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const active = ready?.active;
  const api = ready?.api;
  const [status, setStatus] = useState<DemoDataStatus | null | undefined>(undefined);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [confirm, setConfirm] = useState<'load' | 'cleanup' | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!api || !active) return;
    try {
      const r = await api.get<DemoDataStatus>(`/workspaces/${active.workspaceId}/demo-data`);
      setStatus(r.data ?? null);
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setStatus(null);
      else setProblem(problemOf(err));
    }
  }, [api, active]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progreso de la carga / limpieza en curso.
  useEffect(() => {
    if (status?.status !== 'LOADING' && status?.status !== 'CLEANING') return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [status, refresh]);

  // Al terminar la carga, el selector de workspaces debe mostrar el demo.
  const [announced, setAnnounced] = useState<string | null>(null);
  useEffect(() => {
    if (status?.status === 'READY' && announced !== status.demoWorkspaceId) {
      setAnnounced(status.demoWorkspaceId);
      void reload();
    }
  }, [status, announced, reload]);

  if (!ready || !active || active.role !== 'OWNER') return null;
  const enabled = ready.me.features?.demoData !== false;
  const isDemo = Boolean(active.isDemo);
  const current = status && status.status !== 'PURGED' ? status : null;

  async function load() {
    if (!api || !active) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await api.command<DemoDataStatus>(
        'POST',
        `/workspaces/${active.workspaceId}/demo-data`,
        undefined,
      );
      setStatus(r.data ?? null);
      setConfirm(null);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function cleanup() {
    if (!api || !current) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.command<DemoDataStatus>(
        'POST',
        `/workspaces/${current.demoWorkspaceId}/demo-data/cleanup`,
        undefined,
      );
      setConfirm(null);
      if (isDemo) {
        // El demo deja de existir: volver al workspace de origen.
        await selectWorkspace(current.originWorkspaceId);
      } else {
        await reload();
        await refresh();
      }
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const done = current?.progress?.completedModules.length ?? 0;
  const total = current?.progress?.totalModules ?? 0;
  return (
    <section
      aria-labelledby="demo-data-title"
      data-testid="demo-data-panel"
      style={{ ...cardStyle, display: 'grid', gap: '0.5rem' }}
    >
      <h2 id="demo-data-title">{t('title')}</h2>
      <p style={{ margin: 0 }}>{isDemo ? t('inDemo') : t('description')}</p>
      {current?.status === 'LOADING' ? (
        <div role="status" data-testid="demo-data-status">
          <p style={{ margin: 0 }}>{t('loading')}</p>
          <progress max={total || 1} value={done} aria-label={t('progress', { done, total })} />
        </div>
      ) : null}
      {current?.status === 'READY' ? (
        <p role="status" data-testid="demo-data-status" style={{ margin: 0 }}>
          {t('ready', { date: current.anchorDate })}
        </p>
      ) : null}
      {current?.status === 'FAILED' ? (
        <p role="alert" data-testid="demo-data-status" style={{ margin: 0 }}>
          {t('failed')}
        </p>
      ) : null}
      {current?.status === 'CLEANING' ? (
        <p role="status" data-testid="demo-data-status" style={{ margin: 0 }}>
          {t('cleaning')}
        </p>
      ) : null}

      {status !== undefined && !current && !isDemo && enabled && confirm !== 'load' ? (
        <div>
          <button type="button" data-testid="demo-load" onClick={() => setConfirm('load')}>
            {t('load')}
          </button>
        </div>
      ) : null}
      {status !== undefined && !current && !isDemo && !enabled ? (
        <p style={{ margin: 0 }} data-testid="demo-disabled">
          {t('disabled')}
        </p>
      ) : null}
      {current?.status === 'READY' && !isDemo ? (
        <div>
          <button
            type="button"
            data-testid="demo-open"
            onClick={() => void selectWorkspace(current.demoWorkspaceId)}
          >
            {t('open')}
          </button>
        </div>
      ) : null}
      {(current?.status === 'READY' || current?.status === 'FAILED') && confirm !== 'cleanup' ? (
        <div>
          <button type="button" data-testid="demo-cleanup" onClick={() => setConfirm('cleanup')}>
            {t('cleanup')}
          </button>
        </div>
      ) : null}

      {confirm === 'load' ? (
        <ConfirmPanel
          testId="demo-load-confirm"
          title={t('loadConfirmTitle')}
          description={t('loadConfirmBody')}
          confirmLabel={t('loadConfirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void load()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'cleanup' ? (
        <ConfirmPanel
          testId="demo-cleanup-confirm"
          title={t('cleanupConfirmTitle')}
          description={t('cleanupConfirmBody')}
          confirmLabel={t('cleanupConfirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void cleanup()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={locale} /> : null}
    </section>
  );
}
