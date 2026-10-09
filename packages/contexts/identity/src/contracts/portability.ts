import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

/** Colas del worker de add-workspace-export (se encolan EN la transacción del comando). */
export const WORKSPACE_EXPORT_QUEUE = 'identity.workspace-export' as const;
export const WORKSPACE_IMPORT_QUEUE = 'identity.workspace-import' as const;
export const EXPORT_RETENTION_QUEUE = 'identity.export-retention' as const;

/** Payload de `identity.WorkspaceExportCompleted.v1` (contracts/events/identity). */
export interface WorkspaceExportCompletedV1 {
  readonly workspaceId: string;
  readonly exportId: string;
  readonly status: 'READY' | 'FAILED';
  readonly expiresAt: string | null;
  readonly requestedBy: string;
}

/** Payload de `identity.WorkspaceRestored.v1` (contracts/events/identity). */
export interface WorkspaceRestoredV1 {
  readonly workspaceId: string;
  readonly importId: string;
  readonly sourceWorkspaceId: string;
  readonly sourceExportedAt: string;
}

/**
 * Sección `workspace`: la configuración del workspace (nombre, moneda base, zona, idioma, mes fiscal, reserva mínima). La
 * importación la usa para CREAR el workspace nuevo; no viajan la marca demo, el estado ni el usuario "personal". La
 * membresía no viaja: el importador es el único OWNER del workspace restaurado.
 */
export const IDENTITY_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'workspace',
    context: 'identity',
    table: 'iam.workspace',
    order: 100,
    workspaceColumn: 'id',
    orderBy: ['id'],
    omit: [
      'personal_of_user_id',
      'status',
      'deletion_requested_at',
      'archived_at',
      'is_demo',
      'demo_status',
      'demo_origin_workspace_id',
      'demo_requested_by',
      'demo_dataset_version',
      'restored_from_export',
      'version',
      'updated_at',
    ],
    money: { min_liquidity_reserve_amount: 't.min_liquidity_reserve_currency' },
  },
];

/**
 * Tablas de negocio con `workspace_id` que NO se exportan y por qué (regla de cobertura): metadatos técnicos del propio
 * export, mensajería de plataforma, sesiones/idempotencia y cachés derivadas. Cada contexto declara las suyas.
 */
export const IDENTITY_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  { table: 'iam.workspace_membership', reason: 'Membresía: el importador queda como único OWNER del workspace restaurado.' },
  { table: 'iam.workspace_export', reason: 'Metadatos técnicos del propio export (no son datos del usuario).' },
  { table: 'platform.operation', reason: 'Operaciones asíncronas técnicas (estado de jobs).' },
  { table: 'platform.outbox', reason: 'Mensajes del outbox: infraestructura de eventos, no datos de negocio (sin secretos en el export).' },
  { table: 'platform.inbox', reason: 'Idempotencia de consumidores: infraestructura.' },
  { table: 'platform.dead_letter', reason: 'Eventos fallidos de consumidores: infraestructura.' },
  { table: 'platform.idempotency_key', reason: 'Claves de idempotencia y sus respuestas: nunca viajan (secretos de petición).' },
  { table: 'platform.demo_workspace_run', reason: 'Evidencia de carga/purga de datos demo (los exports demo no se importan, D99).' },
  { table: 'reporting.workspace_data_version', reason: 'Contador de invalidación de caché (derivado).' },
];
