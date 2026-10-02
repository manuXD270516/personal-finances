import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPosix, walkFiles } from './fs-utils.js';
import type { TestFile } from './types.js';

/** Directorios con tests automatizados del monorepo. */
export const TEST_ROOTS = ['apps', 'packages', 'scripts', 'tests'] as const;
/** Directorios que no se recorren: dependencias, artefactos y repos simulados de fixtures. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'fixtures',
  '__fixtures__',
]);
const TEST_FILE = /\.(?:test|spec|e2e)\.(?:ts|tsx|mts)$/;
export const TC_REF = /\[(TC-[A-Z]+-[A-Z0-9]+-\d{3})\]/g;

/** Extrae los TC-IDs entre corchetes (`[TC-…]`) presentes en el contenido de un test. */
export const extractIds = (content: string): string[] => [
  ...new Set([...content.matchAll(TC_REF)].map((m) => m[1] as string)),
];

/** Escanea `**\/*.{test,spec}.{ts,tsx,mts}` en apps/, packages/, scripts/ y tests/. */
export function scanTests(root: string): TestFile[] {
  const files: TestFile[] = [];
  for (const dir of TEST_ROOTS) {
    for (const abs of walkFiles(join(root, dir), SKIP_DIRS)) {
      if (!TEST_FILE.test(abs)) continue;
      const ids = extractIds(readFileSync(abs, 'utf8'));
      files.push({ file: toPosix(root, abs), ids });
    }
  }
  return files;
}
