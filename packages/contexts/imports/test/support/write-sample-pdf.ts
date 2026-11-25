import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { paintStatement } from '../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { renderPdf } from './render-pdf.js';

/**
 * Escribe en disco el PDF SINTÉTICO de «Banco Pampa Demo» (diseño Ganadero: 11 filas en 2 páginas, el mismo de
 * TC-IMPORTS-PDF-048) para probar la lectura exitosa de un extracto en un despliegue antes de usar datos reales
 * (docs/despliegue/GUIA-PRUEBAS-FUNCIONALES.md, GF-IMP-15). El archivo se genera cada vez y NO se versiona (D255,
 * D281, D282). Devuelve la ruta absoluta escrita.
 */
export async function writeSamplePdf(path: string): Promise<string> {
  const target = resolve(path);
  const bytes = await renderPdf(paintStatement('GANADERO'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return target;
}
