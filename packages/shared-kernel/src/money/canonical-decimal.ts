/**
 * Forma canónica de un texto decimal ya validado (`-?\d+(\.\d+)?`): sin ceros finales en la parte fraccionaria, sin `.`
 * huérfano y `-0` ⇒ `0`. Es la forma con que se devuelven los valores guardados en `numeric(38,18)` (la base los rellena
 * con ceros hasta 18 decimales). Opera sobre texto: nunca pasa por `number` (INV-001).
 */
export function canonicalDecimal(text: string): string {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const trimmed = fraction.replace(/0+$/u, '');
  const body = trimmed === '' ? whole : `${whole}.${trimmed}`;
  return negative && body !== '0' ? `-${body}` : body;
}
