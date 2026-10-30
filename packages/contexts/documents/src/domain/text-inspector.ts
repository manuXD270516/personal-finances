import type { DocumentFormat, InspectionVerdict } from './types.js';

/**
 * Inspector de formatos de texto (CSV, OFX/QFX, QIF, JSON; design decisión 4). Puro: no ejecuta ni interpreta nada.
 * Decodifica UTF-8 (con o sin BOM), UTF-16 con BOM o windows-1252; sin `NUL` ni controles C0 salvo `\t \r \n`; sin
 * marcado HTML/SVG/script al inicio.
 */
export type TextFormat = Extract<DocumentFormat, 'CSV' | 'OFX' | 'QIF' | 'JSON'>;

export const DEFAULT_JSON_MAX_DEPTH = 64;

/** Decodifica o devuelve `null` si el contenido no es texto en una de las codificaciones admitidas. */
export function decodeText(content: Buffer): string | null {
  if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    return decodeUtf8(content.subarray(3));
  }
  if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(content.subarray(2));
  }
  if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
    const swapped = Buffer.from(content.subarray(2));
    swapped.swap16();
    return new TextDecoder('utf-16le').decode(swapped);
  }
  // Sin BOM: UTF-8 estricto y, si no, windows-1252 (extractos de bancos locales, docs/13 §12).
  if (content.includes(0)) return null;
  return decodeUtf8(content) ?? new TextDecoder('windows-1252').decode(content);
}

function decodeUtf8(content: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u;
const ACTIVE_MARKUP = /<!doctype\s+html|<html|<script|<svg|<iframe|javascript:/iu;
const XML_THEN_SVG = /<\?xml[\s\S]*?<svg/iu;

/** Marcado activo en el primer KiB (tras BOM y espacios). */
export function startsWithActiveMarkup(text: string): boolean {
  const head = text.trimStart().slice(0, 1024);
  return ACTIVE_MARKUP.test(head) || XML_THEN_SVG.test(head);
}

/** Profundidad máxima de anidamiento `{`/`[` fuera de cadenas, sin recursión (no desborda la pila). */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i += 1;
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth += 1;
      if (depth > max) max = depth;
    } else if (c === 0x7d || c === 0x5d) depth -= 1;
  }
  return max;
}

export function inspectText(
  content: Buffer,
  format: TextFormat,
  options: { readonly jsonMaxDepth?: number } = {},
): InspectionVerdict {
  const text = decodeText(content);
  if (text === null) return { ok: false, reason: 'MALFORMED_CONTENT' };
  if (FORBIDDEN_CONTROLS.test(text)) return { ok: false, reason: 'MALFORMED_CONTENT' };
  if (startsWithActiveMarkup(text)) return { ok: false, reason: 'ACTIVE_CONTENT' };
  const head = text.trimStart();
  switch (format) {
    case 'OFX': {
      const probe = head.slice(0, 4096).toLowerCase();
      if (!probe.includes('ofxheader:') && !probe.includes('<ofx>') && !probe.includes('<?ofx')) {
        return { ok: false, reason: 'TYPE_MISMATCH' };
      }
      return { ok: true, format };
    }
    case 'QIF': {
      const lower = head.slice(0, 64).toLowerCase();
      if (!lower.startsWith('!type:') && !lower.startsWith('!account')) {
        return { ok: false, reason: 'TYPE_MISMATCH' };
      }
      return { ok: true, format };
    }
    case 'JSON': {
      if (jsonDepth(text) > (options.jsonMaxDepth ?? DEFAULT_JSON_MAX_DEPTH)) {
        return { ok: false, reason: 'MALFORMED_CONTENT' };
      }
      try {
        JSON.parse(text);
      } catch {
        return { ok: false, reason: 'MALFORMED_CONTENT' };
      }
      return { ok: true, format };
    }
    default:
      return { ok: true, format };
  }
}
