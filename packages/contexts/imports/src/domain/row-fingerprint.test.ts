import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  descriptionKey,
  occurrenceIndexes,
  rowFingerprint,
  type FingerprintInput,
  type FingerprintTuple,
} from './row-fingerprint.js';
import { sha256Hex } from './sha256.js';

const BASE: FingerprintInput = {
  workspaceId: '00000000-0000-7000-8000-000000000001',
  accountId: '00000000-0000-7000-8000-0000000000a1',
  bookingDate: '2026-10-02',
  signedAmount: '-18.00',
  currency: 'BOB',
  description: 'PAGO QR CAFÉ',
  occurrenceIndex: 0,
};

describe('sha256 puro', () => {
  it('vectores del estándar', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('bloques en el borde del relleno (55, 56, 63, 64 y 65 bytes)', () => {
    const expected: Record<number, string> = {
      55: '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
      56: 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
      63: '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34',
      64: 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
      65: '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0',
    };
    for (const [n, digest] of Object.entries(expected)) expect(sha256Hex('a'.repeat(Number(n)))).toBe(digest);
  });
});

describe('descriptionKey', () => {
  it('minúsculas, sin acentos, espacios colapsados y sin tarjeta enmascarada', () => {
    expect(descriptionKey('  PAGO   QR  CAFÉ ')).toBe('pago qr cafe');
    expect(descriptionKey('COMPRA **** **** **** 1234 TIENDA')).toBe('compra tienda');
    expect(descriptionKey('COMPRA XXXX-5678 TIENDA')).toBe('compra tienda');
    expect(descriptionKey('PAGO **** **** **** 1234')).toBe('pago');
    expect(descriptionKey('maxx 1234')).toBe('maxx 1234');
    expect(descriptionKey(null)).toBe('');
  });

  it('una descripción hostil de miles de marcas se procesa en tiempo lineal (sin ReDoS)', () => {
    const started = Date.now();
    for (const hostile of [
      'x'.repeat(20_000),
      `${'* '.repeat(5000)}!`,
      `${'x-'.repeat(5000)}z`,
      'X'.repeat(560),
    ]) {
      descriptionKey(hostile);
    }
    expect(Date.now() - started).toBeLessThan(500);
  }, 10_000);
});

describe('occurrenceIndexes', () => {
  it('[TC-IMPORTS-CSV-018] dos compras idénticas el mismo día tienen índices 0 y 1', () => {
    const rows = [
      { bookingDate: '2026-10-01', signedAmount: '-245.30', description: 'COMPRA SUPERMERCADO' },
      { bookingDate: '2026-10-02', signedAmount: '-18.00', description: 'PAGO QR CAFÉ' },
      { bookingDate: '2026-10-02', signedAmount: '-18.00', description: 'Pago QR Cafe' },
      { bookingDate: '2026-10-05', signedAmount: '8000.00', description: 'ABONO SUELDO' },
    ];
    expect(occurrenceIndexes(rows)).toEqual([0, 0, 1, 0]);
  });
});

describe('rowFingerprint', () => {
  it('es determinista, de 64 hex y sensible a cada componente', () => {
    const f = rowFingerprint(BASE);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(rowFingerprint({ ...BASE })).toBe(f);
    const variants: Partial<FingerprintInput>[] = [
      { workspaceId: '00000000-0000-7000-8000-000000000002' },
      { accountId: '00000000-0000-7000-8000-0000000000a2' },
      { bookingDate: '2026-10-03' },
      { signedAmount: '-18.01' },
      { currency: 'USD' },
      { description: 'OTRO' },
      { occurrenceIndex: 1 },
      { externalId: 'fitid-1' },
    ];
    for (const v of variants) expect(rowFingerprint({ ...BASE, ...v })).not.toBe(f);
  });

  it('la descripción se compara normalizada (acentos, mayúsculas, espacios)', () => {
    expect(rowFingerprint({ ...BASE, description: '  pago qr   cafe' })).toBe(rowFingerprint(BASE));
  });

  it('[TC-IMPORTS-CSV-016] PBT: el multiconjunto de huellas no depende del orden de filas no idénticas', () => {
    const row = fc.record({
      bookingDate: fc.constantFrom('2026-10-01', '2026-10-02', '2026-10-03'),
      signedAmount: fc.constantFrom('-18.00', '-245.30', '8000.00'),
      description: fc.constantFrom('A', 'B', 'C', null),
    });
    const fingerprints = (list: readonly FingerprintTuple[]) => {
      const idx = occurrenceIndexes(list);
      return list.map((r, i) => rowFingerprint({ ...BASE, ...r, occurrenceIndex: idx[i] as number }));
    };
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 12 }), (rows) => {
        // Ordenar por tupla es un reordenamiento estable: las filas idénticas conservan su orden relativo.
        const sorted = [...rows].sort((a, b) =>
          (a.bookingDate + a.signedAmount + String(a.description)).localeCompare(
            b.bookingDate + b.signedAmount + String(b.description),
          ),
        );
        expect([...fingerprints(sorted)].sort()).toEqual([...fingerprints(rows)].sort());
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
