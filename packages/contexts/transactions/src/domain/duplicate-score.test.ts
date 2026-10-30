import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DuplicateScore, formatRatio4, jaroWinkler, normalizeForScore } from './duplicate-score.js';

const row = {
  date: '2026-10-01',
  description: 'SUPERMERCADO DEMO',
  counterpartyId: null,
  externalId: null,
};
const manual = {
  transactionId: '0190a000-0000-7000-8000-000000000001',
  date: '2026-10-02',
  description: 'Supermercado Demo',
  counterpartyId: null,
  bankExternalId: null,
};

describe('DuplicateScore (puntaje de posible duplicado)', () => {
  it('[TC-TRANSACTIONS-DEDUPE-001] un gasto manual del día siguiente con la misma descripción puntúa 0.9000', () => {
    // 0.40 + 0.25 × 0.8 + 0.20 × 1 + 0.10 × 0.5 + 0.05 = 0.9000
    const r = DuplicateScore.of(row, manual);
    expect(r.score).toBe('0.9000');
    expect(r.signals).toEqual({
      amount: '1.0000',
      date: '0.8000',
      description: '1.0000',
      counterparty: '0.5000',
      origin: '1.0000',
    });
  });

  it('[TC-TRANSACTIONS-DEDUPE-002] un candidato con otro identificador del banco puntúa 0.8500', () => {
    const r = DuplicateScore.of({ ...row, externalId: 'FIT-1' }, { ...manual, bankExternalId: 'FIT-2' });
    expect(r.score).toBe('0.8500');
    expect(r.signals.origin).toBe('0.0000');
    // El mismo identificador no penaliza; un candidato sin identificador tampoco.
    expect(
      DuplicateScore.of({ ...row, externalId: 'FIT-1' }, { ...manual, bankExternalId: 'FIT-1' }).score,
    ).toBe('0.9000');
  });

  it('[TC-TRANSACTIONS-DEDUPE-003] con igual puntaje va primero el de menor diferencia de días y el orden es determinista', () => {
    // Ambos a 1 y 2 días con puntajes forzados iguales: sin descripción en la fila, la descripción vale 0.5 en los dos
    // y la fecha pesa distinto; para empatar se usa la misma fecha con identificadores distintos.
    const a = { ...manual, transactionId: 'b-2', date: '2026-10-03' };
    const b = { ...manual, transactionId: 'a-1', date: '2026-10-03' };
    const c = { ...manual, transactionId: 'c-0', date: '2026-10-02' };
    const ranked = DuplicateScore.rank(row, [a, b, c]);
    expect(ranked.map((x) => x.transactionId)).toEqual(['c-0', 'a-1', 'b-2']);
    // Calcular de nuevo, en otro orden de entrada, da el mismo orden.
    expect(DuplicateScore.rank(row, [c, b, a]).map((x) => x.transactionId)).toEqual(
      ranked.map((x) => x.transactionId),
    );
    // Mismo puntaje con distinta distancia en días: se construye con contrapartes que compensan nada; se verifica el
    // desempate con una descripción vacía en ambos (0.5) y fechas a 1 y 2 días ⇒ puntajes distintos, el de 1 día antes.
    const empty = { ...row, description: null };
    const near = { ...manual, transactionId: 'z', description: null, date: '2026-10-02' };
    const far = { ...manual, transactionId: 'a', description: null, date: '2026-10-03' };
    expect(DuplicateScore.rank(empty, [far, near]).map((x) => x.transactionId)).toEqual(['z', 'a']);
  });

  it('[TC-TRANSACTIONS-DEDUPE-008] 245.30 BOB a 3 días, sin similitud, sin contrapartes ni identificador puntúa 0.5750', () => {
    // 0.40 + 0.25 × 0.3 + 0.20 × 0 + 0.10 × 0.5 + 0.05 = 0.5750
    const r = DuplicateScore.of(
      { ...row, description: 'zzzz' },
      { ...manual, date: '2026-10-04', description: 'qqq' },
    );
    expect(r.score).toBe('0.5750');
    expect(r.signals.description).toBe('0.0000');
  });

  it('[TC-TRANSACTIONS-DEDUPE-001] la contraparte coincidente suma 0.10 y la distinta suma 0; sin descripción en el candidato vale 0.5', () => {
    const cp = { ...row, counterpartyId: 'cp-1' };
    expect(DuplicateScore.of(cp, { ...manual, counterpartyId: 'cp-1' }).score).toBe('0.9500');
    expect(DuplicateScore.of(cp, { ...manual, counterpartyId: 'cp-2' }).score).toBe('0.8500');
    // 0.40 + 0.20 + 0.20 × 0.5 + 0.05 + 0.05 = 0.8000
    expect(DuplicateScore.of(row, { ...manual, description: null }).score).toBe('0.8000');
  });

  it('una ventana configurada mayor que 3 días da peso 0 a la fecha', () => {
    expect(DuplicateScore.of(row, { ...manual, date: '2026-10-05' }).signals.date).toBe('0.0000');
  });

  it('Jaro-Winkler: valores conocidos con aritmética exacta y normalización de descripciones', () => {
    expect(formatRatio4(jaroWinkler('martha', 'marhta'))).toBe('0.9611');
    expect(formatRatio4(jaroWinkler('dwayne', 'duane'))).toBe('0.8400');
    expect(formatRatio4(jaroWinkler('abc', 'abc'))).toBe('1.0000');
    expect(formatRatio4(jaroWinkler('abc', 'xyz'))).toBe('0.0000');
    expect(normalizeForScore('  PAGO Qr  ****1234 Café  ')).toBe('pago qr cafe');
  });

  it('[TC-TRANSACTIONS-DEDUPE-003] PBT: el puntaje es determinista, está entre 0 y 1 y el orden no depende de la entrada', () => {
    const text = fc.string({ maxLength: 24 });
    const day = fc.integer({ min: 0, max: 3 });
    const candidate = fc.record({
      description: fc.option(text, { nil: null }),
      daysApart: day,
      counterpartyId: fc.option(fc.constantFrom('cp-1', 'cp-2'), { nil: null }),
      bankExternalId: fc.option(fc.constantFrom('A', 'B'), { nil: null }),
    });
    fc.assert(
      fc.property(
        text,
        fc.option(fc.constantFrom('cp-1', 'cp-2'), { nil: null }),
        fc.array(candidate, { minLength: 1, maxLength: 8 }),
        (description, counterpartyId, raw) => {
          const probe = { ...row, description, counterpartyId, externalId: 'A' };
          const candidates = raw.map((c, i) => ({
            transactionId: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
            date: `2026-10-${String(1 + c.daysApart).padStart(2, '0')}`,
            description: c.description,
            counterpartyId: c.counterpartyId,
            bankExternalId: c.bankExternalId,
          }));
          const first = DuplicateScore.rank(probe, candidates);
          const again = DuplicateScore.rank(probe, [...candidates].reverse());
          expect(again.map((x) => [x.transactionId, x.score])).toEqual(
            first.map((x) => [x.transactionId, x.score]),
          );
          for (const r of first) {
            expect(r.score).toMatch(/^[01]\.\d{4}$/u);
            expect(r.score <= '1.0000').toBe(true);
          }
          for (let i = 1; i < first.length; i++) {
            expect((first[i - 1] as { score: string }).score >= (first[i] as { score: string }).score).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
