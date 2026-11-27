import { describe, expect, it, vi } from 'vitest';
import {
  createInstallStore,
  isStandalone,
  STANDALONE_QUERY,
  type BeforeInstallPromptEvent,
  type InstallWindow,
} from './install';

/**
 * Aviso de instalación (change add-pwa-install, decisión 4): el evento `beforeinstallprompt` llega una sola vez y puede
 * llegar antes de que el botón exista, así que un almacén lo guarda hasta que Mis preferencias lo pida. Sin evento, o
 * con la aplicación ya instalada, no hay nada que ofrecer.
 */
function fakeWindow(standalone = false) {
  const target = new EventTarget();
  const win: InstallWindow = Object.assign(target, {
    matchMedia: (query: string) => ({ matches: standalone && query === STANDALONE_QUERY }),
  });
  return { win, fire: (event: Event) => target.dispatchEvent(event) };
}

function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  }) as BeforeInstallPromptEvent;
  return { event, prompt };
}

describe('isStandalone', () => {
  it('[TC-PLATFORM-PWA-008] detecta la aplicación instalada por display-mode: standalone', () => {
    expect(isStandalone(fakeWindow(true).win.matchMedia)).toBe(true);
    expect(isStandalone(fakeWindow(false).win.matchMedia)).toBe(false);
  });
});

describe('createInstallStore', () => {
  it('[TC-PLATFORM-PWA-007] sin aviso del navegador no hay nada que ofrecer', () => {
    const store = createInstallStore(fakeWindow().win);
    store.start();
    expect(store.getSnapshot()).toBe('none');
  });

  it('[TC-PLATFORM-PWA-006] el aviso llega antes de montar el botón: queda guardado y se ofrece', () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    const { event } = promptEvent();
    fire(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getSnapshot()).toBe('available');
  });

  it('[TC-PLATFORM-PWA-006] avisa a los suscriptores cuando llega el aviso', () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    const seen = vi.fn();
    store.subscribe(seen);
    fire(promptEvent().event);
    expect(seen).toHaveBeenCalled();
  });

  it('[TC-PLATFORM-PWA-006] install abre el diálogo del navegador con el evento guardado', async () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    const { event, prompt } = promptEvent();
    fire(event);
    await expect(store.install()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PWA-009] aceptar la instalación oculta la oferta; el evento es de un solo uso', async () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    const { event, prompt } = promptEvent('accepted');
    fire(event);
    await store.install();
    expect(store.getSnapshot()).toBe('installed');
    await expect(store.install()).resolves.toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PWA-009] appinstalled oculta la oferta sin recargar', () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    fire(promptEvent().event);
    fire(new Event('appinstalled'));
    expect(store.getSnapshot()).toBe('installed');
  });

  it('[TC-PLATFORM-PWA-009] rechazar el diálogo descarta el evento hasta que llegue otro', async () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    fire(promptEvent('dismissed').event);
    await expect(store.install()).resolves.toBe('dismissed');
    expect(store.getSnapshot()).toBe('none');
    fire(promptEvent().event);
    expect(store.getSnapshot()).toBe('available');
  });

  it('[TC-PLATFORM-PWA-008] con la aplicación ya instalada (standalone) no se ofrece nada aunque llegue el aviso', () => {
    const { win, fire } = fakeWindow(true);
    const store = createInstallStore(win);
    store.start();
    fire(promptEvent().event);
    expect(store.getSnapshot()).toBe('installed');
  });

  it('[TC-PLATFORM-PWA-006] un error del diálogo no rompe: devuelve unavailable y no deja el evento colgado', async () => {
    const { win, fire } = fakeWindow();
    const store = createInstallStore(win);
    store.start();
    const { event } = promptEvent();
    (event as unknown as { prompt: () => Promise<void> }).prompt = () => Promise.reject(new Error('x'));
    fire(event);
    await expect(store.install()).resolves.toBe('unavailable');
    expect(store.getSnapshot()).toBe('none');
  });

  it('[TC-PLATFORM-PWA-006] start es idempotente: un solo registro por evento', () => {
    const { win } = fakeWindow();
    const add = vi.spyOn(win, 'addEventListener');
    const store = createInstallStore(win);
    store.start();
    store.start();
    expect(add).toHaveBeenCalledTimes(2); // beforeinstallprompt y appinstalled, una vez cada uno
  });
});
