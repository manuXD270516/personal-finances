-- Transferencias entre cuentas propias (openspec add-transfers, tarea 4.1; design.md decisión 7; docs/09 §6.4).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`. Sin tablas nuevas: una transferencia es `kind='TRANSFER'`
-- con legs `SOURCE` (< 0) y `TARGET` (> 0). Segunda barrera del dominio: constraint trigger DIFERIDO
-- `txn.assert_transfer_consistency()` (exactamente un SOURCE y un TARGET vigentes, cuentas distintas, misma moneda).

-- migrate:up
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT', 'TRANSFER'));

CREATE FUNCTION txn.assert_transfer_consistency() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tx       uuid;
  v_kind     text;
  v_status   text;
  v_currency text;
  v_sources  integer;
  v_targets  integer;
  v_others   integer;
  v_accounts integer;
  v_ccys     integer;
BEGIN
  IF TG_TABLE_NAME = 'transaction' THEN
    v_tx := NEW.id;
  ELSE
    v_tx := NEW.transaction_id;
  END IF;
  SELECT t.kind, t.status, t.currency INTO v_kind, v_status, v_currency FROM txn.transaction t
   WHERE t.workspace_id = NEW.workspace_id AND t.id = v_tx;
  IF v_kind IS DISTINCT FROM 'TRANSFER' THEN
    RETURN NULL;
  END IF;
  SELECT count(*) FILTER (WHERE l.role = 'SOURCE' AND l.amount < 0),
         count(*) FILTER (WHERE l.role = 'TARGET' AND l.amount > 0),
         count(*) FILTER (WHERE l.role NOT IN ('SOURCE', 'TARGET')
                            OR (l.role = 'SOURCE' AND l.amount >= 0)
                            OR (l.role = 'TARGET' AND l.amount <= 0)),
         count(DISTINCT l.account_id),
         count(DISTINCT l.currency) FILTER (WHERE l.currency <> v_currency) + count(DISTINCT l.currency)
    INTO v_sources, v_targets, v_others, v_accounts, v_ccys
    FROM txn.transaction_leg l
   WHERE l.workspace_id = NEW.workspace_id AND l.transaction_id = v_tx AND l.superseded_in_revision IS NULL;
  IF v_sources <> 1 OR v_targets <> 1 OR v_others <> 0 OR v_accounts <> 2 OR v_ccys <> 1 THEN
    RAISE EXCEPTION 'transfer % is inconsistent (sources %, targets %, accounts %, currencies %)',
      v_tx, v_sources, v_targets, v_accounts, v_ccys
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_transfer_consistency_ck';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_transfer_consistency_tx
  AFTER INSERT OR UPDATE ON txn.transaction
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_transfer_consistency();
CREATE CONSTRAINT TRIGGER transaction_transfer_consistency_leg
  AFTER INSERT OR UPDATE ON txn.transaction_leg
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION txn.assert_transfer_consistency();
REVOKE ALL ON FUNCTION txn.assert_transfer_consistency() FROM PUBLIC;

-- migrate:down
DROP TRIGGER transaction_transfer_consistency_leg ON txn.transaction_leg;
DROP TRIGGER transaction_transfer_consistency_tx ON txn.transaction;
DROP FUNCTION txn.assert_transfer_consistency();
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT'));
