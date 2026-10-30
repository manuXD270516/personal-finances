/**
 * Normalización del nombre original (FR-DOCUMENTS-005, docs/12 §1): NFC, sin rutas ni caracteres de control, sin
 * comillas ni separadores que permitan inyectar cabeceras, ≤ 255 caracteres. Es solo un metadato: ninguna clave de
 * objeto lo contiene.
 */
export const MAX_FILE_NAME_LENGTH = 255;

// Controles C0 y C1, separadores de línea Unicode y marcas de dirección (U+202A–U+202E, U+2066–U+2069).
// eslint-disable-next-line no-control-regex -- justamente se eliminan los caracteres de control
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

export function normalizeFileName(raw: string): string {
  // `..\..\windows\factura\n.pdf`: los controles se eliminan primero (el salto de línea no esconde nada) y lo que
  // queda después del último separador de ruta es el nombre.
  const noControls = raw.normalize('NFC').replace(CONTROLS, '');
  const base = noControls.split(/[\\/]/u).pop() ?? '';
  const clean = base
    .replace(/["\u201c\u201d]/gu, '')
    .replace(/^[\s.]+/u, '')
    .trim();
  return [...clean].slice(0, MAX_FILE_NAME_LENGTH).join('').trim();
}

/** Extensión en minúsculas, sin punto (`''` si no hay). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Parte ASCII segura para `Content-Disposition: filename="…"` (sin `"`, `;`, `\`, CR, LF ni controles). */
export function asciiFileName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/gu, '_')
    .replace(/["\\;%]/gu, '_')
    .trim();
  return ascii.length > 0 ? ascii : 'documento';
}

/** `filename*=UTF-8''…` (RFC 5987/8187): percent-encoding de todo salvo `attr-char`. */
export function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDispositionOf(name: string): string {
  return `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${rfc5987(name)}`;
}
