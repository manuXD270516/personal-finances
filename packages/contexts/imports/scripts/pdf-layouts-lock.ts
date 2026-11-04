import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutChecksum, layoutKey } from '../src/infrastructure/pdf/file-pdf-layout-registry.js';

/**
 * Publica diseños nuevos en `pdf-layouts.lock.json` (openspec add-pdf-statement-parser decisión 6). SOLO agrega
 * entradas de versiones que aún no están en el lock; si el archivo de una versión ya publicada cambió, falla:
 * una versión publicada es inmutable (un formato nuevo del banco es una versión nueva).
 *
 * Uso: `pnpm --filter @pf/imports exec tsx scripts/pdf-layouts-lock.ts`.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../src/infrastructure/pdf');
const lockPath = join(root, 'pdf-layouts.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, string>;
let added = 0;
for (const file of readdirSync(join(root, 'layouts')).filter((f) => f.endsWith('.json'))) {
  const layout = JSON.parse(readFileSync(join(root, 'layouts', file), 'utf8')) as {
    id: string;
    version: number;
  };
  const key = layoutKey(layout.id, layout.version);
  const sum = layoutChecksum(layout);
  if (lock[key] === undefined) {
    lock[key] = sum;
    added += 1;
  } else if (lock[key] !== sum) {
    throw new Error(`${key} ya está publicado y cambió: publique una versión nueva en lugar de editarlo`);
  }
}
const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(lockPath, `${JSON.stringify(sorted, null, 2)}\n`);
process.stdout.write(`pdf-layouts.lock.json: ${added} diseño(s) agregado(s)\n`);
