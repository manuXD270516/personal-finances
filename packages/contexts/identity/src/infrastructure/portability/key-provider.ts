import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ExportKeyProvider, WrappedDataKey } from '../../application/portability/ports.js';
import { DATA_KEY_BYTES } from './envelope.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Clave maestra desconocida o envoltorio que no autentica (clave equivocada o fila alterada). */
export class KeyUnwrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyUnwrapError';
  }
}

/**
 * Llavero local de CLAVES MAESTRAS (`EXPORT_ENCRYPTION_KEYS` = `kid:clave[,kid:clave…]`, clave de 32 bytes en
 * base64url; la vigente es `EXPORT_ENCRYPTION_ACTIVE_KEY_ID` o, sin ella, la primera). Cifrado de sobre: la clave de
 * datos de cada archivo se envuelve con AES-256-GCM bajo la clave maestra, con el contexto del export (workspace y
 * export) como AAD, de modo que un envoltorio copiado a otra fila no descifra. Rotación: una clave nueva pasa a ser la
 * vigente y las anteriores permanecen en el llavero mientras existan exports envueltos con ellas (≤ retención).
 *
 * Adapter para cloud (KMS `GenerateDataKey`/`Decrypt`): mismo puerto `ExportKeyProvider`; se cablea con el change de
 * despliegue cloud (pendiente, design § Riesgos).
 */
export class LocalKeyringProvider implements ExportKeyProvider {
  private readonly keys = new Map<string, Buffer>();
  readonly activeKeyId: string;

  constructor(spec: string, activeKeyId?: string) {
    for (const entry of spec.split(',')) {
      const cut = entry.indexOf(':');
      const id = entry.slice(0, cut);
      const raw = entry.slice(cut + 1);
      // 32 bytes en hexadecimal (64 caracteres, `openssl rand -hex 32`) o en base64url (43 caracteres).
      const key = /^[0-9a-f]{64}$/u.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64url');
      if (id.length === 0 || key.length !== DATA_KEY_BYTES) {
        throw new Error(
          'EXPORT_ENCRYPTION_KEYS: cada clave maestra debe ser de 32 bytes (base64url o hexadecimal)',
        );
      }
      this.keys.set(id, key);
    }
    const first = this.keys.keys().next().value as string | undefined;
    const active = activeKeyId ?? first;
    if (!active || !this.keys.has(active)) {
      throw new Error('EXPORT_ENCRYPTION_ACTIVE_KEY_ID no figura en EXPORT_ENCRYPTION_KEYS');
    }
    this.activeKeyId = active;
  }

  /** Identificadores presentes en el llavero (para diagnósticos; nunca las claves). */
  keyIds(): string[] {
    return [...this.keys.keys()];
  }

  async wrap(dataKey: Buffer, context: string): Promise<WrappedDataKey> {
    const master = this.keys.get(this.activeKeyId) as Buffer;
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', master, nonce);
    cipher.setAAD(Buffer.from(`${this.activeKeyId}|${context}`, 'utf8'));
    const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { keyId: this.activeKeyId, wrappedKey: Buffer.concat([nonce, body, cipher.getAuthTag()]) };
  }

  async unwrap(wrapped: WrappedDataKey, context: string): Promise<Buffer> {
    const master = this.keys.get(wrapped.keyId);
    if (!master) throw new KeyUnwrapError(`la clave maestra ${wrapped.keyId} ya no figura en el llavero`);
    const raw = wrapped.wrappedKey;
    if (raw.length !== NONCE_BYTES + DATA_KEY_BYTES + TAG_BYTES)
      throw new KeyUnwrapError('envoltorio inválido');
    try {
      const decipher = createDecipheriv('aes-256-gcm', master, raw.subarray(0, NONCE_BYTES));
      decipher.setAAD(Buffer.from(`${wrapped.keyId}|${context}`, 'utf8'));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new KeyUnwrapError('el envoltorio de la clave de datos no autentica');
    }
  }
}
