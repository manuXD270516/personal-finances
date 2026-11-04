import { stripWildcardLiteral } from './literals.js';

/**
 * Fragmentos variables de la glosa (decisión 12): anotaciones de estado que el banco recalcula entre descargas del
 * mismo mes (`Aún falta 350`, `Completado`). Se quitan SOLO de la descripción que alimenta la huella de la fila; la
 * transacción guarda la glosa completa. Comodín numérico `{n}` y sin expresiones regulares (evita ReDoS).
 */
export function stripVolatileFragments(
  description: string | null,
  fragments: readonly string[],
): string | null {
  if (description === null || fragments.length === 0) return description;
  let text = description;
  for (const fragment of fragments) text = stripWildcardLiteral(text, fragment);
  return text === '' ? null : text;
}
