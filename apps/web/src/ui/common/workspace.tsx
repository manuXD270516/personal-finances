'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody, type FinanceApiClient } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import type { FormatContext } from '../dashboard/types';
import { localized, useSession, type Me, type Role } from '../session-context';
import { DEFAULT_FORMAT_LOCALE, DEFAULT_TIME_ZONE } from './dates';
import { KNOWN_SCALES } from './money';
import type { CurrencyInfo, Page } from './types';

export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly role: Role;
}

export interface WorkspaceContext {
  readonly api: FinanceApiClient;
  readonly me: Me;
  readonly ws: WorkspaceInfo;
  /** Ruta del workspace activo para la API: `/workspaces/{id}`. */
  readonly base: string;
  readonly currencies: readonly CurrencyInfo[];
  readonly scales: Readonly<Record<string, number>>;
  /** Locale de formato (`es-BO`) y zona (`America/La_Paz`) del workspace. */
  readonly formatLocale: string;
  readonly timeZone: string;
  /** Locale de la UI (`es`, `en`, `pt`) para rutas y mensajes de error. */
  readonly uiLocale: string;
  readonly canEdit: boolean;
  readonly href: (path: string) => string;
}

export const problemOf = (err: unknown): ApiProblemBody =>
  err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' };

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly ws: WorkspaceInfo; readonly currencies: readonly CurrencyInfo[] };

/**
 * Datos del workspace activo que necesitan las pantallas financieras: rol (la API decide la autorización; la UI
 * solo oculta acciones), moneda base, locale de formato, zona horaria y catálogo de monedas con su escala.
 */
export function useWorkspace():
  WorkspaceContext | { readonly status: 'loading' | 'none' | 'error'; problem?: ApiProblemBody } {
  const { state } = useSession();
  const uiLocale = useLocale();
  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;
  const [loaded, setLoaded] = useState<State & { workspaceId?: string }>({ status: 'loading' });

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    Promise.all([
      api.get<WorkspaceInfo>(`/workspaces/${workspaceId}`),
      api
        .get<{ data: CurrencyInfo[] }>(`/workspaces/${workspaceId}/currencies`)
        .then((r) => r.data?.data ?? [])
        .catch(() => [] as CurrencyInfo[]),
    ])
      .then(([ws, currencies]) => {
        if (!cancelled) setLoaded({ status: 'ready', ws: ws.data!, currencies, workspaceId });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ status: 'error', problem: problemOf(err), workspaceId });
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  return useMemo(() => {
    if (!ready) return { status: 'loading' as const };
    if (!workspaceId) return { status: 'none' as const };
    if (loaded.status === 'error') return { status: 'error' as const, problem: loaded.problem };
    if (loaded.status !== 'ready' || loaded.workspaceId !== workspaceId)
      return { status: 'loading' as const };
    const scales: Record<string, number> = { ...KNOWN_SCALES };
    for (const c of loaded.currencies) scales[c.code] = c.scale;
    const ws = { ...loaded.ws, role: ready.active?.role ?? loaded.ws.role };
    return {
      api: ready.api,
      me: ready.me,
      ws,
      base: `/workspaces/${workspaceId}`,
      currencies: loaded.currencies,
      scales,
      formatLocale: ws.locale || DEFAULT_FORMAT_LOCALE,
      timeZone: ws.timezone || DEFAULT_TIME_ZONE,
      uiLocale,
      canEdit: ws.role === 'OWNER' || ws.role === 'EDITOR',
      href: (path: string) => localized(uiLocale, path),
    } satisfies WorkspaceContext;
  }, [ready, workspaceId, loaded, uiLocale]);
}

export const isReady = (w: ReturnType<typeof useWorkspace>): w is WorkspaceContext => 'api' in w;

/** Contenedor estándar: espera el workspace y muestra error/carga con los textos comunes. */
export function WithWorkspace({ children }: { children: (ctx: WorkspaceContext) => ReactNode }) {
  const t = useTranslations('Common');
  const uiLocale = useLocale();
  const w = useWorkspace();
  if (isReady(w)) return <>{children(w)}</>;
  if (w.status === 'none') return <p data-testid="no-workspace">{t('noWorkspace')}</p>;
  if (w.status === 'error' && w.problem) return <ProblemMessage problem={w.problem} locale={uiLocale} />;
  return (
    <p data-testid="page-loading" aria-busy="true">
      {t('loading')}
    </p>
  );
}

/** Contexto de formato de un namespace de mensajes (componentes presentacionales testeables). */
export function useFormat(namespace: string, ctx: WorkspaceContext): FormatContext {
  const t = useTranslations(namespace);
  return useMemo(
    () => ({
      locale: ctx.formatLocale,
      timeZone: ctx.timeZone,
      t: (key: string, values?: Record<string, string | number>) => t(key as never, values as never),
      has: (key: string) => t.has(key as never),
    }),
    [t, ctx.formatLocale, ctx.timeZone],
  );
}

/** Todas las páginas de un listado (hasta `maxPages`), para catálogos pequeños (categorías, tags, cuentas). */
export async function listAll<T>(
  api: FinanceApiClient,
  path: string,
  params: URLSearchParams = new URLSearchParams(),
  maxPages = 10,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const q = new URLSearchParams(params);
    q.set('limit', '200');
    if (cursor) q.set('cursor', cursor);
    const r = await api.get<Page<T>>(`${path}?${q.toString()}`);
    out.push(...(r.data?.data ?? []));
    if (!r.data?.page.hasMore || !r.data.page.nextCursor) break;
    cursor = r.data.page.nextCursor;
  }
  return out;
}
