import { parentPort, workerData } from 'node:worker_threads';

/**
 * Cuerpo del hilo aislado de extracción de texto de un PDF (openspec add-pdf-statement-parser decisión 3 y ADR-0032).
 * Corre con `resourceLimits`, sin variables de entorno y bajo un plazo en el hilo principal; ante cualquier fallo el
 * principal falla cerrado. SOLO importa módulos de Node y `pdfjs-dist`: sin base de datos, sin configuración, sin red.
 *
 * Uso de PDF.js: únicamente `getDocument` + `getTextContent`; nunca `render`, ni metadatos (`getMetadata`), ni
 * anotaciones, ni JavaScript embebido. `isEvalSupported: false` mitiga la clase de CVE-2024-4367 (ejecución de código
 * al compilar fuentes). Los datos del documento nunca se escriben a consola.
 */
interface WorkerInput {
  readonly bytes: Uint8Array;
  readonly maxPages: number;
  readonly maxTextItems: number;
  readonly maxTextChars: number;
  readonly cMapUrl: string;
  readonly standardFontDataUrl: string;
}

type Reply =
  | {
      readonly ok: true;
      readonly pageCount: number;
      readonly pages: readonly {
        readonly number: number;
        readonly width: number;
        readonly height: number;
        readonly items: readonly {
          readonly text: string;
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        }[];
      }[];
    }
  | { readonly ok: false; readonly reason: 'PAGE_LIMIT' | 'TEXT_LIMIT' | 'MALFORMED' | 'ENCRYPTED' };

const input = workerData as WorkerInput;
const round = (v: number): number => Math.round(v * 100) / 100;

/* eslint-disable no-console -- el hilo aislado SILENCIA la consola: PDF.js avisa de cosas sin importancia (el canvas nativo ausente) y nada del documento debe llegar a los logs. */
/** PDF.js avisa por consola de cosas sin importancia (p. ej. el canvas nativo ausente): se silencia en el hilo. */
const quiet = (): void => undefined;
console.warn = quiet;
console.log = quiet;
console.info = quiet;
console.error = quiet;
/* eslint-enable no-console */

async function run(): Promise<Reply> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // `isEvalSupported: false` es obligatorio (CVE-2024-4367). La serie 6.x ya no compila funciones con `eval` ni
  // `new Function` (un test lo verifica sobre el paquete instalado) y la opción no figura en sus tipos: se pasa igual
  // para que una versión que la reintroduzca nunca arranque con el valor por omisión.
  const hardened = { isEvalSupported: false };
  const task = pdfjs.getDocument({
    ...hardened,
    data: input.bytes,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    verbosity: 0,
    enableXfa: false,
    cMapUrl: input.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: input.standardFontDataUrl,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    return {
      ok: false,
      reason: (err as { name?: string }).name === 'PasswordException' ? 'ENCRYPTED' : 'MALFORMED',
    };
  }
  try {
    // Se corta por el número de páginas ANTES de pedir el contenido de ninguna.
    if (pdf.numPages > input.maxPages) return { ok: false, reason: 'PAGE_LIMIT' };
    const pages: Extract<Reply, { ok: true }>['pages'][number][] = [];
    let items = 0;
    let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const out: Extract<Reply, { ok: true }>['pages'][number]['items'][number][] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        items += 1;
        chars += item.str.length;
        if (items > input.maxTextItems || chars > input.maxTextChars)
          return { ok: false, reason: 'TEXT_LIMIT' };
        const transform = item.transform as number[];
        const [vx, vy] = viewport.convertToViewportPoint(transform[4] as number, transform[5] as number);
        out.push({
          text: item.str.normalize('NFC'),
          x: round(vx as number),
          y: round(vy as number),
          width: round(item.width),
          height: round(item.height),
        });
      }
      pages.push({ number: n, width: round(viewport.width), height: round(viewport.height), items: out });
      page.cleanup();
    }
    return { ok: true, pageCount: pdf.numPages, pages };
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  } finally {
    await task.destroy().catch(quiet);
  }
}

run()
  .then((reply) => parentPort?.postMessage(reply))
  .catch(() => parentPort?.postMessage({ ok: false, reason: 'MALFORMED' } satisfies Reply));
