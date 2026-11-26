-- TRANSACTIONS: rol de DEBT sobre un gasto (openspec add-card-interest-ledger-portions, design.md decisiones 2 y 8; docs/76
-- pregunta 1). Expand, no destructiva, sin backfill (las filas existentes quedan en NULL):
--   * `debt_role text NULL` con `CHECK (debt_role IS NULL OR debt_role = 'CARD_CHARGE')`: marca que un `EXPENSE` es un cargo
--     de tarjeta (interés, comisiones, seguro o impuestos) administrado por DEBT; abierta a otros roles ampliando el CHECK;
--   * `CHECK (debt_role IS NULL OR kind = 'EXPENSE')`: un rol de DEBT solo vive en un gasto (el cargo sigue contando como
--     gasto en todo lo que ya mide gasto);
--   * `debt_card_id uuid NULL`: tarjeta que administra la transacción (referencia lógica, sin FK entre contextos,
--     NFR-DATA-015); no nulo si y solo si hay `debt_role`. Viaja en `details` del `TRANSACTION_MANAGED_EXTERNALLY`.
-- Los CHECK se agregan `NOT VALID` y se validan aparte (sin bloqueo largo). La unicidad parcial por `externalRef`
-- `debt.card-charge` va en la migración siguiente (CONCURRENTLY).

-- migrate:up
ALTER TABLE txn.transaction ADD COLUMN debt_role text NULL;
ALTER TABLE txn.transaction ADD COLUMN debt_card_id uuid NULL;
COMMENT ON COLUMN txn.transaction.debt_role IS
  'Rol que DEBT le da a un gasto: CARD_CHARGE = interés y cargos de una tarjeta (porciones por componente). NULL en el resto.';
COMMENT ON COLUMN txn.transaction.debt_card_id IS
  'Tarjeta (debt.credit_card) que administra el gasto cuando hay debt_role; referencia lógica sin FK.';

ALTER TABLE txn.transaction ADD CONSTRAINT transaction_debt_role_ck
  CHECK (debt_role IS NULL OR debt_role = 'CARD_CHARGE') NOT VALID;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_debt_role_kind_ck
  CHECK (debt_role IS NULL OR kind = 'EXPENSE') NOT VALID;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_debt_card_ck
  CHECK ((debt_role IS NULL) = (debt_card_id IS NULL)) NOT VALID;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_debt_role_ck;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_debt_role_kind_ck;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_debt_card_ck;

-- migrate:down
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_debt_card_ck;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_debt_role_kind_ck;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_debt_role_ck;
ALTER TABLE txn.transaction DROP COLUMN debt_card_id;
ALTER TABLE txn.transaction DROP COLUMN debt_role;
