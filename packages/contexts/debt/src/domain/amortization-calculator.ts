import { DomainError, LocalDate, Money, MoneyDecimal, dec, type Currency } from '@pf/shared-kernel';
import {
  DAY_COUNTS,
  LOAN_FREQUENCIES,
  MAX_LOAN_INSTALLMENTS,
  MIN_LOAN_INSTALLMENTS,
  MONTHS_PER_PERIOD,
  type ChargeSpec,
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
}

export interface AmortizationSchedule {
  readonly installments: readonly ScheduleInstallment[];
  /** Cuota base (sin cargos) a la escala de la moneda: la estándar o la nivelada (D153). */
  readonly installmentAmount: string;
  /** `true` si se aplicó la cuota nivelada (ACT/360, ACT/365 o primer periodo irregular). */
  readonly leveled: boolean;
}

const RATE_SCALE = 18;
const RATE_UNIT = 10n ** BigInt(RATE_SCALE);
/** Ventana (en unidades menores) alrededor de la cuota nivelada donde se busca el mínimo |última − cuota|. */
const LEVEL_WINDOW = 6n;

const validation = (message: string, details?: Record<string, unknown>) =>
  new DomainError('VALIDATION_FAILED', message, details ? { details } : {});

/** Cociente entero de a/b (b > 0, a ≥ 0) con redondeo HALF_EVEN. */
function divHalfEven(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const twice = 2n * r;
  return twice > b || (twice === b && q % 2n === 1n) ? q + 1n : q;
}

/** Tasa decimal (0..max) → entero escalado a 10^18. */
function rateUnits(value: string, label: string, max: string): bigint {
  let d;
  try {
    d = new MoneyDecimal(value);
  } catch {
    throw validation(`${label} must be a decimal string`, { field: label });
  }
  if (!d.isFinite() || d.isNeg() || d.gt(max) || d.decimalPlaces() > RATE_SCALE) {
    throw validation(`${label} must be between 0 and ${max} with at most ${RATE_SCALE} decimals`, {
      field: label,
    });
  }
  return BigInt(d.times(RATE_UNIT.toString()).toFixed(0));
}

/** Días 30/360 europeo (días 31 → 30) entre dos fechas. */
export function days360European(from: LocalDate, to: LocalDate): number {
  return (
    360 * (to.year - from.year) +
    30 * (to.month - from.month) +
    (Math.min(to.day, 30) - Math.min(from.day, 30))
  );
}

/** Suma `months` meses conservando el día; día inexistente ⇒ último día del mes (mismo criterio que el motor). */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return LocalDate.of(year, month, Math.min(date.day, LocalDate.daysInMonth(year, month)));
}

interface ChargeCalc {
  readonly fixed: bigint | null;
  readonly rate: bigint | null;
}

function chargeCalc(spec: ChargeSpec | undefined, currency: Currency, label: string): ChargeCalc {
  if (!spec) return { fixed: 0n, rate: null };
  if (spec.mode === 'FIXED') {
    const money = Money.parse(spec.value, currency);
    if (money.isNegative()) throw validation(`${label} must not be negative`, { field: label });
    return { fixed: money.toMinorUnits(), rate: null };
  }
  if (spec.mode === 'RATE_ON_BALANCE') {
    return { fixed: null, rate: rateUnits(spec.value, label, '1') };
  }
  throw validation(`${label} has an unknown mode`, { field: label });
}

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

const chargeOf = (ctx: Context, calc: ChargeCalc, balance: bigint): bigint =>
  calc.fixed !== null
    ? calc.fixed
    : divHalfEven(balance * (calc.rate as bigint) * BigInt(ctx.monthsPerPeriod), RATE_UNIT);

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

function fmt(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${intPart}${frac}`;
}

/**
 * Calcula el cronograma francés. Errores (`DomainError`): `VALIDATION_FAILED` por entradas inválidas y, si en una
 * cuota intermedia `A − interés < 0`, `VALIDATION_FAILED` con `details.reason = 'NEGATIVE_AMORTIZATION'`.
 */
export function calculateSchedule(input: AmortizationInput): AmortizationSchedule {
  const ctx = buildContext(input);
  const scale = ctx.currency.scale;
  const standard = standardInstallment(ctx, 12 / ctx.monthsPerPeriod);

  let installment = standard;
  let leveled = false;
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

  const firstNo = input.firstInstallmentNo ?? 1;
  const rows: ScheduleInstallment[] = [];
  let balance = ctx.principal;
  for (let k = 0; k < ctx.n; k += 1) {
    const interest = interestOf(ctx, balance, k);
    let principal: bigint;
    if (k === ctx.n - 1) {
      principal = balance;
    } else {
      principal = installment - interest;
      if (principal < 0n) {
        throw validation('the installment does not cover the interest (negative amortization)', {
          reason: 'NEGATIVE_AMORTIZATION',
          installmentNo: firstNo + k,
          interest: fmt(interest, scale),
          installment: fmt(installment, scale),
        });
      }
      // Casos de escala mínima: con redondeo hacia arriba la cuota podría exceder el saldo antes del final.
      if (principal > balance) principal = balance;
    }
    const fees = chargeOf(ctx, ctx.fees, balance);
    const insurance = chargeOf(ctx, ctx.insurance, balance);
    const taxes = chargeOf(ctx, ctx.taxes, balance);
    const closing = balance - principal;
    rows.push({
      n: firstNo + k,
      dueDate: (ctx.dueDates[k] as LocalDate).toString(),
      periodStart: (ctx.starts[k] as LocalDate).toString(),
      periodEnd: (ctx.dueDates[k] as LocalDate).toString(),
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
