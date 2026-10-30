-- TRANSACTIONS: índice parcial de las transacciones pendientes de revisión (openspec add-rule-engine, tarea 4.2). Sustenta
-- el filtro `needsReview=true` del listado (design.md decisión 12). Expand, no destructiva; CONCURRENTLY en una
-- migración aparte y sin transacción.

-- migrate:up transaction:false
CREATE INDEX CONCURRENTLY IF NOT EXISTS transaction_review_pending_ix
  ON txn.transaction (workspace_id, transaction_date DESC)
  WHERE review_status = 'PENDING';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_review_pending_ix;
