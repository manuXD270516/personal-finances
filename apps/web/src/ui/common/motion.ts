import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';

/**
 * Transición en el mismo documento (change refine-perceived-performance, M-28; D500: View Transitions es Newly 2025-10-14,
 * solo como mejora progresiva y sin polyfill). `withViewTransition(update)` envuelve una actualización de estado en
 * `document.startViewTransition()` cuando el navegador la admite y el usuario NO pidió movimiento reducido; en cualquier
 * otro caso (sin soporte, movimiento reducido, sin `matchMedia`, vista excluida) ejecuta `update` tal cual y al instante.
 *
 * - Sin `view-transition-name` por elemento: el fundido por defecto de `::view-transition-group(*)` (200 ms, en
 *   `app/globals.css` dentro de `prefers-reduced-motion: no-preference`) evita nombres duplicados y el costo de
 *   capturar muchos elementos.
 * - `flushSync` dentro del callback: React debe haber pintado el DOM nuevo cuando el navegador captura el estado final.
 *   Se llama solo desde manejadores de eventos (nunca durante un render).
 * - El foco NO se mueve: ya está en la pestaña o el filtro que el usuario usó (la guía Modern Web Guidance pide
 *   reubicarlo cuando aparece contenido nuevo; aquí no aparece contenido ajeno al control usado).
 */

/** Superficie mínima de `document` que usa el ayudante (inyectable en tests). */
export interface TransitionDocument {
  startViewTransition?: (update: () => void) => {
    readonly finished: Promise<unknown>;
    readonly ready?: Promise<unknown>;
    readonly updateCallbackDone?: Promise<unknown>;
  };
}

export interface ViewTransitionEnv {
  readonly doc?: TransitionDocument;
  readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
  readonly flush?: (update: () => void) => void;
  /** Identificador de la vista, para la lista de vistas excluidas. */
  readonly view?: string;
  readonly excluded?: ReadonlySet<string>;
}

/**
 * Vistas que NO usan transición porque la mediana de tres mediciones locales de INP con las transiciones activas
 * superó los 200 ms de NFR-PERF-004 (tarea 7.7 del change; docs/78 M-30). Lista explícita, se decide con la medición.
 */
export const VIEW_TRANSITION_EXCLUDED: ReadonlySet<string> = new Set<string>([]);

export function withViewTransition(update: () => void, env: ViewTransitionEnv = {}): void {
  const doc = env.doc ?? (typeof document === 'undefined' ? undefined : (document as TransitionDocument));
  const media =
    'matchMedia' in env
      ? env.matchMedia
      : typeof window === 'undefined'
        ? undefined
        : window.matchMedia?.bind(window);
  const flush = env.flush ?? ((fn: () => void) => flushSync(fn));
  const excluded = env.excluded ?? VIEW_TRANSITION_EXCLUDED;

  const allowed =
    typeof doc?.startViewTransition === 'function' &&
    typeof media === 'function' &&
    media('(prefers-reduced-motion: no-preference)').matches &&
    !(env.view !== undefined && excluded.has(env.view));
  if (!allowed || !doc?.startViewTransition) {
    update();
    return;
  }
  const transition = doc.startViewTransition(() => flush(update));
  // Una transición saltada o interrumpida no es un error de la aplicación: el contenido ya cambió.
  for (const p of [transition.finished, transition.ready, transition.updateCallbackDone])
    p?.catch(() => undefined);
}

/**
 * Cambio de contenido por una consulta (filtro de una lista, periodo, reporte): la primera carga de la pantalla NO se
 * anima (no hay contenido anterior que continuar); las siguientes sí, con `withViewTransition` y la vista indicada.
 * Devuelve una función estable; se llama desde el callback de la respuesta, nunca durante un render.
 */
export function useSwapTransition(view: string): (update: () => void) => void {
  const seen = useRef(false);
  return useCallback(
    (update: () => void) => {
      if (!seen.current) {
        seen.current = true;
        update();
        return;
      }
      withViewTransition(update, { view });
    },
    [view],
  );
}
