import { existsSync, readFileSync } from 'node:fs';

export interface EnvLine {
  readonly key?: string;
  readonly value?: string;
  /** Línea original (comentarios y blancos se conservan al reescribir). */
  readonly raw: string;
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  // Comentario en línea solo tras espacio (como Compose): `A=b # c`.
  const hash = v.search(/\s#/);
  return hash >= 0 ? v.slice(0, hash).trimEnd() : v;
}

export function parseEnvLines(text: string): EnvLine[] {
  return text.split(/\r?\n/).map((raw) => {
    const m = LINE.exec(raw);
    if (!m || raw.trimStart().startsWith('#')) return { raw };
    return { raw, key: m[1]!, value: unquote(m[2] ?? '') };
  });
}

/**
 * Interpolación con la misma semántica que Compose para `.env`: `${VAR}`, `${VAR:-default}`, `${VAR-default}`,
 * `${VAR:?error}`, `$$` literal. Las variables del entorno del proceso tienen prioridad sobre el fichero.
 */
export function interpolateEnv(
  lines: readonly EnvLine[],
  processEnv: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const lookup = (name: string): string | undefined => processEnv[name] ?? resolved[name];
  for (const line of lines) {
    if (!line.key) continue;
    if (processEnv[line.key] !== undefined) {
      resolved[line.key] = processEnv[line.key]!;
      continue;
    }
    resolved[line.key] = interpolate(line.value ?? '', lookup, line.key);
  }
  return resolved;
}

export function interpolate(
  value: string,
  lookup: (name: string) => string | undefined,
  context = 'value',
): string {
  return value.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced?: string, op?: string, arg?: string, bare?: string) => {
      if (match === '$$') return '$';
      const name = (braced ?? bare)!;
      const current = lookup(name);
      const unsetOrEmpty = current === undefined || current === '';
      switch (op) {
        case ':-':
          return unsetOrEmpty ? (arg ?? '') : current;
        case '-':
          return current === undefined ? (arg ?? '') : current;
        case ':?':
        case '?':
          if (op === ':?' ? unsetOrEmpty : current === undefined) {
            throw new Error(`${context}: ${name} ${arg || 'is required'}`);
          }
          return current!;
        default:
          return current ?? '';
      }
    },
  );
}

/** Lee y resuelve un `.env`. Lanza si no existe (el mensaje indica cómo crearlo). */
export function loadEnvFile(
  path: string,
  processEnv: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  if (!existsSync(path)) {
    throw new Error(`No existe ${path}. Créalo con: pnpm setup:env`);
  }
  return interpolateEnv(parseEnvLines(readFileSync(path, 'utf8')), processEnv);
}
