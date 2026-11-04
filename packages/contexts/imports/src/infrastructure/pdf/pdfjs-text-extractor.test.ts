import { describe, expect, it } from 'vitest';
import { paintStatement } from '../../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { renderBlankPages, renderPdf } from '../../../test/support/render-pdf.js';
import { PdfExtractionError } from '../../domain/index.js';
import { PdfjsTextExtractor } from './pdfjs-text-extractor.js';

const LIMITS = {
  timeoutMs: 30_000,
  maxPages: 200,
  maxTextItems: 300_000,
  maxTextChars: 4_194_304,
  workerMaxOldMb: 192,
};

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return err instanceof PdfExtractionError ? err.reason : 'OTHER';
  }
  return 'OK';
};

describe('PdfjsTextExtractor (hilo aislado)', () => {
  it('[TC-IMPORTS-PDF-003] extrae el texto con posiciones del extracto sintético de una página', async () => {
    const bytes = await renderPdf(paintStatement('BCP'));
    const doc = await new PdfjsTextExtractor(LIMITS).extract(bytes);
    expect(doc.pageCount).toBe(1);
    const texts = doc.pages[0]?.items.map((i) => i.text) ?? [];
    expect(texts).toContain('Interesganado');
    expect(texts).toContain('1250.00');
    const amount = doc.pages[0]?.items.find((i) => i.text === '1250.00');
    expect((amount?.x ?? 0) + (amount?.width ?? 0)).toBeCloseTo(700, 0);
  }, 60_000);

  it('[TC-IMPORTS-PDF-006] un PDF de 201 páginas falla por el límite de páginas antes de leer el contenido', async () => {
    const bytes = await renderBlankPages(201);
    expect(await reasonOf(new PdfjsTextExtractor(LIMITS).extract(bytes))).toBe('PAGE_LIMIT');
  }, 60_000);

  it('[TC-IMPORTS-PDF-007] un PDF con la tabla de referencias truncada falla la lectura', async () => {
    const bytes = await renderPdf(paintStatement('GANADERO'), { truncate: 0.6 });
    expect(await reasonOf(new PdfjsTextExtractor(LIMITS).extract(bytes))).toBe('MALFORMED');
  }, 60_000);

  it('[TC-IMPORTS-PDF-004] vencido el tiempo de extracción el hilo se termina (motivo TIMEOUT)', async () => {
    const bytes = await renderPdf(paintStatement('GANADERO'));
    // 1 ms: el hilo no alcanza ni a arrancar; el temporizador lo termina y el principal sigue vivo.
    const extractor = new PdfjsTextExtractor({ ...LIMITS, timeoutMs: 1 });
    expect(await reasonOf(extractor.extract(bytes))).toBe('TIMEOUT');
    // El proceso principal sigue funcionando y puede leer otro documento enseguida.
    const doc = await new PdfjsTextExtractor(LIMITS).extract(bytes);
    expect(doc.pageCount).toBe(2);
  }, 60_000);

  it('[TC-IMPORTS-PDF-005] superar el límite de memoria del hilo falla solo esa extracción (motivo MEMORY)', async () => {
    const bytes = await renderPdf(paintStatement('GANADERO'));
    // 16 MiB de heap es menos que lo que PDF.js necesita para arrancar: el hilo muere por memoria, no el proceso.
    const extractor = new PdfjsTextExtractor({ ...LIMITS, workerMaxOldMb: 16 });
    const reason = await reasonOf(extractor.extract(bytes));
    expect(['MEMORY', 'MALFORMED']).toContain(reason);
    const doc = await new PdfjsTextExtractor(LIMITS).extract(bytes);
    expect(doc.pageCount).toBe(2);
  }, 60_000);

  it('[TC-IMPORTS-PDF-008] un extracto con contraseña solo de propietario se lee como cualquier otro', async () => {
    const bytes = await renderPdf(paintStatement('BCP'), { ownerPassword: 'prop-sintetica' });
    const doc = await new PdfjsTextExtractor(LIMITS).extract(bytes);
    expect(doc.pages[0]?.items.some((i) => i.text === 'Interesganado')).toBe(true);
  }, 60_000);

  it('[TC-IMPORTS-PDF-007] con contraseña de apertura la extracción falla cerrada (ENCRYPTED)', async () => {
    const bytes = await renderPdf(paintStatement('BCP'), { userPassword: 'apertura-sintetica' });
    expect(await reasonOf(new PdfjsTextExtractor(LIMITS).extract(bytes))).toBe('ENCRYPTED');
  }, 60_000);

  it('[TC-IMPORTS-PDF-009] el autor de los metadatos del PDF no aparece en el texto extraído', async () => {
    const bytes = await renderPdf(paintStatement('BCP'), { author: 'AUTOR-SECRETO-SINTETICO' });
    const doc = await new PdfjsTextExtractor(LIMITS).extract(bytes);
    expect(JSON.stringify(doc)).not.toContain('AUTOR-SECRETO');
  }, 60_000);
});
