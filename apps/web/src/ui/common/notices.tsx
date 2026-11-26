'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  announcementOf,
  noticesReducer,
  type Notice,
  type NoticeInput,
  type NoticesAction,
} from './notices-state';

/**
 * Región de avisos de la sesión (change `add-quick-capture`, decisión 4; guía `persistent-toast-notifications` de Modern
 * Web Guidance). `NoticesProvider` guarda los avisos en memoria (nada en `sessionStorage` ni `localStorage`: una
 * navegación o una recarga empiezan sin avisos); `NoticeRegion` los dibuja en una región con nombre, sin mover el foco
 * y sin temporizador. El anuncio usa `document.ariaNotify` si existe y, si no, un `role="status"` propio de la región.
 */

export interface NoticesApi {
  /** Publica un aviso y lo anuncia una vez; devuelve su id. */
  push(input: NoticeInput): string;
  /** Cambia un aviso (por ejemplo, de «registrado» a «anulado»); si cambia el texto, lo anuncia de nuevo. */
  update(id: string, patch: Partial<Omit<Notice, 'id'>>): void;
  dismiss(id: string): void;
}

interface NoticesState {
  readonly notices: readonly Notice[];
  readonly statusRef: RefObject<HTMLDivElement | null>;
  readonly dismissWithFocus: (id: string) => void;
}

const NOOP_API: NoticesApi = { push: () => '', update: () => undefined, dismiss: () => undefined };
const ApiContext = createContext<NoticesApi>(NOOP_API);
const StateContext = createContext<NoticesState | null>(null);

/** API de avisos; fuera del `NoticesProvider` (tests de componentes aislados) no hace nada. */
export const useNotices = (): NoticesApi => useContext(ApiContext);

/** `true` si el navegador implementa `document.ariaNotify` (detección por característica). */
const hasAriaNotify = (): boolean =>
  typeof document !== 'undefined' && 'ariaNotify' in document && typeof document.ariaNotify === 'function';

/** Anuncia `text` sin mover el foco: `ariaNotify` si el navegador lo tiene; si no, el `role="status"` de la región. */
function announce(text: string, statusEl: HTMLDivElement | null): void {
  if (typeof document === 'undefined') return;
  if (hasAriaNotify()) {
    try {
      document.ariaNotify?.(text);
      return;
    } catch {
      // Cae al respaldo.
    }
  }
  if (!statusEl) return;
  // Se vacía antes de anunciar para que un texto repetido también se lea.
  statusEl.textContent = '';
  void Promise.resolve().then(() => {
    statusEl.textContent = text;
  });
}

export function NoticesProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('App');
  const [notices, dispatch] = useReducer(noticesReducer, [] as readonly Notice[]);
  const noticesRef = useRef<readonly Notice[]>(notices);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const lastOutside = useRef<HTMLElement | null>(null);
  const counter = useRef(0);
  const actionsAvailable = t('notices.actionsAvailable');

  useEffect(() => {
    noticesRef.current = notices;
  }, [notices]);

  // Último elemento enfocado fuera de la región: a él vuelve el foco al cerrar el último aviso.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-testid="notice-region"]')) return;
      lastOutside.current = target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const send = useCallback((action: NoticesAction) => dispatch(action), []);

  const api = useMemo<NoticesApi>(
    () => ({
      push(input) {
        counter.current += 1;
        const id = `notice-${counter.current}`;
        const notice: Notice = {
          id,
          text: input.text,
          tone: input.tone ?? 'success',
          actions: input.actions ?? [],
        };
        send({ type: 'push', notice });
        announce(announcementOf(notice.text, notice.actions.length > 0, actionsAvailable), statusRef.current);
        return id;
      },
      update(id, patch) {
        send({ type: 'update', id, patch });
        if (patch.text === undefined) return;
        const current = noticesRef.current.find((n) => n.id === id);
        const actions = patch.actions ?? current?.actions ?? [];
        announce(announcementOf(patch.text, actions.length > 0, actionsAvailable), statusRef.current);
      },
      dismiss(id) {
        send({ type: 'dismiss', id });
      },
    }),
    [send, actionsAvailable],
  );

  // Al cerrar con el teclado o el puntero: el foco pasa al aviso vecino o, si era el último, vuelve a donde estaba.
  const dismissWithFocus = useCallback((id: string) => {
    const region = document.querySelector<HTMLElement>('[data-testid="notice-region"]');
    const list = noticesRef.current;
    const index = list.findIndex((n) => n.id === id);
    const neighbour = list[index + 1] ?? list[index - 1];
    const focusedInside = region?.contains(document.activeElement) ?? false;
    if (focusedInside) {
      const next = neighbour
        ? region?.querySelector<HTMLElement>(
            `[data-notice-id="${neighbour.id}"] button, [data-notice-id="${neighbour.id}"] a`,
          )
        : lastOutside.current && lastOutside.current.isConnected
          ? lastOutside.current
          : null;
      next?.focus();
    }
    dispatch({ type: 'dismiss', id });
  }, []);

  const state = useMemo<NoticesState>(
    () => ({ notices, statusRef, dismissWithFocus }),
    [notices, dismissWithFocus],
  );

  return (
    <ApiContext.Provider value={api}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ApiContext.Provider>
  );
}

/**
 * Región con nombre («Avisos») fija en la esquina inferior. Los avisos van agrupados en un `popover="manual"` (capa
 * superior sin cierre por clic fuera); si el navegador no lo soporta, se muestran igual con la misma posición.
 */
export function NoticeRegion() {
  const t = useTranslations('App');
  const state = useContext(StateContext);
  const listRef = useRef<HTMLDivElement | null>(null);
  const count = state?.notices.length ?? 0;
  // El respaldo `role="status"` solo existe si el navegador no tiene `ariaNotify` (se decide al montar, antes de cualquier aviso).
  const [needsFallback, setNeedsFallback] = useState(false);
  useEffect(() => {
    setNeedsFallback(!hasAriaNotify());
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || count === 0) return;
    if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) {
      try {
        el.showPopover();
      } catch {
        // Sin capa superior: el aviso sigue visible en el flujo normal de la región.
      }
    }
  }, [count]);

  if (!state) return null;
  return (
    <section role="region" aria-label={t('notices.label')} className="pf-notices" data-testid="notice-region">
      {needsFallback ? <div ref={state.statusRef} role="status" className="pf-sr-only" /> : null}
      {count > 0 ? (
        <div ref={listRef} popover="manual" className="pf-notices-list">
          {state.notices.map((notice) => (
            <div
              key={notice.id}
              className="pf-notice"
              data-testid="notice"
              data-notice-id={notice.id}
              data-tone={notice.tone}
            >
              <p className="pf-notice-text">{notice.text}</p>
              <div className="pf-notice-actions">
                {notice.actions.map((action) =>
                  action.href !== undefined ? (
                    <a key={action.key} className="pf-notice-action" href={action.href}>
                      {action.label}
                    </a>
                  ) : (
                    <button
                      key={action.key}
                      type="button"
                      className="pf-notice-action"
                      aria-disabled={action.disabled ? true : undefined}
                      onClick={() => {
                        if (!action.disabled) action.onAction?.();
                      }}
                    >
                      {action.label}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="pf-notice-action"
                  onClick={() => state.dismissWithFocus(notice.id)}
                >
                  {t('notices.close')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
