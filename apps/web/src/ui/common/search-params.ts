/** Primer valor de un parámetro de búsqueda de una página (`?cuenta=…`), o `undefined`. */
export const one = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
