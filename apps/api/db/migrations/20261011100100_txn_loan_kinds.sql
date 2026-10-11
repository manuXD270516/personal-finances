-- TRANSACTIONS: transacciones de préstamo administradas por DEBT (openspec add-loans, tarea de la extensión de
-- TRANSACTIONS; design.md decisiones 5, 8 y 10, § Modelo de datos; docs/09 §6.9, docs/08 §5.4). Expand, no destructiva:
--   * `kind` admite `LOAN_DISBURSEMENT` y `LOAN_PAYMENT` (CHECK ampliado: NOT VALID + VALIDATE, sin bloqueo largo);
--   * columna `loan_payment_breakdown jsonb NULL` con `{loanId, principal, interest, fees, insurance, taxes}` (solo
--     `LOAN_PAYMENT`; las filas existentes quedan en NULL);
--   * `txn.assert_splits_sum()` (INV-021) se reemplaza con CREATE OR REPLACE: INCOME/EXPENSE/REFUND conservan exactamente
--     su regla (Σ splits = monto); LOAN_PAYMENT exige Σ splits = monto − principal del desglose; LOAN_DISBURSEMENT exige
--     Σ splits = comisión retenida (= monto − leg TARGET vigente). El principal nunca es gasto (INV-009);
--   * CHECKs de coherencia: un kind de préstamo es siempre `source = 'DEBT'`, lleva su `externalRef` (`debt.loan` /
--     `debt.loan-payment`) y solo el pago lleva desglose.
-- La unicidad parcial por `externalRef` de los espacios de nombres de DEBT va en la migración siguiente `20261011100110` (CONCURRENTLY).

-- migrate:up
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT', 'TRANSFER', 'CONVERSION',
                  'LOAN_DISBURSEMENT', 'LOAN_PAYMENT')) NOT VALID;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_kind_check;

ALTER TABLE txn.transaction ADD COLUMN loan_payment_breakdown jsonb NULL;
COMMENT ON COLUMN txn.transaction.loan_payment_breakdown IS
  'Desglose de un pago de préstamo {loanId, principal, interest, fees, insurance, taxes} (decimales como texto); solo kind = LOAN_PAYMENT, NULL en el resto (INV-016).';

ALTER TABLE txn.transaction ADD CONSTRAINT transaction_loan_source_ck
  CHECK (kind NOT IN ('LOAN_DISBURSEMENT', 'LOAN_PAYMENT') OR source = 'DEBT') NOT VALID;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_loan_external_ref_ck
  CHECK ((kind <> 'LOAN_DISBURSEMENT' OR COALESCE(external_ref_namespace, '') = 'debt.loan')
     AND (kind <> 'LOAN_PAYMENT' OR COALESCE(external_ref_namespace, '') = 'debt.loan-payment')) NOT VALID;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_loan_breakdown_ck
  CHECK ((kind = 'LOAN_PAYMENT') = (loan_payment_breakdown IS NOT NULL)) NOT VALID;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_loan_source_ck;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_loan_external_ref_ck;
ALTER TABLE txn.transaction VALIDATE CONSTRAINT transaction_loan_breakdown_ck;

CREATE OR REPLACE FUNCTION txn.assert_splits_sum() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tx        uuid;
  v_kind      text;
  v_total     numeric;
  v_breakdown jsonb;
  v_expected  numeric;
  v_sum       numeric;
BEGIN
  IF TG_TABLE_NAME = 'transaction' THEN
    v_tx := NEW.id;
  ELSE
    v_tx := NEW.transaction_id;
  END IF;
  SELECT t.kind, t.amount, t.loan_payment_breakdown INTO v_kind, v_total, v_breakdown FROM txn.transaction t
   WHERE t.workspace_id = NEW.workspace_id AND t.id = v_tx;
  IF v_kind IN ('INCOME', 'EXPENSE', 'REFUND') THEN
    v_expected := v_total;
  ELSIF v_kind = 'LOAN_PAYMENT' THEN
    -- INV-021 ampliado: lo que no es principal es gasto (interés, comisiones, seguro, impuestos).
    v_expected := v_total - COALESCE((v_breakdown ->> 'principal')::numeric, 0);
  ELSIF v_kind = 'LOAN_DISBURSEMENT' THEN
    -- Solo la comisión retenida es gasto: monto (principal) − lo que recibe la cuenta destino (leg TARGET vigente).
    v_expected := v_total - COALESCE((
      SELECT l.amount FROM txn.transaction_leg l
       WHERE l.workspace_id = NEW.workspace_id AND l.transaction_id = v_tx
         AND l.role = 'TARGET' AND l.superseded_in_revision IS NULL
       LIMIT 1), v_total);
  ELSE
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(s.amount), 0) INTO v_sum FROM txn.transaction_split s
   WHERE s.workspace_id = NEW.workspace_id AND s.transaction_id = v_tx AND s.superseded_in_revision IS NULL;
  IF v_sum <> v_expected THEN
    RAISE EXCEPTION 'splits of transaction % sum % but the expected amount is %', v_tx, v_sum, v_expected
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum_ck';
  END IF;
  RETURN NULL;
END;
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION txn.assert_splits_sum() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tx    uuid;
  v_kind  text;
  v_total numeric;
  v_sum   numeric;
BEGIN
  IF TG_TABLE_NAME = 'transaction' THEN
    v_tx := NEW.id;
  ELSE
    v_tx := NEW.transaction_id;
  END IF;
  SELECT t.kind, t.amount INTO v_kind, v_total FROM txn.transaction t
   WHERE t.workspace_id = NEW.workspace_id AND t.id = v_tx;
  IF v_kind IS NULL OR v_kind NOT IN ('INCOME', 'EXPENSE', 'REFUND') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(s.amount), 0) INTO v_sum FROM txn.transaction_split s
   WHERE s.workspace_id = NEW.workspace_id AND s.transaction_id = v_tx AND s.superseded_in_revision IS NULL;
  IF v_sum <> v_total THEN
    RAISE EXCEPTION 'splits of transaction % sum % but the amount is %', v_tx, v_sum, v_total
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_splits_sum_ck';
  END IF;
  RETURN NULL;
END;
$$;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_loan_breakdown_ck;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_loan_external_ref_ck;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_loan_source_ck;
ALTER TABLE txn.transaction DROP COLUMN loan_payment_breakdown;
ALTER TABLE txn.transaction DROP CONSTRAINT transaction_kind_check;
ALTER TABLE txn.transaction ADD CONSTRAINT transaction_kind_check
  CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT', 'TRANSFER', 'CONVERSION'));
