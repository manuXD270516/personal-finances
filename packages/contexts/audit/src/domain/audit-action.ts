import { AuditError } from './audit-error.js';

/**
 * `AuditAction` = `<context>.<aggregate>.<verbo-en-pasado>` en minúsculas (design §1), p. ej.
 * `transactions.transaction.voided`, `identity.workspace.settings_changed`, `identity.session.started`.
 */
const ACTION = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2}$/;
/** Tipo de agregado en PascalCase (`Transaction`, `Workspace`); coincide con el filtro `aggregateType` del contrato. */
const AGGREGATE_TYPE = /^[A-Z][A-Za-z]{0,63}$/;

export function auditAction(value: string): string {
  if (!ACTION.test(value)) throw new AuditError('AUDIT_INVALID_RECORD', `invalid audit action '${value}'`);
  return value;
}

export function aggregateType(value: string): string {
  if (!AGGREGATE_TYPE.test(value)) {
    throw new AuditError('AUDIT_INVALID_RECORD', `invalid aggregate type '${value}'`);
  }
  return value;
}

export const isAggregateType = (value: unknown): value is string =>
  typeof value === 'string' && AGGREGATE_TYPE.test(value);
