/**
 * `Document.ariaNotify()` (Baseline desde 2026-09) todavía no está en `lib.dom.d.ts` de TypeScript 6.0.3. Se declara
 * aquí lo mínimo para usarlo con detección (`'ariaNotify' in document`); sin él la región de avisos usa `role="status"`.
 * Quitar esta declaración cuando el `lib.dom.d.ts` del proyecto ya la incluya.
 */
export {};

declare global {
  interface Document {
    /** Anuncia `message` a los lectores de pantalla sin tocar el DOM ni el foco. */
    ariaNotify?(message: string, options?: { priority?: 'none' | 'important' }): void;
  }
}
