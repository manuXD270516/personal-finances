-- TRANSACTIONS: origen de la clasificación por split y marca de revisión (openspec add-rule-engine, tarea 4.2; design.md
-- decisión 6, 12 y § Modelo de datos). Expand, no destructiva: columnas nulas sin default (ADD COLUMN sin reescritura).
--
--   * txn.transaction_split  category_origin (NULL ⇒ UNKNOWN: anterior a este cambio), category_rule_id/version (solo
--     con origen RULE) y rule_refs (jsonb: {field, ruleId, ruleVersion} de etiquetas, contraparte, campos
--     personalizados, descripción y nota).
--   * txn.transaction        review_status (PENDING o nulo), review_reason (RULE | USER), review_rule_id/version,
--     review_marked_at.
-- El origen no afecta al ledger (INV-033). Las filas anteriores quedan con origen UNKNOWN: no se puede saber su origen.
-- Los índices parciales se crean CONCURRENTLY en migraciones aparte, sin transacción.

-- migrate:up
ALTER TABLE txn.transaction_split
  ADD COLUMN category_origin       text  NULL,
  ADD COLUMN category_rule_id      uuid  NULL,
  ADD COLUMN category_rule_version integer NULL,
  ADD COLUMN rule_refs             jsonb NULL;

ALTER TABLE txn.transaction_split
  ADD CONSTRAINT split_category_origin_ck CHECK (
    category_origin IS NULL OR category_origin IN ('MANUAL', 'RULE', 'COUNTERPARTY_DEFAULT', 'SYSTEM_DEFAULT')),
  ADD CONSTRAINT split_category_rule_ck CHECK (
    COALESCE(category_origin = 'RULE', false) = (category_rule_id IS NOT NULL)
    AND (category_rule_id IS NULL) = (category_rule_version IS NULL)),
  ADD CONSTRAINT split_rule_refs_ck CHECK (rule_refs IS NULL OR jsonb_typeof(rule_refs) = 'array');

ALTER TABLE txn.transaction
  ADD COLUMN review_status       text        NULL,
  ADD COLUMN review_reason       text        NULL,
  ADD COLUMN review_rule_id      uuid        NULL,
  ADD COLUMN review_rule_version integer     NULL,
  ADD COLUMN review_marked_at    timestamptz NULL;

ALTER TABLE txn.transaction
  ADD CONSTRAINT transaction_review_ck CHECK (
    (review_status IS NULL AND review_reason IS NULL AND review_rule_id IS NULL
       AND review_rule_version IS NULL AND review_marked_at IS NULL)
    OR (review_status = 'PENDING' AND review_reason IN ('RULE', 'USER') AND review_marked_at IS NOT NULL
        AND (review_reason = 'RULE') = (review_rule_id IS NOT NULL)
        AND (review_rule_id IS NULL) = (review_rule_version IS NULL)));

COMMENT ON COLUMN txn.transaction_split.category_origin IS
  'Origen de la categoría del split (rules/rule-engine): MANUAL, RULE, COUNTERPARTY_DEFAULT, SYSTEM_DEFAULT; NULL ⇒ UNKNOWN (anterior a add-rule-engine).';
COMMENT ON COLUMN txn.transaction.review_status IS
  'PENDING si la transacción espera revisión (marcada por una regla o por el usuario); sin efecto en el ledger ni en el estado.';

-- migrate:down
ALTER TABLE txn.transaction
  DROP CONSTRAINT transaction_review_ck,
  DROP COLUMN review_marked_at,
  DROP COLUMN review_rule_version,
  DROP COLUMN review_rule_id,
  DROP COLUMN review_reason,
  DROP COLUMN review_status;
ALTER TABLE txn.transaction_split
  DROP CONSTRAINT split_rule_refs_ck,
  DROP CONSTRAINT split_category_rule_ck,
  DROP CONSTRAINT split_category_origin_ck,
  DROP COLUMN rule_refs,
  DROP COLUMN category_rule_version,
  DROP COLUMN category_rule_id,
  DROP COLUMN category_origin;
