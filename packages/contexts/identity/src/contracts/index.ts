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

/** Payload de `identity.DemoDataLoaded.v1` / `identity.DemoDataCleaned.v1` (contracts/events/identity). */
export interface DemoDataEventV1 {
  readonly workspaceId: string;
  readonly originWorkspaceId: string;
  readonly datasetVersion: string;
}

/** Colas del worker de add-demo-data (job `demo.load` y `demo.purge`). */
export const DEMO_LOAD_QUEUE = 'demo.load' as const;
export const DEMO_PURGE_QUEUE = 'demo.purge' as const;

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
    // add-demo-data: carga/limpieza/purga auditadas en el workspace de origen (sin datos financieros del demo).
    demoWorkspaceId: 'plain',
    datasetVersion: 'plain',
    anchorDate: 'plain',
    demoStatus: 'plain',
    rowsDeleted: 'plain',
  },
  User: { displayName: 'plain', locale: 'plain', timeZone: 'plain' },
} as const satisfies AuditFieldPoliciesDto;

/**
 * Calendario del workspace para otros contextos (openspec add-financial-periods: PLANNING calcula "hoy" y los rangos
 * de periodos). `fiscalMonthStartDay` 1..28 (FR-IDENTITY-005, docs/31 D23). La implementación de la API lee con el
 * contexto RLS del usuario de la petición; la del worker, con el rol de directorio (`pf_workspace_directory`).
 */
export interface WorkspaceCalendarQuery {
  calendarOf(workspaceId: string): Promise<{ readonly timeZone: string; readonly fiscalMonthStartDay: number }>;
}

/** Miembro activo de un workspace tal como lo necesita NOTIFY para resolver destinatarios (openspec add-alerts). */
export interface WorkspaceRecipientDto {
  readonly userId: string;
  readonly role: WorkspaceRoleDto;
  /** Locale del perfil del usuario (`Me.locale`, p. ej. `es-BO`). */
  readonly locale: string;
  /** Zona horaria IANA del usuario; si no la configuró, la del workspace. */
  readonly timeZone: string;
}

/**
 * Destinatarios de notificaciones (openspec add-alerts, design § Contratos; ampliación aditiva). La implementación del
 * worker lee con el rol de directorio de IDENTITY (`pf_workspace_directory`: `pf_worker` no ve `iam.*` por membresía).
 * `emailFor` devuelve el email VERIFICADO del usuario o `null`; solo lo usa el despacho del email y NUNCA se persiste
 * en las tablas de notificaciones ni se loguea (RISK-010).
 */
export interface WorkspaceRecipientsQuery {
  /** Miembros con membresía `ACTIVE` en este momento (usuarios activos), ordenados por `userId`. */
  activeMembers(workspaceId: string): Promise<readonly WorkspaceRecipientDto[]>;
  emailFor(userId: string): Promise<string | null>;
}
