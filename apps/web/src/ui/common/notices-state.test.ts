import { describe, expect, it } from 'vitest';
import { announcementOf, MAX_NOTICES, noticesReducer, type Notice } from './notices-state';

const n = (id: string, text = id): Notice => ({ id, text, tone: 'success', actions: [] });

describe('región de avisos: estado puro (add-quick-capture)', () => {
  it('[TC-PLATFORM-WEBUI-024] muestra como máximo tres avisos y sale el más antiguo', () => {
    let s: readonly Notice[] = [];
    for (const id of ['10', '20', '30', '40']) s = noticesReducer(s, { type: 'push', notice: n(id) });
    expect(MAX_NOTICES).toBe(3);
    expect(s.map((x) => x.id)).toEqual(['20', '30', '40']);
  });

  it('[TC-PLATFORM-WEBUI-021] cerrar quita solo ese aviso y conserva el orden', () => {
    let s: readonly Notice[] = [n('a'), n('b'), n('c')];
    s = noticesReducer(s, { type: 'dismiss', id: 'b' });
    expect(s.map((x) => x.id)).toEqual(['a', 'c']);
    expect(noticesReducer(s, { type: 'dismiss', id: 'zzz' })).toEqual(s);
  });

  it('[TC-TRANSACTIONS-QUICK-006] actualizar cambia el texto y las acciones sin mover el aviso', () => {
    const s = noticesReducer([n('a'), n('b')], {
      type: 'update',
      id: 'a',
      patch: { text: 'Registro anulado', actions: [] },
    });
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s[0]!.text).toBe('Registro anulado');
  });

  it('[TC-PLATFORM-WEBUI-022] el anuncio lleva el sufijo solo si el aviso tiene acciones', () => {
    expect(announcementOf('Expense of Bs 45.00 recorded', true, 'Actions available')).toBe(
      'Expense of Bs 45.00 recorded. Actions available',
    );
    expect(announcementOf('Registro anulado', false, 'Acciones disponibles')).toBe('Registro anulado');
  });
});
