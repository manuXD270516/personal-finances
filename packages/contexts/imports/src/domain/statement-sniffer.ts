import { OfxReader } from './ofx-reader.js';
import { QifReader } from './qif-reader.js';
import { decodeText } from './reader-support.js';
import type { SniffResult, StatementFormat } from './statement.js';

/**
 * Detección del formato por CONTENIDO, nunca por nombre ni por tipo declarado (FR-IMPORTS-004; openspec
 * add-import-pipeline decisión 5). `null` ⇒ formato no importable (PDF, binario desconocido): la creación de la
 * importación se rechaza con `IMPORT_UNSUPPORTED_FORMAT`. El formato lo fija DOCUMENTS (`detectedFormat`); esto lo
 * confirma antes de elegir el lector.
 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((b, i) => bytes[i] === b);

function asciiIncludes(bytes: Uint8Array, needle: string): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return text.includes(needle);
}

export function sniffStatementFormat(head: Uint8Array): SniffResult | null {
  const sample = head.subarray(0, 4096);
  if (sample.length === 0) return null;
  if (startsWith(sample, PDF_MAGIC)) return null;
  if (startsWith(sample, ZIP_MAGIC)) {
    // Libro de Office Open XML: el primer elemento suele ser `[Content_Types].xml` y existe `xl/`.
    return asciiIncludes(sample, '[Content_Types].xml') || asciiIncludes(sample, 'xl/')
      ? { format: 'XLSX', confidence: 'LOW' }
      : null;
  }
  const ofx = new OfxReader().sniff(sample);
  if (ofx) return ofx;
  const qif = new QifReader().sniff(sample);
  if (qif) return qif;
  const text = decodeText(sample);
  if (text === null) return null;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { format: 'JSON', confidence: trimmed.includes('"pfos.import-file"') ? 'HIGH' : 'LOW' };
  }
  // CSV: texto con al menos un delimitador reconocible.
  if (/[,;\t|]/u.test(text)) return { format: 'CSV', confidence: 'LOW' };
  return null;
}

export const IMPORTABLE_FORMATS: readonly StatementFormat[] = ['CSV', 'OFX', 'QIF', 'JSON', 'XLSX'];
