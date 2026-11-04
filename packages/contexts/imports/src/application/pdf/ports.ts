import type { PdfLayout, PdfTextDocument } from '../../domain/index.js';

/**
 * Puertos de la lectura de extractos PDF (openspec add-pdf-statement-parser). Los cumple `infrastructure/pdf`.
 */

/** Límites del hilo aislado (`IMPORT_PDF_*`). */
export interface PdfExtractionLimits {
  readonly timeoutMs: number;
  readonly maxPages: number;
  readonly maxTextItems: number;
  readonly maxTextChars: number;
  readonly workerMaxOldMb: number;
}

/**
 * Extrae el texto con posiciones de un PDF en un hilo aislado con límites (decisión 3); falla cerrada: lanza
 * `PdfExtractionError` con el motivo estructural.
 */
export interface PdfTextExtractor {
  extract(bytes: Uint8Array): Promise<PdfTextDocument>;
}

/** Diseños publicados (inmutables). `candidates()` va con la versión más reciente primero. */
export interface PdfLayoutRegistry {
  get(id: string, version: number): PdfLayout | null;
  candidates(): readonly PdfLayout[];
}
