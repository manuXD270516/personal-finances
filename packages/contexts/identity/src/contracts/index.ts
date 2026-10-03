/**
 * API pública de `@pf/identity` (consumida por otros contextos y por `apps/api`). Hoja: no importa capas internas.
 * Los tokens y el módulo Nest llegan con la capa interface (tarea 7.x).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const IDENTITY_CONTEXT = 'identity' as const;

export type WorkspaceRoleDto = 'OWNER' | 'EDITOR' | 'VIEWER';

/** Payload de `identity.WorkspaceCreated.v1` (contracts/events/identity/WorkspaceCreated.v1.schema.json). */
export interface WorkspaceCreatedV1 {
  readonly workspaceId: string;
  readonly name: string;
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly fiscalMonthStartDay: number;
  readonly ownerUserId: string;
  readonly origin: 'PERSONAL_DEFAULT' | 'USER_CREATED';
}

/**
 * Allow-list de auditoría de los agregados de IDENTITY (openspec add-audit-trail, NFR-SEC-015): lo que no figura
 * aquí nunca se copia a `audit.audit_log` (p. ej. `preferences`, email, issuer/subject del IdP).
 */
export const IDENTITY_AUDIT_POLICY = {
  Workspace: {
    name: 'plain',
    baseCurrency: 'plain',
    timeZone: 'plain',
    locale: 'plain',
    fiscalMonthStartDay: 'plain',
    minimumLiquidityReserve: 'money',
    origin: 'plain',
    memberUserId: 'plain',
    memberRole: 'plain',
  },
  User: { displayName: 'plain', locale: 'plain', timeZone: 'plain' },
} as const satisfies AuditFieldPoliciesDto;
