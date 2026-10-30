import { Readable } from 'node:stream';
import {
  DecryptStream,
  EnvelopeIntegrityError,
  KeyUnwrapError,
  encryptEnvelope,
  newDataKey,
  type LocalKeyringProvider,
} from '@pf/platform/crypto';
import { DocumentIntegrityError } from '../contracts/index.js';
import type { DocumentCipher } from '../application/ports/index.js';

/**
 * Cifrado de sobre de documentos (D313; design decisión 6): formato `PFXE` v1 de `@pf/platform/crypto` con una clave
 * de datos por documento, envuelta con la clave maestra activa del llavero `DOCUMENT_ENCRYPTION_KEYS` y con el contexto
 * `documents:{workspaceId}:{documentId}` como dato autenticado (un envoltorio copiado a otra fila no descifra).
 */
export class EnvelopeDocumentCipher implements DocumentCipher {
  constructor(private readonly keyring: LocalKeyringProvider) {}

  get activeKeyId(): string {
    return this.keyring.activeKeyId;
  }

  keyIds(): readonly string[] {
    return this.keyring.keyIds();
  }

  async seal(plain: Buffer, context: string) {
    const dataKey = newDataKey();
    const wrapped = await this.keyring.wrap(dataKey, context);
    return {
      encrypted: encryptEnvelope(plain, dataKey),
      keyId: wrapped.keyId,
      wrappedKey: wrapped.wrappedKey,
    };
  }

  async open(
    encrypted: Readable,
    wrapped: { keyId: string; wrappedKey: Uint8Array },
    context: string,
  ): Promise<Readable> {
    let dataKey: Buffer;
    try {
      dataKey = await this.keyring.unwrap(wrapped, context);
    } catch (err) {
      encrypted.destroy();
      throw new DocumentIntegrityError(err instanceof KeyUnwrapError ? err.message : 'key unavailable');
    }
    const decrypt = new DecryptStream(dataKey);
    encrypted.on('error', (err) => decrypt.destroy(err));
    encrypted.pipe(decrypt);
    // Cada bloque se valida ANTES de emitirse; los errores del flujo se traducen al error público del contrato.
    async function* verified(): AsyncGenerator<Buffer> {
      try {
        for await (const chunk of decrypt) yield chunk as Buffer;
      } catch (err) {
        encrypted.destroy();
        throw err instanceof EnvelopeIntegrityError
          ? new DocumentIntegrityError(err.message)
          : new DocumentIntegrityError('the stored object could not be read');
      }
    }
    return Readable.from(verified(), { objectMode: false });
  }

  async rewrap(wrapped: { keyId: string; wrappedKey: Uint8Array }, context: string) {
    const dataKey = await this.keyring.unwrap(wrapped, context);
    return this.keyring.wrap(dataKey, context);
  }
}
