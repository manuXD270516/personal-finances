import { createCipheriv, createHash } from 'node:crypto';

/**
 * ¿El PDF cifrado exige contraseña de usuario para abrirse? (D319: se rechazan los que sí; los que solo tienen
 * contraseña de propietario —permisos— se aceptan.) Implementa los algoritmos de autenticación de la contraseña de
 * usuario VACÍA del manejador estándar (ISO 32000-1 §7.6.3 R2–R4; ISO 32000-2 §7.6.4.3 R5–R6). No descifra contenido.
 */
export interface PdfEncryptionParams {
  readonly filter: string;
  readonly v: number;
  readonly r: number;
  readonly o: Buffer;
  readonly u: Buffer;
  readonly p: number;
  /** Longitud de la clave en bits (por omisión 40). */
  readonly lengthBits: number;
  readonly encryptMetadata: boolean;
  /** Primer elemento de `/ID` (vacío si falta). */
  readonly id0: Buffer;
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');

const md5 = (...parts: Buffer[]): Buffer => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
};

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k += 1) {
    a = (a + 1) & 0xff;
    b = (b + s[a]!) & 0xff;
    [s[a], s[b]] = [s[b]!, s[a]!];
    out[k] = data[k]! ^ s[(s[a]! + s[b]!) & 0xff]!;
  }
  return out;
}

/** Clave de cifrado con contraseña vacía (Algoritmo 2). */
function keyForEmptyPassword(p: PdfEncryptionParams): Buffer {
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p.p | 0, 0);
  const parts: Buffer[] = [PAD, p.o.subarray(0, 32), pBytes, p.id0];
  if (p.r >= 4 && !p.encryptMetadata) parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  let hash = md5(...parts);
  const n = p.r === 2 ? 5 : Math.max(5, Math.min(16, Math.floor(p.lengthBits / 8)));
  if (p.r >= 3) for (let i = 0; i < 50; i += 1) hash = md5(hash.subarray(0, n));
  return hash.subarray(0, n);
}

/** Valor `/U` esperado para la contraseña vacía en R2–R4 (Algoritmos 4 y 5); en R3–R4 solo los primeros 16 bytes. */
export function expectedUserEntryLegacy(p: PdfEncryptionParams): Buffer {
  const key = keyForEmptyPassword(p);
  if (p.r === 2) return rc4(key, PAD);
  let x = rc4(key, md5(PAD, p.id0));
  for (let i = 1; i <= 19; i += 1) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  return x;
}

/** Algoritmo 2.B (R6): hash reforzado. Con `userBytes` vacío para la comprobación de la contraseña de usuario. */
export function hashR6(password: Buffer, salt: Buffer, userBytes: Buffer): Buffer {
  let k = createHash('sha256').update(password).update(salt).update(userBytes).digest();
  let e = Buffer.alloc(1);
  for (let i = 0; i < 64 || e[e.length - 1]! > i - 32; i += 1) {
    const block = Buffer.concat([password, k, userBytes]);
    const repeated = Buffer.concat(Array.from({ length: 64 }, () => block));
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    e = Buffer.concat([cipher.update(repeated), cipher.final()]);
    let sum = 0;
    for (let b = 0; b < 16; b += 1) sum += e[b]!;
    const algo = ['sha256', 'sha384', 'sha512'][sum % 3]!;
    k = createHash(algo).update(e).digest();
  }
  return k.subarray(0, 32);
}

export function hashR5(password: Buffer, salt: Buffer): Buffer {
  return createHash('sha256').update(password).update(salt).digest();
}

/** `true` si la contraseña de usuario vacía abre el documento (solo contraseña de propietario). */
export function opensWithEmptyUserPassword(p: PdfEncryptionParams): boolean {
  if (p.filter !== 'Standard') return false;
  if (p.r >= 5) {
    if (p.u.length < 48) return false;
    const validationSalt = p.u.subarray(32, 40);
    const expected =
      p.r === 5
        ? hashR5(Buffer.alloc(0), validationSalt)
        : hashR6(Buffer.alloc(0), validationSalt, Buffer.alloc(0));
    return expected.equals(p.u.subarray(0, 32));
  }
  if (p.r < 2 || p.u.length < 16) return false;
  const expected = expectedUserEntryLegacy(p);
  const len = p.r === 2 ? 32 : 16;
  return p.u.length >= len && expected.subarray(0, len).equals(p.u.subarray(0, len));
}
