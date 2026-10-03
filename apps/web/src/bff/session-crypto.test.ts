import { describe, expect, it } from 'vitest';
import { SessionCipher, hashSid, newOpaqueId, parseSessionKeys } from './session-crypto';

// Token de forma JWT armado en tiempo de ejecución: no es un secreto y así no dispara gitleaks.
const b64url = (value: string): string => Buffer.from(value).toString('base64url');
const ACCESS = [b64url('{"alg":"RS256"}'), b64url('{"sub":"kc-0001"}'), b64url('signature')].join('.');

describe('cifrado de sesiones del BFF (AES-256-GCM)', () => {
  const cipher = new SessionCipher(parseSessionKeys(`k2:${'b'.repeat(32)},k1:${'a'.repeat(32)}`));

  it('[TC-IDENTITY-AUTH-003] el blob no contiene el token en claro y solo descifra con el mismo AAD', () => {
    const blob = cipher.encrypt(JSON.stringify({ accessToken: ACCESS }), 'session-1:tokens');
    const text = blob.toString('utf8');
    expect(text.startsWith('v1.k2.')).toBe(true);
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain('eyJ');
    expect(JSON.parse(cipher.decrypt(blob, 'session-1:tokens'))).toEqual({ accessToken: ACCESS });
    expect(() => cipher.decrypt(blob, 'session-2:tokens')).toThrow();
    const parts = text.split('.');
    parts[3] = (parts[3]!.startsWith('A') ? 'B' : 'A') + parts[3]!.slice(1); // altera el ciphertext
    const tampered = Buffer.from(parts.join('.'), 'utf8');
    expect(() => cipher.decrypt(tampered, 'session-1:tokens')).toThrow();
  });

  it('rotación por kid: una clave anterior sigue descifrando; una clave retirada no', () => {
    const old = new SessionCipher(parseSessionKeys(`k1:${'a'.repeat(32)}`));
    const blob = old.encrypt('secreto', 'aad');
    expect(cipher.decrypt(blob, 'aad')).toBe('secreto');
    const retired = new SessionCipher(parseSessionKeys(`k2:${'b'.repeat(32)}`));
    expect(() => retired.decrypt(blob, 'aad')).toThrow();
  });

  it('claves mal formadas se rechazan; el sid es opaco de 256 bits y en la base solo va su sha256', () => {
    expect(() => parseSessionKeys('k1:corta')).toThrow();
    expect(parseSessionKeys('s'.repeat(32))[0]?.kid).toBe('k0');
    expect(() => parseSessionKeys(`k1:${'a'.repeat(32)},k1:${'b'.repeat(32)}`)).toThrow();
    const sid = newOpaqueId();
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSid(sid)).toHaveLength(32);
    expect(hashSid(sid).toString('hex')).not.toContain(Buffer.from(sid).toString('hex'));
  });
});
