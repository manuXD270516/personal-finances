import { DomainError, Money, type Currency } from '@pf/shared-kernel';
import { AMOUNT_TYPES, type AmountType } from './types.js';

/**
 * Monto esperado de una definición u ocurrencia (FR-COMMITMENTS-004; design decisión 11). Los montos son texto decimal
 * a la escala canónica de la moneda (INV-001/002): nunca `number`.
 *  - `FIXED`/`ESTIMATED`: `amount`.
 *  - `MIN_MAX`: `min` y `max` (las proyecciones usan el máximo).
 *  - `VARIABLE`: sin monto; se indica al aprobar.
 */
export interface AmountSpec {
  readonly type: AmountType;
  readonly amount: string | null;
  readonly min: string | null;
  readonly max: string | null;
}

export interface AmountSpecInput {
  readonly type: string;
  readonly amount?: string | null | undefined;
  readonly min?: string | null | undefined;
  readonly max?: string | null | undefined;
}

const invalid = (message: string, pointer?: string) => {
  const err = new DomainError('RECURRING_INVALID_AMOUNT', message);
  return pointer ? err.at(pointer) : err;
};

function positive(value: string | null | undefined, currency: Currency, pointer: string): string {
  if (value === null || value === undefined)
    throw invalid('amount is required for this amount type', pointer);
  let money: Money;
  try {
    money = Money.parse(value, currency);
  } catch (err) {
    if (err instanceof DomainError) throw invalid(`${err.code}: ${err.message}`, pointer);
    throw err;
  }
  if (!money.isPositive()) throw invalid('amount must be greater than zero', pointer);
  return money.toFixed();
}

/** Valida y normaliza un monto esperado (positivo, escala de la moneda, coherente con el tipo). */
export function buildAmountSpec(input: AmountSpecInput, currency: Currency, base = '/amount'): AmountSpec {
  if (!(AMOUNT_TYPES as readonly string[]).includes(input.type)) {
    throw invalid(`unknown amount type ${input.type}`, `${base}/type`);
  }
  const type = input.type as AmountType;
  const present = (v: string | null | undefined) => v !== null && v !== undefined;
  switch (type) {
    case 'FIXED':
    case 'ESTIMATED': {
      if (present(input.min) || present(input.max)) throw invalid(`${type} does not take a range`, base);
      return { type, amount: positive(input.amount, currency, `${base}/amount`), min: null, max: null };
    }
    case 'MIN_MAX': {
      if (present(input.amount)) throw invalid('MIN_MAX does not take a single amount', base);
      const min = positive(input.min, currency, `${base}/min`);
      const max = positive(input.max, currency, `${base}/max`);
      if (Money.parse(min, currency).compare(Money.parse(max, currency)) > 0) {
        throw invalid('min must not exceed max', `${base}/min`);
      }
      return { type, amount: null, min, max };
    }
    case 'VARIABLE': {
      if (present(input.amount) || present(input.min) || present(input.max)) {
        throw invalid('VARIABLE has no expected amount', base);
      }
      return { type, amount: null, min: null, max: null };
    }
  }
}

/** Monto que usan las proyecciones y el comprometido: el fijo/estimado, el máximo del rango o `null` (variable). */
export function projectedAmount(spec: AmountSpec): string | null {
  switch (spec.type) {
    case 'FIXED':
    case 'ESTIMATED':
      return spec.amount;
    case 'MIN_MAX':
      return spec.max;
    case 'VARIABLE':
      return null;
  }
}

/**
 * Monto con el que se crea la transacción al aprobar (design decisión 11): `FIXED` ⇒ el indicado o el esperado;
 * `ESTIMATED` ⇒ indicado o esperado; `MIN_MAX` ⇒ indicado dentro del rango o el máximo; `VARIABLE` ⇒ obligatorio.
 */
export function resolveApprovalAmount(spec: AmountSpec, provided: string | null, currency: Currency): string {
  if (provided !== null) {
    const amount = positive(provided, currency, '/amount');
    if (spec.type === 'MIN_MAX') {
      const value = Money.parse(amount, currency);
      if (
        value.compare(Money.parse(spec.min as string, currency)) < 0 ||
        value.compare(Money.parse(spec.max as string, currency)) > 0
      ) {
        throw invalid(`amount must be within ${spec.min as string}..${spec.max as string}`, '/amount');
      }
    }
    return amount;
  }
  const fallback = projectedAmount(spec);
  if (fallback === null) {
    throw new DomainError(
      'OCCURRENCE_AMOUNT_REQUIRED',
      'a VARIABLE occurrence needs an amount to be approved',
    ).at('/amount');
  }
  return fallback;
}

export const sameAmountSpec = (a: AmountSpec, b: AmountSpec): boolean =>
  a.type === b.type && a.amount === b.amount && a.min === b.min && a.max === b.max;
