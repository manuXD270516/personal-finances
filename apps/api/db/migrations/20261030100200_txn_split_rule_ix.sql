-- TRANSACTIONS: índice parcial por regla de la categoría del split (openspec add-rule-engine, tarea 4.2). Sustenta la
-- cobertura de clasificación y las estadísticas por regla (design.md decisión 11): solo splits vigentes clasificados por
-- una regla. Expand, no destructiva; CONCURRENTLY en una migración aparte y sin transacción.

-- migrate:up transaction:false
CREATE INDEX CONCURRENTLY IF NOT EXISTS transaction_split_rule_ix
  ON txn.transaction_split (workspace_id, category_rule_id)
  WHERE category_rule_id IS NOT NULL AND superseded_in_revision IS NULL;

-- migrate:down transaction:false
DROP INDEX CONCURRENTLY IF EXISTS txn.transaction_split_rule_ix;
