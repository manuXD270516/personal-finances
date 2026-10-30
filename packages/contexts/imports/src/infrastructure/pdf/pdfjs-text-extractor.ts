import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { PdfExtractionLimits, PdfTextExtractor } from '../../application/pdf/ports.js';
import { PdfExtractionError, type PdfExtractionReason, type PdfTextDocument } from '../../domain/index.js';

/**
 * `PdfjsTextExtractor` (openspec add-pdf-statement-parser decisión 3, ADR-0032): un `worker_thread` NUEVO por
 * documento, con `resourceLimits`, sin variables de entorno, con el búfer transferido (sin copia compartida) y un
 * temporizador que lo termina (`terminate`). Falla cerrada: tiempo, memoria, páginas, fragmentos, PDF malformado o
 * cifrado ⇒ `PdfExtractionError` con el motivo estructural; jamás texto del documento. La respuesta del hilo se
 * valida con `zod` antes de usarla: un hilo comprometido no puede inyectar campos.
 */
const SELF = import.meta.url;
const FROM_SOURCE = SELF.endsWith('.ts');

const finite = z.number().refine(Number.isFinite);
const ReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    pageCount: z.number().int().min(0),
    pages: z.array(
      z.strictObject({
        number: z.number().int().min(1),
        width: finite,
        height: finite,
        items: z.array(
          z.strictObject({ text: z.string(), x: finite, y: finite, width: finite, height: finite }),
        ),
      }),
    ),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(['PAGE_LIMIT', 'TEXT_LIMIT', 'MALFORMED', 'ENCRYPTED']),
  }),
]);

/** Recursos locales del paquete (CMaps y fuentes estándar): PDF.js nunca va a la red. */
function resourceUrls(): { cMapUrl: string; standardFontDataUrl: string } {
  const root = dirname(createRequire(SELF).resolve('pdfjs-dist/package.json'));
  return {
    cMapUrl: pathToFileURL(join(root, 'cmaps') + sep).href,
    standardFontDataUrl: pathToFileURL(join(root, 'standard_fonts') + sep).href,
  };
}

export class PdfjsTextExtractor implements PdfTextExtractor {
  private readonly urls = resourceUrls();

  constructor(private readonly limits: PdfExtractionLimits) {}

  extract(bytes: Uint8Array): Promise<PdfTextDocument> {
    return new Promise((resolve, reject) => {
      const file = new URL(`./pdf-text-extractor.worker${FROM_SOURCE ? '.ts' : '.js'}`, SELF);
      // Copia propia que se transfiere: el búfer del llamador puede ser una vista de un ArrayBuffer compartido.
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      let settled = false;
      let memory = false;
      const finish = (outcome: { doc: PdfTextDocument } | { reason: PdfExtractionReason }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if ('doc' in outcome) resolve(outcome.doc);
        else reject(new PdfExtractionError(outcome.reason));
      };
      const worker = new Worker(file, {
        workerData: {
          bytes: copy,
          maxPages: this.limits.maxPages,
          maxTextItems: this.limits.maxTextItems,
          maxTextChars: this.limits.maxTextChars,
          ...this.urls,
        },
        transferList: [copy.buffer],
        resourceLimits: {
          maxOldGenerationSizeMb: this.limits.workerMaxOldMb,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
        // Sin variables de entorno: el hilo no ve secretos ni configuración.
        env: {},
        // Desde fuentes (pruebas y desarrollo) el hilo carga TypeScript con tsx.
        execArgv: FROM_SOURCE ? ['--import', 'tsx'] : [],
        stdout: true,
        stderr: true,
      });
      const timer = setTimeout(() => finish({ reason: 'TIMEOUT' }), this.limits.timeoutMs);
      worker.once('message', (raw: unknown) => {
        const parsed = ReplySchema.safeParse(raw);
        if (!parsed.success) return finish({ reason: 'MALFORMED' });
        const reply = parsed.data;
        if (!reply.ok) return finish({ reason: reply.reason });
        if (reply.pageCount !== reply.pages.length) return finish({ reason: 'MALFORMED' });
        finish({ doc: { pageCount: reply.pageCount, pages: reply.pages } });
      });
      worker.once('error', (err: Error & { code?: string }) => {
        memory = err.code === 'ERR_WORKER_OUT_OF_MEMORY';
        finish({ reason: memory ? 'MEMORY' : 'MALFORMED' });
      });
      worker.once('exit', () => finish({ reason: memory ? 'MEMORY' : 'MALFORMED' }));
    });
  }
}
