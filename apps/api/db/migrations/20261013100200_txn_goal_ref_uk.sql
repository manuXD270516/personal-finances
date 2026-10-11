-- TRANSACTIONS: índice único parcial por referencia externa de las transferencias de metas (openspec add-savings-goals,
-- design.md decisión 3). Expand, no destructiva. Red de seguridad de la idempotencia de `GoalTransferPort`: una
-- transferencia vigente por movimiento de meta (`goals.movement`) aunque un reintento o dos peticiones concurrentes
-- intenten registrarla dos veces. Ninguna fila existente usa ese espacio de nombres, así que el índice no puede fallar;
-- se crea CONCURRENTLY en una migración aparte y sin transacción. Una transferencia anulada deja de ocupar la referencia.

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_goal_ref_uk
  ON txn.transaction (workspace_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace = 'goals.movement' AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_goal_ref_uk;
