import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCatalogedAction } from '../domain/audit-action-category.js';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const CONTEXTS = [
  'accounts',
  'audit',
  'classification',
  'fx',
  'identity',
  'ledger',
  'notifications',
  'planning',
  'security',
  'transactions',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'testing' || name === 'test') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name)) out.push(path);
  }
  return out;
}

/** Acciones emitidas en el código de producción: literales `'ctx.entidad.verbo'` y plantillas `ctx.entidad.${verbo}`. */
function emittedActions(): Map<string, string> {
  const roots = [
    ...readdirSync(join(REPO, 'packages/contexts'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .map((c) => join(REPO, 'packages/contexts', c, 'src')),
    join(REPO, 'apps/api/src'),
  ];
  const found = new Map<string, string>();
  const quote = '[\'"`]';
  const verb = '(?:[a-z][a-z_]*|\\$\\{[A-Za-z.]+\\})';
  const literal = new RegExp(`(${quote})((?:${CONTEXTS.join('|')})\\.[a-z][a-z_]*\\.${verb})\\1`, 'gu');
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        // Solo líneas que declaran una acción (`action:`/`action =`/retorno de acciones por estado), no referencias SQL.
        if (!/action|Action|\? '|: '/u.test(line)) continue;
        for (const m of line.matchAll(literal)) found.set(m[2]!, file);
      }
    }
  }
  return found;
}

describe('[TC-AUDIT-GLOBAL-006] catálogo de categorías de las acciones de auditoría', () => {
  it('toda acción emitida en el código está catalogada (un change que agrega una acción debe catalogarla)', () => {
    const emitted = emittedActions();
    expect(emitted.size).toBeGreaterThan(50);
    const uncataloged = [...emitted].filter(([action]) => !isCatalogedAction(action));
    expect(uncataloged.map(([action, file]) => `${action} (${file})`)).toEqual([]);
  });
});
