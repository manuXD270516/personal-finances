import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BACKTEST_MIN_MONTHS,
  CATEGORY_SUGGESTION_DEFAULTS,
  CategorySuggestionIndex,
  backtestFigures,
  type SuggestionEvidence,
} from './category-suggester.js';

const ev = (over: Partial<SuggestionEvidence> = {}): SuggestionEvidence => ({
  kind: 'EXPENSE',
  description: 'PEDIDOSYA *8811',
  counterpartyId: null,
  categoryId: 'cat-restaurantes',
  ...over,
});
const many = (n: number, over: Partial<SuggestionEvidence> = {}) => Array.from({ length: n }, () => ev(over));

const T = CATEGORY_SUGGESTION_DEFAULTS;
const suggest = (
  evidence: readonly SuggestionEvidence[],
  subject: {
    description?: string | null;
    counterpartyId?: string | null;
    kind?: 'INCOME' | 'EXPENSE' | 'REFUND';
  } = {},
) =>
  CategorySuggestionIndex.build(evidence).suggest(
    {
      kind: subject.kind ?? 'EXPENSE',
      description: subject.description === undefined ? 'PEDIDOSYA *8812' : subject.description,
      counterpartyId: subject.counterpartyId ?? null,
    },
    T,
  );

describe('sugerencia de categoría por historial', () => {
  it('[TC-CLASSIFICATION-AUTO-001] nueve de diez sugiere la categoría con confianza alta', () => {
    const s = suggest([...many(9), ev({ categoryId: 'cat-super' })]);
    expect(s).toMatchObject({
      categoryId: 'cat-restaurantes',
      confidence: '0.9000',
      level: 'HIGH',
      support: 10,
      matches: 9,
      basis: 'DESCRIPTION',
      descriptionKey: 'pedidosya',
      counterpartyId: null,
    });
  });

  it('[TC-CLASSIFICATION-AUTO-002] siete de diez sugiere con confianza media', () => {
    const s = suggest([...many(7), ...many(3, { categoryId: 'cat-super' })]);
    expect(s).toMatchObject({ categoryId: 'cat-restaurantes', confidence: '0.7000', level: 'MEDIUM' });
  });

  it('[TC-CLASSIFICATION-AUTO-002] con 4 de 4 (apoyo menor que 5) el nivel es medio aunque la confianza sea 1.0000', () => {
    expect(suggest(many(4))).toMatchObject({ confidence: '1.0000', level: 'MEDIUM' });
    expect(suggest(many(5))).toMatchObject({ confidence: '1.0000', level: 'HIGH' });
  });

  it('[TC-CLASSIFICATION-AUTO-003] seis de nueve (0.6667) no alcanza el umbral', () => {
    expect(suggest([...many(6), ...many(3, { categoryId: 'cat-super' })])).toBeNull();
  });

  it('[TC-CLASSIFICATION-AUTO-004] un empate o una sola transacción no sugieren', () => {
    const tie = [
      ...many(2, { description: 'UBER TRIP', categoryId: 'cat-taxi' }),
      ...many(2, { description: 'UBER TRIP', categoryId: 'cat-viajes' }),
    ];
    expect(suggest(tie, { description: 'UBER TRIP 9' })).toBeNull();
    expect(
      suggest(many(1, { description: 'GIMNASIO BODYTECH' }), { description: 'GIMNASIO BODYTECH' }),
    ).toBeNull();
    expect(
      suggest(many(2, { description: 'GIMNASIO BODYTECH' }), { description: 'GIMNASIO BODYTECH' }),
    ).not.toBeNull();
  });

  it('el historial de otro tipo de transacción no cuenta', () => {
    expect(suggest(many(5, { kind: 'INCOME' }), { kind: 'EXPENSE' })).toBeNull();
    expect(suggest(many(5, { kind: 'REFUND' }), { kind: 'REFUND' })).not.toBeNull();
  });

  it('una descripción sin clave utilizable y sin contraparte no sugiere nada', () => {
    expect(suggest(many(5, { description: 'A 12345' }), { description: 'A 12345' })).toBeNull();
    expect(suggest(many(5), { description: null })).toBeNull();
  });
});

describe('patrones por contraparte y por descripción', () => {
  it('[TC-CLASSIFICATION-AUTO-007] la contraparte gana a la descripción con mayor confianza', () => {
    const farma = 'COMPRA TARJ ****1234 FARMACORP SUC 3';
    const evidence = [
      ...many(4, { description: 'otro texto', counterpartyId: 'cp-farmacorp', categoryId: 'cat-farmacia' }),
      ...many(3, { description: farma, categoryId: 'cat-salud' }),
      ev({ description: farma, categoryId: 'cat-hogar' }),
    ];
    const s = suggest(evidence, { description: farma, counterpartyId: 'cp-farmacorp' });
    expect(s).toMatchObject({
      categoryId: 'cat-farmacia',
      confidence: '1.0000',
      basis: 'COUNTERPARTY',
      descriptionKey: null,
      counterpartyId: 'cp-farmacorp',
    });
    // La clave de la descripción se calcula igual y sin los números ni asteriscos.
    const onlyDescription = suggest(evidence, { description: farma });
    expect(onlyDescription?.descriptionKey).toBe('compra tarj farmacorp suc');
    expect(onlyDescription?.categoryId).toBe('cat-salud');
    expect(onlyDescription?.confidence).toBe('0.7500');
  });

  it('[TC-CLASSIFICATION-AUTO-008] dos patrones que coinciden dan una sola sugerencia con la confianza mayor', () => {
    const evidence = [
      // Descripción: 4 de 5 (0.8000); contraparte: 9 de 10 (0.9000); ambas en Restaurantes.
      ...many(4, { counterpartyId: null }),
      ev({ categoryId: 'cat-super', counterpartyId: null }),
      ...many(9, { description: 'otro', counterpartyId: 'cp-pya' }),
      ev({ description: 'otro', counterpartyId: 'cp-pya', categoryId: 'cat-super' }),
      // Las de la contraparte con la descripción del sujeto también cuentan para la descripción.
    ];
    const s = suggest(evidence, { description: 'PEDIDOSYA *1', counterpartyId: 'cp-pya' });
    expect(s).toMatchObject({
      categoryId: 'cat-restaurantes',
      confidence: '0.9000',
      basis: 'BOTH',
      descriptionKey: 'pedidosya',
      counterpartyId: 'cp-pya',
      support: 10,
      matches: 9,
      level: 'HIGH',
    });
  });

  it('a igual confianza gana la contraparte cuando difieren', () => {
    const evidence = [
      ...many(3, { description: 'x', counterpartyId: 'cp-1', categoryId: 'cat-a' }),
      ...many(3, { categoryId: 'cat-b' }),
    ];
    const s = suggest(evidence, { counterpartyId: 'cp-1' });
    expect(s).toMatchObject({ categoryId: 'cat-a', basis: 'COUNTERPARTY' });
  });

  it('gana la descripción cuando su confianza es mayor que la de la contraparte', () => {
    const evidence = [
      ...many(7, { description: 'x', counterpartyId: 'cp-1', categoryId: 'cat-a' }),
      ...many(3, { description: 'x', counterpartyId: 'cp-1', categoryId: 'cat-c' }),
      ...many(5, { categoryId: 'cat-b' }),
    ];
    const s = suggest(evidence, { counterpartyId: 'cp-1' });
    expect(s).toMatchObject({ categoryId: 'cat-b', basis: 'DESCRIPTION', confidence: '1.0000' });
  });
});

describe('propiedades', () => {
  const evidenceArb = fc.array(
    fc.record({
      kind: fc.constantFrom('EXPENSE' as const, 'INCOME' as const, 'REFUND' as const),
      description: fc.constantFrom('PEDIDOSYA *1', 'UBER TRIP', 'FARMACORP SUC 3', 'x', null),
      counterpartyId: fc.constantFrom(null, 'cp-a', 'cp-b'),
      categoryId: fc.constantFrom('c1', 'c2', 'c3', 'c4'),
    }),
    { maxLength: 60 },
  );
  const subjectArb = fc.record({
    kind: fc.constantFrom('EXPENSE' as const, 'INCOME' as const, 'REFUND' as const),
    description: fc.constantFrom('PEDIDOSYA 99', 'UBER TRIP 4', 'FARMACORP', 'y', null),
    counterpartyId: fc.constantFrom(null, 'cp-a', 'cp-b'),
  });

  it('[TC-CLASSIFICATION-AUTO-001] la confianza está entre 0.7000 y 1.0000 y no cambia al permutar la evidencia', () => {
    fc.assert(
      fc.property(
        evidenceArb,
        subjectArb,
        fc.integer({ min: 0, max: 1_000_000 }),
        (evidence, subject, seed) => {
          const shuffled: SuggestionEvidence[] = [...evidence];
          let s = seed;
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
            const j = s % (i + 1);
            [shuffled[i], shuffled[j]] = [
              shuffled[j] as SuggestionEvidence,
              shuffled[i] as SuggestionEvidence,
            ];
          }
          const a = CategorySuggestionIndex.build(evidence).suggest(subject, T);
          const b = CategorySuggestionIndex.build(shuffled).suggest(subject, T);
          expect(b).toEqual(a);
          if (a) {
            expect(a.confidence >= '0.7000' && a.confidence <= '1.0000').toBe(true);
            expect(a.support).toBeGreaterThanOrEqual(T.minSupport);
            expect(a.matches).toBeLessThanOrEqual(a.support);
            expect(a.level === 'HIGH').toBe(
              a.confidence >= T.highConfidence && a.support >= T.highMinSupport,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});

describe('cifras del backtesting', () => {
  it('[TC-CLASSIFICATION-AUTO-019] 264 aciertos de 300 sugerencias sobre 400 transacciones: precisión 0.8800 y cobertura 0.7500', () => {
    expect(backtestFigures(400, 300, 264)).toEqual({
      transactions: 400,
      suggestions: 300,
      hits: 264,
      precision: '0.8800',
      coverage: '0.7500',
    });
  });

  it('[TC-CLASSIFICATION-AUTO-019] redondea HALF_EVEN a 4 decimales y no inventa cifras sin datos', () => {
    expect(backtestFigures(3, 3, 2).precision).toBe('0.6667');
    expect(backtestFigures(0, 0, 0)).toMatchObject({ precision: null, coverage: null });
    expect(backtestFigures(10, 0, 0)).toMatchObject({ precision: null, coverage: '0.0000' });
  });

  it('[TC-CLASSIFICATION-AUTO-020] el backtesting exige al menos 3 meses', () => {
    expect(BACKTEST_MIN_MONTHS).toBe(3);
  });
});
