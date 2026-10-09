import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a AUDIT (openspec add-workspace-export): el log de
 * auditoría y los recorridos (transiciones de estado). NO viajan el hash de la IP del cliente, la clave de idempotencia
 * de la petición, el user agent ni los identificadores de petición (requirement "Contenido completo del export").
 * Los registros son historia inmutable: se insertan tal cual con sus ids remapeados (también dentro de los diffs).
 */
export const AUDIT_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'audit-log',
    context: 'audit',
    table: 'audit.audit_log',
    order: 900,
    orderBy: ['occurred_at', 'id'],
    omit: ['client_ip_hash', 'idempotency_key', 'user_agent', 'request_id', 'prev_hash', 'row_hash'],
  },
  {
    name: 'lifecycle-transitions',
    context: 'audit',
    table: 'audit.lifecycle_transition',
    order: 910,
    orderBy: ['aggregate_type', 'aggregate_id', 'sequence'],
  },
];
