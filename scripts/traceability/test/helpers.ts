import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { main } from '../src/cli.js';
import type { Finding } from '../src/types.js';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** Crea un repositorio fixture en un directorio temporal: `base` + overlays (los archivos del overlay reemplazan). */
export function makeRepo(...overlays: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pf-trace-'));
  created.push(root);
  cpSync(join(FIXTURES, 'base'), root, { recursive: true });
  for (const overlay of overlays) cpSync(join(FIXTURES, 'overlays', overlay), root, { recursive: true });
  return root;
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[]): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    out: (line) => (stdout += `${line}\n`),
    err: (line) => (stderr += `${line}\n`),
  });
  return { code, stdout, stderr };
}

export const errorsOf = (findings: Finding[], rule?: string): Finding[] =>
  findings.filter((f) => f.severity === 'error' && (rule === undefined || f.rule === rule));
