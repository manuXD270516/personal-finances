import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type {
  CredentialKeyUnwrapper,
  CredentialKeyWrapper,
  SymmetricCipher,
  WrappedDek,
} from '../../application/banking/credential-vault.js';

/**
 * Envoltura de la clave de datos con X25519 + HKDF-SHA256 + AES-256-GCM (openspec add-banking-providers decisión 3,
 * opción b): la API conoce solo las claves PÚBLICAS (`CONNECTION_CREDENTIALS_PUBLIC_KEYS`, `kid:clave`, la primera es
 * la vigente); solo el worker tiene las privadas (D342: archivo montado con permisos 0400 fuera del repositorio,
 * `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE`; en local/ci también la variable `CONNECTION_CREDENTIALS_PRIVATE_KEYS`).
 * Cada envoltura usa un par efímero nuevo: la DEK queda atada al destinatario y al AAD.
 */

const INFO = 'pfos.connection-credential.v1';
// Prefijos DER fijos de X25519 (RFC 8410) para importar claves crudas de 32 bytes.
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

export const nodeSymmetricCipher: SymmetricCipher = {
  randomBytes: (n) => new Uint8Array(randomBytes(n)),
  seal(key, nonce, plaintext, aad) {
    const c = createCipheriv('aes-256-gcm', key, nonce);
    c.setAAD(aad);
    const body = Buffer.concat([c.update(plaintext), c.final()]);
    return new Uint8Array(Buffer.concat([body, c.getAuthTag()]));
  },
  open(key, nonce, sealed, aad) {
    const d = createDecipheriv('aes-256-gcm', key, nonce);
    d.setAAD(aad);
    d.setAuthTag(Buffer.from(sealed.subarray(sealed.length - 16)));
    return new Uint8Array(Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]));
  },
};

const b64 = (s: string): Buffer => Buffer.from(s, 'base64url');

function parseKeyring(source: string): Map<string, Buffer> {
  const ring = new Map<string, Buffer>();
  for (const part of source.split(/[,\n]/)) {
    const entry = part.trim();
    if (entry === '') continue;
    const i = entry.indexOf(':');
    if (i < 1) throw new Error('credential key ring entries must be kid:key');
    const raw = b64(entry.slice(i + 1));
    if (raw.length !== 32) throw new Error('credential keys must be 32 bytes (base64url)');
    ring.set(entry.slice(0, i), raw);
  }
  return ring;
}

const publicKeyOf = (raw: Buffer): KeyObject =>
  createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
const privateKeyOf = (raw: Buffer): KeyObject =>
  createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });

function rawPublic(key: KeyObject): Buffer {
  return Buffer.from(key.export({ format: 'der', type: 'spki' })).subarray(SPKI_PREFIX.length);
}

function wrapKey(shared: Buffer, ephemeralPublic: Buffer, recipientPublic: Buffer, kid: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', shared, Buffer.concat([ephemeralPublic, recipientPublic]), `${INFO}|${kid}`, 32),
  );
}

/** Envuelve con la clave pública vigente (API y worker). */
export class X25519CredentialKeyWrapper implements CredentialKeyWrapper {
  protected readonly publicKeys: ReadonlyMap<string, Buffer>;
  readonly activeKid: string;

  constructor(publicKeys: string) {
    this.publicKeys = parseKeyring(publicKeys);
    const first = [...this.publicKeys.keys()][0];
    if (first === undefined) throw new Error('at least one credential public key is required');
    this.activeKid = first;
  }

  wrap(dek: Uint8Array, aad: Uint8Array): WrappedDek {
    return this.wrapWith(this.activeKid, dek, aad);
  }

  protected wrapWith(kid: string, dek: Uint8Array, aad: Uint8Array): WrappedDek {
    const recipient = this.publicKeys.get(kid);
    if (!recipient) throw new Error('unknown credential key id');
    const ephemeral = generateKeyPairSync('x25519');
    const ephemeralPublic = rawPublic(ephemeral.publicKey);
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyOf(recipient) });
    const key = wrapKey(shared, ephemeralPublic, recipient, kid);
    const nonce = randomBytes(12);
    const wrapped = nodeSymmetricCipher.seal(key, nonce, dek, aad);
    key.fill(0);
    return {
      kid,
      ephemeralPublicKey: new Uint8Array(ephemeralPublic),
      wrappedDek: wrapped,
      dekNonce: new Uint8Array(nonce),
    };
  }
}

/** Solo el worker: añade las claves privadas (desenvolver y re-envolver). */
export class X25519CredentialKeyUnwrapper
  extends X25519CredentialKeyWrapper
  implements CredentialKeyUnwrapper
{
  private readonly privateKeys: ReadonlyMap<string, Buffer>;

  constructor(publicKeys: string, privateKeys: string) {
    super(publicKeys);
    this.privateKeys = parseKeyring(privateKeys);
  }

  hasKey(kid: string): boolean {
    return this.privateKeys.has(kid);
  }

  unwrap(wrapped: WrappedDek, aad: Uint8Array): Uint8Array {
    const priv = this.privateKeys.get(wrapped.kid);
    if (!priv) throw new Error('credential key id not available in this process');
    const privateKey = privateKeyOf(priv);
    const recipientPublic = rawPublic(createPublicKey(privateKey));
    const shared = diffieHellman({
      privateKey,
      publicKey: publicKeyOf(Buffer.from(wrapped.ephemeralPublicKey)),
    });
    const key = wrapKey(shared, Buffer.from(wrapped.ephemeralPublicKey), recipientPublic, wrapped.kid);
    try {
      return nodeSymmetricCipher.open(key, wrapped.dekNonce, wrapped.wrappedDek, aad);
    } finally {
      key.fill(0);
    }
  }

  rewrap(wrapped: WrappedDek, aad: Uint8Array): WrappedDek {
    const dek = this.unwrap(wrapped, aad);
    try {
      return this.wrap(dek, aad);
    } finally {
      dek.fill(0);
    }
  }
}

/** Par de claves nuevo (herramienta de desarrollo y tests; `pnpm setup:env` lo usa para los valores de desarrollo). */
export function generateCredentialKeyPair(): { readonly publicKey: string; readonly privateKey: string } {
  const pair = generateKeyPairSync('x25519');
  const priv = Buffer.from(pair.privateKey.export({ format: 'der', type: 'pkcs8' })).subarray(
    PKCS8_PREFIX.length,
  );
  return {
    publicKey: rawPublic(pair.publicKey).toString('base64url'),
    privateKey: priv.toString('base64url'),
  };
}

/**
 * Lee las claves privadas del worker (D342): del archivo montado (permisos 0400 o más estrictos fuera de Windows) o,
 * solo en local/ci, de la variable. Devuelve `null` si no hay ninguna (el worker no puede descifrar).
 */
export function loadPrivateKeyring(input: {
  readonly file: string | undefined;
  readonly inline: string | undefined;
  readonly environment: string;
}): string | null {
  if (input.file) {
    if (process.platform !== 'win32') {
      const mode = statSync(input.file).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new Error('CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE must have permissions 0400');
      }
    }
    return readFileSync(input.file, 'utf8');
  }
  if (input.inline) {
    if (input.environment === 'staging' || input.environment === 'production') {
      throw new Error(
        'CONNECTION_CREDENTIALS_PRIVATE_KEYS is only allowed in local and ci (use the key file)',
      );
    }
    return input.inline;
  }
  return null;
}
