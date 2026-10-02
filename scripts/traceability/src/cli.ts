import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadModel, runCheck } from './check.js';
import { buildMatrix, writeMatrix } from './matrix.js';
import type { OpenSpecMode } from './openspec.js';
import type { Finding } from './types.js';

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const HELP = `Uso: traceability <check|matrix> [opciones]

Comandos:
  check    Valida la cadena FR/NFR → requirement → scenario → TC → test (docs/17 §6.2).
           Falla (código 1) ante: R1 referencia a spec/requirement/scenario inexistente,
           R2 requirement Must sin TC activo, R3 TC automated sin test, R4 test con TC-ID inexistente,
           R5 test con TC-ID deprecado, R6 front matter inválido (schema docs/17 §4.1, id = archivo),
           R8 TC-ID duplicado, R11 TC activo borrado en la PR (requiere --base).
  matrix   Genera matrix.md y matrix.json (por defecto en tests/traceability/).

Opciones:
  --root <dir>          Raíz del repositorio (por defecto: el directorio con pnpm-workspace.yaml).
  --base <ref>          Ref base para detectar TC borrados (git diff --name-status <ref>...HEAD).
  --openspec <modo>     auto | cli | markdown (por defecto auto: \`openspec show --json\` + Markdown).
  --out <dir>           Directorio de salida de la matriz (relativo a --root).
  -h, --help            Muestra esta ayuda.

Códigos de salida: 0 OK · 1 errores de trazabilidad · 2 error de uso o de ejecución.`;

/** Raíz del repo: primer ancestro con pnpm-workspace.yaml (o con openspec/ y tests/cases/). */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'openspec')) && existsSync(join(dir, 'tests', 'cases'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const format = (f: Finding) =>
  `${f.severity === 'error' ? 'ERROR' : 'ADVERTENCIA'} [${f.rule}] ${f.file ?? '(repo)'}: ${f.message}`;

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: 'string' },
        base: { type: 'string' },
        openspec: { type: 'string', default: 'auto' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  const command = positionals[0];
  const mode = values.openspec as OpenSpecMode;
  if ((command !== 'check' && command !== 'matrix') || !['auto', 'cli', 'markdown'].includes(mode)) {
    io.err(`Comando u opción inválidos.\n\n${HELP}`);
    return 2;
  }
  const root = values.root ? resolve(values.root) : findRepoRoot(process.cwd());

  try {
    if (command === 'check') {
      const { model, findings } = await runCheck({
        root,
        openspec: mode,
        ...(values.base ? { base: values.base } : {}),
      });
      const errors = findings.filter((f) => f.severity === 'error');
      const warnings = findings.filter((f) => f.severity === 'warning');
      for (const f of [...errors, ...warnings]) io.err(format(f));
      const stats = `${model.cases.length} TC válidos, ${model.requirements.length} requirements, ${
        model.testFiles.length
      } archivos de test`;
      if (errors.length > 0) {
        io.err(
          `\nTrazabilidad con ${errors.length} error(es) y ${warnings.length} advertencia(s) (${stats}).`,
        );
        return 1;
      }
      io.out(`Trazabilidad OK: ${stats}; ${warnings.length} advertencia(s).`);
      return 0;
    }
    const model = await loadModel({ root, openspec: mode });
    const matrix = buildMatrix(model);
    const outDir = values.out
      ? isAbsolute(values.out)
        ? values.out
        : join(root, values.out)
      : join(root, 'tests', 'traceability');
    const written = writeMatrix(matrix, outDir);
    io.out(
      `Matriz generada: ${written.md} y ${written.json} (${matrix.summary.testCases} TC, ${matrix.summary.requirements} requirements, ${matrix.summary.automated} automatizados).`,
    );
    return 0;
  } catch (e) {
    io.err(`Error: ${(e as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const code = await main(process.argv.slice(2), {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exitCode = code;
}
