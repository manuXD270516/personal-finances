import { DomainError } from '@pf/shared-kernel';

/**
 * `CredentialVault` (openspec add-banking-providers decisión 3): cifrado de sobre de las credenciales de un
 * proveedor. Una clave de datos (DEK) aleatoria por credencial cifra el secreto con AES-256-GCM; la DEK se envuelve
 * con una clave maestra identificada (`kid`) mediante el puerto `CredentialKeyWrapper`. La API solo tiene la clave
 * PÚBLICA (puede cifrar, no descifrar); el worker, que sincroniza, tiene la privada.
 *
 * El AAD ata el texto cifrado a `workspace_id | connection_id | credential_version`: una credencial copiada a otra fila
 * no descifra. El secreto NUNCA sale de este módulo hacia respuestas, logs, errores, auditoría ni export.
 */

/** Sobre de una DEK envuelta con la clave maestra `kid`. */
export interface WrappedDek {
  readonly kid: string;
  readonly ephemeralPublicKey: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly dekNonce: Uint8Array;
}

/** Puerto de envoltura (X25519 + HKDF + AES-256-GCM hoy; KMS en Phase 9). Sin la privada, `unwrap` no existe. */
export interface CredentialKeyWrapper {
  readonly activeKid: string;
  wrap(dek: Uint8Array, aad: Uint8Array): WrappedDek;
}

export interface CredentialKeyUnwrapper extends CredentialKeyWrapper {
  hasKey(kid: string): boolean;
  unwrap(wrapped: WrappedDek, aad: Uint8Array): Uint8Array;
  /** Vuelve a envolver con la clave vigente SIN conocer el secreto. */
  rewrap(wrapped: WrappedDek, oldAad: Uint8Array): WrappedDek;
}

export interface SealedCredential extends WrappedDek {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
}

/** Contenido de una credencial: identificador público de la clave y su secreto. */
export interface CredentialSecret {
  readonly keyId: string;
  readonly secret: string;
}

export interface SymmetricCipher {
  randomBytes(n: number): Uint8Array;
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array;
  open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array;
}

export const credentialAad = (workspaceId: string, connectionId: string, version: number): Uint8Array =>
  new TextEncoder().encode(`${workspaceId}|${connectionId}|${version}`);

/** Huella enmascarada que la API puede mostrar: los últimos 4 caracteres del identificador de la clave. */
export const maskedFingerprint = (keyId: string): string => `…${keyId.slice(-4)}`;

export class CredentialVault {
  constructor(
    private readonly cipher: SymmetricCipher,
    /** `null` ⇒ el módulo de conexiones está deshabilitado (sin claves `CONNECTION_CREDENTIALS_*`). */
    private readonly wrapper: CredentialKeyWrapper | null,
    /** Solo el worker. */
    private readonly unwrapper: CredentialKeyUnwrapper | null = null,
  ) {}

  get canEncrypt(): boolean {
    return this.wrapper !== null;
  }

  get canDecrypt(): boolean {
    return this.unwrapper !== null;
  }

  get activeKid(): string {
    return (this.wrapper ?? this.unwrapper)?.activeKid ?? '';
  }

  hasKey(kid: string): boolean {
    return this.unwrapper?.hasKey(kid) ?? false;
  }

  seal(secret: CredentialSecret, aad: Uint8Array): SealedCredential {
    if (!this.wrapper) {
      throw new DomainError('SERVICE_UNAVAILABLE', 'provider connections are not enabled');
    }
    const dek = this.cipher.randomBytes(32);
    const nonce = this.cipher.randomBytes(12);
    const plaintext = new TextEncoder().encode(JSON.stringify({ k: secret.keyId, s: secret.secret }));
    const ciphertext = this.cipher.seal(dek, nonce, plaintext, aad);
    plaintext.fill(0);
    const wrapped = this.wrapper.wrap(dek, aad);
    dek.fill(0);
    return { ...wrapped, ciphertext, nonce };
  }

  /** Solo en el worker: descifra en memoria; el llamador no debe conservar ni registrar el resultado. */
  open(sealed: SealedCredential, aad: Uint8Array): CredentialSecret {
    if (!this.unwrapper) {
      throw new DomainError('SERVICE_UNAVAILABLE', 'this process cannot decrypt provider credentials');
    }
    const dek = this.unwrapper.unwrap(sealed, aad);
    try {
      const plaintext = this.cipher.open(dek, sealed.nonce, sealed.ciphertext, aad);
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { k: string; s: string };
      plaintext.fill(0);
      return { keyId: parsed.k, secret: parsed.s };
    } finally {
      dek.fill(0);
    }
  }

  /** Rotación: vuelve a envolver la DEK con la clave vigente sin descifrar el secreto. */
  rewrap(sealed: WrappedDek, aad: Uint8Array): WrappedDek {
    if (!this.unwrapper) {
      throw new DomainError('SERVICE_UNAVAILABLE', 'this process cannot rewrap provider credentials');
    }
    return this.unwrapper.rewrap(sealed, aad);
  }
}
