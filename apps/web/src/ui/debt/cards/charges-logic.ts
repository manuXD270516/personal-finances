import { parseAmount, sumAmounts, scaleFor, isZeroAmount } from '../../common/money';
import type { Money } from '../../common/types';

/**
 * Lógica pura del formulario de cargos de una tarjeta (openspec add-card-interest-ledger-portions, tarea 6.1): valida los
 * componentes contra la escala de la moneda sin redondear, calcula el total en vivo y arma el cuerpo de
 * `createCardCharge`.
 */

export const CHARGE_COMPONENTS = ['interest', 'fees', 'insurance', 'taxes'] as const;
export type ChargeComponent = (typeof CHARGE_COMPONENTS)[number];

export type ChargeForm = Record<ChargeComponent, string> & { businessDate: string };

export type ChargeFormError = 'INVALID' | 'SCALE' | 'NEGATIVE' | 'NO_COMPONENT' | 'REQUIRED_DATE';
export type ChargeFormErrors = Partial<Record<ChargeComponent | 'businessDate' | 'form', ChargeFormError>>;

export const emptyChargeForm = (businessDate: string, interest = ''): ChargeForm => ({
  businessDate,
  interest,
  fees: '',
  insurance: '',
  taxes: '',
});

export interface ChargeOpts {
  readonly locale: string;
  readonly scales?: Readonly<Record<string, number>> | undefined;
}

type Parsed =
  | { readonly ok: true; readonly values: Record<ChargeComponent, string> }
  | {
      readonly ok: false;
      readonly errors: ChargeFormErrors;
    };

/** Componentes del formulario como montos canónicos (vacío = `0`); un negativo o un exceso de decimales es un error. */
export function parseChargeComponents(form: ChargeForm, currency: string, o: ChargeOpts): Parsed {
  const scale = scaleFor(currency, o.scales);
  const errors: ChargeFormErrors = {};
  const values = {} as Record<ChargeComponent, string>;
  const zero = scale === 0 ? '0' : `0.${'0'.repeat(scale)}`;
  for (const key of CHARGE_COMPONENTS) {
    const raw = form[key].trim();
    if (raw === '') {
      values[key] = zero;
      continue;
    }
    const r = parseAmount(raw, { locale: o.locale, currency, scale, allowZero: true });
    if (r.ok) values[key] = r.value;
    else errors[key] = r.error === 'SCALE' ? 'SCALE' : r.error === 'NOT_POSITIVE' ? 'NEGATIVE' : 'INVALID';
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** Total en vivo (Σ de los componentes válidos); `null` si algún componente no se puede leer todavía. */
export function chargeTotal(form: ChargeForm, currency: string, o: ChargeOpts): Money | null {
  const parsed = parseChargeComponents(form, currency, o);
  if (!parsed.ok) return null;
  const scale = scaleFor(currency, o.scales);
  return { amount: sumAmounts(Object.values(parsed.values), currency, scale), currency };
}

/** Cuerpo de `createCardCharge` (registro) o de la adopción (`adoptTransactionId`, sin fecha). */
export function buildChargeInput(
  form: ChargeForm,
  o: ChargeOpts & {
    readonly accountId: string;
    readonly currency: string;
    readonly adoptTransactionId?: string;
  },
): { ok: true; input: Record<string, unknown> } | { ok: false; errors: ChargeFormErrors } {
  const parsed = parseChargeComponents(form, o.currency, o);
  if (!parsed.ok) return parsed;
  const errors: ChargeFormErrors = {};
  const adopting = o.adoptTransactionId !== undefined;
  if (!adopting && !/^\d{4}-\d{2}-\d{2}$/.test(form.businessDate)) errors.businessDate = 'REQUIRED_DATE';
  if (CHARGE_COMPONENTS.every((k) => isZeroAmount(parsed.values[k]))) errors.form = 'NO_COMPONENT';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const input: Record<string, unknown> = { accountId: o.accountId };
  if (adopting) input['adoptTransactionId'] = o.adoptTransactionId;
  else input['businessDate'] = form.businessDate;
  for (const key of CHARGE_COMPONENTS) {
    if (!isZeroAmount(parsed.values[key])) input[key] = parsed.values[key];
  }
  return { ok: true, input };
}

/** Un gasto del ciclo sin adoptar en «Intereses pagados» o «Comisiones»: posible doble registro del mismo cobro. */
export function possibleDuplicates<
  T extends {
    readonly kind: string;
    readonly status: string;
    readonly debtRole?: string | null;
    readonly splits: readonly { readonly categoryId: string }[];
  },
>(transactions: readonly T[], systemCategoryIds: ReadonlySet<string>): readonly T[] {
  return transactions.filter(
    (t) =>
      t.kind === 'EXPENSE' &&
      t.status !== 'VOIDED' &&
      (t.debtRole === undefined || t.debtRole === null) &&
      t.splits.some((s) => systemCategoryIds.has(s.categoryId)),
  );
}
