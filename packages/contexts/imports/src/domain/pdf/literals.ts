/**
 * Comparación de literales de los diseños: sin mayúsculas, sin acentos y con espacios colapsados (decisión 6).
 * Sin expresiones regulares construidas con datos del documento: solo recorridos acotados (evita ReDoS).
 */
export function normalizeLiteral(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** `needle` aparece en `haystack` (ambos ya normalizados). */
export const containsLiteral = (haystack: string, needle: string): boolean =>
  needle !== '' && haystack.includes(needle);

const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** Longitud final de una coincidencia de `parts` (separados por `{n}`) que empieza en `start`; `start` si no hay. */
function matchAt(text: string, start: number, parts: readonly string[]): number {
  let pos = start;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p] as string;
    if (p > 0) {
      let digits = 0;
      while (pos + digits < text.length && isDigit(text.charCodeAt(pos + digits))) digits++;
      if (digits === 0) return start;
      pos += digits;
    }
    if (part !== '') {
      if (text.slice(pos, pos + part.length).toLowerCase() !== part.toLowerCase()) return start;
      pos += part.length;
    }
  }
  return pos;
}

/**
 * Literal con comodín numérico `{n}` (una o más cifras): `Aún falta {n}` quita «Aún falta 350». Implementado a mano,
 * sin construir expresiones regulares desde datos. Devuelve el texto sin las apariciones, con espacios colapsados.
 */
export function stripWildcardLiteral(text: string, literal: string): string {
  const parts = literal.split('{n}');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const end = matchAt(text, i, parts);
    if (end > i) {
      out += ' ';
      i = end;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out.replace(/\s+/gu, ' ').trim();
}
