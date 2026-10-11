import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import { frenchInstallmentFor, type CalculableMethod } from './amortization-calculator.js';
import {
  chargeCalc,
  days360European,
  divHalfEven,
  fmt,
  rateUnits,
  unitsOf,
  validation,
} from './amortization-math.js';
import {
  runPeriods,
  type EngineCharges,
  type EnginePeriod,
  type PrincipalPolicy,
} from './schedule-engine.js';
import {
  MONTHS_PER_PERIOD,
  type DayCount,
  type LoanCharges,
  type LoanFrequency,
  type ScheduleInstallment,
} from './loan-types.js';

/**
 * `ScheduleRecalculator` (openspec add-loan-amortization-advanced, decisión 3; capability `debt/amortization`):
 * recalcula las cuotas NO pagadas de un préstamo tras un pago extraordinario (reducir plazo o reducir cuota), un
 * cambio de tasa variable o la anulación de un prepago. Puro y determinista: cada versión se calcula desde el saldo
 * exacto (suma de principal pagado), nunca desde cuotas redondeadas de versiones previas (RISK-001). El recálculo
 * empieza siempre en una frontera de periodo (primera cuota no pagada, `k0`); el llamador verifica las precondiciones.
 *
 * Prepago aplicado en la frontera del periodo (D194): el interés de la cuota siguiente se calcula sobre el saldo
 * reducido completo. Cambio de tasa sin prorrateo (D195): aplica desde el primer periodo que empieza en o después de
 * la vigencia.
 */

export const PREPAYMENT_OPTIONS = ['REDUCE_TERM', 'REDUCE_INSTALLMENT'] as const;
export type PrepaymentOption = (typeof PREPAYMENT_OPTIONS)[number];

/** Tasa vigente desde una fecha (historial de tasas incluida la inicial). */
export interface RateStep {
  /** `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  /** Fracción decimal (`0.12` = 12 %). */
  readonly annualRate: string;
}

/** Condiciones del préstamo que gobiernan el recorrido de un tramo. */
export interface TailTerms {
  readonly currency: Currency;
  readonly method: CalculableMethod;
  readonly dayCount: DayCount;
  readonly frequency: LoanFrequency;
  readonly charges: LoanCharges;
  /** Número de la primera cuota del préstamo (el periodo irregular 30/360 solo puede ser el suyo). */
  readonly firstInstallmentNo: number;
  /** Historial de tasas ordenado por vigencia (la inicial primero). */
  readonly rates: readonly RateStep[];
}

/**
 * Parámetros del sistema vigentes para continuar "con la misma cuota / el mismo principal": se guardan con cada
 * versión (`debt.loan_schedule_version.parameters`).
 */
export interface TailParameters {
  /** Francés: cuota base (principal + interés) a la escala de la moneda. */
  readonly installmentAmount?: string | undefined;
  /** Alemán: principal por cuota. */
  readonly principalPerInstallment?: string | undefined;
  /** Capital fijo: principal por cuota de las cuotas anteriores a la última. */
  readonly fixedPrincipalAmount?: string | undefined;
}

export interface RecalculatedTail {
  readonly installments: readonly ScheduleInstallment[];
  /** Parámetros de la versión nueva. */
  readonly parameters: TailParameters;
  /** Cuota base nivelada en el francés. */
  readonly leveled: boolean;
}

export interface TailSummary {
  /** Cuota de la primera cuota del tramo (total con cargos). */
  readonly installmentAmount: string;
  readonly installmentCount: number;
  /** Vencimiento de la última cuota. */
  readonly endDate: string | null;
  /** Σ interés restante. */
  readonly remainingInterest: string;
  readonly remainingPrincipal: string;
}

const fail = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError(code, message, details ? { details } : {});

// ───────────────────────────────────────────────────────────── periodos

/** Tasa que rige un periodo: la última vigencia con `effectiveFrom ≤ periodStart` (la inicial si ninguna). */
export function rateAt(rates: readonly RateStep[], periodStart: string): string {
  let current = rates[0]?.annualRate ?? '0';
  for (const step of rates) {
    if (step.effectiveFrom <= periodStart) current = step.annualRate;
  }
  return current;
}

/** Días del devengo de una cuota según la convención (30/360: solo el primer periodo del préstamo puede ser irregular). */
function daysOf(terms: TailTerms, row: Pick<ScheduleInstallment, 'n' | 'periodStart' | 'dueDate'>): number {
  const start = LocalDate.parse(row.periodStart);
  const due = LocalDate.parse(row.dueDate);
  if (terms.dayCount === 'D30_360') {
    return row.n === terms.firstInstallmentNo
      ? days360European(start, due)
      : 30 * MONTHS_PER_PERIOD[terms.frequency];
  }
  return due.toEpochDay() - start.toEpochDay();
}

export function tailPeriods(
  terms: TailTerms,
  rows: readonly Pick<ScheduleInstallment, 'n' | 'periodStart' | 'dueDate'>[],
  rates: readonly RateStep[],
): EnginePeriod[] {
  return rows.map((row) => ({
    n: row.n,
    dueDate: LocalDate.parse(row.dueDate),
    periodStart: LocalDate.parse(row.periodStart),
    days: daysOf(terms, row),
    rate: rateUnits(rateAt(rates, row.periodStart), 'annualRate', '1'),
  }));
}

export function tailCharges(terms: TailTerms): EngineCharges {
  return {
    fees: chargeCalc(terms.charges.fees, terms.currency, 'charges.fees'),
    insurance: chargeCalc(terms.charges.insurance, terms.currency, 'charges.insurance'),
    taxes: chargeCalc(terms.charges.taxes, terms.currency, 'charges.taxes'),
  };
}

function run(
  terms: TailTerms,
  periods: readonly EnginePeriod[],
  opening: bigint,
  policy: PrincipalPolicy,
  stopWhenPaid = false,
): ScheduleInstallment[] {
  return runPeriods({
    scale: terms.currency.scale,
    denominator: terms.dayCount === 'ACT_365' ? 365n : 360n,
    monthsPerPeriod: MONTHS_PER_PERIOD[terms.frequency],
    charges: tailCharges(terms),
    opening,
    periods,
    policy,
    stopWhenPaid,
  });
}

const parseUnits = (value: string | undefined, terms: TailTerms, label: string): bigint => {
  if (value === undefined) throw validation(`${label} is required to recalculate`, { field: label });
  return unitsOf(value, terms.currency);
};

function frenchPolicy(
  terms: TailTerms,
  periods: readonly EnginePeriod[],
  balance: bigint,
  rate: string,
): { policy: PrincipalPolicy; leveled: boolean; installmentAmount: string } {
  const { installment, leveled } = frenchInstallmentFor({
    currency: terms.currency,
    principal: fmt(balance, terms.currency.scale),
    annualRate: rate,
    dayCount: terms.dayCount,
    frequency: terms.frequency,
    periods: periods.map((p) => ({ n: p.n, dueDate: p.dueDate, periodStart: p.periodStart, days: p.days })),
  });
  return {
    policy: { kind: 'LEVEL', installment },
    leveled,
    installmentAmount: fmt(installment, terms.currency.scale),
  };
}

/** Tasa constante con la que se calcula la cuota francesa de un tramo: la del último periodo. */
const tailRate = (terms: TailTerms, rows: readonly Pick<ScheduleInstallment, 'periodStart'>[]): string =>
  rateAt(terms.rates, (rows[rows.length - 1] as { periodStart: string }).periodStart);

// ───────────────────────────────────────────────────────────── eventos

export interface PrepaymentInput {
  readonly terms: TailTerms;
  /** Cuotas no pagadas vigentes desde `k0` (solo se usan sus fechas y numeración). */
  readonly rows: readonly ScheduleInstallment[];
  /** Principal pendiente antes del prepago. */
  readonly balance: string;
  readonly amount: string;
  readonly option: PrepaymentOption;
  readonly parameters: TailParameters;
}

/**
 * Prepago: con `REDUCE_TERM` misma cuota (o mismo principal por cuota) hasta saldar, la última absorbe el residuo;
 * con `REDUCE_INSTALLMENT` mismas fechas y cuota menor (capital fijo: principal proporcional y el balloon absorbe).
 * Un prepago igual al saldo salda el préstamo (sin cuotas nuevas); mayor ⇒ `LOAN_OVERPAYMENT`.
 */
export function recalculatePrepayment(input: PrepaymentInput): RecalculatedTail {
  const { terms, rows } = input;
  if (rows.length === 0) throw fail('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
  const balance = unitsOf(input.balance, terms.currency);
  const amount = Money.parse(input.amount, terms.currency);
  if (!amount.isPositive()) throw validation('the prepayment must be greater than zero', { field: 'amount' });
  const prepay = amount.toMinorUnits();
  if (prepay > balance) {
    throw fail('LOAN_OVERPAYMENT', 'the prepayment exceeds the outstanding principal', {
      outstandingPrincipal: input.balance,
      amount: input.amount,
    });
  }
  const remaining = balance - prepay;
  if (remaining === 0n) return { installments: [], parameters: {}, leveled: false };
  const periods = tailPeriods(terms, rows, terms.rates);
  const scale = terms.currency.scale;

  if (input.option === 'REDUCE_TERM') {
    if (terms.method === 'FRENCH') {
      const installment = parseUnits(input.parameters.installmentAmount, terms, 'installmentAmount');
      const installments = run(terms, periods, remaining, { kind: 'LEVEL', installment }, true);
      return {
        installments,
        parameters: { installmentAmount: fmt(installment, scale) },
        leveled: false,
      };
    }
    if (terms.method === 'GERMAN') {
      const principal = parseUnits(
        input.parameters.principalPerInstallment,
        terms,
        'principalPerInstallment',
      );
      return {
        installments: run(terms, periods, remaining, { kind: 'CONSTANT', principal }, true),
        parameters: { principalPerInstallment: fmt(principal, scale) },
        leveled: false,
      };
    }
    const principal = parseUnits(input.parameters.fixedPrincipalAmount, terms, 'fixedPrincipalAmount');
    return {
      installments: run(terms, periods, remaining, { kind: 'CONSTANT', principal }, true),
      parameters: { fixedPrincipalAmount: fmt(principal, scale) },
      leveled: false,
    };
  }

  // REDUCE_INSTALLMENT: mismas fechas y numeración.
  if (terms.method === 'FRENCH') {
    const f = frenchPolicy(terms, periods, remaining, tailRate(terms, rows));
    return {
      installments: run(terms, periods, remaining, f.policy),
      parameters: { installmentAmount: f.installmentAmount },
      leveled: f.leveled,
    };
  }
  if (terms.method === 'GERMAN') {
    const principal = divHalfEven(remaining, BigInt(periods.length));
    return {
      installments: run(terms, periods, remaining, { kind: 'CONSTANT', principal }),
      parameters: { principalPerInstallment: fmt(principal, scale) },
      leveled: false,
    };
  }
  const fixed = parseUnits(input.parameters.fixedPrincipalAmount, terms, 'fixedPrincipalAmount');
  const reduced = divHalfEven(fixed * remaining, balance);
  return {
    installments: run(terms, periods, remaining, { kind: 'CONSTANT', principal: reduced }),
    parameters: { fixedPrincipalAmount: fmt(reduced, scale) },
    leveled: false,
  };
}

export interface RateChangeInput {
  readonly terms: TailTerms;
  /** Cuotas no pagadas vigentes desde `k0`, con sus montos. */
  readonly rows: readonly ScheduleInstallment[];
  readonly balance: string;
  readonly newRate: string;
  /** `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
}

/**
 * Cambio de tasa (D195, sin prorrateo): las cuotas cuyo periodo empieza en o después de la vigencia se recalculan con
 * la tasa nueva conservando número y fechas; las anteriores (periodo ya iniciado) conservan sus montos. Francés: nueva
 * cuota sobre el saldo y las cuotas restantes; alemán y capital fijo: mismo principal, interés nuevo.
 * `LOAN_CHANGE_DATE_INVALID` si la vigencia es anterior al inicio del periodo de la primera cuota no pagada o no alcanza
 * a ninguna cuota.
 */
export function recalculateRateChange(input: RateChangeInput): RecalculatedTail {
  const { terms, rows } = input;
  if (rows.length === 0) throw fail('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
  const first = rows[0] as ScheduleInstallment;
  const last = rows[rows.length - 1] as ScheduleInstallment;
  if (input.effectiveFrom < first.periodStart || input.effectiveFrom > last.periodStart) {
    throw fail(
      'LOAN_CHANGE_DATE_INVALID',
      'the effective date must fall on or after the start of the first unpaid period and reach an installment',
      { firstUnpaidPeriodStart: first.periodStart, lastPeriodStart: last.periodStart },
    );
  }
  rateUnits(input.newRate, 'annualRate', '1');
  const scale = terms.currency.scale;
  const rates: RateStep[] = [
    ...terms.rates,
    { effectiveFrom: input.effectiveFrom, annualRate: input.newRate },
  ];
  const keep = rows.filter((r) => r.periodStart < input.effectiveFrom);
  const changed = rows.slice(keep.length);
  const opening =
    keep.length === 0
      ? unitsOf(input.balance, terms.currency)
      : unitsOf((keep[keep.length - 1] as ScheduleInstallment).closingBalance, terms.currency);
  const periods = tailPeriods(terms, changed, rates);
  const updated = { ...terms, rates };

  if (terms.method === 'FRENCH') {
    const f = frenchPolicy(updated, periods, opening, input.newRate);
    return {
      installments: [...keep, ...run(updated, periods, opening, f.policy)],
      parameters: { installmentAmount: f.installmentAmount },
      leveled: f.leveled,
    };
  }
  const principals = changed.map((r) => unitsOf(r.principal, terms.currency));
  const tail = run(updated, periods, opening, { kind: 'GIVEN', principals });
  // Principal por cuota de referencia para futuros recálculos: el de la primera cuota del tramo.
  const reference = principals[0] as bigint;
  return {
    installments: [...keep, ...tail],
    parameters:
      terms.method === 'GERMAN'
        ? { principalPerInstallment: fmt(reference, scale) }
        : { fixedPrincipalAmount: fmt(reference, scale) },
    leveled: false,
  };
}

export interface RestitutionInput {
  readonly terms: TailTerms;
  /** Cuotas (fechas y numeración) de la versión que regía antes del prepago, desde `k0`. */
  readonly rows: readonly ScheduleInstallment[];
  /** Principal pendiente restituido. */
  readonly balance: string;
  /** Parámetros de la versión anterior al prepago. */
  readonly parameters: TailParameters;
}

/**
 * Restitución al anular el prepago más reciente: recalcula desde `k0` con el saldo restituido y los parámetros de la
 * versión anterior al prepago, sobre las mismas fechas. Con los datos de la versión anterior coincide cuota a cuota con
 * ella (nunca se "reactiva" una versión vieja: el resultado es una versión nueva).
 */
export function restitute(input: RestitutionInput): RecalculatedTail {
  const { terms, rows } = input;
  if (rows.length === 0) throw fail('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
  const balance = unitsOf(input.balance, terms.currency);
  const periods = tailPeriods(terms, rows, terms.rates);
  const scale = terms.currency.scale;
  if (terms.method === 'FRENCH') {
    const installment = parseUnits(input.parameters.installmentAmount, terms, 'installmentAmount');
    return {
      installments: run(terms, periods, balance, { kind: 'LEVEL', installment }),
      parameters: { installmentAmount: fmt(installment, scale) },
      leveled: false,
    };
  }
  if (terms.method === 'GERMAN') {
    const principal = parseUnits(input.parameters.principalPerInstallment, terms, 'principalPerInstallment');
    return {
      installments: run(terms, periods, balance, { kind: 'CONSTANT', principal }),
      parameters: { principalPerInstallment: fmt(principal, scale) },
      leveled: false,
    };
  }
  const principal = parseUnits(input.parameters.fixedPrincipalAmount, terms, 'fixedPrincipalAmount');
  return {
    installments: run(terms, periods, balance, { kind: 'CONSTANT', principal }),
    parameters: { fixedPrincipalAmount: fmt(principal, scale) },
    leveled: false,
  };
}

/** Resumen de un tramo para la vista previa y el historial de versiones. */
export function summarizeTail(rows: readonly ScheduleInstallment[]): TailSummary {
  const scale = rows[0]?.principal.split('.')[1]?.length ?? 0;
  // Unidades menores exactas (los textos ya vienen a la escala de la moneda).
  const units = (text: string): bigint => BigInt(text.replace('.', ''));
  let interest = 0n;
  let principal = 0n;
  for (const r of rows) {
    interest += units(r.interest);
    principal += units(r.principal);
  }
  return {
    installmentAmount: rows[0]?.total ?? '0',
    installmentCount: rows.length,
    endDate: rows.length > 0 ? (rows[rows.length - 1] as ScheduleInstallment).dueDate : null,
    remainingInterest: fmt(interest, scale),
    remainingPrincipal: fmt(principal, scale),
  };
}
