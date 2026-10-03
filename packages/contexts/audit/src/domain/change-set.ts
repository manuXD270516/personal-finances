import { CURRENCY_CODE, Money } from '@pf/shared-kernel';
import { AuditError } from './audit-error.js';

/** Monto en el diff: string decimal a la escala de su moneda + código (INV-001/INV-003). Nunca un `number`. */
export interface AuditMoney {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Valor de un campo del diff. Los montos son `AuditMoney`; los enteros (días, contadores) se admiten, pero un número
 * con decimales nunca: un importe como `number` pierde escala (design §2).
 */
export type AuditValue = string | boolean | number | AuditMoney | null;

export interface AuditChange {
  readonly field: string;
  readonly before: AuditValue;
  readonly after: AuditValue;
}

/** Cambio tal como lo aporta el comando, antes de la política de redacción. */
export interface RawAuditChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

const DECIMAL = /^-?\d{1,20}(\.\d{1,18})?$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

const isMoneyJson = (v: object): v is AuditMoney =>
  Object.keys(v).length === 2 &&
  typeof (v as AuditMoney).amount === 'string' &&
  typeof (v as AuditMoney).currency === 'string';

/** Normaliza un monto: `Money` del shared-kernel o `{amount, currency}` con amount decimal en string. */
export function toAuditMoney(value: unknown): AuditMoney {
  if (value instanceof Money) return Object.freeze(value.toJSON());
  if (typeof value === 'object' && value !== null && isMoneyJson(value)) {
    if (!DECIMAL.test(value.amount) || !CURRENCY_CODE.test(value.currency)) {
      throw new AuditError('AUDIT_INVALID_VALUE', 'money must be a decimal string with a currency code');
    }
    return Object.freeze({ amount: value.amount, currency: value.currency });
  }
  throw new AuditError('AUDIT_INVALID_VALUE', 'expected a Money value ({amount: string, currency})');
}

/** Valor "plano" del diff: string, boolean, entero seguro o null; un monto se normaliza a `AuditMoney`. */
export function toAuditValue(value: unknown): AuditValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new AuditError('AUDIT_INVALID_VALUE', 'fractional numbers are not allowed in audit changes');
  }
  if (typeof value === 'object') return toAuditMoney(value);
  throw new AuditError('AUDIT_INVALID_VALUE', `unsupported audit value of type ${typeof value}`);
}

export function auditChange(field: string, before: AuditValue, after: AuditValue): AuditChange {
  if (!FIELD.test(field)) throw new AuditError('AUDIT_INVALID_RECORD', `invalid change field '${field}'`);
  return Object.freeze({ field, before, after });
}

/** `ChangeSet`: lista inmutable de cambios campo a campo, sin campos repetidos. */
export function changeSet(changes: readonly AuditChange[]): readonly AuditChange[] {
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.field))
      throw new AuditError('AUDIT_INVALID_RECORD', `duplicated change field '${c.field}'`);
    seen.add(c.field);
  }
  return Object.freeze([...changes]);
}
