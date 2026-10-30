import type { PdfLayoutRegistry, PdfTextExtractor } from '../../application/pdf/ports.js';
import {
  PdfExtractionError,
  detectLayout,
  findPagesWithoutText,
  readPdfStatement,
  type PdfLayout,
} from '../../domain/index.js';

/**
 * Diagnóstico local de un extracto PDF (openspec add-pdf-statement-parser decisión 15, Could): corre el extractor y el
 * motor sobre un PDF que está FUERA del repositorio e informa SOLO la estructura: diseño y versión, páginas, filas
 * reconocidas, líneas no reconocidas (página y número), resultado de cada verificación de coherencia y códigos de fila
 * por conteo. Nunca montos, descripciones, nombres, cuentas ni saldos: el owner puede compartir la salida (D281, D355).
 */
export async function probePdf(
  bytes: Uint8Array,
  deps: {
    readonly extractor: PdfTextExtractor;
    readonly layouts: PdfLayoutRegistry;
    readonly scale: number;
    readonly minPageTextChars: number;
  },
): Promise<string[]> {
  const out: string[] = [];
  let doc;
  try {
    doc = await deps.extractor.extract(bytes);
  } catch (err) {
    out.push(`extraccion: FALLO (${err instanceof PdfExtractionError ? err.reason : 'MALFORMED'})`);
    return out;
  }
  out.push(`paginas leidas: ${doc.pages.length}`);
  const candidates = deps.layouts.candidates();
  const blank = candidates.flatMap((l: PdfLayout) => l.page.blankPageLiterals);
  const noText = findPagesWithoutText(doc, deps.minPageTextChars, blank);
  out.push(`paginas sin texto: ${noText.length === 0 ? 'ninguna' : noText.join(', ')}`);
  if (noText.length > 0) {
    out.push('resultado: FALLO IMPORT_PDF_NO_TEXT');
    return out;
  }
  const layout = detectLayout(doc, candidates);
  if (!layout) {
    out.push('diseno: ninguno (IMPORT_PDF_LAYOUT_UNKNOWN)');
    out.push('resultado: FALLO IMPORT_PDF_LAYOUT_UNKNOWN');
    return out;
  }
  out.push(`diseno: ${layout.id}@${layout.version}`);
  const result = readPdfStatement(doc, layout, { scale: deps.scale, maxRows: 1_000_000 });
  const info = result.info;
  out.push(`paginas declaradas: ${info.pagesDeclared ?? 'no declara'}`);
  out.push(`moneda del encabezado: ${info.currency === null ? 'no se leyo' : 'leida'}`);
  out.push(`cuenta del encabezado: ${info.accountLast4 === null ? 'no se leyo' : 'leida'}`);
  const coherence = info.coherence;
  if (coherence) {
    out.push(`filas reconocidas: ${coherence.recognizedRows}`);
    out.push(
      `lineas no reconocidas: ${
        coherence.unrecognizedLines.length === 0
          ? 'ninguna'
          : coherence.unrecognizedLines.map((l) => `p${l.page}:l${l.line}`).join(', ')
      }`,
    );
    for (const c of coherence.checks) out.push(`verificacion ${c.check}: ${c.status}`);
    out.push(`saldo corrido: ${coherence.runningBalance}`);
  }
  if (result.ok) {
    const counts = new Map<string, number>();
    for (const r of result.records)
      for (const i of r.issues) counts.set(i.code, (counts.get(i.code) ?? 0) + 1);
    out.push(
      `codigos de fila: ${
        counts.size === 0
          ? 'ninguno'
          : [...counts.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([code, n]) => `${code}=${n}`)
              .join(', ')
      }`,
    );
    out.push('resultado: OK');
  } else {
    out.push(`resultado: FALLO ${result.code}`);
  }
  return out;
}
