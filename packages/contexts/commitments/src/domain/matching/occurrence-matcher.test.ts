import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NO_TOLERANCE_OVERRIDES, resolveTolerances, validateToleranceOverrides } from './match-tolerances.js';
import { OccurrenceMatcher, type MatchOccurrence, type MatchTransaction } from './occurrence-matcher.js';

const BANK = 'acc-bank';
const CASH = 'acc-cash';
const SAVINGS = 'acc-savings';
const TIGO = 'cp-tigo';
const ENTEL = 'cp-entel';
const SUR = 'cp-mayorista-sur';

function tx(over: Partial<MatchTransaction> = {}): MatchTransaction {
  return {
    transactionId: 'tx-1',
    kind: 'EXPENSE',
    status: 'POSTED',
    businessDate: '2026-10-19',
    amount: { amount: '199.00', currency: 'BOB' },
    accountId: BANK,
    toAccountId: null,
    counterpartyId: null,
    externalRef: null,
    ...over,
  };
}

function occ(over: Partial<MatchOccurrence> = {}): MatchOccurrence {
  return {
    occurrenceId: 'occ-internet',
    definitionId: 'def-internet',
    kind: 'EXPENSE',
    status: 'DUE',
    dueDate: '2026-10-20',
    expected: { type: 'FIXED', amount: '199.00', min: null, max: null },
    currency: 'BOB',
    accountId: BANK,
    toAccountId: null,
    counterpartyId: null,
    tolerances: NO_TOLERANCE_OVERRIDES,
    ...over,
  };
}

const bob = (amount: string) => ({ amount, currency: 'BOB' });

describe('OccurrenceMatcher: puntaje, confianza y motivos (FR-COMMITMENTS-010)', () => {
  it('[TC-COMMITMENTS-MATCH-001] gasto de 199.00 BOB a 1 día sin contraparte ⇒ 50 + 25 + 10 = 85.00 HIGH', () => {
    const [c] = OccurrenceMatcher.forTransaction(tx(), [occ()]);
    expect(c).toMatchObject({
      occurrenceId: 'occ-internet',
      transactionId: 'tx-1',
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: '0.00',
      currency: 'BOB',
      dateDeltaDays: 1,
      counterparty: 'UNKNOWN',
      ambiguous: false,
    });
  });

  it('[TC-COMMITMENTS-MATCH-005] coincidencia exacta con la misma contraparte ⇒ 100.00 HIGH', () => {
    const [c] = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-20', counterpartyId: TIGO }), [
      occ({ counterpartyId: TIGO }),
    ]);
    expect(c).toMatchObject({ score: '100.00', confidence: 'HIGH', counterparty: 'MATCH', dateDeltaDays: 0 });
  });

  it('el puntaje es determinista: mismo insumo, mismo resultado', () => {
    expect(OccurrenceMatcher.forTransaction(tx(), [occ()])).toEqual(
      OccurrenceMatcher.forTransaction(tx(), [occ()]),
    );
  });

  it('confianza: HIGH ≥ 80, MEDIUM ≥ 60, LOW < 60', () => {
    // Δ = 0, 5 días de 6 ⇒ 50 + 5 + 10 = 65 MEDIUM
    const [medium] = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-15' }), [occ()]);
    expect(medium).toMatchObject({ score: '65.00', confidence: 'MEDIUM' });
    // Δ = 3.98 (borde), 5 días ⇒ 0 + 5 + 10 = 15 LOW
    const [low] = OccurrenceMatcher.forTransaction(
      tx({ businessDate: '2026-10-15', amount: bob('202.98') }),
      [occ()],
    );
    expect(low).toMatchObject({ score: '15.00', confidence: 'LOW' });
  });

  it('el puntaje redondea HALF_EVEN a 2 decimales', () => {
    // Luz ESTIMATED 150.00 ±25 % (margen 37.50), gasto 163.40 (Δ 13.40), 2 días de 6:
    // 50 × (1 − 13.40/37.50) = 32.1333…; 30 × (1 − 2/6) = 20; contraparte 10 ⇒ 62.13
    const [c] = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-27', amount: bob('163.40') }), [
      occ({ dueDate: '2026-10-25', expected: { type: 'ESTIMATED', amount: '150.00', min: null, max: null } }),
    ]);
    expect(c).toMatchObject({ score: '62.13', confidence: 'MEDIUM', amountDelta: '13.40', dateDeltaDays: 2 });
  });
});

describe('OccurrenceMatcher: filtros duros', () => {
  it('[TC-COMMITMENTS-MATCH-002] sin ocurrencias en la cuenta de la transacción no hay candidatas', () => {
    const cash = tx({ accountId: CASH, amount: bob('45.90') });
    expect(OccurrenceMatcher.forTransaction(cash, [occ()])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(cash, [])).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-002] reembolsos, ajustes, conversiones y saldos iniciales nunca son candidatos', () => {
    for (const kind of ['REFUND', 'ADJUSTMENT', 'CONVERSION', 'OPENING_BALANCE']) {
      expect(OccurrenceMatcher.forTransaction(tx({ kind }), [occ()])).toEqual([]);
    }
  });

  it('el tipo debe coincidir: EXPENSE↔EXPENSE, INCOME↔INCOME, TRANSFER↔TRANSFER', () => {
    expect(OccurrenceMatcher.forTransaction(tx({ kind: 'INCOME' }), [occ()])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(tx(), [occ({ kind: 'INCOME' })])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(tx({ kind: 'INCOME' }), [occ({ kind: 'INCOME' })])).toHaveLength(
      1,
    );
  });

  it('una transferencia exige el mismo origen y el mismo destino', () => {
    const transfer = tx({ kind: 'TRANSFER', toAccountId: SAVINGS });
    expect(
      OccurrenceMatcher.forTransaction(transfer, [occ({ kind: 'TRANSFER', toAccountId: SAVINGS })]),
    ).toHaveLength(1);
    expect(
      OccurrenceMatcher.forTransaction(transfer, [occ({ kind: 'TRANSFER', toAccountId: CASH })]),
    ).toEqual([]);
  });

  it('la moneda debe coincidir', () => {
    expect(
      OccurrenceMatcher.forTransaction(tx({ amount: { amount: '199.00', currency: 'USD' } }), [occ()]),
    ).toEqual([]);
  });

  it('una transacción anulada, o creada por una ocurrencia, no se sugiere', () => {
    expect(OccurrenceMatcher.forTransaction(tx({ status: 'VOIDED' }), [occ()])).toEqual([]);
    expect(
      OccurrenceMatcher.forTransaction(
        tx({ externalRef: { namespace: 'commitments.occurrence', id: 'occ-other' } }),
        [occ()],
      ),
    ).toEqual([]);
    // Otro namespace de externalRef (por ejemplo, un import) sí es elegible.
    expect(
      OccurrenceMatcher.forTransaction(tx({ externalRef: { namespace: 'imports.row', id: 'r1' } }), [occ()]),
    ).toHaveLength(1);
  });

  it('solo las ocurrencias SCHEDULED, DUE u OVERDUE son candidatas', () => {
    for (const status of ['MATERIALIZED', 'MATCHED', 'SKIPPED', 'CANCELLED'] as const) {
      expect(OccurrenceMatcher.forTransaction(tx(), [occ({ status })])).toEqual([]);
    }
    for (const status of ['SCHEDULED', 'DUE', 'OVERDUE'] as const) {
      expect(OccurrenceMatcher.forTransaction(tx(), [occ({ status })])).toHaveLength(1);
    }
  });

  it('la fecha debe estar a lo sumo a la ventana del vencimiento (5 días por omisión, borde inclusivo)', () => {
    expect(OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-15' }), [occ()])).toHaveLength(1);
    expect(OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-14' }), [occ()])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-25' }), [occ()])).toHaveLength(1);
    expect(OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-26' }), [occ()])).toEqual([]);
  });
});

describe('OccurrenceMatcher: tolerancias de monto', () => {
  it('[TC-COMMITMENTS-MATCH-003] FIXED ±2 %: 205.00 sobre 199.00 queda fuera y 202.98 (Δ = 3.98) entra', () => {
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('205.00') }), [occ()])).toEqual([]);
    const [edge] = OccurrenceMatcher.forTransaction(tx({ amount: bob('202.98') }), [occ()]);
    expect(edge).toMatchObject({ amountDelta: '3.98' });
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('202.99') }), [occ()])).toEqual([]);
    // por debajo también
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('195.02') }), [occ()])).toHaveLength(1);
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('195.01') }), [occ()])).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-003] ESTIMATED ±25 %: la luz de 163.40 sobre 150.00 a 2 días se sugiere', () => {
    const [c] = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-27', amount: bob('163.40') }), [
      occ({ dueDate: '2026-10-25', expected: { type: 'ESTIMATED', amount: '150.00', min: null, max: null } }),
    ]);
    expect(c).toMatchObject({ amountDelta: '13.40', dateDeltaDays: 2 });
  });

  it('MIN_MAX: el rango ampliado ±5 %; dentro del rango el monto puntúa completo', () => {
    const gym = occ({ expected: { type: 'MIN_MAX', amount: null, min: '100.00', max: '180.00' } });
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('150.00') }), [gym])[0]).toMatchObject({
      amountDelta: '0.00',
    });
    // 189.00 = 180 × 1.05 (borde); 189.01 queda fuera
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('189.00') }), [gym])[0]).toMatchObject({
      amountDelta: '9.00',
    });
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('189.01') }), [gym])).toEqual([]);
    // 95.00 = 100 × 0.95 (borde); 94.99 fuera
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('95.00') }), [gym])).toHaveLength(1);
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('94.99') }), [gym])).toEqual([]);
  });

  it('tolerancia 0 %: solo el monto exacto', () => {
    const strict = occ({ tolerances: { amountTolerancePct: '0.00', dateWindowDays: null } });
    expect(OccurrenceMatcher.forTransaction(tx(), [strict])).toHaveLength(1);
    expect(OccurrenceMatcher.forTransaction(tx({ amount: bob('199.01') }), [strict])).toEqual([]);
  });
});

describe('OccurrenceMatcher: contraparte', () => {
  it('[TC-COMMITMENTS-MATCH-004] contraparte distinta excluye; si falta en alguna no contradice', () => {
    const tigo = occ({ counterpartyId: TIGO });
    expect(OccurrenceMatcher.forTransaction(tx({ counterpartyId: ENTEL }), [tigo])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(tx({ counterpartyId: TIGO }), [tigo])[0]).toMatchObject({
      counterparty: 'MATCH',
    });
    expect(OccurrenceMatcher.forTransaction(tx(), [tigo])[0]).toMatchObject({ counterparty: 'UNKNOWN' });
    expect(OccurrenceMatcher.forTransaction(tx({ counterpartyId: TIGO }), [occ()])[0]).toMatchObject({
      counterparty: 'UNKNOWN',
    });
  });

  it('[TC-COMMITMENTS-MATCH-004] VARIABLE exige la misma contraparte presente en ambas', () => {
    const wholesale = occ({
      expected: { type: 'VARIABLE', amount: null, min: null, max: null },
      counterpartyId: SUR,
    });
    const big = tx({ amount: bob('812.30') });
    expect(OccurrenceMatcher.forTransaction(big, [wholesale])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction({ ...big, counterpartyId: ENTEL }, [wholesale])).toEqual([]);
    const [c] = OccurrenceMatcher.forTransaction({ ...big, counterpartyId: SUR }, [wholesale]);
    // monto variable 25 + fecha (1 día de 6) 25 + contraparte 20 = 70
    expect(c).toMatchObject({
      score: '70.00',
      confidence: 'MEDIUM',
      amountDelta: null,
      counterparty: 'MATCH',
    });
    // sin contraparte en la definición tampoco
    expect(
      OccurrenceMatcher.forTransaction({ ...big, counterpartyId: SUR }, [
        { ...wholesale, counterpartyId: null },
      ]),
    ).toEqual([]);
  });
});

describe('OccurrenceMatcher: tolerancias configuradas por definición', () => {
  it('[TC-COMMITMENTS-MATCH-004] 5 % y ventana de 2 días: 205.00 el 2026-10-23 no; el 2026-10-21 sí', () => {
    const internet = occ({ tolerances: { amountTolerancePct: '5.00', dateWindowDays: 2 } });
    const spent = (date: string) => tx({ businessDate: date, amount: bob('205.00') });
    expect(OccurrenceMatcher.forTransaction(spent('2026-10-23'), [internet])).toEqual([]);
    expect(OccurrenceMatcher.forTransaction(spent('2026-10-21'), [internet])).toHaveLength(1);
  });

  it('valores por omisión según el tipo y validación de rangos', () => {
    expect(resolveTolerances('FIXED', NO_TOLERANCE_OVERRIDES)).toEqual({
      amountTolerancePct: '2',
      dateWindowDays: 5,
    });
    expect(resolveTolerances('ESTIMATED', NO_TOLERANCE_OVERRIDES).amountTolerancePct).toBe('25');
    expect(resolveTolerances('MIN_MAX', NO_TOLERANCE_OVERRIDES).amountTolerancePct).toBe('5');
    expect(resolveTolerances('FIXED', { amountTolerancePct: '7.50', dateWindowDays: 0 })).toEqual({
      amountTolerancePct: '7.50',
      dateWindowDays: 0,
    });
    expect(validateToleranceOverrides({ amountTolerancePercent: '5', dateWindowDays: 2 })).toEqual({
      amountTolerancePct: '5.00',
      dateWindowDays: 2,
    });
    expect(validateToleranceOverrides({ amountTolerancePercent: null, dateWindowDays: null })).toEqual({
      amountTolerancePct: null,
      dateWindowDays: null,
    });
    for (const bad of ['-1', '100.01', 'abc', '1.234', '']) {
      expect(() => validateToleranceOverrides({ amountTolerancePercent: bad })).toThrow();
    }
    for (const bad of [-1, 16, 1.5, Number.NaN]) {
      expect(() => validateToleranceOverrides({ dateWindowDays: bad })).toThrow();
    }
    expect(validateToleranceOverrides({ dateWindowDays: 15 }).dateWindowDays).toBe(15);
    expect(validateToleranceOverrides({ amountTolerancePercent: '100' }).amountTolerancePct).toBe('100.00');
  });
});

describe('OccurrenceMatcher: ranking y ambigüedad', () => {
  const casa = occ({ occurrenceId: 'occ-casa', definitionId: 'def-casa', dueDate: '2026-10-20' });
  const oficina = occ({ occurrenceId: 'occ-oficina', definitionId: 'def-oficina', dueDate: '2026-10-22' });

  it('[TC-COMMITMENTS-MATCH-009] el gasto del 2026-10-20 ⇒ casa 90.00 primero, oficina 80.00, sin ambigüedad', () => {
    const list = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-20' }), [oficina, casa]);
    expect(list.map((c) => [c.occurrenceId, c.score, c.ambiguous])).toEqual([
      ['occ-casa', '90.00', false],
      ['occ-oficina', '80.00', false],
    ]);
  });

  it('[TC-COMMITMENTS-MATCH-009] el gasto del 2026-10-21 ⇒ ambas 85.00 y ambiguas', () => {
    const list = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-21' }), [oficina, casa]);
    expect(list.map((c) => [c.occurrenceId, c.score, c.ambiguous])).toEqual([
      ['occ-casa', '85.00', true],
      ['occ-oficina', '85.00', true],
    ]);
  });

  it('un empate fuera de los dos primeros no marca ambigüedad', () => {
    const list = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-19' }), [
      casa, // 1 día ⇒ 85
      occ({ occurrenceId: 'occ-z', dueDate: '2026-10-24' }), // 5 días ⇒ 65
      occ({ occurrenceId: 'occ-y', dueDate: '2026-10-14' }), // 5 días ⇒ 65
    ]);
    expect(list.map((c) => [c.occurrenceId, c.ambiguous])).toEqual([
      ['occ-casa', false],
      ['occ-y', false],
      ['occ-z', false],
    ]);
  });

  it('a igual puntaje y días gana el vencimiento más temprano', () => {
    const early = occ({ occurrenceId: 'occ-early', dueDate: '2026-10-20' });
    const late = occ({ occurrenceId: 'occ-late', dueDate: '2026-10-18' });
    const list = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-19' }), [early, late]);
    expect(list.map((c) => c.occurrenceId)).toEqual(['occ-late', 'occ-early']);
  });

  it('a igual puntaje gana la menor diferencia de días (monto distinto compensa)', () => {
    // 85.00 en ambas: a 1 día con monto exacto (50 + 25 + 10) y el mismo día con 1 % de desvío (45 + 30 + 10).
    const oneDay = occ({
      occurrenceId: 'occ-a',
      dueDate: '2026-10-20',
      expected: { type: 'FIXED', amount: '198.00', min: null, max: null },
    });
    const sameDay = occ({
      occurrenceId: 'occ-b',
      dueDate: '2026-10-19',
      expected: { type: 'FIXED', amount: '200.00', min: null, max: null },
      tolerances: { amountTolerancePct: '10', dateWindowDays: null },
    });
    const list = OccurrenceMatcher.forTransaction(tx({ businessDate: '2026-10-19', amount: bob('198.00') }), [
      oneDay,
      sameDay,
    ]);
    expect(list.map((c) => [c.occurrenceId, c.score])).toEqual([
      ['occ-b', '85.00'],
      ['occ-a', '85.00'],
    ]);
  });

  it('forOccurrence: varias transacciones candidatas de una ocurrencia, ordenadas y con ambigüedad', () => {
    const list = OccurrenceMatcher.forOccurrence(casa, [
      tx({ transactionId: 'tx-a', businessDate: '2026-10-21' }),
      tx({ transactionId: 'tx-b', businessDate: '2026-10-19' }),
      tx({ transactionId: 'tx-c', businessDate: '2026-10-20' }),
    ]);
    expect(list.map((c) => [c.transactionId, c.score, c.ambiguous])).toEqual([
      ['tx-c', '90.00', false],
      ['tx-b', '85.00', false],
      ['tx-a', '85.00', false],
    ]);
    const tied = OccurrenceMatcher.forOccurrence(casa, [
      tx({ transactionId: 'tx-a', businessDate: '2026-10-21' }),
      tx({ transactionId: 'tx-b', businessDate: '2026-10-19' }),
    ]);
    expect(tied.map((c) => [c.transactionId, c.ambiguous])).toEqual([
      ['tx-b', true],
      ['tx-a', true],
    ]);
  });

  it('evaluate de un par suelto devuelve null si no es compatible', () => {
    expect(OccurrenceMatcher.evaluate(tx({ amount: bob('500.00') }), occ())).toBeNull();
    expect(OccurrenceMatcher.evaluate(tx(), occ())?.score).toBe('85.00');
  });
});

describe('OccurrenceMatcher: propiedades', () => {
  const amountArb = fc
    .integer({ min: 1, max: 100_000 })
    .map((c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`);
  const dayArb = fc.integer({ min: 1, max: 28 }).map((d) => `2026-10-${String(d).padStart(2, '0')}`);
  const specArb: fc.Arbitrary<MatchOccurrence['expected']> = fc.oneof(
    amountArb.map((amount) => ({ type: 'FIXED' as const, amount, min: null, max: null })),
    amountArb.map((amount) => ({ type: 'ESTIMATED' as const, amount, min: null, max: null })),
    fc.tuple(amountArb, amountArb).map(([a, b]) => {
      const [min, max] = Number(a) <= Number(b) ? [a, b] : [b, a];
      return { type: 'MIN_MAX' as const, amount: null, min, max };
    }),
    fc.constant({ type: 'VARIABLE' as const, amount: null, min: null, max: null }),
  );

  it(
    'el puntaje siempre está en 0..100, la confianza es coherente con él y el resultado es determinista',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(
          specArb,
          amountArb,
          dayArb,
          dayArb,
          fc.constantFrom(null, TIGO),
          fc.constantFrom(null, TIGO),
          fc.integer({ min: 0, max: 15 }),
          fc.integer({ min: 0, max: 100 }),
          (expected, value, due, spent, txCp, occCp, window, pct) => {
            const o = occ({
              expected,
              dueDate: due,
              counterpartyId: occCp,
              tolerances: { amountTolerancePct: String(pct), dateWindowDays: window },
            });
            const t = tx({ amount: bob(value), businessDate: spent, counterpartyId: txCp });
            const c = OccurrenceMatcher.evaluate(t, o);
            expect(OccurrenceMatcher.evaluate(t, o)).toEqual(c);
            if (!c) return;
            const score = Number(c.score);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
            expect(c.confidence).toBe(score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW');
            expect(c.dateDeltaDays).toBeLessThanOrEqual(window);
            if (expected.type === 'VARIABLE') expect(c.counterparty).toBe('MATCH');
            // La contraparte jamás contradice.
            if (txCp !== null && occCp !== null) expect(txCp).toBe(occCp);
          },
        ),
        { numRuns: process.env['NIGHTLY'] ? 10_000 : 200 },
      );
    },
  );

  it(
    'un gasto con el monto exacto, la misma cuenta y el día del vencimiento siempre es candidato de un FIXED',
    { timeout: 60_000 },
    () => {
      fc.assert(
        fc.property(amountArb, dayArb, fc.integer({ min: 0, max: 15 }), (value, due, window) => {
          fc.pre(Number(value) > 0);
          const o = occ({
            expected: { type: 'FIXED', amount: value, min: null, max: null },
            dueDate: due,
            tolerances: { amountTolerancePct: '0', dateWindowDays: window },
          });
          const [c] = OccurrenceMatcher.forTransaction(tx({ amount: bob(value), businessDate: due }), [o]);
          expect(c).toMatchObject({ score: '90.00', amountDelta: dec0(value) });
        }),
        { numRuns: process.env['NIGHTLY'] ? 10_000 : 200 },
      );
    },
  );
});

const dec0 = (value: string): string =>
  `0.${'0'.repeat(value.split('.')[1]?.length ?? 0)}`.replace(/\.$/, '');
