import { LocalDate, currency, dec, type DomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateSchedule, type AmortizationInput } from './amortization-calculator.js';
import type { ScheduleInstallment } from './loan-types.js';
import {
  recalculatePrepayment,
  recalculateRateChange,
  restitute,
  summarizeTail,
  type TailParameters,
  type TailTerms,
} from './schedule-recalculator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);
const sum = (xs: readonly string[]) => xs.reduce((a, x) => a.plus(x), dec('0'));

const french = (over: Partial<AmortizationInput> = {}): AmortizationInput => ({
  currency: BOB,
  principal: '12000.00',
  annualRate: '0.12',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  installments: 12,
  accrualStart: d('2026-10-15'),
  firstDueDate: d('2026-11-15'),
  ...over,
});

const termsOf = (input: AmortizationInput, rate = input.annualRate): TailTerms => ({
  currency: input.currency,
  method: input.method ?? 'FRENCH',
  dayCount: input.dayCount,
  frequency: input.frequency,
  charges: input.charges ?? {},
  firstInstallmentNo: input.firstInstallmentNo ?? 1,
  rates: [{ effectiveFrom: input.accrualStart.toString(), annualRate: rate }],
});

/** Cuotas 4..12 (cuotas 1 a 3 pagadas) del préstamo de los scenarios. */
function afterThreePaid(input = french()) {
  const schedule = calculateSchedule(input);
  const unpaid = schedule.installments.slice(3);
  return {
    schedule,
    unpaid,
    terms: termsOf(input),
    balance: (unpaid[0] as ScheduleInstallment).openingBalance,
    parameters: { installmentAmount: schedule.installmentAmount } as TailParameters,
  };
}

describe('ScheduleRecalculator — prepago (add-loan-amortization-advanced)', () => {
  it('el préstamo de los scenarios: 12 cuotas de 1066.19, interés total 794.23, pendiente 9132.95 tras 3 cuotas', () => {
    const w = afterThreePaid();
    expect(w.schedule.installmentAmount).toBe('1066.19');
    expect(w.balance).toBe('9132.95');
    expect(sum(w.schedule.installments.map((c) => c.interest)).toFixed(2)).toBe('794.23');
    expect(sum(w.unpaid.map((c) => c.interest)).toFixed(2)).toBe('462.71');
  });

  it('[TC-DEBT-AMORT-031] reducir plazo: cuotas 4 a 9 de 1066.19 y la 9 de 1017.22; interés 462.71 → 215.22', () => {
    const w = afterThreePaid();
    const r = recalculatePrepayment({
      terms: w.terms,
      rows: w.unpaid,
      balance: w.balance,
      amount: '3000.00',
      option: 'REDUCE_TERM',
      parameters: w.parameters,
    });
    const s = r.installments;
    expect(s.map((c) => c.n)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(s.slice(0, 5).every((c) => c.total === '1066.19')).toBe(true);
    expect(s[5]).toMatchObject({ n: 9, dueDate: '2027-07-15', total: '1017.22' });
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('6132.95');
    expect(s[0]!.openingBalance).toBe('6132.95');
    const summary = summarizeTail(s);
    expect(summary.remainingInterest).toBe('215.22');
    expect(dec(summarizeTail(w.unpaid).remainingInterest).minus(summary.remainingInterest).toFixed(2)).toBe(
      '247.49',
    );
    expect(r.parameters.installmentAmount).toBe('1066.19');
  });

  it('[TC-DEBT-AMORT-032] reducir cuota: cuotas 4 a 12 de 715.96 y la 12 de 715.99; interés 462.71 → 310.72', () => {
    const w = afterThreePaid();
    const r = recalculatePrepayment({
      terms: w.terms,
      rows: w.unpaid,
      balance: w.balance,
      amount: '3000.00',
      option: 'REDUCE_INSTALLMENT',
      parameters: w.parameters,
    });
    const s = r.installments;
    expect(s.map((c) => c.n)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.slice(0, 8).every((c) => c.total === '715.96')).toBe(true);
    expect(s[8]).toMatchObject({ dueDate: '2027-10-15', total: '715.99' });
    expect(s.map((c) => c.dueDate)).toEqual(w.unpaid.map((c) => c.dueDate));
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('6132.95');
    const summary = summarizeTail(s);
    expect(summary.remainingInterest).toBe('310.72');
    expect(dec(summarizeTail(w.unpaid).remainingInterest).minus(summary.remainingInterest).toFixed(2)).toBe(
      '151.99',
    );
    expect(r.parameters.installmentAmount).toBe('715.96');
  });

  it('un prepago igual al saldo salda el préstamo (sin cuotas nuevas) y uno mayor es LOAN_OVERPAYMENT', () => {
    const w = afterThreePaid();
    const base = { terms: w.terms, rows: w.unpaid, balance: w.balance, option: 'REDUCE_TERM' as const };
    const paid = recalculatePrepayment({ ...base, amount: '9132.95', parameters: w.parameters });
    expect(paid.installments).toEqual([]);
    let error: unknown;
    try {
      recalculatePrepayment({ ...base, amount: '9132.96', parameters: w.parameters });
    } catch (e) {
      error = e;
    }
    expect((error as DomainError).code).toBe('LOAN_OVERPAYMENT');
  });

  it('alemán: reducir plazo conserva el principal por cuota y reducir cuota lo reparte entre las cuotas restantes', () => {
    const input = french({ method: 'GERMAN' });
    const schedule = calculateSchedule(input);
    const unpaid = schedule.installments.slice(3);
    const terms = termsOf(input);
    const balance = unpaid[0]!.openingBalance;
    expect(balance).toBe('9000.00');
    const term = recalculatePrepayment({
      terms,
      rows: unpaid,
      balance,
      amount: '3000.00',
      option: 'REDUCE_TERM',
      parameters: { principalPerInstallment: '1000.00' },
    });
    expect(term.installments.map((c) => c.principal)).toEqual([
      '1000.00',
      '1000.00',
      '1000.00',
      '1000.00',
      '1000.00',
      '1000.00',
    ]);
    const inst = recalculatePrepayment({
      terms,
      rows: unpaid,
      balance,
      amount: '3000.00',
      option: 'REDUCE_INSTALLMENT',
      parameters: { principalPerInstallment: '1000.00' },
    });
    expect(inst.installments).toHaveLength(9);
    expect(inst.installments[0]!.principal).toBe('666.67');
    expect(inst.installments[8]!.principal).toBe('666.64');
    expect(sum(inst.installments.map((c) => c.principal)).toFixed(2)).toBe('6000.00');
  });

  it('capital fijo: reducir plazo mantiene el principal fijo y el balloon absorbe; reducir cuota lo reduce en proporción', () => {
    const input = french({
      principal: '10000.00',
      method: 'FIXED_PRINCIPAL',
      fixedPrincipalAmount: '500.00',
    });
    const schedule = calculateSchedule(input);
    const unpaid = schedule.installments.slice(3);
    const terms = termsOf(input);
    const balance = unpaid[0]!.openingBalance;
    expect(balance).toBe('8500.00');
    const term = recalculatePrepayment({
      terms,
      rows: unpaid,
      balance,
      amount: '2000.00',
      option: 'REDUCE_TERM',
      parameters: { fixedPrincipalAmount: '500.00' },
    });
    // 6500.00 restante: 8 cuotas de 500.00 y el balloon de 2500.00 en la cuota 12
    expect(term.installments.map((c) => c.principal)).toEqual([
      '500.00',
      '500.00',
      '500.00',
      '500.00',
      '500.00',
      '500.00',
      '500.00',
      '500.00',
      '2500.00',
    ]);
    const inst = recalculatePrepayment({
      terms,
      rows: unpaid,
      balance,
      amount: '2000.00',
      option: 'REDUCE_INSTALLMENT',
      parameters: { fixedPrincipalAmount: '500.00' },
    });
    // 500.00 × 6500.00 / 8500.00 = 382.35; el balloon absorbe el resto
    expect(inst.installments[0]!.principal).toBe('382.35');
    expect(inst.installments[8]!.principal).toBe('3441.20');
    expect(sum(inst.installments.map((c) => c.principal)).toFixed(2)).toBe('6500.00');
  });
});

describe('ScheduleRecalculator — cambio de tasa', () => {
  const sixPaid = () => {
    const input = french();
    const schedule = calculateSchedule(input);
    const unpaid = schedule.installments.slice(6);
    return { input, schedule, unpaid, terms: termsOf(input), balance: unpaid[0]!.openingBalance };
  };

  it('[TC-DEBT-AMORT-037] 15 % desde 2027-04-15 con 6 cuotas pagadas: cuotas 7 a 12 de 1075.36, interés de la 7 de 77.24', () => {
    const w = sixPaid();
    expect(w.balance).toBe('6179.02');
    const r = recalculateRateChange({
      terms: w.terms,
      rows: w.unpaid,
      balance: w.balance,
      newRate: '0.15',
      effectiveFrom: '2027-04-15',
    });
    const s = r.installments;
    expect(s.map((c) => c.n)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(s[0]).toMatchObject({ total: '1075.36', interest: '77.24' });
    expect(s.slice(0, 5).every((c) => c.total === '1075.36')).toBe(true);
    expect(sum(s.map((c) => c.principal)).toFixed(2)).toBe('6179.02');
    expect(s.map((c) => c.dueDate)).toEqual(w.unpaid.map((c) => c.dueDate));
    expect(r.parameters.installmentAmount).toBe('1075.36');
  });

  it('[TC-DEBT-AMORT-039] una vigencia anterior al inicio del primer periodo no pagado se rechaza', () => {
    const w = sixPaid();
    let error: unknown;
    try {
      recalculateRateChange({
        terms: w.terms,
        rows: w.unpaid,
        balance: w.balance,
        newRate: '0.15',
        effectiveFrom: '2027-02-01',
      });
    } catch (e) {
      error = e;
    }
    expect((error as DomainError).code).toBe('LOAN_CHANGE_DATE_INVALID');
  });

  it('sin prorrateo: una vigencia dentro de un periodo ya iniciado aplica desde el periodo siguiente', () => {
    const w = sixPaid();
    // 2027-05-01 cae en el periodo de la cuota 7 (2027-04-15 → 2027-05-15): la cuota 7 conserva su monto
    const r = recalculateRateChange({
      terms: w.terms,
      rows: w.unpaid,
      balance: w.balance,
      newRate: '0.15',
      effectiveFrom: '2027-05-01',
    });
    expect(r.installments[0]).toEqual(w.unpaid[0]);
    expect(r.installments[1]!.interest).toBe(
      dec(r.installments[1]!.openingBalance).times('0.15').div(12).toFixed(2, 6),
    );
    expect(sum(r.installments.map((c) => c.principal)).toFixed(2)).toBe('6179.02');
  });
});

describe('ScheduleRecalculator — restitución', () => {
  it('[TC-DEBT-LOAN-050] al anular el prepago las cuotas 4 a 12 vuelven a 1066.19 (la 12 de 1066.14) como en la versión 1', () => {
    const w = afterThreePaid();
    const r = restitute({ terms: w.terms, rows: w.unpaid, balance: w.balance, parameters: w.parameters });
    expect(r.installments).toEqual(w.unpaid);
    expect(r.installments[8]!.total).toBe('1066.14');
    expect(r.installments.slice(0, 8).every((c) => c.total === '1066.19')).toBe(true);
  });
});

// ---------- PBT (INV-017) ----------

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 20_000 : 300;
const PBT_TIMEOUT = env?.NIGHTLY ? 3_600_000 : 120_000;

const arbLoan = fc.record({
  units: fc.bigInt({ min: 100_000n, max: 500_000_000n }),
  bp: fc.integer({ min: 0, max: 6_000 }),
  n: fc.integer({ min: 2, max: 120 }),
  method: fc.constantFrom<'FRENCH' | 'GERMAN'>('FRENCH', 'GERMAN'),
  paid: fc.integer({ min: 0, max: 118 }),
  share: fc.integer({ min: 1, max: 99 }),
  rateBp: fc.integer({ min: 0, max: 6_000 }),
  day: fc.integer({ min: 1, max: 28 }),
});

describe('ScheduleRecalculator — propiedades', () => {
  it('[TC-DEBT-AMORT-033] contraejemplo de redondeo: cuota original bajo la nivelada del saldo nuevo, reducir plazo devenga centavos más', () => {
    // 1000.00 al 53.65 % a 112 cuotas, 95 pagadas, prepago del 1 %: la cuota original (45.04) queda 3 centavos bajo
    // la nivelada del saldo nuevo (45.07), así que la última cuota absorbe un residuo mayor.
    const input = french({
      principal: '1000.00',
      annualRate: '0.5365',
      installments: 112,
      accrualStart: d('2026-10-01'),
      firstDueDate: d('2026-11-01'),
    });
    const schedule = calculateSchedule(input);
    const unpaid = schedule.installments.slice(95);
    const balance = (unpaid[0] as ScheduleInstallment).openingBalance;
    const prepay = dec(balance).times(1).div(100).toDecimalPlaces(2, 1).toFixed(2);
    const common = {
      terms: termsOf(input),
      rows: unpaid,
      balance,
      amount: prepay,
      parameters: { installmentAmount: schedule.installmentAmount } as TailParameters,
    };
    const term = recalculatePrepayment({ ...common, option: 'REDUCE_TERM' });
    const inst = recalculatePrepayment({ ...common, option: 'REDUCE_INSTALLMENT' });
    expect(term.installments.length).toBe(inst.installments.length);
    expect(dec(term.parameters.installmentAmount ?? '0').lt(inst.parameters.installmentAmount ?? '0')).toBe(
      true,
    );
    const termInterest = sum(term.installments.map((c) => c.interest));
    const instInterest = sum(inst.installments.map((c) => c.interest));
    expect(termInterest.gt(instInterest)).toBe(true);
    // la diferencia es de centavos, no un error de magnitud
    expect(termInterest.minus(instInterest).lt('1')).toBe(true);
  });

  it(
    '[TC-DEBT-AMORT-033] el recálculo suma el principal pendiente, conserva fechas y reducir plazo no paga más interés',
    () => {
      fc.assert(
        fc.property(arbLoan, (p) => {
          const principal = dec(p.units.toString()).div(100).toFixed(2);
          const start = LocalDate.of(2026, 10, p.day);
          const input = french({
            principal,
            annualRate: dec(String(p.bp)).div(10000).toFixed(),
            installments: p.n,
            method: p.method,
            accrualStart: start,
            firstDueDate: LocalDate.of(2026, 11, p.day),
          });
          const schedule = calculateSchedule(input);
          const paid = Math.min(p.paid, p.n - 1);
          const unpaid = schedule.installments.slice(paid);
          const terms = termsOf(input);
          const balance = unpaid[0]!.openingBalance;
          const parameters: TailParameters =
            p.method === 'FRENCH'
              ? { installmentAmount: schedule.installmentAmount }
              : { principalPerInstallment: schedule.installments[0]!.principal };
          const prepay = dec(balance).times(p.share).div(100).toDecimalPlaces(2, 1);
          if (!prepay.gt(0) || prepay.gte(balance)) return true;
          const common = { terms, rows: unpaid, balance, amount: prepay.toFixed(2), parameters };
          const term = recalculatePrepayment({ ...common, option: 'REDUCE_TERM' });
          const inst = recalculatePrepayment({ ...common, option: 'REDUCE_INSTALLMENT' });
          const outstanding = dec(balance).minus(prepay);
          for (const r of [term, inst]) {
            expect(sum(r.installments.map((c) => c.principal)).eq(outstanding)).toBe(true);
            expect(r.installments[r.installments.length - 1]!.closingBalance).toBe('0.00');
            r.installments.forEach((c, i) => {
              expect(c.dueDate).toBe(unpaid[i]!.dueDate);
              expect(c.n).toBe(unpaid[i]!.n);
              expect(sum([c.principal, c.interest, c.fees, c.insurance, c.taxes]).eq(c.total)).toBe(true);
            });
          }
          expect(term.installments.length).toBeLessThanOrEqual(inst.installments.length);
          // reducir plazo nunca da más interés restante que reducir cuota, mientras la cuota (o el principal por cuota)
          // que conserva sea al menos la recalculada: la cuota original está redondeada al centavo y, con saldos
          // pequeños y tasas altas, puede quedar unos centavos bajo la nivelada del saldo nuevo; entonces el plazo
          // restante absorbe un residuo mayor y devenga algo más de interés (redondeo legítimo, no un defecto).
          const keptByTerm = dec(
            term.parameters.installmentAmount ?? term.parameters.principalPerInstallment ?? '0',
          );
          const levelOfInst = dec(
            inst.parameters.installmentAmount ?? inst.parameters.principalPerInstallment ?? '0',
          );
          if (keptByTerm.gte(levelOfInst)) {
            expect(
              sum(term.installments.map((c) => c.interest)).lte(
                sum(inst.installments.map((c) => c.interest)),
              ),
            ).toBe(true);
          }
          // cambio de tasa: Σ principal = saldo y mismas fechas
          const rate = recalculateRateChange({
            terms,
            rows: unpaid,
            balance,
            newRate: dec(String(p.rateBp)).div(10000).toFixed(),
            effectiveFrom: unpaid[0]!.periodStart,
          });
          expect(sum(rate.installments.map((c) => c.principal)).eq(balance)).toBe(true);
          expect(rate.installments.map((c) => c.dueDate)).toEqual(unpaid.map((c) => c.dueDate));
          return true;
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PBT_TIMEOUT,
  );
});
