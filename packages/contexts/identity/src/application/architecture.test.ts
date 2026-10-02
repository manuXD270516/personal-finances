import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const IMPORT = /^\s*(?:import|export)\s[^'"]*['"]([^'"]+)['"]/gm;

function importsOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(IMPORT)].map((m) => m[1] as string));
}

describe('IDENTITY: cambiar la moneda base no toca la historia (tarea 4.3)', () => {
  it('application y domain no dependen de Ledger, Transactions, Accounts ni FX', () => {
    const imports = [...importsOf(here), ...importsOf(join(here, '..', 'domain'))];
    expect(imports.length).toBeGreaterThan(0);
    const forbidden = imports.filter((i) => /^@pf\/(ledger|transactions|txn|accounts|fx)(\/|$)/.test(i));
    expect(forbidden).toEqual([]);
  });
});
