import { DomainError, Money, dec, type Currency } from '@pf/shared-kernel';
import type { MinimumPaymentRuleSpec } from './card-types.js';

/**
 * `MinimumPaymentRule` (openspec add-credit-cards, requirement "Regla de pago mínimo"; INV-020): el mínimo de un
 * estado de cuenta es 0 si el saldo facturado es <= 0; con porcentaje, `min(facturado, max(HALF_EVEN(facturado ×
 * porcentaje), piso))`; con monto fijo, `min(facturado, monto)`. El único redondeo es el del porcentaje.
 */
export function applyMinimumPayment(rule: MinimumPaymentRuleSpec, billed: Money): Money {
  const zero = Money.zero(billed.currency);
  if (!billed.isPositive()) return zero;
  if (rule.type === 'FIXED') {
    const amount = Money.parse(rule.amount, billed.currency);
    return amount.compare(billed) < 0 ? amount : billed;
  }
  const byPercent = billed.percentage(rule.percent, 'HALF_EVEN');
  const floor = rule.floor === null ? zero : Money.parse(rule.floor, billed.currency);
  const wanted = byPercent.compare(floor) >= 0 ? byPercent : floor;
  return wanted.compare(billed) < 0 ? wanted : billed;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const fail = (message: string, pointer: string): never => {
  throw new DomainError('VALIDATION_FAILED', message).at(pointer);
};

/** Porcentaje con a lo sumo 2 decimales entre `min` y `max`, normalizado a 2 decimales. */
export function normalizePercent(value: unknown, pointer: string, min = '0.01', max = '100.00'): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail('must be a decimal string', pointer);
  const d = dec(value);
  if (d.decimalPlaces() > 2) return fail('must have at most 2 decimals', pointer);
  if (d.lt(dec(min)) || d.gt(dec(max))) return fail(`must be between ${min} and ${max}`, pointer);
  return d.toFixed(2);
}

/** Monto decimal a la escala de la moneda (`AMOUNT_SCALE_EXCEEDED`; con `positive`, `AMOUNT_NOT_POSITIVE`). */
export function normalizeAmount(
  value: unknown,
  currency: Currency,
  pointer: string,
  positive: boolean,
): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail('must be a decimal string', pointer);
  let money: Money;
  try {
    money = Money.parse(value, currency);
  } catch (err) {
    if (err instanceof DomainError) throw err.at(pointer);
    throw err;
  }
  if (positive && !money.isPositive()) {
    throw new DomainError('AMOUNT_NOT_POSITIVE', 'must be greater than zero').at(pointer);
  }
  return money.toFixed();
}

/**
 * El contrato publica el piso y el monto fijo como `Money` (`{amount, currency}`); el dominio también acepta el monto
 * en texto (uso interno). La moneda declarada debe ser la de la cuenta.
 */
function moneyAmount(value: unknown, currency: Currency, pointer: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const money = value as Record<string, unknown>;
  if (money['currency'] !== undefined && money['currency'] !== currency.code) {
    throw new DomainError('CURRENCY_MISMATCH', 'the amount must be in the currency of the account').at(
      `${pointer}/currency`,
    );
  }
  return money['amount'];
}

/** Valida y normaliza la regla recibida de un cliente (escala de la moneda de la cuenta). */
export function normalizeMinimumRule(
  raw: unknown,
  currency: Currency,
  pointer = '/minimumRule',
): MinimumPaymentRuleSpec {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('minimumRule must be an object', pointer);
  }
  const input = raw as Record<string, unknown>;
  if (input['type'] === 'PERCENT') {
    const floor = input['floor'];
    return {
      type: 'PERCENT',
      percent: normalizePercent(input['percent'], `${pointer}/percent`),
      floor:
        floor === undefined || floor === null
          ? null
          : normalizeAmount(
              moneyAmount(floor, currency, `${pointer}/floor`),
              currency,
              `${pointer}/floor`,
              false,
            ),
    };
  }
  if (input['type'] === 'FIXED') {
    return {
      type: 'FIXED',
      amount: normalizeAmount(
        moneyAmount(input['amount'], currency, `${pointer}/amount`),
        currency,
        `${pointer}/amount`,
        true,
      ),
    };
  }
  return fail('type must be PERCENT or FIXED', `${pointer}/type`);
}
