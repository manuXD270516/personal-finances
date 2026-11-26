import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Utilidades comunes de formularios (change `refine-web-accessibility-foundations`, decisiones 2, 4 y 11; guías `accessible-error-announcement` e
 * `ime-safe-enter-submit` de Modern Web Guidance): foco al primer error tras un envío rechazado y Enter durante la
 * composición de texto. Sin dependencias del DOM en los tipos para poder probarlas sin navegador.
 */

/** Lo mínimo que se necesita de un elemento para decidir si se puede enfocar y para enfocarlo. */
export interface FocusTarget {
  readonly disabled?: boolean;
  readonly hidden?: boolean;
  readonly tabIndex: number;
  focus(options?: { preventScroll?: boolean }): void;
}

/** Contenedor (un `<form>`) donde se buscan el resumen y los campos inválidos. */
export interface ErrorScope {
  querySelector(selector: string): FocusTarget | null;
  querySelectorAll(selector: string): ArrayLike<FocusTarget>;
}

/** Atributo que marca el resumen de errores (`ErrorSummary`). */
export const ERROR_SUMMARY_ATTR = 'data-error-summary';

const isFocusable = (el: FocusTarget): boolean => !el.disabled && !el.hidden && el.tabIndex >= 0;

/**
 * Destino del foco tras un envío rechazado: el resumen de errores si el formulario lo tiene; si no, el primer
 * elemento enfocable con `aria-invalid="true"` en el orden del DOM (que es el orden visual: no se reordena con CSS).
 */
export function firstErrorTarget(scope: ErrorScope): FocusTarget | null {
  const summary = scope.querySelector(`[${ERROR_SUMMARY_ATTR}]`);
  if (summary) return summary;
  const invalid = scope.querySelectorAll('[aria-invalid="true"]');
  for (let i = 0; i < invalid.length; i += 1) {
    const candidate = invalid[i]!;
    if (isFocusable(candidate)) return candidate;
  }
  return null;
}

/** Enfoca el destino de `firstErrorTarget`; devuelve `true` si había alguno. */
export function focusFirstError(scope: ErrorScope): boolean {
  const target = firstErrorTarget(scope);
  if (!target) return false;
  target.focus();
  return true;
}

/**
 * Mueve el foco al primer error cada vez que `attempt` aumenta (el formulario lo incrementa en cada envío rechazado
 * por la validación). El efecto corre tras el render que muestra los errores.
 */
export function useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, attempt: number): void {
  useEffect(() => {
    if (attempt <= 0) return;
    const form = formRef.current;
    if (form) focusFirstError(form as unknown as ErrorScope);
  }, [attempt, formRef]);
}

/**
 * Cubre por omisión todo `<form noValidate>` de la aplicación: tras un `submit`, y una vez que React pintó los
 * errores, enfoca el resumen o el primer campo inválido. Se monta una sola vez en el marco de la aplicación.
 */
export function useFocusFirstErrorOnSubmit(): void {
  useEffect(() => {
    let frame = 0;
    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.noValidate) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        focusFirstError(form as unknown as ErrorScope);
      });
    };
    document.addEventListener('submit', onSubmit);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('submit', onSubmit);
    };
  }, []);
}

/**
 * Enter que confirma una composición de texto (método de entrada o tecla muerta): no debe ejecutar la acción.
 * `isComposing` es Limited y en Safari llega en falso, por eso también se mira `keyCode === 229`.
 */
export function isImeEnter(e: { nativeEvent: { isComposing: boolean }; keyCode: number }): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/**
 * Matriz de tiempos de la validación al salir del campo (decisión 4 del change; guía `validate-input-after-interaction`): el error se
 * calcula en `blur` solo si el campo fue modificado; en `input` solo se recalcula si ya había un error, de modo que
 * se limpia en cuanto el valor es válido y nunca aparece uno nuevo mientras se escribe. Un obligatorio vacío y no
 * modificado no muestra error al salir: aparece al enviar.
 */
export function nextFieldError(
  event: 'blur' | 'input',
  state: { dirty: boolean; current: string | undefined; computed: string | undefined },
): string | undefined {
  if (event === 'blur') return state.dirty ? state.computed : state.current;
  return state.current === undefined ? undefined : state.computed;
}

/** Campos que el usuario modificó (`dirty`), sin provocar renders. */
export function useDirtyFields(): { isDirty: (name: string) => boolean; markDirty: (name: string) => void } {
  const dirty = useRef(new Set<string>());
  const isDirty = useCallback((name: string) => dirty.current.has(name), []);
  const markDirty = useCallback((name: string) => {
    dirty.current.add(name);
  }, []);
  return { isDirty, markDirty };
}

/** Copia del mapa de errores con el mensaje de `name` puesto o quitado (`undefined`). */
export function withFieldError(
  errors: Readonly<Record<string, string>>,
  name: string,
  message: string | undefined,
): Record<string, string> {
  const next = { ...errors };
  if (message === undefined) delete next[name];
  else next[name] = message;
  return next;
}
