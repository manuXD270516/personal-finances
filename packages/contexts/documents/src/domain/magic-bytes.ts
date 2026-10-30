import type { DocumentFormat } from './types.js';

/**
 * Detección del tipo real por firma inicial (design decisión 4). Solo reconoce las familias binarias de la lista
 * permitida; los formatos de texto no tienen firma y los valida `TextContentInspector`. Ningún nombre ni tipo
 * declarado interviene.
 */
export type BinaryFamily = Extract<DocumentFormat, 'PDF' | 'PNG' | 'JPEG' | 'WEBP' | 'HEIC' | 'XLSX'>;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'msf1']);

/** Firmas de formatos que nunca se admiten (ejecutables, comprimidos, scripts): `TYPE_NOT_ALLOWED`. */
const FORBIDDEN_SIGNATURES: readonly Buffer[] = [
  Buffer.from('MZ', 'latin1'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from('Rar!', 'latin1'),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  Buffer.from('#!', 'latin1'),
];

/** PDF: la firma `%PDF-1.` o `%PDF-2.` DEBE estar en el byte 0 (los lectores toleran 1 KiB: así se evitan políglotas). */
export function hasPdfSignature(head: Buffer): boolean {
  return (
    head.length >= 7 &&
    head.subarray(0, 5).toString('latin1') === '%PDF-' &&
    (head[5] === 0x31 || head[5] === 0x32) &&
    head[6] === 0x2e
  );
}

/** Familia binaria reconocida por la firma inicial, o `null`. */
export function detectBinaryFamily(head: Buffer): BinaryFamily | null {
  if (hasPdfSignature(head)) return 'PDF';
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return 'PNG';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'JPEG';
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'WEBP';
  }
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
    if (HEIC_BRANDS.has(head.subarray(8, 12).toString('latin1'))) return 'HEIC';
  }
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return 'XLSX';
  }
  return null;
}

/** ¿Empieza con la firma de un ejecutable, comprimido o script que jamás se admite? */
export function hasForbiddenSignature(head: Buffer): boolean {
  return FORBIDDEN_SIGNATURES.some(
    (sig) => head.length >= sig.length && head.subarray(0, sig.length).equals(sig),
  );
}

const MAX_SIDE = 50_000;

/**
 * Dimensiones desde la cabecera, sin decodificar píxeles. `null` ⇒ cabecera ilegible (contenido mal formado);
 * un lado mayor que 50 000 px ⇒ `{ width, height }` y el llamador rechaza.
 */
export function imageDimensions(
  content: Buffer,
  family: BinaryFamily,
): { width: number; height: number } | null {
  switch (family) {
    case 'PNG': {
      if (content.length < 24 || content.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
      return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
    }
    case 'JPEG':
      return jpegDimensions(content);
    case 'WEBP':
      return webpDimensions(content);
    case 'HEIC':
      return heicDimensions(content);
    default:
      return null;
  }
}

export const exceedsMaxSide = (d: { width: number; height: number }): boolean =>
  d.width > MAX_SIDE || d.height > MAX_SIDE;
export const hasEmptySide = (d: { width: number; height: number }): boolean => d.width < 1 || d.height < 1;

function jpegDimensions(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1]!;
    }
    // Marcadores sin longitud.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = b.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return null;
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function webpDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const kind = b.subarray(12, 16).toString('latin1');
  if (kind === 'VP8X') {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function heicDimensions(b: Buffer): { width: number; height: number } | null {
  const limit = Math.min(b.length, 4 * 1024 * 1024);
  const at = b.subarray(0, limit).indexOf('ispe', 0, 'latin1');
  if (at < 0 || at + 16 > limit) return null;
  // ispe: tamaño (4) | 'ispe' (4) | versión y banderas (4) | ancho (4) | alto (4)
  return { width: b.readUInt32BE(at + 8), height: b.readUInt32BE(at + 12) };
}
