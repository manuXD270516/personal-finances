/**
 * Detector de fugas de valores sensibles en texto serializado (JSON de auditoría, logs…).
 *
 * Un número corto (p. ej. `3099`) aparece por azar dentro de UUIDv7 (grupos de 4 hex separados
 * por guiones), hashes y marcas de tiempo; buscarlo suelto produce falsos positivos intermitentes.
 * El valor solo cuenta como fuga si no está pegado a caracteres de palabra, guion, punto o
 * dos puntos (los que forman ids, hashes y timestamps).
 */
export function leakPattern(...values: string[]): RegExp {
  const escaped = values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return new RegExp(`(?<![\\w.:-])(?:${escaped.join('|')})(?![\\w-])`, 'u');
}
