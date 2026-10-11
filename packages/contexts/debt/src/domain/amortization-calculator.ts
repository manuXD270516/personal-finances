import { Money, MoneyDecimal, dec, type Currency, type LocalDate } from '@pf/shared-kernel';
import {
  RATE_UNIT,
  addMonthsClamped,
  chargeCalc,
  days360European,
  divHalfEven,
  fmt,
  rateUnits,
  unitsOf,
  validation,
  type ChargeCalc,
} from './amortization-math.js';
import { runPeriods, type EnginePeriod, type PrincipalPolicy } from './schedule-engine.js';
import {
  DAY_COUNTS,
  LOAN_FREQUENCIES,
  MAX_LOAN_INSTALLMENTS,
  MIN_LOAN_INSTALLMENTS,
  MONTHS_PER_PERIOD,
  type DayCount,
  type LoanCharges,
  type LoanFrequency,
  type ScheduleInstallment,
} from './loan-types.js';

/**
 * `AmortizationCalculator` (openspec add-loans, design decisión 3; capability `debt/amortization`).
 *
 * Cronograma francés exacto y determinista, puro (sin IO ni reloj): el dinero se calcula en unidades menores
 * `bigint` y la cuota con `Decimal` de precisión 40 (sin `Math.pow`, INV-001). Cada componente se redondea
 * HALF_EVEN una sola vez (producto exacto) y la última cuota absorbe el residuo (INV-017).
 *
 * La vista previa (`previewSchedule`) es la misma función: no persiste nada.
 */

/** Entrada del calculador. Las tasas son fracciones decimales como string (0.115 = 11.50 %). */
export interface AmortizationInput {
  readonly currency: Currency;
  /** Principal del préstamo o saldo pendiente en un préstamo en curso. */
  readonly principal: string;
  /** Tasa nominal anual (0..1). */
  readonly annualRate: string;
  readonly dayCount: DayCount;
  readonly frequency: LoanFrequency;
  /** Número de cuotas de ESTE cronograma (1..600; en un préstamo en curso, las restantes). */
  readonly installments: number;
  /** Inicio del devengo: desembolso o `asOf` del saldo pendiente. */
  readonly accrualStart: LocalDate;
  readonly firstDueDate: LocalDate;
  /** Número de la primera cuota (por omisión 1; un préstamo en curso continúa la numeración). */
  readonly firstInstallmentNo?: number;
  readonly charges?: LoanCharges;
  /** Sistema de amortización calculable (`FRENCH` por omisión; el `CUSTOM` no se calcula, se carga). */
  readonly method?: CalculableMethod;
  /** Solo `FIXED_PRINCIPAL`: principal de las cuotas 1..n−1 (escala de la moneda); la última es el balloon. */
  readonly fixedPrincipalAmount?: string;
}

/** Sistemas que el calculador sabe calcular (add-loan-amortization-advanced, decisión 1). */
export const CALCULABLE_METHODS = ['FRENCH', 'GERMAN', 'FIXED_PRINCIPAL'] as const;
export type CalculableMethod = (typeof CALCULABLE_METHODS)[number];

export interface AmortizationSchedule {
  readonly installments: readonly ScheduleInstallment[];
  /** Cuota base (sin cargos) a la escala de la moneda: la estándar o la nivelada (D153). */
  readonly installmentAmount: string;
  /** `true` si se aplicó la cuota nivelada (ACT/360, ACT/365 o primer periodo irregular). */
  readonly leveled: boolean;
}

/** Ventana (en unidades menores) alrededor de la cuota nivelada donde se busca el mínimo |última − cuota|. */
const LEVEL_WINDOW = 6n;

interface Context {
  readonly currency: Currency;
  readonly principal: bigint;
  readonly n: number;
  readonly rate: bigint;
  /** Días de cada periodo y denominador de la convención. */
  readonly days: readonly number[];
  readonly denominator: bigint;
  readonly monthsPerPeriod: number;
  readonly dueDates: readonly LocalDate[];
  readonly starts: readonly LocalDate[];
  readonly irregularFirstPeriod: boolean;
  readonly fees: ChargeCalc;
  readonly insurance: ChargeCalc;
  readonly taxes: ChargeCalc;
}

const interestOf = (ctx: Context, balance: bigint, k: number): bigint =>
  divHalfEven(balance * ctx.rate * BigInt(ctx.days[k] as number), RATE_UNIT * ctx.denominator);

function buildContext(input: AmortizationInput): Context {
  const { currency: cur } = input;
  if (
    !Number.isInteger(input.installments) ||
    input.installments < MIN_LOAN_INSTALLMENTS ||
    input.installments > MAX_LOAN_INSTALLMENTS
  ) {
    throw validation(
      `installments must be an integer between ${MIN_LOAN_INSTALLMENTS} and ${MAX_LOAN_INSTALLMENTS}`,
      {
        field: 'installments',
      },
    );
  }
  if (!(DAY_COUNTS as readonly string[]).includes(input.dayCount)) {
    throw validation('unknown day count convention', { field: 'dayCount' });
  }
  if (!(LOAN_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    throw validation('unknown frequency', { field: 'frequency' });
  }
  const first = input.firstInstallmentNo ?? 1;
  if (!Number.isInteger(first) || first < 1) {
    throw validation('firstInstallmentNo must be a positive integer', { field: 'firstInstallmentNo' });
  }
  const principalMoney = Money.parse(input.principal, cur);
  if (!principalMoney.isPositive()) throw validation('principal must be positive', { field: 'principal' });
  if (input.firstDueDate.compare(input.accrualStart) <= 0) {
    throw validation('the first due date must be after the accrual start', { field: 'firstDueDate' });
  }
  const rate = rateUnits(input.annualRate, 'annualRate', '1');

  const months = MONTHS_PER_PERIOD[input.frequency];
  const n = input.installments;
  const dueDates: LocalDate[] = [];
  for (let k = 0; k < n; k += 1) dueDates.push(addMonthsClamped(input.firstDueDate, k * months));
  const starts = dueDates.map((_, k) => (k === 0 ? input.accrualStart : (dueDates[k - 1] as LocalDate)));

  let days: number[];
  let irregular = false;
  if (input.dayCount === 'D30_360') {
    // 30/360 europeo: un periodo regular vale exactamente 30 × meses (= 1 / cuotas por año).
    days = dueDates.map(() => 30 * months);
    const firstDays = days360European(input.accrualStart, input.firstDueDate);
    if (firstDays !== 30 * months) {
      irregular = true;
      days[0] = firstDays;
    }
  } else {
    days = dueDates.map((due, k) => due.toEpochDay() - (starts[k] as LocalDate).toEpochDay());
  }
  return {
    currency: cur,
    principal: principalMoney.toMinorUnits(),
    n,
    rate,
    days,
    denominator: input.dayCount === 'ACT_365' ? 365n : 360n,
    monthsPerPeriod: months,
    dueDates,
    starts,
    irregularFirstPeriod: irregular,
    fees: chargeCalc(input.charges?.fees, cur, 'charges.fees'),
    insurance: chargeCalc(input.charges?.insurance, cur, 'charges.insurance'),
    taxes: chargeCalc(input.charges?.taxes, cur, 'charges.taxes'),
  };
}

/** Cuota estándar `A = HALF_EVEN(P·i / (1 − (1+i)^−n))` (precisión 40, exponente entero); tasa 0 ⇒ `P/n`. */
function standardInstallment(ctx: Context, perYear: number): bigint {
  if (ctx.rate === 0n) return divHalfEven(ctx.principal, BigInt(ctx.n));
  const i = dec(ctx.rate.toString()).div(RATE_UNIT.toString()).div(perYear);
  const discount = dec('1').plus(i).pow(-ctx.n);
  const value = dec(ctx.principal.toString()).times(i).div(dec('1').minus(discount));
  return BigInt(value.toDecimalPlaces(0, MoneyDecimal.ROUND_HALF_EVEN).toFixed(0));
}

type Probe = { readonly kind: 'NEG' | 'EARLY' } | { readonly kind: 'OK'; readonly gap: bigint };

/** Recorre el saldo con la cuota `A` y devuelve `última − A` (principal + interés de la última cuota, sin cargos). */
function probe(ctx: Context, A: bigint): Probe {
  let balance = ctx.principal;
  for (let k = 0; k < ctx.n - 1; k += 1) {
    const principal = A - interestOf(ctx, balance, k);
    if (principal < 0n) return { kind: 'NEG' };
    if (principal > balance) return { kind: 'EARLY' };
    balance -= principal;
  }
  return { kind: 'OK', gap: balance + interestOf(ctx, balance, ctx.n - 1) - A };
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

/**
 * Cuota nivelada (D153): la menor cuota en unidades menores que minimiza |última − cuota|, donde "última" es
 * principal + interés de la última cuota (sin cargos). Único punto de nivelación del calculador. Parte de la cuota
 * estándar `start`; busca por bisección el menor `A` cuya última cuota ya no supera a `A` y compara una ventana
 * de ±6 unidades menores alrededor (el redondeo por cuota hace la función no estrictamente monótona).
 * Devuelve `null` si ninguna cuota produce un cronograma sin amortización negativa (cuota en string decimal).
 */
export function levelInstallment(input: AmortizationInput): string | null {
  const ctx = buildContext(input);
  const level = levelFrom(ctx, standardInstallment(ctx, 12 / ctx.monthsPerPeriod));
  return level === null ? null : fmt(level, ctx.currency.scale);
}

function levelFrom(ctx: Context, start: bigint): bigint | null {
  const tooLow = (A: bigint): boolean => {
    const p = probe(ctx, A);
    return p.kind === 'NEG' || (p.kind === 'OK' && p.gap > 0n);
  };
  // Cota inferior que sea "demasiado baja".
  let lo = start;
  let step = 1n;
  while (!tooLow(lo)) {
    lo = lo > step ? lo - step : 0n;
    step *= 2n;
    if (lo === 0n) break;
  }
  if (!tooLow(lo)) return null;
  // Cota superior "no demasiado baja": con A ≥ P + interés se salda antes de tiempo (EARLY).
  let hi = lo + 1n;
  step = 1n;
  const ceiling = ctx.principal * 4n + 1_000_000n;
  while (tooLow(hi)) {
    hi += step;
    step *= 2n;
    if (hi > ceiling) return null;
  }
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (tooLow(mid)) lo = mid;
    else hi = mid;
  }
  let best: { A: bigint; gap: bigint } | null = null;
  for (let A = hi - LEVEL_WINDOW; A <= hi + LEVEL_WINDOW; A += 1n) {
    if (A < 0n) continue;
    const p = probe(ctx, A);
    if (p.kind !== 'OK') continue;
    if (best === null || abs(p.gap) < abs(best.gap)) best = { A, gap: p.gap };
  }
  return best?.A ?? null;
}

/**
 * Principal fijo por cuota del capital fijo (decisión 1): positivo, a la escala de la moneda y tal que las cuotas
 * 1..n−1 no agoten el principal (el balloon sería ≤ 0); si no, `VALIDATION_FAILED`.
 */
function fixedPrincipalUnits(input: AmortizationInput, ctx: Context): bigint {
  if (input.fixedPrincipalAmount === undefined) {
    throw validation('fixedPrincipalAmount is required for the FIXED_PRINCIPAL method', {
      field: 'fixedPrincipalAmount',
    });
  }
  const fixed = Money.parse(input.fixedPrincipalAmount, ctx.currency);
  if (!fixed.isPositive()) {
    throw validation('fixedPrincipalAmount must be greater than zero', { field: 'fixedPrincipalAmount' });
  }
  const units = fixed.toMinorUnits();
  const before = units * BigInt(ctx.n - 1);
  if (before >= ctx.principal) {
    throw validation('the fixed principal leaves no balloon installment', {
      field: 'fixedPrincipalAmount',
      sumBeforeLast: fmt(before, ctx.currency.scale),
      principal: fmt(ctx.principal, ctx.currency.scale),
    });
  }
  return units;
}

/**
 * Calcula el cronograma (francés, alemán o capital fijo). Errores (`DomainError`): `VALIDATION_FAILED` por entradas inválidas y, si en una
 * cuota intermedia `A − interés < 0`, `VALIDATION_FAILED` con `details.reason = 'NEGATIVE_AMORTIZATION'`.
 */
export function calculateSchedule(input: AmortizationInput): AmortizationSchedule {
  const ctx = buildContext(input);
  const scale = ctx.currency.scale;
  const method: CalculableMethod = input.method ?? 'FRENCH';
  if (!(CALCULABLE_METHODS as readonly string[]).includes(method)) {
    throw validation('unknown amortization method', { field: 'method' });
  }

  let installment = 0n;
  let leveled = false;
  let policy: PrincipalPolicy;
  if (method === 'FRENCH') {
    const standard = standardInstallment(ctx, 12 / ctx.monthsPerPeriod);
    installment = standard;
    const needsLeveling =
      ctx.rate > 0n && ctx.n > 1 && (input.dayCount !== 'D30_360' || ctx.irregularFirstPeriod);
    if (needsLeveling) {
      const level = levelFrom(ctx, standard);
      if (level === null) {
        throw validation('the schedule would require negative amortization', {
          reason: 'NEGATIVE_AMORTIZATION',
        });
      }
      installment = level;
      leveled = true;
    }
    policy = { kind: 'LEVEL', installment };
  } else if (method === 'GERMAN') {
    policy = { kind: 'CONSTANT', principal: divHalfEven(ctx.principal, BigInt(ctx.n)) };
  } else {
    policy = { kind: 'CONSTANT', principal: fixedPrincipalUnits(input, ctx) };
  }

  const firstNo = input.firstInstallmentNo ?? 1;
  const periods: EnginePeriod[] = ctx.dueDates.map((dueDate, k) => ({
    n: firstNo + k,
    dueDate,
    periodStart: ctx.starts[k] as LocalDate,
    days: ctx.days[k] as number,
    rate: ctx.rate,
  }));
  const rows = runPeriods({
    scale,
    denominator: ctx.denominator,
    monthsPerPeriod: ctx.monthsPerPeriod,
    charges: { fees: ctx.fees, insurance: ctx.insurance, taxes: ctx.taxes },
    opening: ctx.principal,
    periods,
    policy,
  });
  if (method !== 'FRENCH') {
    // Cuota base de referencia de los sistemas de principal fijo: principal + interés de la primera cuota.
    const first = rows[0] as ScheduleInstallment;
    installment = unitsOf(dec(first.principal).plus(first.interest).toFixed(scale), ctx.currency);
  }
  return { installments: rows, installmentAmount: fmt(installment, scale), leveled };
}

/** Vista previa (FR-DEBT-003): exactamente el mismo cálculo que el cronograma fijado al activar; no persiste. */
export const previewSchedule = calculateSchedule;

export const AmortizationCalculator = {
  calculate: calculateSchedule,
  calculateSchedule,
  preview: previewSchedule,
  previewSchedule,
  levelInstallment,
} as const;

/** Periodos explícitos de un tramo (cuotas restantes de un préstamo en curso), con los días de cada devengo. */
export interface TailPeriodSpec {
  readonly n: number;
  readonly dueDate: LocalDate;
  readonly periodStart: LocalDate;
  readonly days: number;
}

export interface TailInstallmentInput {
  readonly currency: Currency;
  /** Saldo de principal al inicio del tramo. */
  readonly principal: string;
  readonly annualRate: string;
  readonly dayCount: DayCount;
  readonly frequency: LoanFrequency;
  readonly periods: readonly TailPeriodSpec[];
}

/**
 * Cuota francesa (con la misma nivelación D153 del cronograma inicial) de un tramo sobre fechas dadas: la usan el
 * ScheduleRecalculator al reducir la cuota y al cambiar la tasa (add-loan-amortization-advanced, decisión 3).
 * Devuelve la cuota base en unidades menores (principal + interés, sin cargos) y si se niveló.
 */
export function frenchInstallmentFor(input: TailInstallmentInput): { installment: bigint; leveled: boolean } {
  const n = input.periods.length;
  if (n < 1) throw validation('the tail needs at least one installment', { field: 'periods' });
  const principalMoney = Money.parse(input.principal, input.currency);
  if (!principalMoney.isPositive()) throw validation('principal must be positive', { field: 'principal' });
  const months = MONTHS_PER_PERIOD[input.frequency];
  const first = input.periods[0] as TailPeriodSpec;
  const zero: ChargeCalc = { fixed: 0n, rate: null };
  const ctx: Context = {
    currency: input.currency,
    principal: principalMoney.toMinorUnits(),
    n,
    rate: rateUnits(input.annualRate, 'annualRate', '1'),
    days: input.periods.map((p) => p.days),
    denominator: input.dayCount === 'ACT_365' ? 365n : 360n,
    monthsPerPeriod: months,
    dueDates: input.periods.map((p) => p.dueDate),
    starts: input.periods.map((p) => p.periodStart),
    irregularFirstPeriod: first.days !== 30 * months,
    fees: zero,
    insurance: zero,
    taxes: zero,
  };
  const standard = standardInstallment(ctx, 12 / months);
  const needsLeveling = ctx.rate > 0n && n > 1 && (input.dayCount !== 'D30_360' || ctx.irregularFirstPeriod);
  if (!needsLeveling) return { installment: standard, leveled: false };
  const level = levelFrom(ctx, standard);
  if (level === null) {
    throw validation('the schedule would require negative amortization', { reason: 'NEGATIVE_AMORTIZATION' });
  }
  return { installment: level, leveled: true };
}
