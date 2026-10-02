import { execFile } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del monorepo (scripts/architecture/src → ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const CONFIG_FILE = join(REPO_ROOT, '.dependency-cruiser.cjs');
/** Mismos directorios que el script raíz `arch:check`. */
export const REPO_TARGETS = ['apps', 'packages', 'scripts'] as const;

const DEPCRUISE_BIN = join(
  dirname(fileURLToPath(import.meta.resolve('dependency-cruiser'))),
  '..',
  '..',
  'bin',
  'dependency-cruiser.mjs',
);

export interface Violation {
  readonly rule: string;
  readonly from: string;
  readonly to: string;
}

export interface CruiseResult {
  readonly exitCode: number;
  readonly violations: readonly Violation[];
}

/**
 * Ejecuta dependency-cruiser (CLI, igual que `pnpm arch:check`) con `cwd` como raíz: las rutas de las
 * reglas (`^packages/contexts/...`) son relativas a ese directorio.
 */
export function cruise(cwd: string, targets: readonly string[]): Promise<CruiseResult> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      [DEPCRUISE_BIN, ...targets, '--config', CONFIG_FILE, '--output-type', 'err', '--no-progress'],
      { cwd, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        // eslint-disable-next-line no-control-regex -- quitar colores ANSI de la salida
        const text = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
        if (exitCode < 0 || !/no dependency violations found|dependency violations \(/.test(text)) {
          fail(new Error(`dependency-cruiser terminó de forma inesperada (exit ${exitCode}): ${text}`));
          return;
        }
        // Reporter `err` (mismo código de salida que `arch:check`): `  error <regla>: <from> → <to>`;
        // en no-circular el ciclo continúa en las líneas siguientes.
        const violations = [...text.matchAll(/^\s*error (\S+): (\S+) →\s+(\S+)/gm)].map((m) => ({
          rule: m[1] as string,
          from: m[2] as string,
          to: m[3] as string,
        }));
        done({ exitCode, violations });
      },
    );
  });
}

/** Copia un árbol de fixtures (`*.ts.txt`, inertes en el repo) renombrándolos a `*.ts`. */
function copyFixtureTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
  const rename = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) rename(abs);
      else if (name.endsWith('.ts.txt')) renameSync(abs, abs.slice(0, -'.txt'.length));
    }
  };
  rename(to);
}

/**
 * Crea un mini repositorio temporal: fixture `baseline` (+ overlay opcional de violaciones),
 * `tsconfig.base.json` real y `node_modules` enlazado a uno real del workspace para que los imports
 * de frameworks (`@nestjs/common`, `pg`) se resuelvan como en el repo (trampa SPIKE-04 R4).
 */
export function createMiniRepo(fixturesDir: string, overlay?: string): { root: string; dispose: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pf-arch-'));
  copyFixtureTree(join(fixturesDir, 'baseline'), root);
  if (overlay) copyFixtureTree(join(fixturesDir, 'violations', overlay), root);
  cpSync(join(REPO_ROOT, 'tsconfig.base.json'), join(root, 'tsconfig.base.json'));
  const link = join(root, 'node_modules');
  symlinkSync(join(REPO_ROOT, 'packages', 'platform', 'node_modules'), link, 'junction');
  return {
    root,
    dispose: () => {
      // Primero el enlace (nunca recorrer el node_modules real), luego el resto.
      unlinkSync(link);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
