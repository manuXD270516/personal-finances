import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Chequeo estático "sin localhost fijo" (spec local-environment, TC-PLATFORM-STACK-005; NFR-PORT-005).
 *
 * Busca `localhost` / `127.0.0.1` en el código de aplicación y las definiciones de contenedores. Excepciones
 * declaradas (no son direcciones de servicios):
 *  - documentación (`*.md`) y fixtures/arneses de test (`__fixtures__/`, `test/`, `*.test.ts`);
 *  - bloques `healthcheck:` de Compose e instrucciones `HEALTHCHECK` de Dockerfile: se ejecutan DENTRO del
 *    propio contenedor (su loopback), docs/19 §5.1;
 *  - una línea marcada con `pf-allow-loopback` (en la misma línea o en la anterior), con justificación.
 */
export const DEFAULT_SCOPE = ['apps', 'packages', 'docker', 'deploy/compose'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__fixtures__', 'test']);
const TEXT_FILE = /(\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|sql|sh|toml|conf)|Dockerfile|\.Dockerfile)$/;
const PATTERN = /\blocalhost\b|127\.0\.0\.1/i;
const MARKER = 'pf-allow-loopback';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function isExcludedFile(name: string): boolean {
  return name.endsWith('.md') || /\.test\.[cm]?[jt]sx?$/.test(name) || name === 'next-env.d.ts';
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (TEXT_FILE.test(name) && !isExcludedFile(name)) {
      yield full;
    }
  }
}

/** Líneas (1-based) permitidas por estar dentro de un healthcheck de contenedor. */
export function healthcheckLines(file: string, lines: readonly string[]): Set<number> {
  const allowed = new Set<number>();
  const isCompose = /\.ya?ml$/.test(file);
  const isDockerfile = /Dockerfile$/.test(file) || file.endsWith('.Dockerfile');
  if (isCompose) {
    let blockIndent = -1;
    lines.forEach((line, i) => {
      const indent = line.search(/\S/);
      if (blockIndent >= 0) {
        if (indent > blockIndent || line.trim() === '') {
          allowed.add(i + 1);
          return;
        }
        blockIndent = -1;
      }
      if (/^\s*healthcheck:\s*(#.*)?$/.test(line)) blockIndent = indent;
    });
  }
  if (isDockerfile) {
    let continuing = false;
    lines.forEach((line, i) => {
      if (continuing || /^\s*HEALTHCHECK\b/i.test(line)) {
        allowed.add(i + 1);
        continuing = /\\\s*$/.test(line);
      }
    });
  }
  return allowed;
}

export function scanText(file: string, text: string): Finding[] {
  const lines = text.split(/\r?\n/);
  const allowed = healthcheckLines(file, lines);
  const findings: Finding[] = [];
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    if (allowed.has(i + 1)) return;
    if (line.includes(MARKER) || (i > 0 && lines[i - 1]!.includes(MARKER))) return;
    findings.push({ file, line: i + 1, text: line.trim() });
  });
  return findings;
}

export function scanRepository(root: string, scope: readonly string[] = DEFAULT_SCOPE): Finding[] {
  const findings: Finding[] = [];
  for (const dir of scope) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).split(sep).join('/');
      findings.push(...scanText(rel, readFileSync(file, 'utf8')));
    }
  }
  return findings;
}
