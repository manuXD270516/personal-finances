// Genera (o verifica con --check) docs/config-reference.md desde el registro de variables.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConfigReference } from '../src/config/docs.js';

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/config-reference.md');
const expected = renderConfigReference();
const check = process.argv.includes('--check');

if (check) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // inexistente = desactualizado
  }
  if (current.replace(/\r\n/g, '\n') !== expected) {
    process.stderr.write('docs/config-reference.md está desactualizado: ejecuta `pnpm config:docs`.\n');
    process.exit(1);
  }
  process.stdout.write('docs/config-reference.md al día.\n');
} else {
  writeFileSync(target, expected, 'utf8');
  process.stdout.write(`Escrito ${target}\n`);
}
