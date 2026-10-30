import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FilePdfLayoutRegistry } from '../src/infrastructure/pdf/file-pdf-layout-registry.js';
import { PdfjsTextExtractor } from '../src/infrastructure/pdf/pdfjs-text-extractor.js';
import { probePdf } from '../src/infrastructure/pdf/pdf-probe.js';

/**
 * Diagnóstico local: `pnpm imports:pdf:probe <ruta-absoluta-al-pdf>` (openspec add-pdf-statement-parser decisión 15).
 * Sin red ni base de datos. Imprime SOLO estructura (diseño, páginas, filas reconocidas, líneas no reconocidas por
 * página y número, verificaciones OK/MISMATCH): ningún monto, descripción, nombre ni cuenta. El PDF debe estar FUERA
 * del repositorio.
 */
const arg = process.argv[2];
if (!arg) {
  process.stderr.write('Uso: pnpm imports:pdf:probe <ruta-al-pdf>\n');
  process.exit(2);
}
const path = resolve(process.cwd(), arg);
const bytes = new Uint8Array(readFileSync(path));
const lines = await probePdf(bytes, {
  extractor: new PdfjsTextExtractor({
    timeoutMs: 60_000,
    maxPages: 200,
    maxTextItems: 300_000,
    maxTextChars: 4_194_304,
    workerMaxOldMb: 192,
  }),
  layouts: new FilePdfLayoutRegistry(),
  scale: 2,
  minPageTextChars: 20,
});
process.stdout.write(`${lines.join('\n')}\n`);
