-- TRANSACTIONS: índice único parcial por referencia externa de ocurrencias recurrentes (openspec add-recurrence-engine,
-- tarea 4.1; design.md decisión 10). Expand, no destructiva. Defensa en profundidad: una transacción por ocurrencia
-- aunque un bug reintente la materialización. Ninguna fila existente usa el espacio de nombres `commitments.occurrence`,
-- así que el índice no puede fallar; se crea CONCURRENTLY en una migración aparte y sin transacción.

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_recurring_occurrence_uq
  ON txn.transaction (workspace_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace = 'commitments.occurrence';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_recurring_occurrence_uq;
