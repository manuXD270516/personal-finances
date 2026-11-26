import { resolve } from 'node:path';
import { writeSamplePdf } from '../test/support/write-sample-pdf.js';

/**
 * `pnpm imports:pdf:sample <ruta>`: escribe en disco el PDF sintético de «Banco Pampa Demo» (diseño Ganadero) para
 * subirlo a una cuenta de prueba y verificar la lectura exitosa de un extracto. Sin red ni base de datos; datos
 * ficticios; el PDF NO se versiona: escribilo fuera del repositorio. Usá una ruta ABSOLUTA: pnpm ejecuta el script
 * desde la carpeta del paquete, así que una ruta relativa se resuelve ahí.
 */
const arg = process.argv.slice(2).find((a) => a !== '--');
if (!arg) {
  process.stderr.write('Uso: pnpm imports:pdf:sample <ruta-de-salida.pdf>\n');
  process.exit(2);
}
const written = await writeSamplePdf(resolve(process.cwd(), arg));
process.stdout.write(`PDF sintético escrito en ${written}\n`);
