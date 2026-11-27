import { describe, expect, it, vi } from 'vitest';
import { VIEW_TRANSITION_EXCLUDED, withViewTransition, type TransitionDocument } from './motion';

/**
 * Transición en el mismo documento (change refine-perceived-performance, decisión 1 y 2): con soporte y sin
 * movimiento reducido envuelve la actualización; en cualquier otro caso la ejecuta tal cual.
 */
function fakeDoc(opts: { supported: boolean }): {
  doc: TransitionDocument;
  started: ReturnType<typeof vi.fn>;
} {
  const started = vi.fn();
  const doc: TransitionDocument = opts.supported
    ? {
        startViewTransition: (cb: () => void) => {
          started();
          cb();
          return { finished: Promise.resolve() };
        },
      }
    : {};
  return { doc, started };
}
const media = (noPreference: boolean) => (query: string) => ({
  matches: query.includes('no-preference') ? noPreference : !noPreference,
});

describe('withViewTransition', () => {
  it('[TC-PLATFORM-PERCEIVED-001] con soporte y movimiento permitido envuelve la actualización en una transición', () => {
    const { doc, started } = fakeDoc({ supported: true });
    const update = vi.fn();
    withViewTransition(update, { doc, matchMedia: media(true), flush: (fn) => fn() });
    expect(started).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PERCEIVED-001] la actualización corre dentro del callback con el vaciado síncrono de React', () => {
    const { doc } = fakeDoc({ supported: true });
    const order: string[] = [];
    withViewTransition(() => order.push('update'), {
      doc,
      matchMedia: media(true),
      flush: (fn) => {
        order.push('flush');
        fn();
      },
    });
    expect(order).toEqual(['flush', 'update']);
  });

  it('[TC-PLATFORM-PERCEIVED-002] con movimiento reducido cambia al instante, sin transición', () => {
    const { doc, started } = fakeDoc({ supported: true });
    const update = vi.fn();
    withViewTransition(update, { doc, matchMedia: media(false), flush: (fn) => fn() });
    expect(started).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PERCEIVED-003] sin soporte ejecuta la actualización tal cual', () => {
    const { doc } = fakeDoc({ supported: false });
    const update = vi.fn();
    withViewTransition(update, { doc, matchMedia: media(true), flush: (fn) => fn() });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PERCEIVED-003] sin matchMedia no usa la transición (no se puede comprobar la preferencia)', () => {
    const { doc, started } = fakeDoc({ supported: true });
    const update = vi.fn();
    withViewTransition(update, { doc, matchMedia: undefined, flush: (fn) => fn() });
    expect(started).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PERCEIVED-004] una vista excluida por la medición de respuesta funciona sin transición', () => {
    const { doc, started } = fakeDoc({ supported: true });
    const update = vi.fn();
    withViewTransition(update, {
      doc,
      matchMedia: media(true),
      flush: (fn) => fn(),
      view: 'vista-lenta',
      excluded: new Set(['vista-lenta']),
    });
    expect(started).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('[TC-PLATFORM-PERCEIVED-004] la lista de vistas excluidas es explícita y está documentada', () => {
    expect(VIEW_TRANSITION_EXCLUDED).toBeInstanceOf(Set);
  });
});
