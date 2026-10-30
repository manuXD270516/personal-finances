/**
 * Falla de la extracción de texto de un PDF (decisión 3). `reason` es el motivo estructural que se informa en
 * `ImportJob.pdf.extractionFailure`; nunca lleva texto del documento ni del motor de lectura.
 */
export const PDF_EXTRACTION_REASONS = [
  'TIMEOUT',
  'MEMORY',
  'PAGE_LIMIT',
  'TEXT_LIMIT',
  'MALFORMED',
  'ENCRYPTED',
] as const;
export type PdfExtractionReason = (typeof PDF_EXTRACTION_REASONS)[number];

export class PdfExtractionError extends Error {
  constructor(readonly reason: PdfExtractionReason) {
    super(`pdf extraction failed: ${reason}`);
    this.name = 'PdfExtractionError';
  }
}
