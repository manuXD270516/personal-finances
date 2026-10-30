/**
 * Montos exactos de los diseños (decisión 9). Gramática: `^-?\d{1,3}(T\d{3})*D\d+$` o `^-?\d+D\d+$` con `T`/`D` los
 * separadores del diseño (sin miles declarado: solo la segunda forma). El texto se limpia de separadores y se devuelve
 * como cadena decimal (jamás `Number`/`parseFloat`, INV-001); más decimales que la escala de la moneda ⇒ `SCALE`
 * sin redondear (INV-003); un número que no cumple la gramática pero sí la del otro separador ⇒ `AMBIGUOUS`.
 * Recorrido a mano: sin expresiones regulares armadas con datos.
 */
export interface PdfNumberFormat {
  readonly decimal: '.' | ',';
  readonly thousands: ',' | '.' | null;
}

export type NumberParse =
  /** `value`: decimal con signo y `.` como separador, completado a `scale` decimales. */
  | { readonly kind: 'OK'; readonly value: string; readonly exact: string }
  /** Cumple la gramática pero tiene más decimales que la escala: `exact` conserva el valor sin redondear. */
  | { readonly kind: 'SCALE'; readonly exact: string }
  | { readonly kind: 'AMBIGUOUS' }
  | { readonly kind: 'INVALID' };

const isDigits = (s: string): boolean => s !== '' && [...s].every((c) => c >= '0' && c <= '9');
const isZero = (s: string): boolean => [...s].every((c) => c === '0');

/** Cumple la gramática para el par (decimal, miles); devuelve la parte entera y la fraccionaria sin signo. */
function split(
  body: string,
  decimal: string,
  thousands: string | null,
): { int: string; frac: string } | null {
  const at = body.lastIndexOf(decimal);
  if (at <= 0 || body.indexOf(decimal) !== at) return null;
  const intPart = body.slice(0, at);
  const frac = body.slice(at + 1);
  if (!isDigits(frac)) return null;
  if (isDigits(intPart)) return { int: intPart, frac };
  if (thousands === null || thousands === decimal) return null;
  const groups = intPart.split(thousands);
  const [first, ...rest] = groups as [string, ...string[]];
  if (first.length < 1 || first.length > 3 || !isDigits(first)) return null;
  if (rest.some((g) => g.length !== 3 || !isDigits(g))) return null;
  return { int: groups.join(''), frac };
}

export function parsePdfNumber(text: string, format: PdfNumberFormat, scale: number): NumberParse {
  const raw = text.trim();
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  if (body === '') return { kind: 'INVALID' };
  const own = split(body, format.decimal, format.thousands);
  if (own === null) {
    // La gramática del otro separador: «1250,00» donde el diseño declara punto decimal.
    const otherDecimal = format.decimal === '.' ? ',' : '.';
    const otherThousands = format.thousands === null ? null : format.thousands === ',' ? '.' : ',';
    return split(body, otherDecimal, otherThousands) !== null ? { kind: 'AMBIGUOUS' } : { kind: 'INVALID' };
  }
  const int = own.int.replace(/^0+(?=\d)/u, '');
  const frac = own.frac;
  const sign = negative && !(isZero(int) && isZero(frac)) ? '-' : '';
  const exact = `${sign}${int}.${frac}`;
  // Ceros sobrantes no cambian el valor: `12.340` en escala 2 es exacto; un dígito distinto de cero no se redondea.
  if (frac.length > scale && !isZero(frac.slice(scale))) return { kind: 'SCALE', exact };
  const padded = scale === 0 ? int : `${int}.${frac.slice(0, scale).padEnd(scale, '0')}`;
  return { kind: 'OK', value: `${sign}${padded}`, exact };
}

/** Escribe un decimal (`-1250.5`) con los separadores del diseño: el inverso exacto de `parsePdfNumber`. */
export function formatPdfNumber(value: string, format: PdfNumberFormat, scale: number): string {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = (negative ? value.slice(1) : value).split('.');
  const fractional = frac.padEnd(scale, '0');
  let grouped = int;
  if (format.thousands !== null && int.length > 3) {
    const parts: string[] = [];
    for (let i = int.length; i > 0; i -= 3) parts.unshift(int.slice(Math.max(0, i - 3), i));
    grouped = parts.join(format.thousands);
  }
  return `${negative ? '-' : ''}${grouped}${scale > 0 ? format.decimal + fractional : ''}`;
}
