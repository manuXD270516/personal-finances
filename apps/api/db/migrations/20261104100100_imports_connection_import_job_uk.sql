-- IMPORTS: una sola sincronización en curso por conexión (openspec add-banking-providers, tarea 4.2; design.md decisión 6).
-- Expand, no destructiva. Índice único parcial sobre los imports de una conexión en estados no terminales: la segunda
-- sincronización de la misma conexión falla con `CONNECTION_SYNC_IN_PROGRESS` aunque dos solicitudes lleguen a la vez.
-- Ninguna fila existente tiene `connection_id`, así que el índice no puede fallar; se crea CONCURRENTLY en una migración
-- aparte y sin transacción (como `transaction_import_ext_ref_uk`).

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS import_job_connection_active_uk
  ON imports.import_job (workspace_id, connection_id)
  WHERE connection_id IS NOT NULL
    AND status IN ('UPLOADED', 'PROCESSING', 'AWAITING_MAPPING', 'AWAITING_REVIEW', 'APPROVED', 'PERSISTING',
                   'PARTIALLY_FAILED');

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS imports.import_job_connection_active_uk;
