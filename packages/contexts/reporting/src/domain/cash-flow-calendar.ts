import { dec, LocalDate, Money, type Currency, type Decimal } from '@pf/shared-kernel';

/**
 * DS `CashFlowCalendar` (openspec add-cash-flow-forecast, design.md decisión 3; docs/14 §8; FR-REPORTING-014/015): puro y
 * determinista, sin reloj ni E/S. Convierte los movimientos esperados (transacciones pendientes y ocurrencias no resueltas)
 * en el saldo esperado diario de las cuentas líquidas, por cuenta y por moneda:
 *   `low_k(d) = B_k(d−1) + Σ egresos_k(d)` y `B_k(d) = low_k(d) + Σ ingresos_k(d)`, con `B_k(T−1) = Σ saldo contable`.
 * Los egresos del día se aplican ANTES que los ingresos (orden conservador); lo vencido se aplica en hoy. Todo en Decimal
 * (precisión 40, sin redondeo intermedio); el redondeo HALF_EVEN ocurre una sola vez, al materializar `Money`.
 */

export type CashFlowEventKind =
  'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CONVERSION' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
export type CashFlowCertainty = 'KNOWN' | 'ESTIMATED' | 'EXPECTED';
export type CashFlowAmountType = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';
export type CashFlowManagedBy = 'USER' | 'SUBSCRIPTION' | 'DEBT' | 'GOAL';

/** Cuenta líquida (`ASSET` + `LIQUID`, no archivada; D35) con su saldo contable. */
export interface CashFlowAccountInput {
  readonly accountId: string;
  readonly name: string;
  readonly balance: Money;
}

/** Movimiento esperado: una ocurrencia no resuelta o una transacción `PENDING`. */
export interface CashFlowMovementInput {
  readonly id: string;
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly kind: CashFlowEventKind;
  /** Fecha de vencimiento o de negocio; anterior a hoy ⇒ se aplica hoy, marcado vencido. */
  readonly date: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amountType: CashFlowAmountType | null;
  readonly name: string | null;
  readonly managedBy: CashFlowManagedBy | null;
  readonly categoryId: string | null;
  /** Monto que sale de la cuenta de origen (o entra, en un ingreso): `MIN_MAX` ya resuelto; `null` si es `VARIABLE`. */
  readonly amount: Money | null;
  /** Monto que entra en la cuenta de destino (conversiones); por omisión, `amount`. */
  readonly toAmount: Money | null;
}

export interface CashFlowDayPoint {
  readonly date: string;
  /** Saldo al cierre del día. */
  readonly balance: Money;
  /** Saldo más bajo del día (egresos antes que ingresos). */
  readonly low: Money;
}

export interface CashFlowLowest {
  readonly amount: Money;
  readonly date: string;
}

export interface CashFlowEvent {
  readonly id: string;
  /** Fecha en que se aplica al saldo (hoy para lo vencido). */
  readonly date: string;
  readonly originalDate: string;
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly kind: CashFlowEventKind;
  readonly certainty: CashFlowCertainty;
  readonly amountType: CashFlowAmountType | null;
  readonly name: string | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: Money | null;
  readonly toAmount: Money | null;
  readonly overdue: boolean;
  readonly daysOverdue: number | null;
  readonly managedBy: CashFlowManagedBy | null;
  readonly categoryId: string | null;
}

export interface CashFlowAccountBlock {
  readonly accountId: string;
  readonly name: string;
  readonly currency: Currency;
  readonly startBalance: Money;
  readonly endBalance: Money;
  readonly lowest: CashFlowLowest;
  readonly series: readonly CashFlowDayPoint[];
}

export interface CashFlowCurrencyBlock {
  readonly currency: Currency;
  readonly startBalance: Money;
  readonly endBalance: Money;
  readonly lowest: CashFlowLowest;
  /** Σ de egresos de la serie principal (sin las transferencias entre cuentas líquidas de la moneda). */
  readonly outflowTotal: Money;
  readonly inflowTotal: Money;
  /** Movimientos `VARIABLE` listados sin monto. */
  readonly withoutAmountCount: number;
  readonly series: readonly CashFlowDayPoint[];
  /** Serie con el gasto planificado restante (Σ planificado del día es un egreso más); `null` sin plan aplicable. */
  readonly planned: {
    readonly lowest: CashFlowLowest;
    readonly endBalance: Money;
    readonly series: readonly { readonly date: string; readonly balance: Money; readonly low: Money }[];
  } | null;
  /** Peor caso sin ingresos esperados (sin ocurrencias de ingreso ni ingresos pendientes). */
  readonly withoutExpectedIncome: { readonly lowest: CashFlowLowest; readonly endBalance: Money };
}

export interface CashFlowResult {
  readonly from: string;
  readonly to: string;
  readonly currencies: readonly CashFlowCurrencyBlock[];
  readonly accounts: readonly CashFlowAccountBlock[];
  readonly events: readonly CashFlowEvent[];
}

export interface CashFlowInput {
  /** Hoy en la zona del workspace (`YYYY-MM-DD`). */
  readonly today: string;
  readonly horizonDays: number;
  readonly accounts: readonly CashFlowAccountInput[];
  readonly movements: readonly CashFlowMovementInput[];
  /** Gasto planificado por moneda y día (Decimal, sin redondeo intermedio); ausente = sin serie del plan. */
  readonly plannedByDay?: ReadonlyMap<string, ReadonlyMap<string, Decimal>>;
}

/** Efecto de un movimiento sobre una cuenta líquida: positivo entra, negativo sale. */
interface Effect {
  readonly accountId: string;
  readonly currency: string;
  readonly delta: Decimal;
  /** Transferencia entre cuentas líquidas de la misma moneda: neutra para la serie de la moneda. */
  readonly neutralForCurrency: boolean;
  readonly isIncomeEvent: boolean;
}

const ZERO = dec('0');

/** Certeza del movimiento (design decisión 5): conocido, estimado o esperado (ingreso). */
export function certaintyOf(input: {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly kind: CashFlowEventKind;
  readonly amountType: CashFlowAmountType | null;
}): CashFlowCertainty {
  if (input.kind === 'INCOME') return 'EXPECTED';
  if (input.source === 'PENDING') return 'KNOWN';
  return input.amountType === 'FIXED' ? 'KNOWN' : 'ESTIMATED';
}

const epoch = (date: string) => LocalDate.parse(date).toEpochDay();
const addDays = (date: string, n: number) => LocalDate.parse(date).plusDays(n).toString();

/** Efectos de un movimiento en las cuentas líquidas (los movimientos sin monto no tienen efecto). */
function effectsOf(m: CashFlowMovementInput, liquid: ReadonlyMap<string, CashFlowAccountInput>): Effect[] {
  if (m.amount === null) return [];
  const out: Effect[] = [];
  const isIncome = m.kind === 'INCOME';
  const from = liquid.get(m.accountId);
  const to = m.toAccountId === null ? undefined : liquid.get(m.toAccountId);
  if (isIncome) {
    if (from) {
      out.push({
        accountId: from.accountId,
        currency: m.amount.currency.code,
        delta: m.amount.toDecimal(),
        neutralForCurrency: false,
        isIncomeEvent: true,
      });
    }
    return out;
  }
  const moves = m.kind === 'TRANSFER' || m.kind === 'CONVERSION' || m.kind === 'CARD_PAYMENT';
  const neutral =
    moves &&
    from !== undefined &&
    to !== undefined &&
    m.amount.currency.code === (m.toAmount ?? m.amount).currency.code;
  if (from) {
    out.push({
      accountId: from.accountId,
      currency: m.amount.currency.code,
      delta: m.amount.toDecimal().negated(),
      neutralForCurrency: neutral,
      isIncomeEvent: false,
    });
  }
  if (to && moves) {
    const received = m.toAmount ?? m.amount;
    out.push({
      accountId: to.accountId,
      currency: received.currency.code,
      delta: received.toDecimal(),
      neutralForCurrency: neutral,
      isIncomeEvent: false,
    });
  }
  return out;
}

interface DayAcc {
  out: Decimal;
  inn: Decimal;
}

/** Recorre `[from, to]` aplicando egresos antes que ingresos y devuelve la serie y el mínimo con su PRIMERA fecha. */
function walk(
  start: Decimal,
  days: readonly string[],
  byDay: ReadonlyMap<string, DayAcc>,
  extraOut?: ReadonlyMap<string, Decimal>,
) {
  let balance = start;
  let lowestValue: Decimal | null = null;
  let lowestDate = days[0] as string;
  const series: { date: string; balance: Decimal; low: Decimal }[] = [];
  for (const d of days) {
    const acc = byDay.get(d);
    let low = balance.plus(acc?.out ?? ZERO);
    const planned = extraOut?.get(d);
    if (planned) low = low.minus(planned);
    balance = low.plus(acc?.inn ?? ZERO);
    series.push({ date: d, balance, low });
    if (lowestValue === null || low.lt(lowestValue)) {
      lowestValue = low;
      lowestDate = d;
    }
  }
  return { series, lowest: { value: lowestValue as Decimal, date: lowestDate }, end: balance };
}

export const CashFlowCalendar = {
  compute(input: CashFlowInput): CashFlowResult {
    const { today, horizonDays } = input;
    const to = addDays(today, horizonDays);
    const days = Array.from({ length: horizonDays + 1 }, (_, i) => addDays(today, i));
    const liquid = new Map(input.accounts.map((a) => [a.accountId, a]));
    const todayEpoch = epoch(today);

    // ---- eventos aplicados (vencidos ⇒ hoy; fuera del horizonte ⇒ no cuentan)
    const applied: { readonly event: CashFlowEvent; readonly effects: readonly Effect[] }[] = [];
    const withoutAmount = new Map<string, number>();
    for (const m of input.movements) {
      if (m.date > to) continue;
      const overdue = m.date < today;
      const effectiveDate = overdue ? today : m.date;
      const effects = effectsOf(m, liquid);
      const touchesLiquid = liquid.has(m.accountId) || (m.toAccountId !== null && liquid.has(m.toAccountId));
      if (!touchesLiquid) continue;
      const event: CashFlowEvent = {
        id: m.id,
        date: effectiveDate,
        originalDate: m.date,
        source: m.source,
        kind: m.kind,
        certainty: certaintyOf(m),
        amountType: m.amountType,
        name: m.name,
        accountId: m.accountId,
        toAccountId: m.toAccountId,
        amount: m.amount,
        toAmount: m.toAmount,
        overdue,
        daysOverdue: overdue ? todayEpoch - epoch(m.date) : null,
        managedBy: m.managedBy,
        categoryId: m.categoryId,
      };
      applied.push({ event, effects });
      if (m.amount === null) {
        const accountCurrency = (liquid.get(m.accountId) ?? liquid.get(m.toAccountId as string))?.balance
          .currency.code as string;
        withoutAmount.set(accountCurrency, (withoutAmount.get(accountCurrency) ?? 0) + 1);
      }
    }
    // Orden determinista: por fecha aplicada, egresos antes que ingresos, y por id.
    const rank = (e: CashFlowEvent) => (e.kind === 'INCOME' ? 1 : 0);
    applied.sort(
      (a, b) =>
        (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0) ||
        rank(a.event) - rank(b.event) ||
        (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0),
    );
    const events = applied.map((a) => a.event);

    // ---- acumulados por día: cuenta, moneda y moneda sin ingresos
    const perAccount = new Map<string, Map<string, DayAcc>>();
    const perCurrency = new Map<string, Map<string, DayAcc>>();
    const perCurrencyNoIncome = new Map<string, Map<string, DayAcc>>();
    const totals = new Map<string, { out: Decimal; inn: Decimal }>();
    const bump = (map: Map<string, Map<string, DayAcc>>, key: string, date: string, delta: Decimal) => {
      const byDay = map.get(key) ?? new Map<string, DayAcc>();
      map.set(key, byDay);
      const acc = byDay.get(date) ?? { out: ZERO, inn: ZERO };
      byDay.set(
        date,
        delta.isNegative() ? { ...acc, out: acc.out.plus(delta) } : { ...acc, inn: acc.inn.plus(delta) },
      );
    };
    for (const { event: e, effects } of applied) {
      for (const eff of effects) {
        bump(perAccount, eff.accountId, e.date, eff.delta);
        if (eff.neutralForCurrency) continue;
        bump(perCurrency, eff.currency, e.date, eff.delta);
        if (!eff.isIncomeEvent) bump(perCurrencyNoIncome, eff.currency, e.date, eff.delta);
        const t = totals.get(eff.currency) ?? { out: ZERO, inn: ZERO };
        totals.set(
          eff.currency,
          eff.delta.isNegative()
            ? { ...t, out: t.out.plus(eff.delta) }
            : { ...t, inn: t.inn.plus(eff.delta) },
        );
      }
    }

    const present = (value: Decimal, currency: Currency) => Money.roundToScale(value, currency, 'HALF_EVEN');
    const point = (
      p: { date: string; balance: Decimal; low: Decimal },
      currency: Currency,
    ): CashFlowDayPoint => ({
      date: p.date,
      balance: present(p.balance, currency),
      low: present(p.low, currency),
    });

    // ---- por cuenta
    const accountBlocks: CashFlowAccountBlock[] = input.accounts.map((a) => {
      const currency = a.balance.currency;
      const r = walk(a.balance.toDecimal(), days, perAccount.get(a.accountId) ?? new Map());
      return {
        accountId: a.accountId,
        name: a.name,
        currency,
        startBalance: a.balance,
        endBalance: present(r.end, currency),
        lowest: { amount: present(r.lowest.value, currency), date: r.lowest.date },
        series: r.series.map((p) => point(p, currency)),
      };
    });

    // ---- por moneda
    const currencies = new Map<string, Currency>();
    for (const a of input.accounts) currencies.set(a.balance.currency.code, a.balance.currency);
    const currencyBlocks: CashFlowCurrencyBlock[] = [...currencies.keys()].sort().map((code) => {
      const currency = currencies.get(code) as Currency;
      const start = input.accounts
        .filter((a) => a.balance.currency.code === code)
        .reduce((acc, a) => acc.plus(a.balance.toDecimal()), ZERO);
      const main = walk(start, days, perCurrency.get(code) ?? new Map());
      const noIncome = walk(start, days, perCurrencyNoIncome.get(code) ?? new Map());
      const plannedDays = input.plannedByDay?.get(code);
      const planned =
        plannedDays && plannedDays.size > 0
          ? walk(start, days, perCurrency.get(code) ?? new Map(), plannedDays)
          : null;
      const total = totals.get(code) ?? { out: ZERO, inn: ZERO };
      return {
        currency,
        startBalance: present(start, currency),
        endBalance: present(main.end, currency),
        lowest: { amount: present(main.lowest.value, currency), date: main.lowest.date },
        outflowTotal: present(total.out.negated(), currency),
        inflowTotal: present(total.inn, currency),
        withoutAmountCount: withoutAmount.get(code) ?? 0,
        series: main.series.map((p) => point(p, currency)),
        planned: planned
          ? {
              lowest: { amount: present(planned.lowest.value, currency), date: planned.lowest.date },
              endBalance: present(planned.end, currency),
              series: planned.series.map((p) => ({
                date: p.date,
                balance: present(p.balance, currency),
                low: present(p.low, currency),
              })),
            }
          : null,
        withoutExpectedIncome: {
          lowest: { amount: present(noIncome.lowest.value, currency), date: noIncome.lowest.date },
          endBalance: present(noIncome.end, currency),
        },
      };
    });

    return { from: today, to, currencies: currencyBlocks, accounts: accountBlocks, events };
  },
} as const;
