import { describe, expect, it } from 'vitest';
import {
  CredentialVault,
  credentialAad,
  maskedFingerprint,
} from '../../application/banking/credential-vault.js';
import {
  X25519CredentialKeyUnwrapper,
  X25519CredentialKeyWrapper,
  generateCredentialKeyPair,
  loadPrivateKeyring,
  nodeSymmetricCipher,
} from './x25519-key-wrapper.js';

const SECRET = { keyId: 'AKIA-TEST-0000-a1b2', secret: 'sk-test-super-secret-value-9f8e7d' };
const aad = credentialAad('w1', 'c1', 1);

function world() {
  const k1 = generateCredentialKeyPair();
  const k2 = generateCredentialKeyPair();
  const publicRing = (first: 'k1' | 'k2') =>
    first === 'k1' ? `k1:${k1.publicKey},k2:${k2.publicKey}` : `k2:${k2.publicKey},k1:${k1.publicKey}`;
  const privateRing = `k1:${k1.privateKey},k2:${k2.privateKey}`;
  return { k1, k2, publicRing, privateRing };
}

describe('CredentialVault (cifrado de sobre X25519 + HKDF + AES-256-GCM)', () => {
  it('[TC-IMPORTS-BANKING-007] cifra y descifra en el worker; el texto cifrado no contiene el secreto', () => {
    const w = world();
    const worker = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(w.publicRing('k1')),
      new X25519CredentialKeyUnwrapper(w.publicRing('k1'), w.privateRing),
    );
    const sealed = worker.seal(SECRET, aad);
    expect(sealed.kid).toBe('k1');
    const stored = Buffer.concat([sealed.ciphertext, sealed.wrappedDek, sealed.ephemeralPublicKey]).toString(
      'latin1',
    );
    expect(stored).not.toContain(SECRET.secret);
    expect(stored).not.toContain(SECRET.keyId);
    expect(worker.open(sealed, aad)).toEqual(SECRET);
    expect(maskedFingerprint(SECRET.keyId)).toBe('…a1b2');
  });

  it('[TC-IMPORTS-BANKING-008] la API (solo claves públicas) cifra pero no puede descifrar', () => {
    const w = world();
    const api = new CredentialVault(nodeSymmetricCipher, new X25519CredentialKeyWrapper(w.publicRing('k1')));
    expect(api.canDecrypt).toBe(false);
    const sealed = api.seal(SECRET, aad);
    expect(() => api.open(sealed, aad)).toThrowError(
      expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
    );
    // El worker con la privada sí descifra lo que cifró la API.
    const worker = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(w.publicRing('k1')),
      new X25519CredentialKeyUnwrapper(w.publicRing('k1'), w.privateRing),
    );
    expect(worker.open(sealed, aad).secret).toBe(SECRET.secret);
  });

  it('una credencial copiada a otra fila (otro AAD) no descifra', () => {
    const w = world();
    const vault = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(w.publicRing('k1')),
      new X25519CredentialKeyUnwrapper(w.publicRing('k1'), w.privateRing),
    );
    const sealed = vault.seal(SECRET, aad);
    expect(() => vault.open(sealed, credentialAad('w1', 'otra-conexion', 1))).toThrow();
    expect(() => vault.open(sealed, credentialAad('w2', 'c1', 1))).toThrow();
    expect(() => vault.open(sealed, credentialAad('w1', 'c1', 2))).toThrow();
  });

  it('[TC-IMPORTS-BANKING-015] la rotación vuelve a envolver la DEK con k2 sin descifrar el secreto', () => {
    const w = world();
    const onK1 = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(w.publicRing('k1')),
      new X25519CredentialKeyUnwrapper(w.publicRing('k1'), w.privateRing),
    );
    const sealed = onK1.seal(SECRET, aad);
    expect(sealed.kid).toBe('k1');
    const onK2 = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(w.publicRing('k2')),
      new X25519CredentialKeyUnwrapper(w.publicRing('k2'), w.privateRing),
    );
    const rewrapped = onK2.rewrap(sealed, aad);
    expect(rewrapped.kid).toBe('k2');
    // El texto cifrado del secreto no cambia: solo la envoltura de la DEK.
    const migrated = { ...sealed, ...rewrapped };
    expect(Buffer.from(migrated.ciphertext).equals(Buffer.from(sealed.ciphertext))).toBe(true);
    // k1 se puede retirar: el llavero solo con k2 sigue descifrando.
    const onlyK2 = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(`k2:${w.k2.publicKey}`),
      new X25519CredentialKeyUnwrapper(`k2:${w.k2.publicKey}`, `k2:${w.k2.privateKey}`),
    );
    expect(onlyK2.open(migrated, aad)).toEqual(SECRET);
  });

  it('[TC-IMPORTS-BANKING-016] un kid ausente del llavero no se puede desenvolver (hasKey = false)', () => {
    const w = world();
    const sealed = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(`k0:${w.k1.publicKey}`),
    ).seal(SECRET, aad);
    const worker = new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(`k1:${w.k1.publicKey}`),
      new X25519CredentialKeyUnwrapper(`k1:${w.k1.publicKey}`, `k1:${w.k1.privateKey}`),
    );
    expect(worker.hasKey(sealed.kid)).toBe(false);
    expect(() => worker.open(sealed, aad)).toThrow(/not available/);
  });

  it('vector fijo propio: una credencial sellada con claves de PRUEBA conocidas se descifra siempre igual', () => {
    // Claves de prueba generadas solo para este vector (no son de ningún entorno).
    const publicKey = 'GLrfikq3zriHSYMjG-5hEWZFy6cOAb6pmuBMgjhnWQ4';
    const privateKey = 'INa6wCFYOLGTwOfSqLGVXaIR_YBXz_C5GBycv6UTB3M';
    const hex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
    const unwrapper = new X25519CredentialKeyUnwrapper(`v:${publicKey}`, `v:${privateKey}`);
    const vault = new CredentialVault(nodeSymmetricCipher, unwrapper, unwrapper);
    const sealed = {
      kid: 'v',
      ephemeralPublicKey: hex('db8317f6678ae8ca54c8bded144b127b8b865d876c3f21348399ddb1b492d11e'),
      wrappedDek: hex(
        'bc922e38f092be99d15c99f3b9c8f90d8b087d5c5bad3f7ca0336b8b264a52ec0ef70d3a3c1ca0ec0804f6f0d75cf7f7',
      ),
      dekNonce: hex('3043c06e8472851586df0a82'),
      ciphertext: hex(
        '0d8e7180d4630738811711a1a3d5b67dd4b0ae0c961730e88cd693eac03516f1b9224fc087add90f8232ebe4e71eabca038b3924762f32c30b9bd5e77693943404f7ccdbf8db32155f9a5b6570ad40d57c5482',
      ),
      nonce: hex('00587a2e7b0276d43385d540'),
    };
    expect(vault.open(sealed, aad)).toEqual(SECRET);
    expect(() => vault.open(sealed, credentialAad('w1', 'c2', 1))).toThrow();
  });

  it('un par de claves mal formado se rechaza', () => {
    expect(() => new X25519CredentialKeyWrapper('k1:corta')).toThrow(/32 bytes/);
    expect(() => new X25519CredentialKeyWrapper('')).toThrow(/at least one/);
  });

  it('D342: la clave privada sale de un archivo; en staging/producción la variable en claro se rechaza', () => {
    expect(loadPrivateKeyring({ file: undefined, inline: undefined, environment: 'production' })).toBeNull();
    expect(loadPrivateKeyring({ file: undefined, inline: 'k1:x', environment: 'ci' })).toBe('k1:x');
    expect(() => loadPrivateKeyring({ file: undefined, inline: 'k1:x', environment: 'production' })).toThrow(
      /only allowed in local and ci/,
    );
  });
});
