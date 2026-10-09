/**
 * Categoría de una acción de auditoría (openspec add-global-audit-view, design decisión 5; FR-AUDIT-005/006): los
 * eventos de seguridad (sesiones, fallos de autorización, cambios de configuración, exportaciones, restauraciones,
 * reaperturas de periodos) se revisan aparte de los cambios de datos financieros. La categoría se DERIVA de la
 * acción (no es una columna): `SECURITY` si coincide con una regla del catálogo; el resto es `DATA`.
 */
export const AUDIT_ACTION_CATEGORIES = ['SECURITY', 'DATA'] as const;
export type AuditActionCategory = (typeof AUDIT_ACTION_CATEGORIES)[number];

export const isAuditActionCategory = (value: unknown): value is AuditActionCategory =>
  typeof value === 'string' && (AUDIT_ACTION_CATEGORIES as readonly string[]).includes(value);

/**
 * Acciones de seguridad, TODAS explícitas (sin comodines): la consulta `category=SECURITY` las filtra con
 * `action = ANY(…)` sobre el índice `(workspace_id, action, occurred_at DESC)`. Un change que agrega una acción de
 * seguridad (p. ej. `add-workspace-export` con las suyas de `identity.export.*`) la agrega aquí; el test de catálogo
 * falla mientras una acción emitida no esté catalogada.
 */
export const SECURITY_ACTIONS = [
  'identity.session.started',
  'identity.session.ended',
  'security.authorization.denied',
  'identity.workspace.settings_changed',
  'identity.workspace.restored',
  'planning.period.reopened',
  'audit.log.exported',
  'audit.lifecycle.exported',
] as const;

/**
 * Entidades (`<contexto>.<entidad>`) cuyas acciones son cambios de datos. Un contexto que agrega una entidad
 * auditada la agrega aquí: el test de catálogo (TC-AUDIT-GLOBAL-006) falla si una acción emitida en el código no
 * está catalogada, ni como seguridad ni como datos.
 */
export const DATA_ACTION_ENTITIES = [
  'accounts.account',
  'accounts.institution',
  'classification.catalog',
  'classification.category',
  'classification.category_group',
  'classification.counterparty',
  'classification.custom_field',
  'classification.tag',
  'fx.exchange_rate',
  'fx.rate_preferences',
  'identity.demo',
  'identity.user',
  'identity.workspace',
  'ledger.journal_entry',
  'ledger.period_lock',
  'notifications.preferences',
  'planning.budget',
  'planning.closing_policy',
  'planning.period',
  'planning.template',
  'transactions.conversion',
  'transactions.reconciliation',
  'transactions.transaction',
  'transactions.transfer',
] as const;

const SECURITY_SET: ReadonlySet<string> = new Set(SECURITY_ACTIONS);

/** ¿La acción es un evento de seguridad? */
export function isSecurityAction(action: string): boolean {
  return SECURITY_SET.has(action);
}

/** Categoría de una acción (`SECURITY` si está en el catálogo de seguridad; si no, `DATA`). */
export function auditActionCategory(action: string): AuditActionCategory {
  return isSecurityAction(action) ? 'SECURITY' : 'DATA';
}

/** `<contexto>.<entidad>` de una acción (`transactions.transaction.voided` → `transactions.transaction`). */
export const actionEntityOf = (action: string): string => action.split('.').slice(0, 2).join('.');

/** ¿La acción está catalogada (seguridad por regla o entidad de datos conocida)? */
export function isCatalogedAction(action: string): boolean {
  return (
    isSecurityAction(action) || (DATA_ACTION_ENTITIES as readonly string[]).includes(actionEntityOf(action))
  );
}

/** Reglas de la categoría `SECURITY` tal como las consume el almacén para filtrar (SQL `= ANY`). */
export interface SecurityActionRules {
  readonly exact: readonly string[];
}

export const SECURITY_ACTION_RULES: SecurityActionRules = { exact: SECURITY_ACTIONS };
