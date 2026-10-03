import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../errors/problem.js';
import {
  CursorCodec,
  buildPage,
  ephemeralCursorKey,
  parseCursorKeys,
  type CursorScope,
  type Page,
} from './cursor-codec.js';

interface Item {
  readonly id: string;
  readonly date: string;
}

const SECRET = 'x'.repeat(40);
const W1 = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d01';
const W2 = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d02';
const scope = (over: Partial<CursorScope> = {}): CursorScope => ({
  resource: 'transactions',
  workspaceId: W1,
  filters: { currency: 'BOB', sort: '-transactionDate' },
  ...over,
});

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ApiProblem ? err.code : String(err);
  }
  return undefined;
};

describe('CursorCodec (cursores opacos firmados, design §5)', () => {
  const codec = new CursorCodec([{ kid: 'k1', secret: SECRET }]);
  const cursor = codec.encode(scope(), ['2026-09-30', '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9f01']);

  it('[TC-PLATFORM-API-016] un cursor válido devuelve su posición keyset', () => {
    expect(codec.decode(cursor, scope())).toEqual(['2026-09-30', '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9f01']);
    // El orden de las claves de los filtros no importa (JSON canónico).
    expect(
      codec.decode(cursor, scope({ filters: { sort: '-transactionDate', currency: 'BOB' } })),
    ).toHaveLength(2);
  });

  it('[TC-PLATFORM-API-016] alterar un byte del cursor ⇒ INVALID_CURSOR', () => {
    for (let i = 0; i < cursor.length; i += 7) {
      const c = cursor[i] === 'A' ? 'B' : 'A';
      const tampered = `${cursor.slice(0, i)}${c}${cursor.slice(i + 1)}`;
      if (tampered === cursor) continue;
      expect(
        codeOf(() => codec.decode(tampered, scope())),
        `byte ${i}`,
      ).toBe('INVALID_CURSOR');
    }
    for (const bad of ['', 'abc', 'a.b.c', '.x', 'x.', `${Buffer.from('null').toString('base64url')}.x`]) {
      expect(
        codeOf(() => codec.decode(bad, scope())),
        bad,
      ).toBe('INVALID_CURSOR');
    }
  });

  it('[TC-PLATFORM-API-016] un cursor de otros filtros, de otro workspace o de otro recurso ⇒ INVALID_CURSOR', () => {
    expect(
      codeOf(() => codec.decode(cursor, scope({ filters: { currency: 'USD', sort: '-transactionDate' } }))),
    ).toBe('INVALID_CURSOR');
    expect(codeOf(() => codec.decode(cursor, scope({ workspaceId: W2 })))).toBe('INVALID_CURSOR');
    expect(codeOf(() => codec.decode(cursor, scope({ resource: 'accounts' })))).toBe('INVALID_CURSOR');
  });

  it('[TC-PLATFORM-API-016] rotación por kid: la clave nueva firma y la anterior sigue verificando; una clave ajena no', () => {
    const rotated = new CursorCodec(parseCursorKeys(`k2:${'y'.repeat(40)},k1:${SECRET}`));
    expect(rotated.decode(cursor, scope())).toHaveLength(2);
    const fresh = rotated.encode(scope(), ['2026-10-01', 'id']);
    expect(codeOf(() => codec.decode(fresh, scope()))).toBe('INVALID_CURSOR');
    const forged = new CursorCodec([{ kid: 'k1', secret: 'z'.repeat(40) }]).encode(scope(), [
      '2026-10-01',
      'id',
    ]);
    expect(codeOf(() => codec.decode(forged, scope()))).toBe('INVALID_CURSOR');
    expect(ephemeralCursorKey().secret).toHaveLength(64);
  });

  it('valida el formato de CURSOR_SIGNING_KEY', () => {
    expect(() => parseCursorKeys('k1:corto')).toThrow();
    expect(() => parseCursorKeys('')).toThrow();
    expect(() => parseCursorKeys(`k1:${SECRET},k1:${SECRET}`)).toThrow(/duplicado/);
    expect(() => new CursorCodec([])).toThrow();
  });

  it('[TC-PLATFORM-API-015] buildPage recorre 120 elementos en páginas de 50, 50 y 20 sin omitir ni repetir', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `id-${String(i).padStart(3, '0')}`,
      date: `2026-09-${String(10 + (i % 3)).padStart(2, '0')}`, // muchos empates de fecha
    }));
    const sorted = [...items].sort((a, b) =>
      a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
    );
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const after: readonly (string | number | boolean | null)[] | undefined = cursor
        ? codec.decode(cursor, scope())
        : undefined;
      const rest: typeof sorted = after
        ? sorted.filter((x) => x.date > String(after[0]) || (x.date === after[0] && x.id > String(after[1])))
        : sorted;
      const page: Page<Item> = buildPage(
        rest.slice(0, 51),
        50,
        (x: Item) => [x.date, x.id],
        (pos) => codec.encode(scope(), pos),
      );
      seen.push(...page.data.map((x: Item) => x.id));
      sizes.push(page.data.length);
      cursor = page.page.nextCursor;
      if (!page.page.hasMore) expect(page.page.nextCursor).toBeNull();
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(sorted.map((x) => x.id));
  });
});
