-- TRANSACTIONS: índice único parcial por referencia de proveedor de movimientos externos (openspec
-- add-banking-providers, tarea 4.2; design.md decisión 8). Expand, no destructiva. A lo sumo UNA transacción no anulada
-- por (cuenta, namespace `imports.provider:<exchange>:<tipo>`, identificador del exchange): el archivo y la API del
-- mismo exchange comparten el namespace, así que un trade importado por un camino aparece como ya importado por el
-- otro (INV-014). Anular la transacción libera la referencia. Ninguna fila usa todavía ese namespace; se crea
-- CONCURRENTLY en una migración aparte y sin transacción (como `transaction_import_ext_ref_uk`).

-- migrate:up transaction:false
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_provider_ref_uk
  ON txn.transaction (workspace_id, account_id, external_ref_namespace, external_ref_id)
  WHERE external_ref_namespace LIKE 'imports.provider:%' AND status <> 'VOIDED';

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_provider_ref_uk;
