import { describe, expect, it } from 'vitest';
import { firstErrorTarget, isImeEnter, nextFieldError, type ErrorScope, type FocusTarget } from './forms';

const el = (name: string, over: Partial<FocusTarget> = {}): FocusTarget & { name: string } => ({
  name,
  disabled: false,
  hidden: false,
  tabIndex: 0,
  focus() {},
  ...over,
});

const scope = (summary: FocusTarget | null, invalid: FocusTarget[]): ErrorScope => ({
  querySelector: (selector) => (selector === '[data-error-summary]' ? summary : null),
  querySelectorAll: (selector) => (selector === '[aria-invalid="true"]' ? invalid : []),
});

describe('foco al primer error', () => {
  it('[TC-PLATFORM-WEBUI-001] elige el primer campo inválido enfocable en el orden del DOM', () => {
    const monto = el('amount');
    const cuenta = el('accountId');
    expect(firstErrorTarget(scope(null, [cuenta, monto]))).toBe(cuenta);
  });

  it('[TC-PLATFORM-WEBUI-001] omite los elementos deshabilitados, ocultos o no enfocables', () => {
    const grupo = el('radiogroup', { tabIndex: -1 });
    const deshabilitado = el('x', { disabled: true });
    const oculto = el('y', { hidden: true });
    const valido = el('amount');
    expect(firstErrorTarget(scope(null, [grupo, deshabilitado, oculto, valido]))).toBe(valido);
  });

  it('[TC-PLATFORM-WEBUI-001] sin campos inválidos no hay destino', () => {
    expect(firstErrorTarget(scope(null, []))).toBeNull();
  });

  it('[TC-PLATFORM-WEBUI-003] con resumen de errores enfoca el resumen y no el primer campo', () => {
    const resumen = el('summary', { tabIndex: -1 });
    expect(firstErrorTarget(scope(resumen, [el('amount')]))).toBe(resumen);
  });
});

describe('Enter con composición de texto', () => {
  it('[TC-PLATFORM-WEBUI-018] ignora Enter con isComposing', () => {
    expect(isImeEnter({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true);
  });

  it('[TC-PLATFORM-WEBUI-018] ignora Enter con keyCode 229 aunque isComposing llegue en falso (Safari)', () => {
    expect(isImeEnter({ nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true);
  });

  it('[TC-PLATFORM-WEBUI-018] deja pasar un Enter sin composición', () => {
    expect(isImeEnter({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  });
});

describe('validación al salir del campo', () => {
  const MSG = 'USDT admite hasta 6 decimales';

  it('[TC-PLATFORM-WEBUI-005] al salir de un campo modificado e inválido muestra el error', () => {
    expect(nextFieldError('blur', { dirty: true, current: undefined, computed: MSG })).toBe(MSG);
  });

  it('[TC-PLATFORM-WEBUI-006] mientras escribe, un error visible se limpia en cuanto el valor es válido', () => {
    expect(nextFieldError('input', { dirty: true, current: MSG, computed: undefined })).toBeUndefined();
  });

  it('[TC-PLATFORM-WEBUI-006] mientras escribe, un error visible se actualiza si sigue inválido', () => {
    expect(nextFieldError('input', { dirty: true, current: MSG, computed: 'Obligatorio' })).toBe(
      'Obligatorio',
    );
  });

  it('[TC-PLATFORM-WEBUI-005] nunca aparece un error nuevo mientras se escribe', () => {
    expect(nextFieldError('input', { dirty: true, current: undefined, computed: MSG })).toBeUndefined();
  });

  it('[TC-PLATFORM-WEBUI-007] un obligatorio vacío y sin modificar no muestra error al salir', () => {
    expect(
      nextFieldError('blur', { dirty: false, current: undefined, computed: 'Obligatorio' }),
    ).toBeUndefined();
  });

  it('[TC-PLATFORM-WEBUI-007] al salir sin modificar se conserva el error que ya hubiera (p. ej. de un envío)', () => {
    expect(nextFieldError('blur', { dirty: false, current: 'Obligatorio', computed: 'Obligatorio' })).toBe(
      'Obligatorio',
    );
  });
});
