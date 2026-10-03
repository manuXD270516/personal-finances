// Uso: pnpm contract:breaking <base.yaml> <revision.yaml>  → código 1 ante cambios incompatibles (oasdiff).
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oasdiffBreaking } from './oasdiff.js';

const [command, base, revision] = process.argv.slice(2);
if (command !== 'breaking' || !base || !revision) {
  console.error('Uso: breaking <base.yaml> <revision.yaml>');
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'pf-oasdiff-'));
try {
  copyFileSync(base, join(dir, 'base.yaml'));
  copyFileSync(revision, join(dir, 'revision.yaml'));
  const result = oasdiffBreaking(join(dir, 'base.yaml'), join(dir, 'revision.yaml'));
  console.log(result.output.trim() || 'Sin cambios incompatibles.');
  process.exitCode = result.breaking ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
