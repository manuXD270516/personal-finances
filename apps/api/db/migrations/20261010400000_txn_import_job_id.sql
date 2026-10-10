-- TRANSACTIONS: origen de importación de una transacción (openspec add-basic-csv-import, tarea 4.2; design.md § Modelo de
-- datos). Expand, no destructiva: columna nullable sin default. `import_job_id` es una referencia lógica a
-- imports.import_job (otro schema, sin FK, NFR-DATA-015); las transacciones existentes quedan en NULL. El índice único
-- parcial por referencia de fila importada se crea CONCURRENTLY en la migración siguiente.

-- migrate:up
ALTER TABLE txn.transaction ADD COLUMN import_job_id uuid NULL;
COMMENT ON COLUMN txn.transaction.import_job_id IS
  'Importación (imports.import_job) que creó la transacción; NULL si no vino de un import (transactions/transaction-recording, source = IMPORT).';

-- migrate:down
ALTER TABLE txn.transaction DROP COLUMN import_job_id;
