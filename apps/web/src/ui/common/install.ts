/**
 * Aviso de instalación de la aplicación (change add-pwa-install, decisión 4; D500: mejora progresiva).
 * `beforeinstallprompt` es una API de Chromium (disponibilidad limitada) que llega una sola vez por documento y puede
 * llegar antes de que el botón de Mis preferencias exista: un almacén de módulo lo guarda hasta que se pida. Sin el
 * aviso no hay botón; `<install>` y `navigator.install()` no tienen soporte y no se usan. Módulo sin dependencias.
 */

/** `BeforeInstallPromptEvent` no está en `lib.dom.d.ts`: solo se usan `prompt()` y `userChoice`. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

/** Parte de `window` que usa el almacén (se simula en las pruebas). */
export interface InstallWindow extends EventTarget {
  matchMedia(query: string): { readonly matches: boolean };
}

/**
 * `none`: sin aviso del navegador; `available`: se puede ofrecer; `installed`: ya instalada o recién aceptada
 * (incluye `display-mode: standalone`).
 */
export type InstallState = 'none' | 'available' | 'installed';
export type InstallResult = 'accepted' | 'dismissed' | 'unavailable';

export const STANDALONE_QUERY = '(display-mode: standalone)';

export function isStandalone(matchMedia: InstallWindow['matchMedia']): boolean {
  return matchMedia(STANDALONE_QUERY).matches;
}

export function createInstallStore(win: InstallWindow) {
  let deferred: BeforeInstallPromptEvent | undefined;
  let installed = false;
  let started = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const getSnapshot = (): InstallState => {
    if (installed || isStandalone((q) => win.matchMedia(q))) return 'installed';
    return deferred ? 'available' : 'none';
  };

  return {
    /** Registra las escuchas una sola vez; llamarlo temprano para no perder el evento. */
    start(): void {
      if (started) return;
      started = true;
      win.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault(); // sin mini-barra automática: el diálogo solo se abre desde el botón
        deferred = event as BeforeInstallPromptEvent;
        emit();
      });
      win.addEventListener('appinstalled', () => {
        deferred = undefined;
        installed = true;
        emit();
      });
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    /** Abre el diálogo del navegador. El evento es de un solo uso: se descarta antes de esperar la respuesta. */
    async install(): Promise<InstallResult> {
      const event = deferred;
      if (!event) return 'unavailable';
      deferred = undefined;
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') installed = true;
        return outcome;
      } catch {
        return 'unavailable';
      } finally {
        emit();
      }
    },
  };
}

/** Almacén de la ventana real; `AppFrame` lo arranca al cargar el módulo y Mis preferencias lo consume. */
export const installStore = createInstallStore(
  typeof window === 'undefined'
    ? ({
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
        matchMedia: () => ({ matches: false }),
      } satisfies InstallWindow)
    : window,
);
