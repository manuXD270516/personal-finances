/**
 * Lógica pura de la pantalla de campos personalizados (openspec add-custom-fields 6.1): clave sugerida a partir de la
 * etiqueta y validación de las opciones de una selección antes de enviarlas (la API valida igual).
 */

/** Opción en edición: `stored` marca las que ya existen (su clave es estable y no se reescribe). */
export interface OptionDraft {
  key: string;
  label: string;
  /** El usuario escribió la clave a mano (deja de derivarse de la etiqueta). */
  touched?: boolean;
  /** La opción ya está guardada: su clave no cambia. */
  stored?: boolean;
}

/** Clave `snake_case` sugerida: minúsculas sin acentos, separadores `_`, empieza con letra y ≤ 40 caracteres. */
export function slugKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withLetter = /^[a-z]/.test(base) || base === '' ? base : `c_${base}`;
  return withLetter.slice(0, 40).replace(/_+$/g, '');
}

const KEY = /^[a-z0-9][a-z0-9_]{0,39}$/;

export type OptionsResult =
  | { readonly options: { key: string; label: string }[] }
  | {
      readonly error: 'optionsRequired' | 'optionKeyInvalid' | 'optionKeyDuplicated' | 'optionLabelRequired';
    };

/** Opciones listas para enviar: sin filas vacías, con claves válidas y sin repetidos. */
export function optionsPayload(rows: readonly OptionDraft[]): OptionsResult {
  const filled = rows.filter((r) => r.key.trim() !== '' || r.label.trim() !== '');
  if (filled.length === 0) return { error: 'optionsRequired' };
  const keys = new Set<string>();
  const labels = new Set<string>();
  const options: { key: string; label: string }[] = [];
  for (const r of filled) {
    const label = r.label.trim();
    const key = r.key.trim() || slugKey(label);
    if (!label) return { error: 'optionLabelRequired' };
    if (!KEY.test(key)) return { error: 'optionKeyInvalid' };
    if (keys.has(key) || labels.has(label.toLocaleLowerCase())) return { error: 'optionKeyDuplicated' };
    keys.add(key);
    labels.add(label.toLocaleLowerCase());
    options.push({ key, label });
  }
  return { options };
}
