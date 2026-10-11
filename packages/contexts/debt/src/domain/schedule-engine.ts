import { DomainError, type LocalDate } from '@pf/shared-kernel';
import { RATE_UNIT, divHalfEven, fmt, type ChargeCalc } from './amortization-math.js';
import type { ScheduleInstallment } from './loan-types.js';

/**
 * Motor de filas del cronograma (openspec add-loan-amortization-advanced, decisión 1 y 3): una sola implementación del
 * recorrido saldo → cuota que comparten el calculador (cronograma inicial), el `ScheduleRecalculator` (prepago, cambio
 * de tasa, restitución) y el `PayoffSimulator`. Puro: unidades menores `bigint`, un único redondeo HALF_EVEN por
 * componente y la última cuota absorbe el residuo (INV-017).
 */

/** Periodo de devengo de una cuota con la tasa que lo rige (fracción escalada a 10^18). */
export interface EnginePeriod {
  readonly n: number;
  readonly dueDate: LocalDate;
  readonly periodStart: LocalDate;
  readonly days: number;
  readonly rate: bigint;
}

export interface EngineCharges {
  readonly fees: ChargeCalc;
  readonly insurance: ChargeCalc;
  readonly taxes: ChargeCalc;
}

/**
 * Cómo se parte la cuota entre principal e interés:
 * - `LEVEL` (francés): cuota fija `installment` = principal + interés.
 * - `CONSTANT` (alemán y capital fijo): principal fijo por cuota.
 * - `GIVEN`: principales dados por cuota (cambio de tasa sobre alemán o capital fijo).
 * En todos la última cuota disponible absorbe el saldo.
 */
export type PrincipalPolicy =
  | { readonly kind: 'LEVEL'; readonly installment: bigint }
  | { readonly kind: 'CONSTANT'; readonly principal: bigint }
  | { readonly kind: 'GIVEN'; readonly principals: readonly bigint[] };

export interface EngineInput {
  readonly scale: number;
  /** 360 o 365. */
  readonly denominator: bigint;
  readonly monthsPerPeriod: number;
  readonly charges: EngineCharges;
  readonly opening: bigint;
  readonly periods: readonly EnginePeriod[];
  readonly policy: PrincipalPolicy;
  /** Termina en la cuota que salda el saldo (reducir plazo); si no, conserva todas las cuotas. */
  readonly stopWhenPaid?: boolean;
}

export const interestFor = (
  balance: bigint,
  period: Pick<EnginePeriod, 'rate' | 'days'>,
  denominator: bigint,
): bigint => divHalfEven(balance * period.rate * BigInt(period.days), RATE_UNIT * denominator);

export const chargeFor = (calc: ChargeCalc, balance: bigint, monthsPerPeriod: number): bigint =>
  calc.fixed !== null
    ? calc.fixed
    : divHalfEven(balance * (calc.rate as bigint) * BigInt(monthsPerPeriod), RATE_UNIT);

export function runPeriods(input: EngineInput): ScheduleInstallment[] {
  const { scale, periods, policy } = input;
  const rows: ScheduleInstallment[] = [];
  let balance = input.opening;
  for (let k = 0; k < periods.length; k += 1) {
    const period = periods[k] as EnginePeriod;
    const last = k === periods.length - 1;
    const interest = interestFor(balance, period, input.denominator);
    let principal: bigint;
    if (last) {
      principal = balance;
    } else if (policy.kind === 'LEVEL') {
      principal = policy.installment - interest;
      if (principal < 0n) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the installment does not cover the interest (negative amortization)',
          {
            details: {
              reason: 'NEGATIVE_AMORTIZATION',
              installmentNo: period.n,
              interest: fmt(interest, scale),
              installment: fmt(policy.installment, scale),
            },
          },
        );
      }
    } else if (policy.kind === 'CONSTANT') {
      principal = policy.principal;
    } else {
      principal = policy.principals[k] ?? 0n;
    }
    // Con redondeo hacia arriba la cuota podría exceder el saldo antes del final.
    if (principal > balance) principal = balance;
    const fees = chargeFor(input.charges.fees, balance, input.monthsPerPeriod);
    const insurance = chargeFor(input.charges.insurance, balance, input.monthsPerPeriod);
    const taxes = chargeFor(input.charges.taxes, balance, input.monthsPerPeriod);
    const closing = balance - principal;
    rows.push({
      n: period.n,
      dueDate: period.dueDate.toString(),
      periodStart: period.periodStart.toString(),
      periodEnd: period.dueDate.toString(),
      principal: fmt(principal, scale),
      interest: fmt(interest, scale),
      fees: fmt(fees, scale),
      insurance: fmt(insurance, scale),
      taxes: fmt(taxes, scale),
      total: fmt(principal + interest + fees + insurance + taxes, scale),
      openingBalance: fmt(balance, scale),
      closingBalance: fmt(closing, scale),
    });
    balance = closing;
    if (input.stopWhenPaid && balance === 0n) break;
  }
  return rows;
}
