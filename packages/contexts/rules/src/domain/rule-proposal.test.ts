import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RULE_PROPOSAL_DEFAULTS,
  assessCoverage,
  descriptionKey,
  mineProposals,
  proposalFingerprint,
  proposedPriority,
  type ProposalEvidence,
} from './rule-proposal.js';

let seq = 0;
const ev = (over: Partial<ProposalEvidence> = {}): ProposalEvidence => {
  seq += 1;
  return {
    transactionId: `tx-${String(seq).padStart(4, '0')}`,
    date: '2026-09-10',
    kind: 'EXPENSE',
    description: 'TIGO MONEY RECARGA 77712345',
    counterpartyId: null,
    categoryId: 'cat-tel',
    ...over,
  };
};
const many = (n: number, over: Partial<ProposalEvidence> = {}) =>
  Array.from({ length: n }, (_, i) => ev({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, ...over }));

const mine = (evidence: readonly ProposalEvidence[]) => mineProposals(evidence, RULE_PROPOSAL_DEFAULTS);

describe('clave de descripción', () => {
  it('[TC-RULES-SUGGEST-007] quita números, asteriscos y palabras de un carácter', () => {
    const vectors: Record<string, string | null> = {
      'COMPRA TARJ ****1234 FARMACORP SUC 3': 'compra tarj farmacorp suc',
      'TIGO MONEY RECARGA 77712345': 'tigo money recarga',
      'PAGO QR  CAFÉ Alexander': 'pago qr cafe alexander',
      'A 12345': null,
    };
    for (const [raw, expected] of Object.entries(vectors)) {
      expect(descriptionKey(raw), raw).toBe(expected);
    }
  });

  it('[TC-RULES-SUGGEST-007] toma como máximo las 5 primeras palabras y exige 3 letras', () => {
    expect(descriptionKey('uno dos tres cuatro cinco seis siete')).toBe('uno dos tres cuatro cinco');
    expect(descriptionKey(null)).toBeNull();
    expect(descriptionKey('  ')).toBeNull();
    expect(descriptionKey('ab 12 c')).toBeNull();
    expect(descriptionKey('ab cd')).toBe('ab cd');
  });

  it('[TC-RULES-SUGGEST-007] coincide con los vectores de crear una regla desde una fila (TC-RULES-ENGINE-054)', () => {
    expect(descriptionKey('TIGO MONEY RECARGA 77712345')).toBe('tigo money recarga');
    expect(descriptionKey('PAGO QR  CAFÉ Alexander')).toBe('pago qr cafe alexander');
    expect(descriptionKey('COMPRA TARJ ****1234 FARMACORP')).toBe('compra tarj farmacorp');
  });
});

describe('huella de la sugerencia', () => {
  const pattern = {
    type: 'DESCRIPTION',
    value: 'tigo money recarga',
    kind: 'EXPENSE',
    categoryId: 'cat-tel',
  } as const;

  it('[TC-RULES-SUGGEST-007] es un SHA-256 hexadecimal estable y sensible a cada componente', () => {
    const a = proposalFingerprint(pattern);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(proposalFingerprint({ ...pattern })).toBe(a);
    for (const other of [
      { ...pattern, type: 'COUNTERPARTY' as const },
      { ...pattern, value: 'otra' },
      { ...pattern, kind: 'REFUND' as const },
      { ...pattern, categoryId: 'cat-otra' },
    ]) {
      expect(proposalFingerprint(other)).not.toBe(a);
    }
  });
});

describe('detección de patrones', () => {
  it('[TC-RULES-SUGGEST-001] cuatro recargas de Tigo clasificadas a mano generan una sugerencia', () => {
    const e = [
      ev({ description: 'TIGO MONEY RECARGA 77712345', date: '2026-07-02' }),
      ev({ description: 'TIGO MONEY RECARGA 77754321', date: '2026-08-10' }),
      ev({ description: 'TIGO MONEY RECARGA 70011122', date: '2026-09-15' }),
      ev({ description: 'TIGO MONEY RECARGA 77712345', date: '2026-10-28' }),
    ];
    const out = mine(e);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      pattern: { type: 'DESCRIPTION', value: 'tigo money recarga', kind: 'EXPENSE', categoryId: 'cat-tel' },
      support: 4,
      evidenceCount: 4,
      confidence: '1.0000',
      level: 'MEDIUM',
    });
  });

  it('[TC-RULES-SUGGEST-002] dos repeticiones no alcanzan el apoyo mínimo', () => {
    expect(mine(many(2))).toEqual([]);
    expect(mine(many(3))).toHaveLength(1);
  });

  it('[TC-RULES-SUGGEST-010] cuatro de cinco alcanza el mínimo con nivel media', () => {
    const e = [
      ...many(4, { description: 'PEDIDOSYA', categoryId: 'cat-rest' }),
      ...many(1, { description: 'PEDIDOSYA', categoryId: 'cat-super' }),
    ];
    const out = mine(e);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      pattern: { categoryId: 'cat-rest' },
      support: 4,
      evidenceCount: 5,
      confidence: '0.8000',
      level: 'MEDIUM',
    });
    expect(out[0]!.counterExampleIds).toHaveLength(1);
  });

  it('[TC-RULES-SUGGEST-011] tres de cuatro queda debajo del mínimo', () => {
    const e = [
      ...many(3, { description: 'PEDIDOSYA', categoryId: 'cat-rest' }),
      ...many(1, { description: 'PEDIDOSYA', categoryId: 'cat-super' }),
    ];
    expect(mine(e)).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-010] el nivel es alta con confianza de 0.9500 o más y 5 o más transacciones', () => {
    const alta = mine(many(20, { description: 'UBER TRIP' }));
    expect(alta[0]).toMatchObject({ confidence: '1.0000', level: 'HIGH', support: 20 });
    const media = mine(many(4, { description: 'UBER TRIP' }));
    expect(media[0]!.level).toBe('MEDIUM');
    // 19 de 20 = 0.9500 con 19 transacciones: alta.
    const limite = mine([
      ...many(19, { description: 'UBER TRIP' }),
      ...many(1, { description: 'UBER TRIP', categoryId: 'cat-otra' }),
    ]);
    expect(limite[0]).toMatchObject({ confidence: '0.9500', level: 'HIGH' });
  });

  it('[TC-RULES-SUGGEST-012] la confianza se redondea a cuatro decimales HALF_EVEN', () => {
    const e = [
      ...many(5, { description: 'UBER TRIP', categoryId: 'cat-taxi' }),
      ...many(1, { description: 'UBER TRIP', categoryId: 'cat-viajes' }),
    ];
    const out = mine(e);
    expect(out[0]).toMatchObject({ pattern: { categoryId: 'cat-taxi' }, confidence: '0.8333', support: 5 });
    // 9 de 11 = 0.818181…: 0.8182.
    const nine = mine([
      ...many(9, { description: 'UBER TRIP', categoryId: 'cat-taxi' }),
      ...many(2, { description: 'UBER TRIP', categoryId: 'cat-viajes' }),
    ]);
    expect(nine[0]!.confidence).toBe('0.8182');
  });

  it('[TC-RULES-SUGGEST-010] un empate en la categoría dominante no sugiere nada', () => {
    const e = [
      ...many(4, { description: 'PEDIDOSYA', categoryId: 'cat-rest' }),
      ...many(4, { description: 'PEDIDOSYA', categoryId: 'cat-super' }),
    ];
    expect(mine(e)).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-001] los tipos de transacción no se mezclan', () => {
    const e = [
      ...many(3, { description: 'REEMBOLSO FARMACIA', kind: 'EXPENSE', categoryId: 'cat-far' }),
      ...many(3, { description: 'REEMBOLSO FARMACIA', kind: 'REFUND', categoryId: 'cat-reem' }),
    ];
    const out = mine(e);
    expect(out.map((o) => [o.pattern.kind, o.pattern.categoryId, o.confidence]).sort()).toEqual([
      ['EXPENSE', 'cat-far', '1.0000'],
      ['REFUND', 'cat-reem', '1.0000'],
    ]);
  });

  it('[TC-RULES-SUGGEST-009] la contraparte gana sobre una descripción contenida en su evidencia', () => {
    const e = [
      ev({ description: 'FARMACORP SUC 3', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ev({ description: 'FARMACORP SUC 9', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ev({ description: 'FARMACORP SUC 12', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ev({ description: 'QR FARMACORP', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
    ];
    const out = mine(e);
    expect(out.map((o) => [o.pattern.type, o.pattern.value])).toEqual([['COUNTERPARTY', 'cp-far']]);
    expect(out[0]!.support).toBe(4);
  });

  it('[TC-RULES-SUGGEST-009] la descripción se conserva si su evidencia no está contenida en la de la contraparte', () => {
    const e = [
      ev({ description: 'FARMACORP SUC 3', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ev({ description: 'FARMACORP SUC 9', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ev({ description: 'FARMACORP SUC 12', counterpartyId: null, categoryId: 'cat-far' }),
    ];
    const out = mine(e);
    expect(out.map((o) => o.pattern.type)).toEqual(['DESCRIPTION']);
  });

  it('[TC-RULES-SUGGEST-009] la contraparte no elimina la descripción de otra categoría', () => {
    const e = [
      ...many(3, { description: 'FARMACORP SUC 3', counterpartyId: 'cp-far', categoryId: 'cat-far' }),
      ...many(4, { description: 'FARMACORP SUC 3', counterpartyId: 'cp-far', categoryId: 'cat-otra' }),
    ];
    // Contraparte: 4 de 7 (0.5714), no se sugiere; descripción igual: tampoco.
    expect(mine(e)).toEqual([]);
  });

  it('[TC-RULES-SUGGEST-015] la evidencia y los contraejemplos van de más reciente a más antigua', () => {
    const e = [
      ev({ description: 'PEDIDOSYA', date: '2026-09-01', categoryId: 'cat-rest' }),
      ev({ description: 'PEDIDOSYA', date: '2026-09-20', categoryId: 'cat-rest' }),
      ev({ description: 'PEDIDOSYA', date: '2026-09-10', categoryId: 'cat-rest' }),
      ev({ description: 'PEDIDOSYA', date: '2026-09-15', categoryId: 'cat-rest' }),
      ev({ description: 'PEDIDOSYA', date: '2026-09-18', categoryId: 'cat-super' }),
    ];
    const out = mine(e);
    const dateOf = (id: string) => e.find((x) => x.transactionId === id)!.date;
    expect(out[0]!.evidenceIds.map(dateOf)).toEqual(['2026-09-20', '2026-09-15', '2026-09-10', '2026-09-01']);
    expect(out[0]!.counterExampleIds.map(dateOf)).toEqual(['2026-09-18']);
  });

  it('[TC-RULES-SUGGEST-011] ordena por apoyo, confianza y patrón, y limita el resultado', () => {
    const e = [
      ...many(3, { description: 'ZETA COMERCIO' }),
      ...many(5, { description: 'BETA COMERCIO' }),
      ...many(3, { description: 'ALFA COMERCIO' }),
      ...many(4, { description: 'GAMMA COMERCIO' }),
      ...many(1, { description: 'GAMMA COMERCIO', categoryId: 'cat-otra' }),
    ];
    const out = mine(e);
    expect(out.map((o) => o.pattern.value)).toEqual([
      'beta comercio',
      'gamma comercio',
      'alfa comercio',
      'zeta comercio',
    ]);
    expect(mineProposals(e, RULE_PROPOSAL_DEFAULTS, 2)).toHaveLength(2);
  });
});

describe('cobertura y conflictos', () => {
  const origin = (ruleId: string, categoryId: string) => ({ categoryId, origin: { ruleId, ruleVersion: 1 } });

  it('[TC-RULES-SUGGEST-013] un patrón cubierto en toda la evidencia no se sugiere', () => {
    const result = assessCoverage(['a', 'b', 'c'], 'cat-tel', () => origin('r-tigo', 'cat-tel'));
    expect(result).toEqual({ covered: true, conflicts: [] });
  });

  it('[TC-RULES-SUGGEST-013] sin regla que coincida no está cubierto ni en conflicto', () => {
    expect(assessCoverage(['a', 'b'], 'cat-tel', () => null)).toEqual({ covered: false, conflicts: [] });
    // Cubierto en parte: el resto sin regla ⇒ se sugiere (no hay conflicto).
    expect(
      assessCoverage(['a', 'b'], 'cat-tel', (id) => (id === 'a' ? origin('r-tigo', 'cat-tel') : null)),
    ).toEqual({ covered: false, conflicts: [] });
  });

  it('[TC-RULES-SUGGEST-014] informa cada regla en conflicto con la cantidad de transacciones', () => {
    const result = assessCoverage(['a', 'b', 'c', 'd'], 'cat-far', (id) =>
      id === 'd' ? origin('r-otra', 'cat-hogar') : origin('r-super', 'cat-super'),
    );
    expect(result.covered).toBe(false);
    expect(result.conflicts).toEqual([
      { ruleId: 'r-super', version: 1, categoryId: 'cat-super', count: 3 },
      { ruleId: 'r-otra', version: 1, categoryId: 'cat-hogar', count: 1 },
    ]);
  });

  it('[TC-RULES-SUGGEST-014] propone una prioridad una unidad menor que la menor en conflicto', () => {
    expect(proposedPriority([])).toEqual({ priority: 100, cannotOutrank: false });
    expect(proposedPriority([100])).toEqual({ priority: 99, cannotOutrank: false });
    expect(proposedPriority([100, 40, 250])).toEqual({ priority: 39, cannotOutrank: false });
    expect(proposedPriority([1])).toEqual({ priority: 0, cannotOutrank: false });
    expect(proposedPriority([0, 10])).toEqual({ priority: 0, cannotOutrank: true });
  });
});

/** Mezcla determinista (LCG) para no depender de un comparador inconsistente. */
function shuffle<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let state = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('propiedades', () => {
  const evidenceArb = fc.array(
    fc.record({
      d: fc.integer({ min: 1, max: 28 }),
      desc: fc.constantFrom('TIGO RECARGA 1', 'PEDIDOSYA', 'UBER TRIP', 'FARMACORP SUC 3', 'x'),
      cp: fc.constantFrom(null, 'cp-a', 'cp-b'),
      cat: fc.constantFrom('cat-1', 'cat-2', 'cat-3'),
      kind: fc.constantFrom('EXPENSE' as const, 'REFUND' as const),
    }),
    { maxLength: 40 },
  );

  it('[TC-RULES-SUGGEST-027] la misma evidencia en cualquier orden da las mismas sugerencias', () => {
    fc.assert(
      fc.property(evidenceArb, fc.integer(), (rows, seed) => {
        const items = rows.map((r, i) =>
          ev({
            transactionId: `p-${String(i).padStart(3, '0')}`,
            date: `2026-09-${String(r.d).padStart(2, '0')}`,
            description: r.desc,
            counterpartyId: r.cp,
            categoryId: r.cat,
            kind: r.kind,
          }),
        );
        const shuffled = shuffle(items, seed);
        const reversed = [...items].reverse();
        const base = mine(items);
        expect(mine(reversed)).toEqual(base);
        expect(mine(shuffled)).toEqual(base);
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it('[TC-RULES-SUGGEST-027] ninguna sugerencia tiene apoyo menor que 3 ni confianza menor que 0.8000', () => {
    fc.assert(
      fc.property(evidenceArb, (rows) => {
        const items = rows.map((r, i) =>
          ev({
            transactionId: `q-${String(i).padStart(3, '0')}`,
            date: `2026-09-${String(r.d).padStart(2, '0')}`,
            description: r.desc,
            counterpartyId: r.cp,
            categoryId: r.cat,
            kind: r.kind,
          }),
        );
        for (const s of mine(items)) {
          expect(s.support).toBeGreaterThanOrEqual(3);
          expect(Number(s.confidence)).toBeGreaterThanOrEqual(0.8);
          expect(s.support).toBeLessThanOrEqual(s.evidenceCount);
          expect(s.suggestionId).toBe(proposalFingerprint(s.pattern));
        }
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it('[TC-RULES-SUGGEST-012] la confianza es k ÷ n con 4 decimales HALF_EVEN (contra aritmética entera exacta)', () => {
    /** Cociente k/n redondeado a 4 decimales, mitad al par, solo con enteros. */
    const halfEven4 = (k: number, n: number): string => {
      const scaled = BigInt(k) * 10_000n;
      const d = BigInt(n);
      let q = scaled / d;
      const twice = (scaled % d) * 2n;
      if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
      const s = q.toString().padStart(5, '0');
      return `${s.slice(0, -4)}.${s.slice(-4)}`;
    };
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 60 }), fc.integer({ min: 0, max: 14 }), (k, extra) => {
        const items = [
          ...Array.from({ length: k }, (_, i) =>
            ev({ transactionId: `h-${i}`, description: 'UBER TRIP', categoryId: 'cat-1' }),
          ),
          ...Array.from({ length: extra }, (_, i) =>
            ev({ transactionId: `x-${i}`, description: 'UBER TRIP', categoryId: `cat-other-${i}` }),
          ),
        ];
        const out = mine(items);
        const expected = halfEven4(k, k + extra);
        if (Number(expected) < 0.8) expect(out).toEqual([]);
        else expect(out[0]!.confidence).toBe(expected);
      }),
      { numRuns: 120 },
    );
  }, 60_000);
});
