import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado de los datos sensibles de la sesión del BFF (tokens OIDC, secreto CSRF, estado de login) con
 * AES-256-GCM (ADR-0010 enmienda, docs/12 §3). La clave de cada `kid` se deriva del secreto de
 * `BFF_SESSION_ENC_KEY` con HKDF-SHA256; la primera clave cifra y todas descifran (rotación por `kid`).
 *
 * Formato (bytes, guardado en `bytea`): `"v1." + kid + "." + base64url(iv) + "." + base64url(ct) + "." +
 * base64url(tag)` en UTF-8. El AAD liga el blob a la fila y al propósito (`<session id>:<campo>`): un blob copiado a
 * otra sesión o a otra columna no descifra.
 */
export interface SessionKey {
  readonly kid: string;
  readonly key: Buffer;
}

const KID = /^[A-Za-z0-9_-]{1,32}$/;
const HKDF_INFO = 'pfos-bff-session-v1';

/** `[kid:]secreto[,kid:secreto…]` (validado por el contrato de configuración) → claves AES-256 derivadas. */
export function parseSessionKeys(value: string): SessionKey[] {
  const keys = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      // Sin `kid` (un solo secreto, p. ej. el generado por `pnpm setup:env`): kid `k0`.
      const sep = part.indexOf(':');
      const kid = sep > 0 ? part.slice(0, sep) : 'k0';
      const secret = sep > 0 ? part.slice(sep + 1) : part;
      if (!KID.test(kid) || secret.length < 32) {
        throw new Error('BFF_SESSION_ENC_KEY inválida: formato kid:secreto con secreto de ≥ 32 caracteres');
      }
      const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), HKDF_INFO, 32));
      return { kid, key };
    });
  if (keys.length === 0) throw new Error('BFF_SESSION_ENC_KEY: se requiere al menos una clave');
  if (new Set(keys.map((k) => k.kid)).size !== keys.length)
    throw new Error('BFF_SESSION_ENC_KEY: kid duplicado');
  return keys;
}

export class SessionCipher {
  private readonly current: SessionKey;
  private readonly byKid: ReadonlyMap<string, SessionKey>;

  constructor(keys: readonly SessionKey[]) {
    const [first] = keys;
    if (!first) throw new Error('SessionCipher requiere al menos una clave');
    this.current = first;
    this.byKid = new Map(keys.map((k) => [k.kid, k]));
  }

  encrypt(plain: string, aad: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const parts = ['v1', this.current.kid, iv, ct, cipher.getAuthTag()].map((p) =>
      typeof p === 'string' ? p : p.toString('base64url'),
    );
    return Buffer.from(parts.join('.'), 'utf8');
  }

  /** Lanza si el blob fue manipulado, se cifró con otra clave o con otro AAD. */
  decrypt(blob: Buffer, aad: string): string {
    const [v, kid, iv, ct, tag, ...rest] = blob.toString('utf8').split('.');
    const key = kid ? this.byKid.get(kid) : undefined;
    if (v !== 'v1' || !key || !iv || ct === undefined || !tag || rest.length > 0) {
      throw new Error('blob de sesión inválido');
    }
    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}

/** Identificador opaco de 256 bits para cookies (`__Host-pfos_sid`, `__Host-pfos_login`). */
export const newOpaqueId = (): string => randomBytes(32).toString('base64url');

/** En la base solo se guarda `sha256(sid)`: un volcado del almacén no permite reconstruir cookies. */
export const hashSid = (sid: string): Buffer => createHash('sha256').update(sid, 'utf8').digest();
