import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IdRemap, isUuid, uuidV7At, uuidV7Millis } from './id-remap.js';

const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const remap = () => new IdRemap(rand, () => 1_790_000_000_000);
const uuidV7 = fc
  .tuple(
    fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
    fc.uint8Array({ minLength: 10, maxLength: 10 }),
  )
  .map(([ms, bytes]) => uuidV7At(ms, bytes));

describe('IdRemap (dominio IDENTITY)', () => {
  it('[TC-IDENTITY-RESTORE-001] un id nuevo es UUIDv7, distinto del original y conserva su instante', () => {
    fc.assert(
      fc.property(uuidV7, (old) => {
        const r = remap();
        const fresh = r.assign(old);
        expect(isUuid(fresh)).toBe(true);
        expect(fresh).not.toBe(old);
        expect(uuidV7Millis(fresh)).toBe(uuidV7Millis(old));
        expect(r.assign(old)).toBe(fresh);
        expect(r.assign(old.toUpperCase())).toBe(fresh);
      }),
    );
  });

  it('[TC-IDENTITY-RESTORE-001] ids no v7 reciben un instante de respaldo y dos ids nunca colisionan', () => {
    const r = remap();
    const legacy = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(uuidV7Millis(legacy)).toBeNull();
    expect(uuidV7Millis(r.assign(legacy))).toBe(1_790_000_000_000);
    fc.assert(
      fc.property(fc.uniqueArray(uuidV7, { minLength: 2, maxLength: 40 }), (ids) => {
        const rr = remap();
        const fresh = ids.map((i) => rr.assign(i));
        expect(new Set(fresh).size).toBe(ids.length);
        expect(fresh.some((f) => ids.includes(f))).toBe(false);
      }),
    );
  });

  it('[TC-IDENTITY-RESTORE-005] reescribe UUID en estructuras JSON anidadas (valores, claves y texto) sin tocar los ajenos', () => {
    fc.assert(
      fc.property(uuidV7, uuidV7, (mapped, foreign) => {
        fc.pre(mapped !== foreign);
        const r = remap();
        const fresh = r.assign(mapped);
        const input = {
          [mapped]: [
            { ref: mapped, ajeno: foreign, link: `/accounts/${mapped}/edit`, n: 3, ok: true, none: null },
          ],
          money: { amount: '45.90', currency: 'BOB' },
        };
        const out = r.replaceDeep(input);
        expect(out).toEqual({
          [fresh]: [
            { ref: fresh, ajeno: foreign, link: `/accounts/${fresh}/edit`, n: 3, ok: true, none: null },
          ],
          money: { amount: '45.90', currency: 'BOB' },
        });
        // El original no se muta y la reescritura es una función pura del mapa.
        expect(JSON.stringify(input)).toContain(mapped);
        expect(r.replaceDeep(out)).toEqual(out);
      }),
    );
  });

  it('set fija correspondencias explícitas (workspace de origen → workspace nuevo)', () => {
    const r = remap();
    r.set('0190a000-0000-7000-8000-0000000000a1', '0190b000-0000-7000-8000-0000000000b2');
    expect(r.replaceText('ws 0190a000-0000-7000-8000-0000000000a1!')).toBe(
      'ws 0190b000-0000-7000-8000-0000000000b2!',
    );
    expect(r.has('0190A000-0000-7000-8000-0000000000A1')).toBe(true);
    expect(r.size).toBe(1);
    expect(r.entries().next().value).toEqual([
      '0190a000-0000-7000-8000-0000000000a1',
      '0190b000-0000-7000-8000-0000000000b2',
    ]);
  });

  it('uuidV7At exige 10 bytes aleatorios', () => {
    expect(() => uuidV7At(1, new Uint8Array(3))).toThrow(RangeError);
  });
});
