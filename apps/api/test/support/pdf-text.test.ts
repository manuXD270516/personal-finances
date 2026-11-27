import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pdfVisibleText } from './pdf-text.js';

/** PDF mínimo con un único content stream (solo lo que lee `pdfVisibleText`). */
function pdfWith(compressed: Buffer, eol: '\n' | '\r\n'): Uint8Array {
  return Buffer.concat([
    Buffer.from('%PDF-1.3\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from(`${eol}endstream\nendobj\n%%EOF\n`, 'latin1'),
  ]);
}

/** Primer texto cuyo deflate termina en 0x0D: el caso que el regex anterior recortaba. */
function endingInCarriageReturn(): { text: string; compressed: Buffer } {
  // El último byte es el menor del Adler-32: se varía también el largo para recorrer todos sus valores.
  for (let i = 0; i < 10_000; i++) {
    const text = `Bank C ${i} ${'x'.repeat(i % 37)}`;
    const compressed = deflateSync(Buffer.from(`BT /F1 12 Tf (${text}) Tj ET`, 'latin1'));
    if (compressed[compressed.length - 1] === 0x0d) return { text, compressed };
  }
  throw new Error('no se encontró un deflate que termine en 0x0D');
}

describe('pdfVisibleText', () => {
  it('lee el texto aunque los bytes comprimidos terminen en 0x0D (fin de línea \n)', () => {
    const { text, compressed } = endingInCarriageReturn();
    expect(pdfVisibleText(pdfWith(compressed, '\n'))).toContain(text);
  });

  it('lee el texto aunque los bytes comprimidos terminen en 0x0D (fin de línea \r\n)', () => {
    const { text, compressed } = endingInCarriageReturn();
    expect(pdfVisibleText(pdfWith(compressed, '\r\n'))).toContain(text);
  });

  it('lee el texto de un stream común con fin de línea \n o \r\n', () => {
    const compressed = deflateSync(Buffer.from('BT (Hola) Tj ET', 'latin1'));
    expect(pdfVisibleText(pdfWith(compressed, '\n'))).toBe('Hola');
    expect(pdfVisibleText(pdfWith(compressed, '\r\n'))).toBe('Hola');
  });
});
