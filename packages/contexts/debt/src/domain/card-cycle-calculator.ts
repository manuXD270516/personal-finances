import { type LocalDate, Money, type Currency } from '@pf/shared-kernel';
import type { CardMovement, CardStatementStatus, MinimumPaymentRuleSpec } from './card-types.js';
import { applyMinimumPayment } from './minimum-payment-rule.js';

/**
 * `CardCycleCalculator` (openspec add-credit-cards, design decisiones 3 y 4; capability `debt/credit-cards`): cifras de
 * un ciclo de una cuenta de tarjeta y su situación (lo que falta y estado). Puro y determinista.
 *
 * Los saldos (`previousBalance`, `closingBalance`) son el saldo PRESENTADO del pasivo (deuda positiva) que el
 * adaptador toma del ledger (INV-022); los movimientos vienen clasificados por TRANSACTIONS (`AccountMovementsQuery`)
 * con el efecto firmado sobre lo adeudado. La invariante `anterior + compras − reembolsos − pagos + otros = cierre` se
 * verifica en cada cálculo: si no cuadra, `consistent = false` (el llamador registra la métrica) en vez de esconderlo.
 * El único redondeo es el del mínimo porcentual (HALF_EVEN, INV-020).
 */
export interface CycleFigures {
  readonly currency: Currency;
  readonly previousBalance: Money;
  readonly purchases: Money;
  readonly refunds: Money;
  readonly payments: Money;
  /** Neto con signo de ajustes, saldos iniciales y otros movimientos (positivo aumenta la deuda). */
  readonly otherNet: Money;
  readonly closingBalance: Money;
  /** Capital de las cuotas que se facturarán en ciclos posteriores (compras ya incluidas en el saldo al cierre). */
  readonly unbilledInstallments: Money;
  /** `closingBalance − unbilledInstallments`. */
  readonly billedBalance: Money;
  readonly minimumDue: Money;
  /** `max(billedBalance, 0)`. */
  readonly noInterestPayment: Money;
  /** Saldo a favor (`−billedBalance` si es negativo; si no, 0). */
  readonly creditBalance: Money;
  /** `anterior + compras − reembolsos − pagos + otros = cierre`. */
  readonly consistent: boolean;
}

export function computeCycleFigures(input: {
  readonly currency: Currency;
  readonly previousBalance: Money;
  readonly closingBalance: Money;
  /** Movimientos de las fechas del ciclo (el llamador ya filtró por rango y por asiento activo). */
  readonly movements: readonly CardMovement[];
  readonly unbilledInstallments: Money;
  readonly minimumRule: MinimumPaymentRuleSpec;
}): CycleFigures {
  const { currency } = input;
  const zero = Money.zero(currency);
  let purchases = zero;
  let refunds = zero;
  let payments = zero;
  let otherNet = zero;
  for (const m of input.movements) {
    const amount = Money.parse(m.amount, currency);
    switch (m.movementClass) {
      case 'PURCHASE':
        purchases = purchases.add(amount);
        break;
      case 'REFUND':
        refunds = refunds.subtract(amount);
        break;
      case 'PAYMENT':
        payments = payments.subtract(amount);
        break;
      case 'OTHER':
        otherNet = otherNet.add(amount);
        break;
    }
  }
  const consistent = input.previousBalance
    .add(purchases)
    .subtract(refunds)
    .subtract(payments)
    .add(otherNet)
    .equals(input.closingBalance);
  const billedBalance = input.closingBalance.subtract(input.unbilledInstallments);
  return {
    currency,
    previousBalance: input.previousBalance,
    purchases,
    refunds,
    payments,
    otherNet,
    closingBalance: input.closingBalance,
    unbilledInstallments: input.unbilledInstallments,
    billedBalance,
    minimumDue: applyMinimumPayment(input.minimumRule, billedBalance),
    noInterestPayment: billedBalance.isPositive() ? billedBalance : zero,
    creditBalance: billedBalance.isNegative() ? billedBalance.negate() : zero,
    consistent,
  };
}

/** Diferencia `current − issued` de las cifras que cambian (estado emitido vs recalculado). */
export function diffFigures(
  issued: CycleFigures,
  current: CycleFigures,
): Pick<
  CycleFigures,
  | 'previousBalance'
  | 'purchases'
  | 'refunds'
  | 'payments'
  | 'otherNet'
  | 'closingBalance'
  | 'unbilledInstallments'
  | 'billedBalance'
  | 'minimumDue'
  | 'noInterestPayment'
  | 'creditBalance'
> {
  return {
    previousBalance: current.previousBalance.subtract(issued.previousBalance),
    purchases: current.purchases.subtract(issued.purchases),
    refunds: current.refunds.subtract(issued.refunds),
    payments: current.payments.subtract(issued.payments),
    otherNet: current.otherNet.subtract(issued.otherNet),
    closingBalance: current.closingBalance.subtract(issued.closingBalance),
    unbilledInstallments: current.unbilledInstallments.subtract(issued.unbilledInstallments),
    billedBalance: current.billedBalance.subtract(issued.billedBalance),
    minimumDue: current.minimumDue.subtract(issued.minimumDue),
    noInterestPayment: current.noInterestPayment.subtract(issued.noInterestPayment),
    creditBalance: current.creditBalance.subtract(issued.creditBalance),
  };
}

export interface StatementStanding {
  /** Pago para no generar intereses vigente (el informado por el banco si existe). */
  readonly noInterestPayment: Money;
  readonly minimumDue: Money;
  readonly remainingNoInterest: Money;
  readonly remainingMinimum: Money;
  readonly status: Exclude<CardStatementStatus, 'OPEN'>;
  /** `reported.billedBalance − figures.billedBalance` si el banco informó el facturado; si no, `null`. */
  readonly reportedDifference: Money | null;
}

/**
 * Lo que falta y el estado de un estado de cuenta emitido (decisión 4; D170): `paymentsAfterClose` = pagos recibidos
 * por la cuenta con fecha en `(cierre, hoy]`. Con montos del banco (`reported`) se usan en lugar de los calculados
 * (el mínimo, si el banco solo informa el facturado, sale de la regla sobre ese facturado). Estado: nada que pagar ⇒
 * `PAID`; hasta el día del vencimiento inclusive ⇒ `ISSUED`; vencido ⇒ `PARTIALLY_PAID` si el mínimo está cubierto y
 * `OVERDUE` si no. Se calcula en lectura: el estado persistido solo sirve para listar.
 */
export function computeStatementStanding(input: {
  readonly figures: CycleFigures;
  readonly reported: { readonly billedBalance: string | null; readonly minimumDue: string | null } | null;
  readonly minimumRule: MinimumPaymentRuleSpec;
  readonly paymentsAfterClose: Money;
  readonly today: LocalDate;
  readonly dueDate: LocalDate;
}): StatementStanding {
  const { figures, reported } = input;
  const currency = figures.currency;
  const zero = Money.zero(currency);
  const reportedBilled =
    reported?.billedBalance !== undefined && reported.billedBalance !== null
      ? Money.parse(reported.billedBalance, currency)
      : null;
  const billed = reportedBilled ?? figures.billedBalance;
  const noInterestPayment = billed.isPositive() ? billed : zero;
  const minimumDue =
    reported?.minimumDue !== undefined && reported.minimumDue !== null
      ? Money.parse(reported.minimumDue, currency)
      : reportedBilled
        ? applyMinimumPayment(input.minimumRule, reportedBilled)
        : figures.minimumDue;
  const paid = input.paymentsAfterClose.isPositive() ? input.paymentsAfterClose : zero;
  const floorAtZero = (m: Money): Money => (m.isNegative() ? zero : m);
  const remainingNoInterest = floorAtZero(noInterestPayment.subtract(paid));
  const remainingMinimum = floorAtZero(minimumDue.subtract(paid));
  let status: StatementStanding['status'];
  if (remainingNoInterest.isZero()) status = 'PAID';
  else if (input.today.compare(input.dueDate) <= 0) status = 'ISSUED';
  else status = remainingMinimum.isZero() ? 'PARTIALLY_PAID' : 'OVERDUE';
  return {
    noInterestPayment,
    minimumDue,
    remainingNoInterest,
    remainingMinimum,
    status,
    reportedDifference: reportedBilled ? reportedBilled.subtract(figures.billedBalance) : null,
  };
}
