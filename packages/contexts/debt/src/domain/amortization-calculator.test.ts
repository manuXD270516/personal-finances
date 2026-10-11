import { DomainError, LocalDate, Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AmortizationCalculator,
  calculateSchedule,
  previewSchedule,
  type AmortizationInput,
} from './amortization-calculator.js';
import { DAY_COUNTS, LOAN_FREQUENCIES, MAX_LOAN_INSTALLMENTS } from './loan-types.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const d = (s: string) => LocalDate.parse(s);

/** Préstamo vehicular de los fixtures: 50000.00 BOB, 11.50 %, 30/360, mensual, 24 cuotas. */
const vehicular = (over: Partial<AmortizationInput> = {}): AmortizationInput => ({
  currency: BOB,
  principal: '50000.00',
  annualRate: '0.115',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  installments: 24,
  accrualStart: d('2026-10-15'),
  firstDueDate: d('2026-11-15'),
  ...over,
});

const sum = (xs: readonly string[]) => xs.reduce((a, x) => a.plus(x), dec('0'));

describe('AmortizationCalculator — cronograma francés', () => {
  it('[TC-DEBT-AMORT-001] 1000.00 al 12 % en 3 cuotas: 340.02, 340.02 y 340.03', () => {
    const { installments: s } = calculateSchedule({
      currency: BOB,
      principal: '1000.00',
      annualRate: '0.12',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      installments: 3,
      accrualStart: d('2026-10-15'),
      firstDueDate: d('2026-11-15'),
    });
    expect(s.map((c) => [c.total, c.principal, c.interest])).toEqual([
      ['340.02', '330.02', '10.00'],
      ['340.02', '333.32', '6.70'],
      ['340.03', '336.66', '3.37'],
    ]);
    expect(s.map((c) => c.closingBalance)).toEqual(['669.98', '336.66', '0.00']);
    expect(s.map((c) => c.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('[TC-DEBT-AMORT-002] 50000.00 a 24 cuotas: cuota 2342.02, última 2341.90 e interés total 6208.36', () => {
    const r = calculateSchedule(vehicular());
    const s = r.installments;
    expect(r.installmentAmount).toBe('2342.02');
    expect(r.leveled).toBe(false);
    expect(s).toHaveLength(24);
    expect([s[0]!.interest, s[0]!.principal]).toEqual(['479.17', '1862.85']);
    expect([s[1]!.interest, s[1]!.principal]).toEqual(['461.31', '1880.71']);
    const last = s[23]!;
    expect([last.dueDate, last.total, last.principal, last.interest]).toEqual([
      '2028-10-15',
      '2341.90',
      '2319.67',
      '22.23',
    ]);
    expect(sum(s.map((c) => c.interest)).toFixed(2)).toBe('6208.36');
  });

  it('[TC-DEBT-AMORT-003] con tasa cero: 333.33, 333.33 y 333.34 sin interés', () => {
    const { installments: s } = calculateSchedule(
      vehicular({ principal: '1000.00', annualRate: '0', installments: 3 }),
    );
    expect(s.map((c) => c.total)).toEqual(['333.33', '333.33', '333.34']);
    expect(s.every((c) => c.interest === '0.00')).toBe(true);
  });

  it('[TC-DEBT-AMORT-004] la suma del principal es exactamente 50000.00 y el saldo final 0.00', () => {
    const s = calculateSchedule(vehicular()).installments;
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('50000.00');
    expect(s[23]!.closingBalance).toBe('0.00');
    expect(s[0]!.openingBalance).toBe('50000.00');
  });

  it('[TC-DEBT-AMORT-006] ACT/365: interés de la cuota 1 de 488.36 (31 días)', () => {
    const s = calculateSchedule(vehicular({ dayCount: 'ACT_365' })).installments;
    expect(s[0]!.interest).toBe('488.36');
    expect(s[0]!.periodStart).toBe('2026-10-15');
    expect(s[0]!.periodEnd).toBe('2026-11-15');
  });

  it('[TC-DEBT-AMORT-007] ACT/360: interés de la cuota 1 de 495.14 y cuota nivelada 2345.94 (D153)', () => {
    const r = calculateSchedule(vehicular({ dayCount: 'ACT_360' }));
    expect(r.installments[0]!.interest).toBe('495.14');
    expect(r.leveled).toBe(true);
    expect(r.installmentAmount).toBe('2345.94');
    const last = r.installments[23]!;
    expect(sum([last.principal, last.interest]).toFixed(2)).toBe('2345.90');
    expect(sum(r.installments.map((c) => c.principal)).toFixed(2)).toBe('50000.00');
  });

  it('[TC-DEBT-AMORT-008] trimestral 12000.00 al 12 % en 4 cuotas', () => {
    const s = calculateSchedule({
      currency: BOB,
      principal: '12000.00',
      annualRate: '0.12',
      dayCount: 'D30_360',
      frequency: 'QUARTERLY',
      installments: 4,
      accrualStart: d('2026-10-15'),
      firstDueDate: d('2027-01-15'),
    }).installments;
    expect(s.map((c) => c.total)).toEqual(['3228.32', '3228.32', '3228.32', '3228.34']);
    expect(s.map((c) => c.interest)).toEqual(['360.00', '273.95', '185.32', '94.03']);
    expect(s.map((c) => c.dueDate)).toEqual(['2027-01-15', '2027-04-15', '2027-07-15', '2027-10-15']);
  });

  it('[TC-DEBT-AMORT-009] primera cuota el día 31: 2027-02-28, 2027-03-31 y 2027-04-30', () => {
    const s = calculateSchedule(
      vehicular({ accrualStart: d('2026-12-31'), firstDueDate: d('2027-01-31'), installments: 4 }),
    ).installments;
    expect(s.map((c) => c.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('[TC-DEBT-AMORT-010] primer periodo de 44 días 30/360: interés 702.78 y Σ principal intacta (cuota nivelada)', () => {
    const r = calculateSchedule(vehicular({ accrualStart: d('2026-10-01') }));
    expect(r.installments[0]!.interest).toBe('702.78');
    expect(r.leveled).toBe(true);
    expect(sum(r.installments.map((c) => c.principal)).toFixed(2)).toBe('50000.00');
    const last = r.installments[23]!;
    const lastDue = sum([last.principal, last.interest]);
    expect(lastDue.minus(r.installmentAmount).abs().lte('0.05')).toBe(true);
  });

  it('[TC-DEBT-AMORT-011] comisión fija 10.00 y seguro 0.0400 % mensual sobre el saldo', () => {
    const s = calculateSchedule(
      vehicular({
        charges: {
          fees: { mode: 'FIXED', value: '10.00' },
          insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
        },
      }),
    ).installments;
    expect(s[0]).toMatchObject({
      total: '2372.02',
      principal: '1862.85',
      interest: '479.17',
      fees: '10.00',
      insurance: '20.00',
      taxes: '0.00',
    });
    expect(s[1]).toMatchObject({ total: '2371.27', insurance: '19.25', openingBalance: '48137.15' });
    expect(s[23]).toMatchObject({ total: '2352.83', insurance: '0.93' });
    // los cargos no alteran principal ni interés
    const sinCargos = calculateSchedule(vehicular()).installments;
    expect(s.map((c) => [c.principal, c.interest])).toEqual(sinCargos.map((c) => [c.principal, c.interest]));
  });

  it('préstamo en curso: 30000.00 al 11.50 %, cuotas 7..24, devengo desde asOf', () => {
    const s = calculateSchedule({
      currency: BOB,
      principal: '30000.00',
      annualRate: '0.115',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      installments: 18,
      firstInstallmentNo: 7,
      accrualStart: d('2026-10-15'),
      firstDueDate: d('2026-11-15'),
    }).installments;
    expect(s[0]!.n).toBe(7);
    expect(s[17]!.n).toBe(24);
    expect(s[0]!.total).toBe('1822.50');
    expect(s[16]!.total).toBe('1822.50');
    expect(s[17]!.total).toBe('1822.53');
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('30000.00');
  });

  it('vista previa: es la misma función y es determinista', () => {
    expect(previewSchedule).toBe(calculateSchedule);
    expect(AmortizationCalculator.calculate(vehicular())).toEqual(calculateSchedule(vehicular()));
  });

  it('una sola cuota: devuelve principal más el interés del periodo', () => {
    const s = calculateSchedule(
      vehicular({ installments: 1, principal: '1000.00', annualRate: '0.12' }),
    ).installments;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      principal: '1000.00',
      interest: '10.00',
      total: '1010.00',
      closingBalance: '0.00',
    });
  });

  it('amortización negativa en una cuota intermedia: VALIDATION_FAILED / NEGATIVE_AMORTIZATION', () => {
    // Primer periodo de ~11 meses al 100 % con 12 cuotas: el interés del primer periodo supera la cuota.
    let error: unknown;
    try {
      calculateSchedule({
        currency: BOB,
        principal: '1000.00',
        annualRate: '1',
        dayCount: 'ACT_360',
        frequency: 'MONTHLY',
        installments: 12,
        accrualStart: d('2026-01-01'),
        firstDueDate: d('2026-12-01'),
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    expect((error as DomainError).details).toMatchObject({ reason: 'NEGATIVE_AMORTIZATION' });
  });

  it('rechaza entradas fuera de rango', () => {
    expect(() => calculateSchedule(vehicular({ installments: 0 }))).toThrow(DomainError);
    expect(() => calculateSchedule(vehicular({ installments: 601 }))).toThrow(DomainError);
    expect(() => calculateSchedule(vehicular({ annualRate: '1.5' }))).toThrow(DomainError);
    expect(() => calculateSchedule(vehicular({ principal: '0.00' }))).toThrow(DomainError);
    expect(() => calculateSchedule(vehicular({ firstDueDate: d('2026-10-15') }))).toThrow(DomainError);
    expect(() => calculateSchedule(vehicular({ principal: '10.001' }))).toThrow(DomainError);
  });
});

// ---------- PBT (INV-017, INV-016) ----------

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 100_000 : 1000;
const PBT_TIMEOUT = env?.NIGHTLY ? 3_600_000 : 120_000;

const arbDate = fc
  .tuple(
    fc.integer({ min: 2020, max: 2040 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([y, m, day]) => LocalDate.of(y, m, Math.min(day, LocalDate.daysInMonth(y, m))));

const arbInput: fc.Arbitrary<AmortizationInput> = fc
  .record({
    cur: fc.constantFrom(BOB, USDT),
    unitsBob: fc.bigInt({ min: 1n, max: 1_000_000_000n }),
    unitsUsdt: fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
    // tasa en puntos básicos de 0.01 %: 0..10000 (0 %..100 %), con sesgo a tasas típicas
    bp: fc.oneof(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 3_000 })),
    installments: fc.oneof(
      fc.integer({ min: 1, max: MAX_LOAN_INSTALLMENTS }),
      fc.integer({ min: 1, max: 60 }),
    ),
    dayCount: fc.constantFrom(...DAY_COUNTS),
    frequency: fc.constantFrom(...LOAN_FREQUENCIES),
    accrual: arbDate,
    gap: fc.integer({ min: 1, max: 60 }),
    feeUnits: fc.option(fc.bigInt({ min: 0n, max: 5_000n }), { nil: undefined }),
    insuranceBp: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
  })
  .map((r): AmortizationInput => {
    const cur = r.cur;
    const principal = Money.ofMinorUnits(cur === BOB ? r.unitsBob : r.unitsUsdt, cur).toFixed();
    return {
      currency: cur,
      principal,
      annualRate: dec(String(r.bp)).div('10000').toFixed(),
      dayCount: r.dayCount,
      frequency: r.frequency,
      installments: r.installments,
      accrualStart: r.accrual,
      firstDueDate: r.accrual.plusDays(r.gap),
      charges: {
        ...(r.feeUnits !== undefined && {
          fees: { mode: 'FIXED' as const, value: Money.ofMinorUnits(r.feeUnits, cur).toFixed() },
        }),
        ...(r.insuranceBp !== undefined && {
          insurance: {
            mode: 'RATE_ON_BALANCE' as const,
            value: dec(String(r.insuranceBp)).div('10000').toFixed(),
          },
        }),
      },
    };
  });

/** Calcula; la amortización negativa es un resultado válido (se rechaza, no se modela). */
function tryCalculate(input: AmortizationInput) {
  try {
    return calculateSchedule(input);
  } catch (e) {
    if (
      e instanceof DomainError &&
      e.code === 'VALIDATION_FAILED' &&
      e.details['reason'] === 'NEGATIVE_AMORTIZATION'
    ) {
      return null;
    }
    throw e;
  }
}

describe('AmortizationCalculator — propiedades (INV-017, INV-016)', () => {
  it(
    '[TC-DEBT-AMORT-005] Σ principal = P, componentes ≥ 0, total = Σ componentes, saldo final 0, escala y determinismo',
    () => {
      fc.assert(
        fc.property(arbInput, (input) => {
          const r = tryCalculate(input);
          if (r === null) return true;
          const s = r.installments;
          expect(s).toHaveLength(input.installments);
          expect(sum(s.map((c) => c.principal)).eq(input.principal)).toBe(true);
          expect(s[s.length - 1]!.closingBalance).toBe(Money.zero(input.currency).toFixed());
          let opening = dec(input.principal);
          for (const c of s) {
            for (const f of [c.principal, c.interest, c.fees, c.insurance, c.taxes, c.total]) {
              expect(dec(f).gte(0)).toBe(true);
              expect(f.split('.')[1]?.length ?? 0).toBe(input.currency.scale);
            }
            expect(sum([c.principal, c.interest, c.fees, c.insurance, c.taxes]).eq(c.total)).toBe(true);
            expect(dec(c.openingBalance).eq(opening)).toBe(true);
            opening = opening.minus(c.principal);
            expect(dec(c.closingBalance).eq(opening)).toBe(true);
            expect(opening.gte(0)).toBe(true);
          }
          expect(calculateSchedule(input)).toEqual(r);
          return true;
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PBT_TIMEOUT,
  );
});
