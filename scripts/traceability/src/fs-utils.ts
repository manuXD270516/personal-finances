import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Ruta relativa a `root` con separador `/` (estable entre Windows y Linux). */
export const toPosix = (root: string, abs: string): string => relative(root, abs).split(sep).join('/');

/** Recorre `dir` recursivamente devolviendo rutas absolutas de archivos; no entra en `skipDirs`. */
export function walkFiles(dir: string, skipDirs: ReadonlySet<string> = new Set()): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

/** Normalización para comparar nombres de requirement/scenario: Unicode NFC, minúsculas y espacios colapsados. */
export const normalizeName = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
