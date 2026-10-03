/** VO `AuditOrigin` (FR-AUDIT-002): canal por el que entró la mutación. */
export const AUDIT_ORIGINS = ['ui', 'api', 'import', 'rule', 'recurring', 'system'] as const;
export type AuditOrigin = (typeof AUDIT_ORIGINS)[number];

export const isAuditOrigin = (value: unknown): value is AuditOrigin =>
  typeof value === 'string' && (AUDIT_ORIGINS as readonly string[]).includes(value);
