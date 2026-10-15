import { dec } from '@pf/shared-kernel';
import { addDays, addMonthsClamped, dayOfMonth, epochDay, withDay } from '../calendar.js';
import type { DemoCurrency, DemoMoney, PlanOp } from '../demo-plan.js';
import type { ModuleOp } from '../module-ops.js';
import { renewalDates } from './commitments.js';

/**
 * Metas del dataset Demo v2 (design.md decisión 5): fechas relativas a la ancla (decisión 4). El aporte mensual de
 * "Fondo de emergencia" es la ocurrencia de una definición administrada por la meta; las reservas son movimientos de
 * la meta (EARMARK, sin asiento). Oráculo: avance esperado lineal entre el inicio y la fecha objetivo.
 */

const money = (minor: bigint, currency: DemoCurrency): DemoMoney => ({ minor, currency });
const SCALE: Readonly<Record<DemoCurrency, number>> = { BOB: 2, USD: 2, USDT: 6, BTC: 8 };

export interface GoalsPlan {
  readonly ops: readonly ModuleOp[];
  /** Flujos del plan (gasto de la billetera y transferencia que resuelve el faltante). */
  readonly flows: readonly PlanOp[];
  readonly dates: {
    readonly emergencyStart: string;
    readonly emergencyTarget: string;
    readonly travelStart: string;
    readonly travelTarget: string;
    readonly walletOpenedOn: string;
  };
  /** Aportes del Fondo de emergencia (fechas de las ocurrencias aprobadas). */
  readonly emergencyContributions: readonly string[];
}

export function buildGoals(anchor: string): GoalsPlan {
  const emergencyStart = addDays(anchor, -364);
  const emergencyTarget = addDays(emergencyStart, 607);
  const travelStart = addDays(anchor, -182);
  const travelTarget = addDays(travelStart, 274);
  const laptopStart = addDays(anchor, -152);
  const walletOpenedOn = addDays(anchor, -91);
  const giftReserve = addDays(anchor, -90);
  const giftSpend = addDays(anchor, -72);
  const giftTopUp = addDays(anchor, -56);
  const planDay = dayOfMonth(addDays(anchor, -25));
  const ops: ModuleOp[] = [];

  // ── Fondo de emergencia: plan real mensual programado como transferencia administrada; un aporte por mes.
  ops.push(
    {
      op: 'goal',
      date: emergencyStart,
      key: 'emergency',
      name: 'Fondo de emergencia',
      type: 'EMERGENCY_FUND',
      target: money(3_000_000n, 'BOB'),
      startDate: emergencyStart,
      targetDate: emergencyTarget,
      linked: ['savings_bob'],
      priority: 1,
    },
    {
      op: 'goalPlan',
      date: emergencyStart,
      goal: 'emergency',
      monthly: money(150_000n, 'BOB'),
      fund: 'REAL',
      source: 'bank_bob',
      destination: 'savings_bob',
      dayOfMonth: planDay,
      automation: 'RECURRING',
    },
  );
  const emergencyContributions: string[] = [];
  // Primera fecha con el día del plan a partir del inicio (regla de la meta: próximo día del mes ≥ hoy).
  const firstContribution =
    withDay(emergencyStart, planDay) >= emergencyStart
      ? withDay(emergencyStart, planDay)
      : withDay(addMonthsClamped(emergencyStart, 1), planDay);
  for (const date of renewalDates(firstContribution, 'MONTHLY', anchor)) {
    emergencyContributions.push(date);
    ops.push({
      op: 'occurrence',
      date,
      target: { type: 'goalPlan', key: 'emergency' },
      occurrenceDate: date,
      action: 'approve',
      effect: { kind: 'transfer', from: 'bank_bob', to: 'savings_bob', amount: money(150_000n, 'BOB') },
    });
  }

  // ── Viaje: plan de reservas sobre Ahorro USD; 100.00 USD de abril a agosto y 50.00 USD en la ancla.
  ops.push(
    {
      op: 'goal',
      date: travelStart,
      key: 'travel',
      name: 'Viaje',
      type: 'TRAVEL',
      target: money(200_000n, 'USD'),
      startDate: travelStart,
      targetDate: travelTarget,
      linked: [],
      priority: 2,
    },
    {
      op: 'goalPlan',
      date: travelStart,
      goal: 'travel',
      monthly: money(15_000n, 'USD'),
      fund: 'EARMARK',
      source: 'bank_usd',
      destination: null,
      dayOfMonth: null,
      automation: 'NONE',
    },
  );
  for (let i = 0; i < 5; i += 1) {
    ops.push({
      op: 'goalMovement',
      date: addMonthsClamped(travelStart, i),
      goal: 'travel',
      kind: 'reserve',
      account: 'bank_usd',
      amount: money(10_000n, 'USD'),
    });
  }
  ops.push({
    op: 'goalMovement',
    date: anchor,
    goal: 'travel',
    kind: 'reserve',
    account: 'bank_usd',
    amount: money(5_000n, 'USD'),
  });

  // ── Laptop: 4 reservas de 2000.00 BOB sobre la cuenta corriente; se alcanza con la cuarta.
  ops.push({
    op: 'goal',
    date: laptopStart,
    key: 'laptop',
    name: 'Laptop',
    type: 'PURCHASE',
    target: money(800_000n, 'BOB'),
    startDate: laptopStart,
    targetDate: null,
    linked: [],
    priority: 3,
  });
  for (let i = 0; i < 4; i += 1) {
    ops.push({
      op: 'goalMovement',
      date: addMonthsClamped(addDays(laptopStart, 14), i),
      goal: 'laptop',
      kind: 'reserve',
      account: 'bank_bob',
      amount: money(200_000n, 'BOB'),
    });
  }

  // ── Regalos: reserva sobre la billetera; un gasto la deja sobre-asignada y una transferencia lo resuelve.
  ops.push(
    {
      op: 'goal',
      date: walletOpenedOn,
      key: 'gifts',
      name: 'Regalos',
      type: 'CUSTOM',
      target: money(100_000n, 'BOB'),
      startDate: walletOpenedOn,
      targetDate: null,
      linked: [],
      priority: 4,
    },
    {
      op: 'goalMovement',
      date: giftReserve,
      goal: 'gifts',
      kind: 'reserve',
      account: 'wallet',
      amount: money(50_000n, 'BOB'),
    },
    { op: 'tick', date: giftSpend, runner: 'goals' },
    { op: 'tick', date: giftTopUp, runner: 'goals' },
  );
  const flows: PlanOp[] = [
    {
      op: 'expense',
      key: 'wallet:gifts',
      date: giftSpend,
      account: 'wallet',
      amount: money(30_000n, 'BOB'),
      splits: [{ category: { name: 'Regalos y celebraciones' }, amount: money(30_000n, 'BOB') }],
      counterparty: null,
      paymentMethod: 'QR',
      description: 'Regalos de cumpleaños',
    },
    {
      op: 'transfer',
      date: giftTopUp,
      from: 'bank_bob',
      to: 'wallet',
      amount: money(40_000n, 'BOB'),
      paymentMethod: 'QR',
      description: 'Recarga de Billetera Altiplano Demo',
    },
  ];
  return {
    ops,
    flows,
    dates: { emergencyStart, emergencyTarget, travelStart, travelTarget, walletOpenedOn },
    emergencyContributions,
  };
}

export interface ProgressFigures {
  /** Avance esperado lineal a la fecha (`objetivo × días transcurridos / días del plazo`), 2 decimales. */
  readonly expected: string;
  /** `(real − esperado) / esperado` en porcentaje con 2 decimales y signo. */
  readonly deviation: string;
}

/** Avance esperado y desviación de una meta con fecha objetivo (Decimal, HALF_EVEN al presentar). */
export function expectedProgress(input: {
  readonly target: string;
  readonly actual: string;
  readonly start: string;
  readonly targetDate: string;
  readonly today: string;
}): ProgressFigures {
  const total = epochDay(input.targetDate) - epochDay(input.start);
  const elapsed = epochDay(input.today) - epochDay(input.start);
  const expected = dec(input.target).times(elapsed).div(total);
  const deviation = dec(input.actual).minus(expected).div(expected).times(100);
  const sign = deviation.isNegative() ? '−' : '+';
  return {
    expected: expected.toDecimalPlaces(2).toFixed(2),
    deviation: `${sign}${deviation.abs().toDecimalPlaces(2).toFixed(2)}`,
  };
}

export const goalScale = (currency: DemoCurrency): number => SCALE[currency];
