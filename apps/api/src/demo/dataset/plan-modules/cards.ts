import { dec } from '@pf/shared-kernel';
import { addDays, addMonthsClamped, dayOfMonth, daysInMonth, monthAt, parseDate, ymd } from '../calendar.js';
import type { DemoCurrency, DemoMoney, PlanOp } from '../demo-plan.js';
import type { CardCreateOp, InstallmentsOp, ModuleOp } from '../module-ops.js';

/**
 * Tarjetas del dataset Demo v2 (design.md decisión 5). El plan repite con enteros los cálculos de DEBT (ciclos,
 * estados de cuenta, pago mínimo) para fijar los montos de las operaciones y como oráculo del cargador, que compara
 * contra lo que devuelve el motor. Convenciones del motor: un cierre por mes en el día `min(statementDay, último)`; el
 * vencimiento es la primera fecha POSTERIOR al cierre con el día `min(dueDay, último)`.
 */

export const cardClosing = (statementDay: number, y: number, m: number): string =>
  ymd(y, m, Math.min(statementDay, daysInMonth(y, m)));

/** Primera fecha posterior al cierre cuyo día es `dueDay` (último día del mes si no existe). */
export function cardDue(closing: string, dueDay: number): string {
  const { y, m } = parseDate(closing);
  const sameMonth = ymd(y, m, Math.min(dueDay, daysInMonth(y, m)));
  if (sameMonth > closing) return sameMonth;
  const next = monthAt(y, m, 1);
  return ymd(next.y, next.m, Math.min(dueDay, daysInMonth(next.y, next.m)));
}

/** Cierres de la tarjeta con `desde < cierre <= hasta`. */
export function closingsBetween(statementDay: number, from: string, to: string): readonly string[] {
  const start = parseDate(from);
  const out: string[] = [];
  for (let i = -1; ; i += 1) {
    const { y, m } = monthAt(start.y, start.m, i);
    const closing = cardClosing(statementDay, y, m);
    if (closing > to) break;
    if (closing > from) out.push(closing);
  }
  return out;
}

/** Movimiento del ledger de una cuenta de tarjeta: `delta` positivo = compra (más deuda), negativo = pago/reembolso. */
export interface CardMovement {
  /** Fecha de negocio (la que cuenta para el ciclo). */
  readonly date: string;
  /** Fecha en que el plan lo ejecuta (una edición posterior no cambia el estado ya emitido). */
  readonly execDate: string;
  readonly delta: bigint;
  readonly kind: 'purchase' | 'payment' | 'refund';
}

export interface StatementFigures {
  readonly closing: string;
  readonly due: string;
  readonly previousBalance: bigint;
  readonly purchases: bigint;
  readonly payments: bigint;
  readonly refunds: bigint;
  readonly closingBalance: bigint;
  readonly unbilledInstallments: bigint;
  readonly billed: bigint;
  readonly minimum: bigint;
}

export interface MinimumRule {
  readonly percent: string;
  readonly floor: bigint;
  readonly scale: number;
}

/** `min(facturado, max(HALF_EVEN(facturado × %), piso))` (INV-020); 0 si el facturado no es positivo. */
export function minimumPayment(billed: bigint, rule: MinimumRule): bigint {
  if (billed <= 0n) return 0n;
  const byPercent = BigInt(
    dec(billed.toString()).times(dec(rule.percent)).div(100).toDecimalPlaces(0).toFixed(0),
  );
  const wanted = byPercent > rule.floor ? byPercent : rule.floor;
  return wanted < billed ? wanted : billed;
}

/**
 * Cifras del estado de cuenta con cierre `closing` calculadas en `asOf` (fecha de ejecución del plan): solo cuentan los
 * movimientos ya ejecutados (`execDate <= asOf`) con fecha de negocio dentro del ciclo.
 */
export function statementFigures(input: {
  readonly movements: readonly CardMovement[];
  readonly closing: string;
  readonly previousClosing: string;
  readonly dueDay: number;
  readonly asOf: string;
  readonly unbilledInstallments: bigint;
  readonly rule: MinimumRule;
}): StatementFigures {
  const known = input.movements.filter((m) => m.execDate <= input.asOf);
  const sum = (pred: (m: CardMovement) => boolean) => known.filter(pred).reduce((s, m) => s + m.delta, 0n);
  const inCycle = (m: CardMovement) => m.date > input.previousClosing && m.date <= input.closing;
  const closingBalance = sum((m) => m.date <= input.closing);
  const billed = closingBalance - input.unbilledInstallments;
  return {
    closing: input.closing,
    due: cardDue(input.closing, input.dueDay),
    previousBalance: sum((m) => m.date <= input.previousClosing),
    purchases: sum((m) => inCycle(m) && m.kind === 'purchase'),
    payments: sum((m) => inCycle(m) && m.kind === 'payment'),
    refunds: sum((m) => inCycle(m) && m.kind === 'refund'),
    closingBalance,
    unbilledInstallments: input.unbilledInstallments,
    billed,
    minimum: minimumPayment(billed, input.rule),
  };
}

export type StatementStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

/** Situación de un estado de cuenta en `today`: pagos posteriores al cierre frente al mínimo y al facturado. */
export function statementStatus(
  figures: StatementFigures,
  movements: readonly CardMovement[],
  today: string,
): { readonly status: StatementStatus; readonly paid: bigint; readonly pending: bigint } {
  const paid = movements
    .filter((m) => m.kind === 'payment' && m.date > figures.closing && m.date <= today)
    .reduce((s, m) => s - m.delta, 0n);
  if (figures.billed <= 0n || paid >= figures.billed) return { status: 'PAID', paid, pending: 0n };
  if (paid >= figures.minimum && paid > 0n) {
    return { status: 'PARTIALLY_PAID', paid, pending: figures.billed - paid };
  }
  if (today > figures.due) {
    return { status: 'OVERDUE', paid, pending: figures.minimum - paid };
  }
  return { status: 'ISSUED', paid, pending: figures.billed - paid };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── Tarjeta Kantuta

const money = (minor: bigint, currency: DemoCurrency): DemoMoney => ({ minor, currency });

export interface KantutaPlan {
  readonly k1: string;
  readonly k2: string;
  readonly statementDay: number;
  readonly dueDay: number;
  /** Fecha de apertura de las cuentas y alta del perfil. */
  readonly openedOn: string;
  readonly card: CardCreateOp;
  readonly installments: InstallmentsOp;
  /** Operaciones del plan (compras y pago). */
  readonly flows: readonly PlanOp[];
  /** Cierres con su cuenta, para los ticks de emisión. */
  readonly closings: readonly string[];
}

/** Compras, cuotas y pago de "Tarjeta Kantuta Demo" respecto de la ancla (design.md decisión 4). */
export function kantutaPlan(anchor: string): KantutaPlan {
  const k2 = addDays(anchor, -12);
  const k1 = addMonthsClamped(k2, -1);
  const statementDay = dayOfMonth(k2);
  const dueDay = dayOfMonth(addDays(anchor, 8));
  const openedOn = addDays(k1, -60);
  const refrigerator = addDays(k1, -24);
  const hotel = addDays(k1, -13);
  const market = addDays(k1, -8);
  const pharmacy = addDays(k1, 7);
  const payment = addDays(k1, 14);
  const purchase = (
    key: string,
    date: string,
    account: 'kantuta_bob' | 'kantuta_usd',
    amount: DemoMoney,
    category: string,
    counterparty: 'appliances' | 'hotel' | 'market' | 'pharmacy',
    description: string,
  ): PlanOp => ({
    op: 'expense',
    key,
    date,
    account,
    amount,
    splits: [{ category: { name: category }, amount }],
    counterparty,
    paymentMethod: 'CREDIT_CARD',
    description,
  });
  const flows: PlanOp[] = [
    purchase(
      'kantuta:refrigerator',
      refrigerator,
      'kantuta_bob',
      money(480_000n, 'BOB'),
      'Hogar',
      'appliances',
      'Refrigerador',
    ),
    purchase('kantuta:hotel', hotel, 'kantuta_usd', money(20_000n, 'USD'), 'Viajes', 'hotel', 'Hotel Salar'),
    purchase(
      'kantuta:market',
      market,
      'kantuta_bob',
      money(32_050n, 'BOB'),
      'Supermercado y minimarket',
      'market',
      'Compras del súper',
    ),
    purchase(
      'kantuta:pharmacy',
      pharmacy,
      'kantuta_bob',
      money(15_000n, 'BOB'),
      'Farmacia',
      'pharmacy',
      'Farmacia',
    ),
    {
      op: 'transfer',
      date: payment,
      from: 'bank_bob',
      to: 'kantuta_bob',
      amount: money(50_000n, 'BOB'),
      paymentMethod: 'BANK_TRANSFER',
      description: 'Pago Tarjeta Kantuta Demo',
    },
  ];
  const rule = (floor: bigint) => ({ minPercent: '5.00', minFloor: money(floor, 'BOB') });
  return {
    k1,
    k2,
    statementDay,
    dueDay,
    openedOn,
    card: {
      op: 'card',
      date: openedOn,
      key: 'kantuta',
      name: 'Tarjeta Kantuta Demo',
      accounts: [
        { account: 'kantuta_bob', limit: null, ...rule(5_000n) },
        {
          account: 'kantuta_usd',
          limit: null,
          minPercent: '5.00',
          minFloor: money(1_000n, 'USD'),
        },
      ],
      sharedLimit: money(2_000_000n, 'BOB'),
      statementDay,
      dueDay,
    },
    installments: {
      op: 'installments',
      date: refrigerator,
      card: 'kantuta',
      purchase: 'kantuta:refrigerator',
      count: 6,
    },
    flows,
    closings: [k1, k2],
  };
}

export interface KantutaFigures {
  readonly bobK1: StatementFigures & { readonly status: StatementStatus; readonly pending: bigint };
  readonly usdK1: StatementFigures & { readonly status: StatementStatus; readonly pending: bigint };
  readonly bobK2: StatementFigures & { readonly status: StatementStatus; readonly pending: bigint };
  readonly usdK2: StatementFigures & { readonly status: StatementStatus; readonly pending: bigint };
  /** Cargos futuros de cuotas (fecha de vencimiento y monto) tras el último estado emitido. */
  readonly futureCharges: readonly { readonly due: string; readonly amount: bigint }[];
  readonly installment: bigint;
}

/** Cifras esperadas de "Tarjeta Kantuta Demo" en la ancla (oráculo; con la ancla fija, las del golden summary). */
export function kantutaFigures(anchor: string): KantutaFigures {
  const plan = kantutaPlan(anchor);
  const f = plan.flows.filter((o): o is Extract<PlanOp, { op: 'income' | 'expense' }> => o.op === 'expense');
  const bob: CardMovement[] = [];
  const usd: CardMovement[] = [];
  for (const o of f) {
    const target = o.account === 'kantuta_bob' ? bob : usd;
    target.push({ date: o.date, execDate: o.date, delta: o.amount.minor, kind: 'purchase' });
  }
  const pay = plan.flows.find((o) => o.op === 'transfer');
  if (pay?.op === 'transfer') {
    bob.push({ date: pay.date, execDate: pay.date, delta: -pay.amount.minor, kind: 'payment' });
  }
  const installment = 80_000n;
  const k0 = addMonthsClamped(plan.k1, -1);
  const floor = (cur: 'bob' | 'usd'): MinimumRule => ({
    percent: '5.00',
    floor: cur === 'bob' ? 5_000n : 1_000n,
    scale: 2,
  });
  const make = (
    movements: CardMovement[],
    closing: string,
    previous: string,
    unbilled: bigint,
    cur: 'bob' | 'usd',
  ) => {
    const base = statementFigures({
      movements,
      closing,
      previousClosing: previous,
      dueDay: plan.dueDay,
      asOf: anchor,
      unbilledInstallments: unbilled,
      rule: floor(cur),
    });
    return { ...base, ...statementStatus(base, movements, anchor) };
  };
  // Plan de 6 cuotas que empieza a facturar en el ciclo de la compra: 5 sin facturar al primer cierre, 4 al segundo.
  const futureCharges = [3, 4, 5, 6].map((n) => ({
    due: cardDue(addMonthsClamped(plan.k1, n - 1), plan.dueDay),
    amount: installment,
  }));
  return {
    bobK1: make(bob, plan.k1, k0, installment * 5n, 'bob'),
    usdK1: make(usd, plan.k1, k0, 0n, 'usd'),
    bobK2: make(bob, plan.k2, plan.k1, installment * 4n, 'bob'),
    usdK2: make(usd, plan.k2, plan.k1, 0n, 'usd'),
    futureCharges,
    installment,
  };
}

/** Operaciones de módulo de las dos tarjetas que no dependen de los flujos del plan (alta, cuotas y ticks de emisión). */
export function kantutaModuleOps(anchor: string): readonly ModuleOp[] {
  const plan = kantutaPlan(anchor);
  return [
    plan.card,
    plan.installments,
    ...plan.closings.map((c): ModuleOp => ({ op: 'tick', date: addDays(c, 1), runner: 'cards' })),
  ];
}
