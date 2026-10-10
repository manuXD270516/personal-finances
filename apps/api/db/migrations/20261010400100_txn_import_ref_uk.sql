-- TRANSACTIONS: índice único parcial por referencia externa de filas importadas (openspec add-basic-csv-import, tarea
-- 4.2; design.md decisión 7c). Expand, no destructiva. Red de seguridad de la idempotencia de imports (INV-014): una
-- transacción activa por (cuenta, huella de fila) aunque un reintento o dos jobs aprobados en paralelo persistan la
-- misma fila. Ninguna fila existente usa el espacio de nombres `imports.csv-row`, así que el índice no puede fallar; se
-- crea CONCURRENTLY en una migración aparte y sin transacción. Una transacción anulada deja de ocupar la huella.

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_import_ref_uk
  ON txn.transaction (workspace_id, account_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace = 'imports.csv-row' AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_import_ref_uk;
