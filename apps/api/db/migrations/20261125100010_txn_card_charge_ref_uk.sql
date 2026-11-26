-- TRANSACTIONS: índice único parcial por referencia externa de los cargos de tarjeta (openspec
-- add-card-interest-ledger-portions; design.md decisión 2). Expand, no destructiva. Red de seguridad de la idempotencia de
-- `CardChargeTransactionsPort.recordCharge`: una transacción vigente por cargo (`debt.card-charge`) aunque un reintento o
-- dos peticiones concurrentes intenten registrarla dos veces. Ninguna fila existente usa ese espacio de nombres, así que
-- el índice no puede fallar; se crea CONCURRENTLY en una migración aparte y sin transacción. Una transacción anulada deja
-- de ocupar la referencia. Los cargos adoptados conservan su propia referencia (p. ej. la del import) y no entran aquí.

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_card_charge_ref_uk
  ON txn.transaction (workspace_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace = 'debt.card-charge' AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_card_charge_ref_uk;
