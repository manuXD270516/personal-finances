import { dec } from '@pf/shared-kernel';
import {
  addDays,
  addMonthsClamped,
  dayOfMonth,
  lastBusinessDay,
  monthAt,
  monthStart,
  parseDate,
  withDay,
  ymd,
} from '../calendar.js';
import type { AccountKey, CategoryRef, CounterpartyKey, DemoCurrency, DemoMoney } from '../demo-plan.js';
import type {
  DefinitionKey,
  ModuleOp,
  OccurrenceOp,
  RecurringCreateOp,
  SubscriptionCreateOp,
  SubscriptionKey,
} from '../module-ops.js';

/**
 * Suscripciones y compromisos recurrentes del dataset Demo v2 (design.md decisión 5). Las fechas de los flujos
 * heredados de v1 se desplazan en días (`shift = ancla − 2026-09-30`); las definiciones nuevas se fechan respecto de la
 * ancla. El plan fija cada ocurrencia que se resuelve (con su efecto en el ledger) y el cargador la ejecuta con los
 * casos de uso públicos de COMMITMENTS.
 */

const money = (minor: bigint, currency: DemoCurrency): DemoMoney => ({ minor, currency });
const SCALE: Readonly<Record<DemoCurrency, number>> = { BOB: 2, USD: 2, USDT: 6, BTC: 8 };

interface SubscriptionSpec {
  readonly key: SubscriptionKey;
  readonly name: string;
  readonly counterparty: CounterpartyKey;
  readonly account: AccountKey;
  readonly price: DemoMoney;
  readonly cadence: 'MONTHLY' | 'ANNUAL';
  /** Primera renovación y alta, en coordenadas de v1 (ancla fija); `null` = relativa a la ancla. */
  readonly first: string | null;
  readonly category: string;
}

const SUBSCRIPTIONS: readonly SubscriptionSpec[] = [
  {
    key: 'stream',
    name: 'StreamFlix Demo',
    counterparty: 'streaming',
    account: 'bank_usd',
    price: money(999n, 'USD'),
    cadence: 'MONTHLY',
    first: '2025-01-03',
    category: 'Suscripciones digitales',
  },
  {
    key: 'music',
    name: 'MúsicaYa Demo',
    counterparty: 'music',
    account: 'bank_usd',
    price: money(599n, 'USD'),
    cadence: 'MONTHLY',
    first: '2025-01-08',
    category: 'Suscripciones digitales',
  },
  {
    key: 'cloud',
    name: 'NubeSegura Demo',
    counterparty: 'cloud',
    account: 'bank_usd',
    price: money(299n, 'USD'),
    cadence: 'MONTHLY',
    first: '2025-01-15',
    category: 'Suscripciones digitales',
  },
  {
    key: 'antivirus',
    name: 'Antivirus Escudo Demo',
    counterparty: 'antivirus',
    account: 'bank_usd',
    price: money(3_999n, 'USD'),
    cadence: 'ANNUAL',
    first: '2025-10-12',
    category: 'Suscripciones digitales',
  },
  {
    key: 'vpn',
    name: 'VPN Cóndor Demo',
    counterparty: 'vpn',
    account: 'usdt',
    price: money(5_000_000n, 'USDT'),
    cadence: 'MONTHLY',
    first: '2026-01-20',
    category: 'Suscripciones digitales',
  },
  {
    key: 'gym',
    name: 'Gimnasio Sajama Demo',
    counterparty: 'gym',
    account: 'card',
    price: money(25_000n, 'BOB'),
    cadence: 'MONTHLY',
    first: '2026-01-10',
    category: 'Deporte y gimnasio',
  },
  {
    key: 'magazine',
    name: 'Revista Andina Demo',
    counterparty: 'magazine',
    account: 'bank_bob',
    price: money(12_000n, 'BOB'),
    cadence: 'ANNUAL',
    first: '2025-02-01',
    category: 'Suscripciones digitales',
  },
  {
    key: 'course',
    name: 'Curso Kantuta Demo',
    counterparty: 'course',
    account: 'bank_usd',
    price: money(1_500n, 'USD'),
    cadence: 'MONTHLY',
    first: null,
    category: 'Cursos e idiomas',
  },
];

/** Fechas de renovación `first, first + 1 período …` hasta `until` (inclusive), con el día del mes del primero. */
export function renewalDates(first: string, cadence: 'MONTHLY' | 'ANNUAL' | 'QUARTERLY', until: string) {
  const step = cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : 12;
  const { y, m, d } = parseDate(first);
  const out: string[] = [];
  for (let i = 0; ; i += 1) {
    const at = monthAt(y, m, i * step);
    const date = withDay(ymd(at.y, at.m, 1), d);
    if (date > until) break;
    out.push(date);
  }
  return out;
}

/** Costo mensualizado y anual en moneda base a las tasas de cierre (Decimal, HALF_EVEN solo al presentar). */
export function subscriptionCosts(
  active: readonly { readonly price: DemoMoney; readonly cadence: 'MONTHLY' | 'ANNUAL' }[],
  trial: readonly { readonly price: DemoMoney; readonly cadence: 'MONTHLY' | 'ANNUAL' }[],
  rates: Readonly<Record<string, string>>,
): { readonly monthly: string; readonly yearly: string; readonly trialMonthly: string } {
  const base = (price: DemoMoney) =>
    dec(price.minor.toString())
      .div(dec('10').pow(SCALE[price.currency]))
      .times(price.currency === 'BOB' ? '1' : (rates[price.currency] as string));
  const perMonth = (s: { price: DemoMoney; cadence: 'MONTHLY' | 'ANNUAL' }) =>
    s.cadence === 'MONTHLY' ? base(s.price) : base(s.price).div(12);
  const perYear = (s: { price: DemoMoney; cadence: 'MONTHLY' | 'ANNUAL' }) =>
    s.cadence === 'MONTHLY' ? base(s.price).times(12) : base(s.price);
  const sum = (items: typeof active, f: typeof perMonth) =>
    items.reduce((acc, s) => acc.plus(f(s)), dec('0'));
  return {
    monthly: sum(active, perMonth).toDecimalPlaces(2).toFixed(2),
    yearly: sum(active, perYear).toDecimalPlaces(2).toFixed(2),
    trialMonthly: sum(trial, perMonth).toDecimalPlaces(2).toFixed(2),
  };
}

export interface SubscriptionPlan {
  readonly key: SubscriptionKey;
  readonly status: 'active' | 'trial' | 'paused' | 'cancelled';
  readonly price: DemoMoney;
  readonly cadence: 'MONTHLY' | 'ANNUAL';
}

export interface CommitmentsPlan {
  readonly ops: readonly ModuleOp[];
  readonly subscriptions: readonly SubscriptionPlan[];
  /** Ocurrencias de definiciones recurrentes sin resolver al llegar a la ancla (atrasadas). */
  readonly unresolved: readonly {
    readonly definition: DefinitionKey;
    readonly date: string;
    readonly amount: DemoMoney;
  }[];
}

export interface CommitmentsContext {
  readonly anchor: string;
  /** Desplazamiento en días de los flujos de v1 (`ancla − 2026-09-30`). */
  readonly shift: number;
  /** Primer día de la ventana (alta de las suscripciones heredadas). */
  readonly startDate: string;
  /** Gasto de luz de v1 por mes calendario (`YYYY-MM` → clave y fecha del gasto), para vincular la ocurrencia. */
  readonly powerExpenseByMonth: ReadonlyMap<string, { readonly key: string; readonly date: string }>;
}

/**
 * Construye las operaciones de suscripciones y definiciones recurrentes. `at` desplaza una fecha de v1 a la ancla.
 */
export function buildCommitments(ctx: CommitmentsContext): CommitmentsPlan {
  const { anchor } = ctx;
  const at = (date: string) => addDays(date, ctx.shift);
  const ops: ModuleOp[] = [];
  const category = (name: string): CategoryRef => ({ name });
  const plans: SubscriptionPlan[] = [];
  const trialEndsOn = addDays(anchor, 5);

  for (const spec of SUBSCRIPTIONS) {
    const first = spec.first === null ? trialEndsOn : at(spec.first);
    const createdOn =
      spec.key === 'course'
        ? addDays(anchor, -20)
        : spec.first === '2025-01-03' || spec.first === '2025-01-08' || spec.first === '2025-01-15'
          ? ctx.startDate
          : addDays(first, -2);
    const create: SubscriptionCreateOp = {
      op: 'subscription',
      date: createdOn,
      key: spec.key,
      name: spec.name,
      counterparty: spec.counterparty,
      account: spec.account,
      price: spec.price,
      cadence: spec.cadence,
      firstRenewalOn: first,
      category: category(spec.category),
      ...(spec.key === 'course' ? { trialEndsOn } : {}),
    };
    ops.push(create);

    // Hechos de vida de la suscripción.
    let priceAt = (_date: string): DemoMoney => spec.price;
    let endsOn = anchor;
    let status: SubscriptionPlan['status'] = spec.key === 'course' ? 'trial' : 'active';
    if (spec.key === 'stream') {
      const hike = at('2025-10-03');
      const hiked = money(1_199n, 'USD');
      ops.push({
        op: 'subscriptionPrice',
        date: addDays(hike, -8),
        sub: 'stream',
        price: hiked,
        effectiveFrom: hike,
      });
      priceAt = (date) => (date >= hike ? hiked : spec.price);
    }
    if (spec.key === 'music') {
      const paused = at('2026-08-20');
      ops.push({ op: 'subscriptionStatus', date: paused, sub: 'music', action: 'pause' });
      endsOn = paused;
      status = 'paused';
    }
    if (spec.key === 'magazine') {
      const cancelled = at('2026-06-30');
      ops.push({
        op: 'subscriptionStatus',
        date: cancelled,
        sub: 'magazine',
        action: 'cancel',
        reason: 'Ya no la leo',
      });
      endsOn = cancelled;
      status = 'cancelled';
    }
    plans.push({
      key: spec.key,
      status,
      price: spec.key === 'stream' ? money(1_199n, 'USD') : spec.price,
      cadence: spec.cadence,
    });

    // Cargos pasados: cada renovación hasta la ancla (o hasta la pausa/cancelación) se aprueba el día del cargo.
    if (spec.key === 'course') continue;
    const dates = renewalDates(first, spec.cadence, endsOn <= anchor ? endsOn : anchor);
    for (const [index, date] of dates.entries()) {
      const lastOfCloud = spec.key === 'cloud' && index === dates.length - 1 && date >= addDays(anchor, -45);
      const amount = lastOfCloud ? money(349n, 'USD') : priceAt(date);
      ops.push({
        op: 'occurrence',
        date,
        target: { type: 'subscription', key: spec.key },
        occurrenceDate: date,
        action: 'approve',
        ...(lastOfCloud ? { amount } : {}),
        effect: { kind: 'expense', account: spec.account, amount },
      });
    }
  }

  // ── Definiciones recurrentes: creadas el día 1 del mes de A − 6 meses; 6 meses de ocurrencias.
  const createdOn = monthStart(addMonthsClamped(anchor, -6));
  const firstMonth = monthStart(addMonthsClamped(anchor, -5));
  const lastMonth = monthStart(anchor);
  const months: string[] = [];
  for (let i = 0; ; i += 1) {
    const { y, m } = monthAt(parseDate(firstMonth).y, parseDate(firstMonth).m, i);
    const start = ymd(y, m, 1);
    if (start > lastMonth) break;
    months.push(start);
  }
  const internetDay = dayOfMonth(addDays(anchor, -2));
  const insuranceDue = addDays(anchor, -45);
  const insuranceStart = addMonthsClamped(insuranceDue, -3);
  const def = (
    key: DefinitionKey,
    over: Omit<RecurringCreateOp, 'op' | 'date' | 'key' | 'startDate'> & { startDate?: string },
  ): RecurringCreateOp => ({
    op: 'recurring',
    date: createdOn,
    key,
    startDate: over.startDate ?? firstMonth,
    ...over,
  });
  ops.push(
    def('salary', {
      name: 'Sueldo',
      kind: 'INCOME',
      account: 'bank_bob',
      amount: money(1_260_000n, 'BOB'),
      amountType: 'FIXED',
      counterparty: 'employer',
      category: category('Sueldo'),
      monthDays: [31],
      cadence: 'MONTHLY',
      weekendAdjustment: 'PREVIOUS',
      mode: 'AUTO_CREATE',
    }),
    def('rent', {
      name: 'Alquiler',
      kind: 'EXPENSE',
      account: 'bank_bob',
      amount: money(370_000n, 'BOB'),
      amountType: 'FIXED',
      counterparty: 'landlord',
      category: category('Alquiler'),
      monthDays: [5],
      cadence: 'MONTHLY',
      weekendAdjustment: 'NONE',
      mode: 'PENDING_APPROVAL',
    }),
    def('internet', {
      name: 'Internet Fibra Kantuta Demo',
      kind: 'EXPENSE',
      account: 'bank_bob',
      amount: money(19_900n, 'BOB'),
      amountType: 'FIXED',
      counterparty: 'internet',
      category: category('Internet'),
      monthDays: [internetDay],
      cadence: 'MONTHLY',
      weekendAdjustment: 'NONE',
      mode: 'PENDING_APPROVAL',
    }),
    def('power', {
      name: 'Luz Altiplano Demo',
      kind: 'EXPENSE',
      account: 'bank_bob',
      amount: money(18_000n, 'BOB'),
      amountType: 'ESTIMATED',
      counterparty: 'power',
      category: category('Luz'),
      monthDays: [12],
      cadence: 'MONTHLY',
      weekendAdjustment: 'NONE',
      mode: 'NOTIFY_ONLY',
    }),
    def('cashWithdrawal', {
      name: 'Retiro de efectivo',
      kind: 'TRANSFER',
      account: 'bank_bob',
      toAccount: 'cash',
      amount: money(60_000n, 'BOB'),
      amountType: 'FIXED',
      counterparty: null,
      category: null,
      monthDays: [2],
      cadence: 'MONTHLY',
      weekendAdjustment: 'NONE',
      mode: 'AUTO_CREATE',
    }),
    def('insurance', {
      name: 'Seguro vehicular Seguros Illampu Demo',
      kind: 'EXPENSE',
      account: 'bank_bob',
      amount: money(45_000n, 'BOB'),
      amountType: 'FIXED',
      counterparty: 'insurer',
      category: category('Vehículo'),
      monthDays: [dayOfMonth(insuranceDue)],
      cadence: 'QUARTERLY',
      weekendAdjustment: 'NONE',
      mode: 'AUTO_CREATE',
      startDate: insuranceStart,
    }),
  );

  const unresolved: { definition: DefinitionKey; date: string; amount: DemoMoney }[] = [];
  const occurrence = (o: Omit<OccurrenceOp, 'op'>): void => {
    ops.push({ op: 'occurrence', ...o });
  };
  for (const month of months) {
    // Sueldo: automático el día 31 con ajuste al día hábil anterior (nominal = fin de mes).
    const { y, m } = parseDate(month);
    const nominalSalary = withDay(month, 31);
    const salaryDue = salaryDueDate(nominalSalary);
    if (salaryDue <= anchor) {
      occurrence({
        date: salaryDue,
        target: { type: 'definition', key: 'salary' },
        occurrenceDate: nominalSalary,
        action: 'auto',
        effect: { kind: 'income', account: 'bank_bob', amount: money(1_260_000n, 'BOB') },
      });
    }
    const rentDate = withDay(month, 5);
    if (rentDate <= anchor) {
      occurrence({
        date: rentDate,
        target: { type: 'definition', key: 'rent' },
        occurrenceDate: rentDate,
        action: 'approve',
        effect: { kind: 'expense', account: 'bank_bob', amount: money(370_000n, 'BOB') },
      });
    }
    const internetDate = withDay(month, internetDay);
    if (internetDate <= anchor) {
      const amount = money(19_900n, 'BOB');
      if (internetDate === addDays(anchor, -2)) {
        occurrence({
          date: internetDate,
          target: { type: 'definition', key: 'internet' },
          occurrenceDate: internetDate,
          action: 'leave',
          effect: null,
        });
        unresolved.push({ definition: 'internet', date: internetDate, amount });
      } else {
        occurrence({
          date: internetDate,
          target: { type: 'definition', key: 'internet' },
          occurrenceDate: internetDate,
          action: 'approve',
          effect: { kind: 'expense', account: 'bank_bob', amount },
        });
      }
    }
    const powerDate = withDay(month, 12);
    if (powerDate <= anchor) {
      const linked = ctx.powerExpenseByMonth.get(`${y}-${String(m).padStart(2, '0')}`);
      occurrence({
        // Se vincula cuando el gasto de v1 ya está registrado (con otras anclas queda días después del nominal).
        date: linked && linked.date > powerDate ? linked.date : powerDate,
        target: { type: 'definition', key: 'power' },
        occurrenceDate: powerDate,
        action: linked ? 'link' : 'approve',
        ...(linked ? { linkTo: linked.key } : {}),
        effect: linked ? null : { kind: 'expense', account: 'bank_bob', amount: money(18_000n, 'BOB') },
      });
    }
    const cashDate = withDay(month, 2);
    if (cashDate <= anchor) {
      occurrence({
        date: cashDate,
        target: { type: 'definition', key: 'cashWithdrawal' },
        occurrenceDate: cashDate,
        action: 'auto',
        effect: { kind: 'transfer', from: 'bank_bob', to: 'cash', amount: money(60_000n, 'BOB') },
      });
    }
  }
  for (const date of renewalDates(insuranceStart, 'QUARTERLY', anchor)) {
    occurrence({
      date,
      target: { type: 'definition', key: 'insurance' },
      occurrenceDate: date,
      action: 'auto',
      effect: { kind: 'expense', account: 'bank_bob', amount: money(45_000n, 'BOB') },
    });
  }
  return { ops, subscriptions: plans, unresolved };
}

/** Día de pago del sueldo: el nominal (fin de mes) o el día hábil anterior (ajuste `PREVIOUS`). */
export function salaryDueDate(nominal: string): string {
  const { y, m } = parseDate(nominal);
  const last = lastBusinessDay(y, m);
  // `PREVIOUS` solo retrocede si el nominal cae en fin de semana.
  return nominal <= last ? nominal : last;
}
