/**
 * API pública de `@pf/identity` (consumida por otros contextos y por `apps/api`). Hoja: no importa capas internas.
 * Los tokens y el módulo Nest llegan con la capa interface (tarea 7.x).
 */
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
