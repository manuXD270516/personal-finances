import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_CATEGORIES, SECURITY_ACTIONS, auditActionCategory } from './audit-action-category.js';

describe('[TC-AUDIT-GLOBAL-006] categoría de las acciones de auditoría', () => {
  it('las acciones de seguridad del diseño son SECURITY y las demás DATA', () => {
    for (const a of [
      'identity.session.started',
      'identity.session.ended',
      'security.authorization.denied',
      'identity.workspace.settings_changed',
      'identity.workspace.restored',
      'planning.period.reopened',
      'audit.log.exported',
      'audit.lifecycle.exported',
    ]) {
      expect(auditActionCategory(a), a).toBe('SECURITY');
    }
    for (const a of [
      'transactions.transaction.created',
      'transactions.transaction.bulk_edited',
      'accounts.account.opened',
      'planning.period.closed',
      'identity.workspace.created',
    ]) {
      expect(auditActionCategory(a), a).toBe('DATA');
    }
    expect(AUDIT_ACTION_CATEGORIES).toEqual(['SECURITY', 'DATA']);
  });

  it('el catálogo de seguridad no tiene duplicados ni acciones mal formadas', () => {
    expect(new Set(SECURITY_ACTIONS).size).toBe(SECURITY_ACTIONS.length);
    for (const a of SECURITY_ACTIONS) expect(a).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2}$/u);
  });
});
