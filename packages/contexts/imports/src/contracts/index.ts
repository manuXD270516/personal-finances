/**
 * API pública de `@pf/imports` (openspec add-basic-csv-import; ADR-0003). Hoja: no importa capas internas.
 * Subconjunto CSV básico de docs/13 (FR-IMPORTS-003, Phase 3); Phase 6 lo extiende sin cambios rompedores.
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

export const IMPORTS_CONTEXT = 'imports' as const;

/** Eventos publicados por el outbox (contracts/events/imports/*.v1.schema.json). Imports NO publica eventos por fila. */
export const IMPORTS_EVENTS = {
  approved: { eventType: 'imports.ImportApproved', eventVersion: 1 },
  completed: { eventType: 'imports.ImportCompleted', eventVersion: 1 },
} as const;

/** Consumidores idempotentes del worker (clave del inbox y nombre de la cola `events.<consumer>`). */
export const IMPORTS_CONSUMERS = {
  persist: 'imports.persist',
} as const;

/** Jobs periódicos del worker (diarios). */
export const IMPORTS_EXPIRE_JOB = 'imports.expire-reviews' as const;
export const IMPORTS_PURGE_JOB = 'imports.purge-staging' as const;

/**
 * Allow-list de auditoría de IMPORTS (NFR-SEC-015): ni celdas, ni descripciones, ni montos de filas. Los valores
 * compuestos (conteos) viajan como texto JSON.
 */
export const IMPORTS_AUDIT_POLICY = {
  ImportJob: {
    accountId: 'plain',
    status: 'plain',
    rowCount: 'plain',
    fileSha256: 'plain',
    counters: 'plain',
    attempt: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

/**
 * Secciones de exportación/importación del workspace que pertenecen a IMPORTS (openspec add-basic-csv-import
 * § Modelo de datos; rango de orden 770, después de COMMITMENTS 750–765 y antes de NOTIFICATIONS 800): los jobs y los
 * vínculos de idempotencia, con ids de cuenta y de transacción remapeados. El staging (`staged_transaction`) se excluye
 * como dato técnico purgable (ver `IMPORTS_PORTABILITY_EXCLUSIONS`).
 */
export const IMPORTS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'import-jobs',
    context: 'imports',
    table: 'imports.import_job',
    order: 770,
    orderBy: ['id'],
  },
  {
    name: 'import-row-links',
    context: 'imports',
    table: 'imports.row_link',
    order: 771,
    orderBy: ['account_id', 'id'],
    // El staging no viaja: el vínculo a la fila de staging queda en NULL al importar.
    omit: ['staged_transaction_id'],
  },
];

export const IMPORTS_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'imports.staged_transaction',
    reason:
      'Dato técnico purgable (celdas crudas del archivo, retención de 90 días): no es dato financiero (docs/13 §11).',
  },
];
