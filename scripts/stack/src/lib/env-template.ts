import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { parseEnvLines } from './dotenv.js';

/** Marcador de `.env.example` que `pnpm setup:env` reemplaza por un secreto de desarrollo aleatorio. */
export const GENERATE_MARKER = '__generate__';

// Prefijos DER fijos de X25519 (RFC 8410) para obtener las claves crudas de 32 bytes en base64url.
const SPKI_PREFIX_LENGTH = 12;
const PKCS8_PREFIX_LENGTH = 16;

/**
 * Par X25519 de DESARROLLO de las credenciales de exchanges (add-banking-providers, D342): la pública se deriva de la
 * privada, así que se generan JUNTAS. `generateSecret` entrega cada mitad a su variable.
 */
const connectionKeyPair = (() => {
  let pair: { publicKey: string; privateKey: string } | undefined;
  return () => {
    if (!pair) {
      const k = generateKeyPairSync('x25519');
      pair = {
        publicKey: Buffer.from(k.publicKey.export({ format: 'der', type: 'spki' }))
          .subarray(SPKI_PREFIX_LENGTH)
          .toString('base64url'),
        privateKey: Buffer.from(k.privateKey.export({ format: 'der', type: 'pkcs8' }))
          .subarray(PKCS8_PREFIX_LENGTH)
          .toString('base64url'),
      };
    }
    return pair;
  };
})();

/** Secreto aleatorio seguro dentro de URLs, SQL, JSON y placeholders de Keycloak (solo [A-Za-z0-9_-]). */
export function generateSecret(key: string): string {
  // Las access keys S3 suelen validarse como alfanuméricas.
  if (key.endsWith('_ACCESS_KEY')) return `pfosdev${randomBytes(8).toString('hex')}`;
  // Clave maestra AES-256 de los exports: exactamente 32 bytes (43 caracteres en base64url).
  if (key === 'PF_DEV_EXPORT_MASTER_KEY' || key === 'PF_DEV_DOCUMENT_MASTER_KEY') {
    return randomBytes(32).toString('base64url');
  }
  if (key === 'PF_DEV_CONNECTION_PRIVATE_KEY') return connectionKeyPair().privateKey;
  if (key === 'PF_DEV_CONNECTION_PUBLIC_KEY') return connectionKeyPair().publicKey;
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
