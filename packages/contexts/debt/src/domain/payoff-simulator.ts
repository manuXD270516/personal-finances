import { DomainError, LocalDate, Money, dec, type Currency } from '@pf/shared-kernel';
import { fmt, unitsOf } from './amortization-math.js';
import {
  chargeFor,
  interestFor,
  type EngineCharges,
  type EnginePeriod,
  type PrincipalPolicy,
} from './schedule-engine.js';
import type { ScheduleInstallment } from './loan-types.js';
import { MONTHS_PER_PERIOD } from './loan-types.js';
import { tailCharges, tailPeriods, type TailParameters, type TailTerms } from './schedule-recalculator.js';

/**
 * `PayoffSimulator` (openspec add-loan-amortization-advanced, decisión 7; capability `debt/amortization`): proyecta
 * préstamos con pagos extra únicos o recurrentes y compara las estrategias avalanche, snowball y sin extra. Puro y
 * SIN persistencia: no escribe transacciones, versiones, compromisos ni auditoría. Reglas:
 * - cada mes, en la fecha de cuota, se paga la cuota programada vigente (interés sobre el saldo por la convención
 *   del préstamo); DESPUÉS se aplica el extra al principal reduciendo el plazo, sin comisión;
 * - avalanche: el extra va al préstamo de mayor tasa (desempate: menor saldo, luego menor id); snowball: al de menor
 *   saldo (desempate: mayor tasa, luego menor id); el sobrante de un préstamo que se salda pasa al siguiente en el
 *   mismo mes;
 * - rollover: las cuotas de los préstamos ya saldados se suman al extra desde el mes siguiente (solo en avalanche y
 *   snowball);
 * - participan los préstamos activos no custom de la moneda del extra; el resto se informa fuera de la estrategia;
 * - horizonte máximo de 600 meses.
 * El cálculo reutiliza el motor del cronograma (mismo redondeo HALF_EVEN), así que un extra único equivale a un prepago
 * `REDUCE_TERM` del `ScheduleRecalculator`.
 */

export const SIMULATION_HORIZON_MONTHS = 600;
export const MAX_SIMULATED_LOANS = 20;

export interface PayoffLoan {
  readonly id: string;
  readonly name: string;
  readonly terms: TailTerms;
  /** Cronograma `CUSTOM`: se proyecta con sus cuotas pero no recibe extra. */
  readonly custom: boolean;
  /** Tasa vigente hoy (fracción decimal): ordena avalanche. */
  readonly annualRate: string;
  /** Principal pendiente. */
  readonly balance: string;
  /** Cuotas no pagadas vigentes, en orden. */
  readonly rows: readonly ScheduleInstallment[];
  readonly parameters: TailParameters;
}

export type ExtraSpec =
  | { readonly type: 'ONE_TIME'; readonly installmentNo: number; readonly amount: string }
  | { readonly type: 'MONTHLY'; readonly fromInstallmentNo: number; readonly amount: string };

export const PAYOFF_STRATEGIES = ['AVALANCHE', 'SNOWBALL', 'NONE'] as const;
export type PayoffStrategy = (typeof PAYOFF_STRATEGIES)[number];

export interface SeriesPoint {
  /** `YYYY-MM` (estrategias) o `YYYY-MM-DD` (un préstamo). */
  readonly period: string;
  /** Saldo de principal tras los pagos del periodo. */
  readonly balance: string;
}

export interface LoanProjection {
  readonly totalInterest: string;
  /** Vencimiento de la cuota que salda el préstamo (`null` si ya no debe nada). */
  readonly endDate: string | null;
  readonly installments: number;
  readonly series: readonly SeriesPoint[];
}

export interface ExtrasSimulation {
  readonly loanId: string;
  readonly currency: string;
  readonly current: LoanProjection;
  readonly scenario: LoanProjection;
  readonly interestSaved: string;
  /** Meses de diferencia entre las fechas de fin. */
  readonly monthsSaved: number;
}

export interface StrategyLoanResult {
  readonly loanId: string;
  readonly name: string;
  readonly endDate: string | null;
  readonly interest: string;
}

export interface StrategyResult {
  readonly strategy: PayoffStrategy;
  readonly totalInterest: string;
  readonly debtFreeDate: string | null;
  /** Ahorro de interés frente a `NONE`. */
  readonly interestSaved: string;
  readonly monthsToDebtFree: number;
  readonly loans: readonly StrategyLoanResult[];
  readonly series: readonly SeriesPoint[];
}

export interface OutOfStrategyLoan {
  readonly loanId: string;
  readonly name: string;
  readonly reason: 'CURRENCY' | 'CUSTOM';
  readonly currency: string;
}

export interface StrategiesSimulation {
  readonly currency: string;
  readonly monthlyExtra: string;
  readonly startBalance: string;
  readonly strategies: readonly StrategyResult[];
  readonly outOfStrategy: readonly OutOfStrategyLoan[];
}

const fail = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError(code, message, details ? { details } : {});

// ───────────────────────────────────────────────────────────── un préstamo

/** Política de reparto de la cuota al recalcular (reducir plazo) a partir de los parámetros o de la primera cuota. */
function policyOf(loan: PayoffLoan): PrincipalPolicy {
  const { terms, rows, parameters } = loan;
  const cur = terms.currency;
  const first = rows[0] as ScheduleInstallment;
  if (terms.method === 'FRENCH') {
    const installment =
      parameters.installmentAmount !== undefined
        ? unitsOf(parameters.installmentAmount, cur)
        : unitsOf(first.principal, cur) + unitsOf(first.interest, cur);
    return { kind: 'LEVEL', installment };
  }
  const given =
    terms.method === 'GERMAN' ? parameters.principalPerInstallment : parameters.fixedPrincipalAmount;
  return {
    kind: 'CONSTANT',
    principal: given !== undefined ? unitsOf(given, cur) : unitsOf(first.principal, cur),
  };
}

interface PaidPeriod {
  readonly dueDate: string;
  readonly total: bigint;
  readonly interest: bigint;
  readonly final: boolean;
}

/** Estado de un préstamo durante la simulación; hasta el primer extra paga las cuotas vigentes tal cual. */
class LoanRun {
  readonly periods: EnginePeriod[];
  private readonly charges: EngineCharges;
  private readonly denominator: bigint;
  private readonly months: number;
  private readonly policy: PrincipalPolicy;
  private usingRows = true;
  k = 0;
  balance: bigint;
  interest = 0n;
  endDate: string | null = null;
  lastRegularTotal: bigint | null = null;
  lastPaid: string | null = null;

  constructor(readonly loan: PayoffLoan) {
    this.periods = tailPeriods(loan.terms, loan.rows, loan.terms.rates);
    this.charges = tailCharges(loan.terms);
    this.denominator = loan.terms.dayCount === 'ACT_365' ? 365n : 360n;
    this.months = MONTHS_PER_PERIOD[loan.terms.frequency];
    this.balance = unitsOf(loan.balance, loan.terms.currency);
    this.policy = policyOf(loan);
  }

  get done(): boolean {
    return this.balance === 0n || this.k >= this.periods.length;
  }

  get nextDue(): string | null {
    return this.k < this.periods.length ? (this.periods[this.k] as EnginePeriod).dueDate.toString() : null;
  }

  /** Paga la cuota programada del periodo `k`. */
  pay(): PaidPeriod {
    const cur = this.loan.terms.currency;
    const period = this.periods[this.k] as EnginePeriod;
    const last = this.k === this.periods.length - 1;
    let principal: bigint;
    let interest: bigint;
    let total: bigint;
    if (this.usingRows) {
      const row = this.loan.rows[this.k] as ScheduleInstallment;
      principal = unitsOf(row.principal, cur);
      if (principal > this.balance) principal = this.balance;
      interest = unitsOf(row.interest, cur);
      total = unitsOf(row.total, cur);
    } else {
      interest = interestFor(this.balance, period, this.denominator);
      if (last) principal = this.balance;
      else if (this.policy.kind === 'LEVEL') principal = this.policy.installment - interest;
      else if (this.policy.kind === 'CONSTANT') principal = this.policy.principal;
      else principal = 0n;
      if (principal < 0n) principal = 0n;
      if (principal > this.balance) principal = this.balance;
      const charges =
        chargeFor(this.charges.fees, this.balance, this.months) +
        chargeFor(this.charges.insurance, this.balance, this.months) +
        chargeFor(this.charges.taxes, this.balance, this.months);
      total = principal + interest + charges;
    }
    this.balance -= principal;
    this.interest += interest;
    this.k += 1;
    const dueDate = period.dueDate.toString();
    this.lastPaid = dueDate;
    const final = this.balance === 0n;
    if (final) this.endDate = dueDate;
    return { dueDate, total, interest, final };
  }

  /** Aplica un extra al principal (reducir plazo); devuelve lo aplicado. */
  extra(amount: bigint, fallbackDate: string): bigint {
    if (this.loan.custom || this.balance === 0n || amount <= 0n) return 0n;
    const applied = amount < this.balance ? amount : this.balance;
    this.balance -= applied;
    this.usingRows = false;
    if (this.balance === 0n) this.endDate = this.lastPaid ?? fallbackDate;
    return applied;
  }
}

const startOf = (loan: PayoffLoan): bigint => unitsOf(loan.balance, loan.terms.currency);

function parseExtra(extra: ExtraSpec, currency: Currency): bigint {
  const money = Money.parse(extra.amount, currency);
  if (!money.isPositive())
    throw fail('VALIDATION_FAILED', 'the extra must be greater than zero', { field: 'amount' });
  return money.toMinorUnits();
}

/** Proyección de un préstamo con extras únicos o recurrentes aplicados después de la cuota indicada. */
export function simulateExtras(loan: PayoffLoan, extras: readonly ExtraSpec[]): ExtrasSimulation {
  if (loan.custom) {
    throw fail('LOAN_SCHEDULE_IS_CUSTOM', 'a custom schedule is not recalculated; load the new bank table');
  }
  if (loan.rows.length === 0) throw fail('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
  const cur = loan.terms.currency;
  const scale = cur.scale;
  const parsed = extras.map((e) => ({ spec: e, amount: parseExtra(e, cur) }));

  const project = (withExtras: boolean): LoanProjection => {
    const run = new LoanRun(loan);
    const series: SeriesPoint[] = [];
    let installments = 0;
    let lastDue = '';
    while (!run.done) {
      const paid = run.pay();
      installments += 1;
      lastDue = paid.dueDate;
      const n = (loan.rows[run.k - 1] as ScheduleInstallment).n;
      if (withExtras && !run.done) {
        let extra = 0n;
        for (const e of parsed) {
          if (e.spec.type === 'ONE_TIME' ? e.spec.installmentNo === n : n >= e.spec.fromInstallmentNo) {
            extra += e.amount;
          }
        }
        if (extra > 0n) run.extra(extra, paid.dueDate);
      }
      series.push({ period: paid.dueDate, balance: fmt(run.balance, scale) });
    }
    return {
      totalInterest: fmt(run.interest, scale),
      endDate: lastDue || null,
      installments,
      series,
    };
  };

  const current = project(false);
  const scenario = project(true);
  const saved = dec(current.totalInterest).minus(scenario.totalInterest);
  return {
    loanId: loan.id,
    currency: cur.code,
    current,
    scenario,
    interestSaved: saved.toFixed(scale),
    monthsSaved: monthsBetween(scenario.endDate, current.endDate),
  };
}

function monthsBetween(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0;
  const a = LocalDate.parse(from);
  const b = LocalDate.parse(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

// ───────────────────────────────────────────────────────────── estrategias

export interface StrategiesInput {
  readonly currency: Currency;
  readonly monthlyExtra: string;
  readonly loans: readonly PayoffLoan[];
  readonly strategies?: readonly PayoffStrategy[];
}

const monthOf = (date: string): string => date.slice(0, 7);

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/** Orden del extra: avalanche mayor tasa (menor saldo, menor id); snowball menor saldo (mayor tasa, menor id). */
function priority(strategy: PayoffStrategy, a: LoanRun, b: LoanRun): number {
  const rateA = dec(a.loan.annualRate);
  const rateB = dec(b.loan.annualRate);
  const byRate = rateB.cmp(rateA);
  const byBalance = a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0;
  const byId = a.loan.id < b.loan.id ? -1 : a.loan.id > b.loan.id ? 1 : 0;
  if (strategy === 'AVALANCHE') return byRate || byBalance || byId;
  return byBalance || byRate || byId;
}

function runStrategy(
  strategy: PayoffStrategy,
  runs: readonly LoanRun[],
  currency: Currency,
  monthlyExtra: bigint,
): StrategyResult {
  const scale = currency.scale;
  const pending = runs.filter((r) => !r.done);
  const startMonth = pending.map((r) => monthOf(r.nextDue as string)).sort()[0];
  const series: SeriesPoint[] = [];
  const freed: { month: string; amount: bigint }[] = [];
  let debtFree: string | null = null;
  let months = 0;
  if (startMonth !== undefined) {
    let month = startMonth;
    for (let step = 0; step < SIMULATION_HORIZON_MONTHS; step += 1) {
      const active = runs.filter((r) => !r.done);
      if (active.length === 0) break;
      let lastDue: string | null = null;
      // 1. cuotas programadas del mes
      for (const run of active) {
        if (run.nextDue !== null && monthOf(run.nextDue) === month) {
          const paid = run.pay();
          lastDue = paid.dueDate;
          if (paid.final && strategy !== 'NONE') {
            // cuota liberada: la regular (la anterior si salda en la cuota final absorbente), desde el mes siguiente
            freed.push({ month: nextMonth(month), amount: run.lastRegularTotal ?? paid.total });
          } else if (!paid.final) {
            run.lastRegularTotal = paid.total;
          }
        }
      }
      // 2. extra del mes: extra mensual + cuotas de préstamos saldados en meses anteriores
      if (strategy !== 'NONE') {
        let pool = monthlyExtra;
        for (const f of freed) if (f.month <= month) pool += f.amount;
        const order = runs.filter((r) => !r.done && !r.loan.custom).sort((a, b) => priority(strategy, a, b));
        for (const run of order) {
          if (pool <= 0n) break;
          const due = lastDue ?? `${month}-01`;
          const applied = run.extra(pool, due);
          pool -= applied;
          if (run.balance === 0n && applied > 0n) {
            // un préstamo saldado con extra libera su cuota regular desde el mes siguiente
            const regular = run.lastRegularTotal ?? 0n;
            if (regular > 0n) freed.push({ month: nextMonth(month), amount: regular });
          }
        }
      }
      const total = runs.reduce((acc, r) => acc + (r.done ? 0n : r.balance), 0n);
      series.push({ period: month, balance: fmt(total, scale) });
      months += 1;
      month = nextMonth(month);
      if (runs.every((r) => r.done)) break;
    }
    const ends = runs
      .map((r) => r.endDate)
      .filter((x): x is string => x !== null)
      .sort();
    debtFree = ends.length > 0 ? (ends[ends.length - 1] as string) : null;
  }
  const totalInterest = runs.reduce((acc, r) => acc + r.interest, 0n);
  return {
    strategy,
    totalInterest: fmt(totalInterest, scale),
    debtFreeDate: debtFree,
    interestSaved: fmt(0n, scale),
    monthsToDebtFree: months,
    loans: runs.map((r) => ({
      loanId: r.loan.id,
      name: r.loan.name,
      endDate: r.endDate,
      interest: fmt(r.interest, scale),
    })),
    series,
  };
}

/** Compara las estrategias para un extra mensual entre los préstamos de la moneda del extra. */
export function simulateStrategies(input: StrategiesInput): StrategiesSimulation {
  const { currency } = input;
  const scale = currency.scale;
  if (input.loans.length > MAX_SIMULATED_LOANS) {
    throw fail('VALIDATION_FAILED', `a simulation takes at most ${MAX_SIMULATED_LOANS} loans`, {
      field: 'loans',
    });
  }
  const extra = Money.parse(input.monthlyExtra, currency);
  if (extra.isNegative())
    throw fail('VALIDATION_FAILED', 'the extra must not be negative', { field: 'monthlyExtra' });
  const monthlyExtra = extra.toMinorUnits();

  const outOfStrategy: OutOfStrategyLoan[] = [];
  const included: PayoffLoan[] = [];
  for (const loan of input.loans) {
    if (loan.terms.currency.code !== currency.code) {
      outOfStrategy.push({
        loanId: loan.id,
        name: loan.name,
        reason: 'CURRENCY',
        currency: loan.terms.currency.code,
      });
    } else if (loan.custom || loan.rows.length === 0) {
      outOfStrategy.push({ loanId: loan.id, name: loan.name, reason: 'CUSTOM', currency: currency.code });
    } else {
      included.push(loan);
    }
  }
  const wanted = input.strategies ?? ['NONE', 'AVALANCHE', 'SNOWBALL'];
  const results = wanted.map((strategy) =>
    runStrategy(
      strategy,
      included.map((l) => new LoanRun(l)),
      currency,
      monthlyExtra,
    ),
  );
  const baseline =
    results.find((r) => r.strategy === 'NONE') ??
    runStrategy(
      'NONE',
      included.map((l) => new LoanRun(l)),
      currency,
      0n,
    );
  const strategies = results.map((r) => ({
    ...r,
    interestSaved: dec(baseline.totalInterest).minus(r.totalInterest).toFixed(scale),
  }));
  return {
    currency: currency.code,
    monthlyExtra: fmt(monthlyExtra, scale),
    startBalance: fmt(
      included.reduce((acc, l) => acc + startOf(l), 0n),
      scale,
    ),
    strategies,
    outOfStrategy,
  };
}
