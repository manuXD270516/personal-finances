import { randomBytes } from 'node:crypto';
import { parseEnvLines } from './dotenv.js';

/** Marcador de `.env.example` que `pnpm setup:env` reemplaza por un secreto de desarrollo aleatorio. */
export const GENERATE_MARKER = '__generate__';

/** Secreto aleatorio seguro dentro de URLs, SQL, JSON y placeholders de Keycloak (solo [A-Za-z0-9_-]). */
export function generateSecret(key: string): string {
  // Las access keys S3 suelen validarse como alfanuméricas.
  if (key.endsWith('_ACCESS_KEY')) return `pfosdev${randomBytes(8).toString('hex')}`;
  // Clave maestra AES-256 de los exports: exactamente 32 bytes (43 caracteres en base64url).
  if (key === 'PF_DEV_EXPORT_MASTER_KEY') return randomBytes(32).toString('base64url');
  return randomBytes(24).toString('base64url');
}

export interface RenderResult {
  readonly text: string;
  readonly generated: string[];
  readonly added: string[];
  readonly kept: string[];
}

/**
 * Construye el `.env` a partir de `.env.example`: conserva los valores ya presentes en `existing` (un `.env`
 * previo), genera los `__generate__` que falten y respeta comentarios y orden de la plantilla. Las variables
 * que solo existen en `existing` se añaden al final (no se pierde configuración local).
 */
export function renderEnv(
  exampleText: string,
  existing: ReadonlyMap<string, string> = new Map(),
  overrides: ReadonlyMap<string, string> = new Map(),
  generate: (key: string) => string = generateSecret,
): RenderResult {
  const generated: string[] = [];
  const added: string[] = [];
  const kept: string[] = [];
  const seen = new Set<string>();
  const out = parseEnvLines(exampleText).map((line) => {
    if (!line.key) return line.raw;
    seen.add(line.key);
    if (overrides.has(line.key)) return `${line.key}=${overrides.get(line.key)!}`;
    const current = existing.get(line.key);
    if (current !== undefined && current !== GENERATE_MARKER) {
      kept.push(line.key);
      return `${line.key}=${current}`;
    }
    if (line.value === GENERATE_MARKER) {
      generated.push(line.key);
      return `${line.key}=${generate(line.key)}`;
    }
    added.push(line.key);
    return line.raw;
  });
  const extra = [...existing].filter(([k]) => !seen.has(k));
  if (extra.length > 0) {
    out.push('', '# ── Variables locales que no están en .env.example ──');
    for (const [k, v] of extra) out.push(`${k}=${v}`);
  }
  return { text: out.join('\n').replace(/\n*$/, '\n'), generated, added, kept };
}

/** Valores literales (sin interpolar) de un `.env`, para conservarlos al regenerar. */
export function rawValues(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) map.set(m[1]!, m[2]!.trim());
  }
  return map;
}
