-- TRANSACTIONS: índice único parcial por referencia externa de las transacciones de préstamo (openspec add-loans;
-- design.md decisiones 5 y 8). Expand, no destructiva. Red de seguridad de la idempotencia de `LoanTransactionsPort`: una
-- transacción vigente por préstamo (`debt.loan`, desembolso) y por pago (`debt.loan-payment`) aunque un reintento o dos
-- peticiones concurrentes intenten registrarla dos veces. Ninguna fila existente usa esos espacios de nombres, así que el
-- índice no puede fallar; se crea CONCURRENTLY en una migración aparte y sin transacción. Una transacción anulada deja
-- de ocupar la referencia.

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_loan_ref_uk
  ON txn.transaction (workspace_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace IN ('debt.loan', 'debt.loan-payment') AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_loan_ref_uk;
