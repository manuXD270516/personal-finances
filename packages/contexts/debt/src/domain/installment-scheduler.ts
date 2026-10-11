import { DomainError, Money, dec } from '@pf/shared-kernel';
import { MAX_INSTALLMENTS, MIN_INSTALLMENTS } from './card-types.js';

/**
 * `InstallmentScheduler` (openspec add-credit-cards, design decisión 13; INV-017, INV-020): cuotas de una compra de
 * tarjeta, con la misma convención que el cronograma de préstamos pero sobre el capital de la compra.
 *
 *  - Sin interés: `p_i = HALF_EVEN(P ÷ n)` y la última cuota absorbe el residuo (`p_n = P − Σ p_i`).
 *  - Con interés (sistema francés): `r = tasa anual ÷ 100 ÷ 12`, `c = HALF_EVEN(P · r ÷ (1 − (1 + r)^−n))`,
 *    `i_k = HALF_EVEN(saldo_k · r)`, `p_k = c − i_k`; la última toma todo el saldo (`p_n = saldo_n`, `c_n = p_n + i_n`),
 *    así que Σ capital = compra exacta.
 *
 * Puro y determinista (decimal.js con precisión 40); el interés es una PROYECCIÓN: nunca se postea como gasto.
 */
export interface InstallmentAmount {
  /** 1..n. */
  readonly n: number;
  readonly principal: Money;
  readonly interest: Money;
  /** `principal + interest`. */
  readonly total: Money;
}

const invalid = (message: string, pointer: string): never => {
  throw new DomainError('INSTALLMENT_PLAN_INVALID', message).at(pointer);
};

const RATE_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function scheduleInstallments(input: {
  readonly principal: Money;
  readonly count: number;
  /** Porcentaje nominal anual (`24.00` = 24.00 %); `0` = sin interés. */
  readonly annualRatePercent: string;
}): InstallmentAmount[] {
  const { principal, count } = input;
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    return invalid(
      `installmentCount must be between ${MIN_INSTALLMENTS} and ${MAX_INSTALLMENTS}`,
      '/installmentCount',
    );
  }
  if (!principal.isPositive())
    return invalid('the purchase amount must be greater than zero', '/purchaseTransactionId');
  if (!RATE_PATTERN.test(input.annualRatePercent))
    return invalid('annualRate must be a decimal', '/annualRate');
  const annual = dec(input.annualRatePercent);
  if (annual.isNeg()) return invalid('annualRate must not be negative', '/annualRate');
  const cur = principal.currency;
  const zero = Money.zero(cur);
  const rows: InstallmentAmount[] = [];

  if (annual.isZero()) {
    // HALF_EVEN; si el redondeo hacia arriba dejara una última cuota negativa (compra mínima en muchas cuotas) se
    // trunca para que la última absorba un residuo >= 0.
    let each = principal.divide(String(count), 'HALF_EVEN');
    if (each.multiply(String(count - 1), 'HALF_EVEN').compare(principal) > 0) {
      each = principal.divide(String(count), 'DOWN');
    }
    let remaining = principal;
    for (let n = 1; n <= count; n += 1) {
      const p = n === count ? remaining : each;
      remaining = remaining.subtract(p);
      rows.push({ n, principal: p, interest: zero, total: p });
    }
    return rows;
  }

  const r = annual.div(100).div(12);
  const growth = r.plus(1).pow(-count);
  const level = Money.roundToScale(
    principal.toDecimal().mul(r).div(dec('1').minus(growth)),
    cur,
    'HALF_EVEN',
  );
  let balance = principal;
  for (let n = 1; n <= count; n += 1) {
    const interest = Money.roundToScale(balance.toDecimal().mul(r), cur, 'HALF_EVEN');
    const wanted = level.subtract(interest);
    // Nunca negativa ni mayor que el saldo (compras mínimas en muchas cuotas); la última toma todo el saldo.
    const p =
      n === count ? balance : wanted.isNegative() ? zero : wanted.compare(balance) > 0 ? balance : wanted;
    balance = balance.subtract(p);
    rows.push({ n, principal: p, interest, total: p.add(interest) });
  }
  return rows;
}
