import { Money } from '@pf/shared-kernel';
import type { StatementStanding } from './card-cycle-calculator.js';
import type { CardPaymentPolicy, MinimumPaymentRuleSpec } from './card-types.js';
import { applyMinimumPayment } from './minimum-payment-rule.js';

/**
 * `PaymentPlanExpectation` (openspec add-credit-cards, design decisión 7): monto esperado de cada ocurrencia no
 * resuelta del plan de pago de una cuenta de tarjeta. Puro; la aplicación decide a qué ciclo corresponde la fecha
 * nominal y solo aplica el resultado cuando cambia (sin eventos redundantes) y nunca sobre ocurrencias resueltas.
 *
 *  - Ciclo EMITIDO: `FIXED` con lo que falta según la política (`NO_INTEREST` o `MINIMUM`); si no falta nada, la
 *    ocurrencia se OMITE con motivo (`NOTHING_BILLED` si el saldo facturado era <= 0, si no `STATEMENT_PAID`).
 *  - Ciclo ABIERTO: `ESTIMATED` = saldo adeudado de hoy − lo que falta de los estados emitidos aún no vencidos − capital
 *    de las cuotas que se facturarán en ciclos posteriores (con `MINIMUM`, la regla del mínimo sobre esa estimación);
 *    `NONE` si da 0.
 *  - Ciclo POSTERIOR: `ESTIMATED` con la suma de las cuotas programadas que se facturan en él, o `NONE` si no hay.
 */
export type PlanExpectation =
  | { readonly type: 'FIXED' | 'ESTIMATED'; readonly amount: Money }
  | { readonly type: 'NONE' }
  | { readonly type: 'SKIP'; readonly reason: 'NOTHING_BILLED' | 'STATEMENT_PAID' };

export function expectationForIssued(input: {
  readonly policy: CardPaymentPolicy;
  readonly standing: StatementStanding;
}): PlanExpectation {
  const { standing } = input;
  const remaining = input.policy === 'MINIMUM' ? standing.remainingMinimum : standing.remainingNoInterest;
  if (remaining.isPositive()) return { type: 'FIXED', amount: remaining };
  return {
    type: 'SKIP',
    reason: standing.noInterestPayment.isPositive() ? 'STATEMENT_PAID' : 'NOTHING_BILLED',
  };
}

export function expectationForOpen(input: {
  readonly policy: CardPaymentPolicy;
  readonly minimumRule: MinimumPaymentRuleSpec;
  /** Saldo presentado de hoy de la cuenta. */
  readonly presentedBalance: Money;
  /** Σ lo que falta (sin intereses) de los estados emitidos cuyo vencimiento aún no pasó. */
  readonly dueIssuedRemaining: Money;
  /** Capital de las cuotas que se facturarán en ciclos posteriores al abierto. */
  readonly unbilledAfter: Money;
}): PlanExpectation {
  const raw = input.presentedBalance.subtract(input.dueIssuedRemaining).subtract(input.unbilledAfter);
  if (!raw.isPositive()) return { type: 'NONE' };
  const amount = input.policy === 'MINIMUM' ? applyMinimumPayment(input.minimumRule, raw) : raw;
  return amount.isPositive() ? { type: 'ESTIMATED', amount } : { type: 'NONE' };
}

export function expectationForFuture(input: {
  readonly policy: CardPaymentPolicy;
  readonly minimumRule: MinimumPaymentRuleSpec;
  /** Σ del total (capital + interés proyectado) de las cuotas que se facturan en el ciclo. */
  readonly installmentsTotal: Money;
}): PlanExpectation {
  const total = input.installmentsTotal;
  if (!total.isPositive()) return { type: 'NONE' };
  const amount = input.policy === 'MINIMUM' ? applyMinimumPayment(input.minimumRule, total) : total;
  return amount.isPositive() ? { type: 'ESTIMATED', amount } : { type: 'NONE' };
}

/** `true` si la expectativa deseada ya es la que tiene la ocurrencia (no hay que escribir ni publicar nada). */
export function sameExpectation(
  wanted: PlanExpectation,
  current: { readonly type: string; readonly amount: string | null },
  scale: number,
): boolean {
  if (wanted.type === 'SKIP') return false;
  if (wanted.type === 'NONE') return current.type === 'VARIABLE' && current.amount === null;
  return (
    current.type === wanted.type &&
    current.amount !== null &&
    Money.parse(current.amount, { code: wanted.amount.currency.code, scale }).equals(wanted.amount)
  );
}
