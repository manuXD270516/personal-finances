import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { proposalFingerprint, sha256Hex } from '../domain/index.js';

const reference = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('SHA-256 puro del dominio', () => {
  it('[TC-RULES-SUGGEST-007] coincide con node:crypto, también con acentos y en varios bloques', () => {
    for (const text of [
      '',
      'abc',
      'v1|DESCRIPTION|café con leche|EXPENSE|x',
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'ñ'.repeat(200),
    ]) {
      expect(sha256Hex(text), text.slice(0, 20)).toBe(reference(text));
    }
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => sha256Hex(text) === reference(text)),
      { numRuns: 200 },
    );
  }, 60_000);

  it('[TC-RULES-SUGGEST-007] la huella es el SHA-256 de v1|tipo|valor|kind|categoría', () => {
    const pattern = {
      type: 'DESCRIPTION',
      value: 'tigo money recarga',
      kind: 'EXPENSE',
      categoryId: 'cat-tel',
    } as const;
    expect(proposalFingerprint(pattern)).toBe(reference('v1|DESCRIPTION|tigo money recarga|EXPENSE|cat-tel'));
  });
});
