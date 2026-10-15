import { dec } from '@pf/shared-kernel';
import { addDays, addMonthsClamped, parseDate, withDay } from '../calendar.js';
import type { DemoCurrency, DemoMoney } from '../demo-plan.js';
import type { LoanKey, ModuleOp } from '../module-ops.js';

/**
 * Préstamos del dataset Demo v2 (design.md decisión 5): cronogramas francés y alemán 30/360 mensuales sin ajuste de
 * fin de semana, calculados con Decimal (HALF_EVEN al escalar la moneda) como oráculo del plan; el cargador compara
 * contra lo que devuelve DEBT. Las fechas son relativas a la ancla (decisión 4).
 */

const SCALE: Readonly<Record<DemoCurrency, number>> = { BOB: 2, USD: 2, USDT: 6, BTC: 8 };

export interface LoanRow {
  readonly n: number;
  readonly due: string;
  readonly payment: bigint;
  readonly interest: bigint;
  readonly principal: bigint;
  /** Principal pendiente tras la cuota. */
  readonly balance: bigint;
}

const toMinor = (value: ReturnType<typeof dec>, scale: number): bigint =>
  BigInt(value.times(dec('10').pow(scale)).toFixed(0));
const fromMinor = (minor: bigint, scale: number) => dec(minor.toString()).div(dec('10').pow(scale));

export interface AmortizationInput {
  readonly principal: bigint;
  /** Tasa anual fraccional (`0.09`). */
  readonly rate: string;
  readonly term: number;
  readonly method: 'FRENCH' | 'GERMAN';
  readonly firstDue: string;
  readonly scale: number;
}

/** Cronograma completo (cuotas 1..term). Escala HALF_EVEN en el interés de cada cuota; la última absorbe el residuo. */
export function amortize(input: AmortizationInput): readonly LoanRow[] {
  const { scale } = input;
  const r = dec(input.rate).div(12);
  const principal = fromMinor(input.principal, scale);
  let balance = principal;
  const level =
    input.method === 'FRENCH'
      ? principal
          .times(r)
          .div(dec('1').minus(dec('1').plus(r).pow(-input.term)))
          .toDecimalPlaces(scale)
      : principal.div(input.term).toDecimalPlaces(scale);
  const rows: LoanRow[] = [];
  for (let n = 1; n <= input.term; n += 1) {
    const interest = balance.times(r).toDecimalPlaces(scale);
    const last = n === input.term;
    const part = last ? balance : input.method === 'FRENCH' ? level.minus(interest) : level;
    balance = balance.minus(part);
    rows.push({
      n,
      due: addMonthsClamped(input.firstDue, n - 1),
      payment: toMinor(part.plus(interest), scale),
      interest: toMinor(interest, scale),
      principal: toMinor(part, scale),
      balance: toMinor(balance, scale),
    });
  }
  return rows;
}

/**
 * Pago extraordinario reduciendo el plazo tras la cuota `afterN` (misma cuota hasta saldar; la última absorbe el
 * residuo). Devuelve las cuotas `afterN + 1 …` nuevas (versión 2 del cronograma).
 */
export function prepayReduceTerm(
  rows: readonly LoanRow[],
  afterN: number,
  amount: bigint,
  input: Pick<AmortizationInput, 'rate' | 'scale' | 'firstDue'>,
): readonly LoanRow[] {
  const { scale } = input;
  const done = rows.find((r) => r.n === afterN);
  const next = rows.find((r) => r.n === afterN + 1);
  if (!done || !next) throw new RangeError(`cuota ${afterN} inexistente`);
  const r = dec(input.rate).div(12);
  const level = fromMinor(next.payment, scale);
  let balance = fromMinor(done.balance - amount, scale);
  const out: LoanRow[] = [];
  for (let n = afterN + 1; balance.gt(0); n += 1) {
    const interest = balance.times(r).toDecimalPlaces(scale);
    const last = balance.plus(interest).lte(level);
    const part = last ? balance : level.minus(interest);
    balance = balance.minus(part);
    out.push({
      n,
      due: addMonthsClamped(input.firstDue, n - 1),
      payment: toMinor(part.plus(interest), scale),
      interest: toMinor(interest, scale),
      principal: toMinor(part, scale),
      balance: toMinor(balance, scale),
    });
  }
  return [...rows.filter((x) => x.n <= afterN), ...out];
}

export interface LoanDefinition {
  readonly key: LoanKey;
  readonly name: string;
  readonly method: 'FRENCH' | 'GERMAN';
  readonly currency: DemoCurrency;
  readonly principal: bigint;
  readonly rate: string;
  readonly term: number;
  readonly disbursementDate: string;
  readonly firstDue: string;
  /** Cuotas pagadas al vencimiento (1..paidThrough). */
  readonly paidThrough: number;
  readonly prepayment: { readonly afterN: number; readonly amount: bigint } | null;
  readonly account: 'bank_bob' | 'bank_usd';
  readonly lender: 'bank' | 'illimani' | 'aunt' | 'eduFund';
  readonly institution: 'andino' | 'illimani' | null;
  readonly reference: string;
}

/** Los cuatro préstamos con fechas relativas a la ancla `A` (design.md decisión 4). */
export function loanDefinitions(anchor: string): readonly LoanDefinition[] {
  const monthBack = (date: string, k: number) => addMonthsClamped(date, -k);
  const vehicularLast = withDay(anchor, 1); // cuota 19 = día 1 del mes de A
  const vehicularFirst = monthBack(vehicularLast, 18);
  const consumoDue6 = addDays(anchor, -9); // cuota 6 = A − 9
  const consumoFirst = monthBack(consumoDue6, 5);
  const familiarDue3 = withDay(monthBack(anchor, 7), 10); // cuota 3 = día 10 del mes de A − 7 meses
  const familiarFirst = monthBack(familiarDue3, 2);
  const educativoDue8 = addDays(anchor, -20); // cuota 8 = A − 20
  const educativoFirst = monthBack(educativoDue8, 7);
  return [
    {
      key: 'vehicular',
      name: 'Préstamo vehicular',
      method: 'FRENCH',
      currency: 'BOB',
      principal: 5_000_000n,
      rate: '0.09',
      term: 36,
      disbursementDate: monthBack(vehicularFirst, 1),
      firstDue: vehicularFirst,
      paidThrough: 19,
      prepayment: null,
      account: 'bank_bob',
      lender: 'bank',
      institution: 'andino',
      reference: 'DEMO-LOAN-0001',
    },
    {
      key: 'consumo',
      name: 'Préstamo de consumo',
      method: 'GERMAN',
      currency: 'BOB',
      principal: 1_200_000n,
      rate: '0.12',
      term: 12,
      disbursementDate: monthBack(consumoFirst, 1),
      firstDue: consumoFirst,
      paidThrough: 4,
      prepayment: null,
      account: 'bank_bob',
      lender: 'illimani',
      institution: 'illimani',
      reference: 'DEMO-LOAN-0002',
    },
    {
      key: 'familiar',
      name: 'Préstamo familiar',
      method: 'FRENCH',
      currency: 'BOB',
      principal: 100_000n,
      rate: '0.12',
      term: 3,
      disbursementDate: monthBack(familiarFirst, 1),
      firstDue: familiarFirst,
      paidThrough: 3,
      prepayment: null,
      account: 'bank_bob',
      lender: 'aunt',
      institution: null,
      reference: 'DEMO-LOAN-0003',
    },
    {
      key: 'educativo',
      name: 'Crédito educativo',
      method: 'FRENCH',
      currency: 'USD',
      principal: 1_200_000n,
      rate: '0.12',
      term: 12,
      disbursementDate: monthBack(educativoFirst, 1),
      firstDue: educativoFirst,
      paidThrough: 8,
      prepayment: { afterN: 3, amount: 300_000n },
      account: 'bank_usd',
      lender: 'eduFund',
      institution: null,
      reference: 'DEMO-LOAN-0004',
    },
  ];
}

/** Cronograma vigente del préstamo (con el pago extraordinario aplicado si lo hay). */
export function currentSchedule(def: LoanDefinition): readonly LoanRow[] {
  const scale = SCALE[def.currency];
  const base = amortize({
    principal: def.principal,
    rate: def.rate,
    term: def.term,
    method: def.method,
    firstDue: def.firstDue,
    scale,
  });
  return def.prepayment
    ? prepayReduceTerm(base, def.prepayment.afterN, def.prepayment.amount, {
        rate: def.rate,
        scale,
        firstDue: def.firstDue,
      })
    : base;
}

const money = (minor: bigint, currency: DemoCurrency): DemoMoney => ({ minor, currency });

/** Operaciones del plan de un préstamo: alta y desembolso, pagos al vencimiento y pago extraordinario. */
export function loanOps(def: LoanDefinition): readonly ModuleOp[] {
  const ops: ModuleOp[] = [
    {
      op: 'loan',
      date: def.disbursementDate,
      key: def.key,
      name: def.name,
      method: def.method,
      principal: money(def.principal, def.currency),
      annualRate: def.rate,
      term: def.term,
      disbursementDate: def.disbursementDate,
      firstDueDate: def.firstDue,
      account: def.account,
      lender: def.lender,
      institution: def.institution,
      reference: def.reference,
    },
  ];
  const scale = SCALE[def.currency];
  const base = amortize({
    principal: def.principal,
    rate: def.rate,
    term: def.term,
    method: def.method,
    firstDue: def.firstDue,
    scale,
  });
  const final = currentSchedule(def);
  for (let n = 1; n <= def.paidThrough; n += 1) {
    // Una cuota posterior al pago extraordinario se paga con el cronograma nuevo; las anteriores, con el original.
    const row = (def.prepayment && n > def.prepayment.afterN ? final : base).find((r) => r.n === n);
    if (!row) throw new RangeError(`${def.key}: cuota ${n} inexistente`);
    ops.push({
      op: 'loanPayment',
      date: row.due,
      loan: def.key,
      installmentNo: n,
      total: money(row.payment, def.currency),
      principal: money(row.principal, def.currency),
      interest: money(row.interest, def.currency),
      account: def.account,
    });
    if (def.prepayment && n === def.prepayment.afterN) {
      ops.push({
        op: 'loanPrepayment',
        date: row.due,
        loan: def.key,
        amount: money(def.prepayment.amount, def.currency),
        account: def.account,
      });
    }
  }
  return ops;
}

export interface LoanFigures {
  readonly key: LoanKey;
  readonly status: 'ACTIVE' | 'PAID_OFF';
  readonly paid: number;
  /** Cuotas no pagadas con vencimiento anterior a la ancla. */
  readonly overdue: number;
  readonly overdueAmounts: readonly string[];
  /** Principal pendiente (string decimal). */
  readonly outstanding: string;
  readonly nextInstallmentNo: number | null;
  readonly nextDue: string | null;
  readonly lastDue: string;
  readonly scheduleVersion: number;
  /** Interés de las cuotas pagadas con vencimiento en el año de la ancla. */
  readonly interestInAnchorYear: string;
  readonly currency: DemoCurrency;
}

const decimal = (minor: bigint, currency: DemoCurrency) =>
  fromMinor(minor, SCALE[currency]).toFixed(SCALE[currency]);

/** Cifras esperadas del préstamo en la ancla (oráculo; con la ancla fija son las del golden summary). */
export function loanFigures(def: LoanDefinition, anchor: string): LoanFigures {
  const schedule = currentSchedule(def);
  const year = parseDate(anchor).y;
  const paid = schedule.filter((r) => r.n <= def.paidThrough);
  const unpaid = schedule.filter((r) => r.n > def.paidThrough);
  const overdue = unpaid.filter((r) => r.due < anchor);
  const last = paid.at(-1);
  const outstanding = last ? last.balance : def.principal;
  const interest = paid.filter((r) => parseDate(r.due).y === year).reduce((acc, r) => acc + r.interest, 0n);
  const next = unpaid[0] ?? null;
  return {
    key: def.key,
    status: unpaid.length === 0 ? 'PAID_OFF' : 'ACTIVE',
    paid: paid.length,
    overdue: overdue.length,
    overdueAmounts: overdue.map((r) => decimal(r.payment, def.currency)),
    outstanding: decimal(outstanding, def.currency),
    nextInstallmentNo: next?.n ?? null,
    nextDue: next?.due ?? null,
    lastDue: (schedule.at(-1) as LoanRow).due,
    scheduleVersion: def.prepayment ? 2 : 1,
    interestInAnchorYear: decimal(interest, def.currency),
    currency: def.currency,
  };
}
