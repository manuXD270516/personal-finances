import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisiblePoller, type PollDocument } from './polling';

/** Consultas periódicas en pausa con la pestaña oculta (change refine-perceived-performance, decisión 3). */
function fakeDoc(hidden: boolean) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  return {
    doc: doc as PollDocument,
    setHidden(value: boolean) {
      doc.hidden = value;
      for (const l of [...listeners]) l();
    },
    listenerCount: () => listeners.size,
  };
}

describe('createVisiblePoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('[TC-PLATFORM-PERCEIVED-006] con la página oculta no consulta durante 30 s', async () => {
    const d = fakeDoc(false);
    const run = vi.fn(async () => undefined);
    const poller = createVisiblePoller({ intervalMs: 2000, run, doc: d.doc });
    poller.start();
    d.setHidden(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).not.toHaveBeenCalled();
    poller.stop();
  });

  it('[TC-PLATFORM-PERCEIVED-006] visible consulta en cada intervalo', async () => {
    const d = fakeDoc(false);
    const run = vi.fn(async () => undefined);
    const poller = createVisiblePoller({ intervalMs: 2000, run, doc: d.doc });
    poller.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('[TC-PLATFORM-PERCEIVED-007] al volver a ser visible consulta enseguida', async () => {
    const d = fakeDoc(true);
    const run = vi.fn(async () => undefined);
    const poller = createVisiblePoller({ intervalMs: 2000, run, doc: d.doc });
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
    d.setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('[TC-PLATFORM-PERCEIVED-008] una página que nace oculta no empieza a consultar hasta hacerse visible', async () => {
    const d = fakeDoc(true);
    const run = vi.fn(async () => undefined);
    const poller = createVisiblePoller({ intervalMs: 2500, run, doc: d.doc });
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
    d.setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('[TC-PLATFORM-PERCEIVED-006] no solapa consultas: espera a que termine la que está en vuelo', async () => {
    const d = fakeDoc(false);
    let release: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const poller = createVisiblePoller({ intervalMs: 1000, run, doc: d.doc });
    poller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('[TC-PLATFORM-PERCEIVED-006] run que devuelve false detiene el sondeo y stop() quita el oyente', async () => {
    const d = fakeDoc(false);
    const run = vi.fn(async () => false as const);
    const poller = createVisiblePoller({ intervalMs: 1000, run, doc: d.doc });
    poller.start();
    expect(d.listenerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    poller.stop();
    expect(d.listenerCount()).toBe(0);
  });

  it('[TC-PLATFORM-PERCEIVED-006] un fallo de run no rompe el sondeo', async () => {
    const d = fakeDoc(false);
    const run = vi.fn(async () => {
      throw new Error('red');
    });
    const poller = createVisiblePoller({ intervalMs: 1000, run, doc: d.doc });
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    poller.stop();
  });
});
