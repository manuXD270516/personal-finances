-- TRANSACTIONS: índice único parcial por identificador externo del banco de filas importadas (openspec
-- add-import-pipeline, tarea 3.3; design.md decisión 10). Expand, no destructiva. Garantiza a lo sumo UNA transacción
-- no anulada por (cuenta, formato, identificador) —FITID de OFX, referencia única de un perfil, `externalId` del JSON—
-- aunque dos imports aprobados a la vez persistan el mismo movimiento (INV-014, FR-IMPORTS-010); anular la transacción
-- libera el identificador. Ninguna fila existente usa el espacio de nombres `imports.ext:*`, así que el índice no puede
-- fallar; se crea CONCURRENTLY en una migración aparte y sin transacción (como `transaction_import_ref_uk`).

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_import_ext_ref_uk
  ON txn.transaction (workspace_id, account_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace LIKE 'imports.ext:%' AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_import_ext_ref_uk;
