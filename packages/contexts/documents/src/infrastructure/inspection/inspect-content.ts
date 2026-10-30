import {
  detectBinaryFamily,
  exceedsMaxSide,
  hasEmptySide,
  hasForbiddenSignature,
  imageDimensions,
  type BinaryFamily,
} from '../../domain/magic-bytes.js';
import { inspectText, type TextFormat } from '../../domain/text-inspector.js';
import type { DocumentFormat, InspectionVerdict } from '../../domain/types.js';
import { DEFAULT_ARCHIVE_LIMITS, inspectXlsx, type ArchiveLimits } from './ooxml-inspector.js';
import { DEFAULT_PDF_LIMITS, inspectPdf, type PdfLimits } from './pdf-inspector.js';

/**
 * Orquestador de la inspección de contenido (design decisión 4): detecta el tipo real por firma, exige que coincida
 * con la familia declarada (extensión ↔ tipo ↔ contenido) y aplica los controles propios de cada formato. Función
 * pura sobre un `Buffer`; el hilo aislado con límites de memoria y tiempo lo aporta `WorkerThreadInspector`.
 */
export interface InspectionConfig {
  readonly jsonMaxDepth: number;
  readonly pdf: PdfLimits;
  readonly archive: ArchiveLimits;
}

export const DEFAULT_INSPECTION_CONFIG: InspectionConfig = {
  jsonMaxDepth: 64,
  pdf: DEFAULT_PDF_LIMITS,
  archive: DEFAULT_ARCHIVE_LIMITS,
};

const BINARY_FORMATS: readonly DocumentFormat[] = ['PDF', 'PNG', 'JPEG', 'WEBP', 'HEIC', 'XLSX'];

/** Familias cuya inspección necesita acceso aleatorio y se ejecuta en el hilo aislado. */
export const NEEDS_ISOLATION: readonly DocumentFormat[] = ['PDF', 'XLSX'];

export function inspectContent(
  content: Buffer,
  declared: DocumentFormat,
  config: InspectionConfig = DEFAULT_INSPECTION_CONFIG,
): InspectionVerdict {
  const head = content.subarray(0, 64);
  const detected = detectBinaryFamily(head);

  if (!BINARY_FORMATS.includes(declared)) {
    // Texto declarado: una firma binaria de la lista permitida es otra familia.
    if (detected !== null) return { ok: false, reason: 'TYPE_MISMATCH' };
    return inspectText(content, declared as TextFormat, { jsonMaxDepth: config.jsonMaxDepth });
  }

  if (detected !== declared) {
    return {
      ok: false,
      reason: detected === null && hasForbiddenSignature(head) ? 'TYPE_NOT_ALLOWED' : 'TYPE_MISMATCH',
    };
  }
  switch (declared as BinaryFamily) {
    case 'PDF':
      return inspectPdf(content, config.pdf);
    case 'XLSX':
      return inspectXlsx(content, config.archive);
    default: {
      const dims = imageDimensions(content, declared as BinaryFamily);
      if (dims === null || hasEmptySide(dims) || exceedsMaxSide(dims)) {
        return { ok: false, reason: 'MALFORMED_CONTENT' };
      }
      return { ok: true, format: declared };
    }
  }
}
