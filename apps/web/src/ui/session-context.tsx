'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FinanceApiError,
  createFinanceApiClient,
  type ApiProblemBody,
  type FinanceApiClient,
} from '../bff/finance-api-client';

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface Membership {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: Role;
  /** Workspace de demostración dedicado (add-demo-data). */
  readonly isDemo?: boolean;
}

export interface Me {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
  readonly memberships: readonly Membership[];
  /** Funciones habilitadas por entorno (p. ej. carga de datos de demostración). */
  readonly features?: { readonly demoData?: boolean };
  readonly version: number;
}

interface SessionInfo {
  readonly csrfToken: string;
  readonly activeWorkspaceId: string | null;
}

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'expired' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | {
      readonly status: 'ready';
      readonly csrfToken: string;
      readonly me: Me;
      /** Cliente hacia `/api/bff/v1` con el token CSRF de la sesión (nunca un token OAuth). */
      readonly api: FinanceApiClient;
      readonly active: Membership | undefined;
    };

interface SessionContextValue {
  readonly state: SessionState;
  readonly reload: () => Promise<void>;
  readonly selectWorkspace: (workspaceId: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | undefined>(undefined);

/** Prefijo del proxy autenticado del BFF (`/api/bff/v1/*` → finance-api `/api/v1/*`). */
export const BFF_API = '/api/bff/v1';

async function readSession(): Promise<SessionInfo | null> {
  const res = await fetch('/api/bff/session', { cache: 'no-store', credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new FinanceApiError(res.status, (await res.json().catch(() => ({}))) as ApiProblemBody);
  return (await res.json()) as SessionInfo;
}

/**
 * Estado de sesión del navegador: token CSRF (de `/api/bff/session`) y perfil (`/api/bff/v1/me`). El navegador
 * solo conoce la cookie opaca HttpOnly; nunca ve access, refresh ni id tokens.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const info = await readSession();
      if (!info) {
        setState({ status: 'expired' });
        return;
      }
      const api = createFinanceApiClient({
        baseUrl: BFF_API,
        headers: () => ({ 'x-csrf-token': info.csrfToken }),
      });
      const me = (await api.get<Me>('/me')).data!;
      const active =
        me.memberships.find((m) => m.workspaceId === info.activeWorkspaceId) ?? me.memberships[0];
      setState({ status: 'ready', csrfToken: info.csrfToken, me, api, active });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 401) setState({ status: 'expired' });
      else setState({ status: 'error', problem: err instanceof FinanceApiError ? err.problem : {} });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      reload: load,
      async selectWorkspace(workspaceId) {
        if (state.status !== 'ready') return;
        const res = await fetch('/api/bff/session', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrfToken },
          body: JSON.stringify({ activeWorkspaceId: workspaceId }),
        });
        if (res.status === 401) setState({ status: 'expired' });
        else await load();
      },
      async logout() {
        const csrf = state.status === 'ready' ? state.csrfToken : '';
        const res = await fetch('/api/bff/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: '{}',
        });
        const body = (await res.json().catch(() => ({}))) as { redirectTo?: string };
        window.location.assign(body.redirectTo ?? '/');
      },
    }),
    [state, load],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuera de SessionProvider');
  return ctx;
}

/** Ruta con prefijo de locale (`localePrefix: as-needed`: español sin prefijo). */
export const localized = (locale: string, path: string): string =>
  locale === 'es' ? path : `/${locale}${path === '/' ? '' : path}`;
