import { AuditError } from './audit-error.js';
import {
  auditChange,
  changeSet,
  toAuditMoney,
  toAuditValue,
  type AuditChange,
  type AuditValue,
  type RawAuditChange,
} from './change-set.js';

/**
 * Regla de un campo permitido (NFR-SEC-015, docs/12 §13):
 * - `plain`: se copia (string/boolean/entero/null).
 * - `money`: monto exacto `{amount, currency}` (sí se registra: es el propósito de la auditoría financiera).
 * - `last4`: identificador de cuenta enmascarado a sus últimos 4 caracteres.
 */
export type AuditFieldRule = 'plain' | 'money' | 'last4';
export type AggregateFieldPolicy = Readonly<Record<string, AuditFieldRule>>;
/** Allow-list por tipo de agregado: lo que no aparece aquí NUNCA se copia a la auditoría. */
export type AuditFieldPolicies = Readonly<Record<string, AggregateFieldPolicy>>;

const RULES: readonly AuditFieldRule[] = ['plain', 'money', 'last4'];

function last4(value: unknown): AuditValue {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuditError('AUDIT_INVALID_VALUE', 'masked fields must be strings');
  return value.slice(-4);
}

function applyRule(rule: AuditFieldRule, value: unknown): AuditValue {
  if (rule === 'last4') return last4(value);
  if (rule === 'money') return value === null || value === undefined ? null : toAuditMoney(value);
  return toAuditValue(value);
}

/**
 * `RedactionPolicy` por allow-list (design §1): los campos desconocidos —incluido cualquier token, cookie, secreto o
 * campo nuevo no revisado— se omiten; nunca se copian. Un agregado sin política no aporta ningún campo.
 */
export class RedactionPolicy {
  private readonly policies: ReadonlyMap<string, AggregateFieldPolicy>;

  constructor(policies: AuditFieldPolicies = {}) {
    for (const [aggregate, fields] of Object.entries(policies)) {
      for (const [field, rule] of Object.entries(fields)) {
        if (!RULES.includes(rule)) {
          throw new AuditError(
            'AUDIT_INVALID_RECORD',
            `unknown rule '${String(rule)}' for ${aggregate}.${field}`,
          );
        }
      }
    }
    this.policies = new Map(Object.entries(policies));
  }

  /** Política combinada; un mismo agregado no puede declararse dos veces (cada contexto es dueño del suyo). */
  with(more: AuditFieldPolicies): RedactionPolicy {
    const merged: Record<string, AggregateFieldPolicy> = Object.fromEntries(this.policies);
    for (const [aggregate, fields] of Object.entries(more)) {
      if (aggregate in merged) {
        throw new AuditError('AUDIT_INVALID_RECORD', `audit policy for ${aggregate} declared twice`);
      }
      merged[aggregate] = fields;
    }
    return new RedactionPolicy(merged);
  }

  apply(aggregateType: string, changes: readonly RawAuditChange[]): readonly AuditChange[] {
    const fields = this.policies.get(aggregateType) ?? {};
    const kept: AuditChange[] = [];
    for (const c of changes) {
      const rule = Object.hasOwn(fields, c.field) ? fields[c.field] : undefined;
      if (!rule) continue;
      kept.push(auditChange(c.field, applyRule(rule, c.before), applyRule(rule, c.after)));
    }
    return changeSet(kept);
  }
}
