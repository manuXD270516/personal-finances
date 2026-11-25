import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSamplePdf } from '../../../test/support/write-sample-pdf.js';
import { FilePdfLayoutRegistry } from './file-pdf-layout-registry.js';
import { probePdf } from './pdf-probe.js';
import { PdfjsTextExtractor } from './pdfjs-text-extractor.js';

describe('PDF sintético en disco (pnpm imports:pdf:sample)', () => {
  it('[TC-IMPORTS-PDF-050] escribe el extracto sintético de Ganadero y el lector lo reconoce completo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pfos-pdf-sample-'));
    try {
      const path = await writeSamplePdf(join(dir, 'sub', 'extracto-ganadero-sintetico.pdf'));
      const bytes = new Uint8Array(readFileSync(path));
      expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      const text = (
        await probePdf(bytes, {
          extractor: new PdfjsTextExtractor({
            timeoutMs: 30_000,
            maxPages: 200,
            maxTextItems: 300_000,
            maxTextChars: 4_194_304,
            workerMaxOldMb: 192,
          }),
          layouts: new FilePdfLayoutRegistry(),
          scale: 2,
          minPageTextChars: 20,
        })
      ).join('\n');
      expect(text).toContain('diseno: bo.ganadero.cuenta@1');
      expect(text).toContain('paginas leidas: 2');
      expect(text).toContain('filas reconocidas: 11');
      expect(text).toContain('resultado: OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
