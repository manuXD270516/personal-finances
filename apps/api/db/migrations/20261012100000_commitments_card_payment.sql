-- COMMITMENTS: pago de tarjeta como compromiso administrado (openspec add-credit-cards, decisión 7).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * recurring_definition.kind: el CHECK admite también `CARD_PAYMENT`, solo para definiciones administradas por
--     `DEBT` (la guarda de dominio por tipo tiene su defensa en profundidad aquí). `managed_by` ya admite `DEBT`
--     (20261011100200). Los CHECK se amplían con NOT VALID + VALIDATE.
--   * recurring_definition_version.mode_ck: `AUTO_CREATE` admitía montos `FIXED`/`ESTIMATED` (o precio indexado). El
--     pago de tarjeta nace con monto `VARIABLE` hasta que la tarjeta fija el esperado de cada ocurrencia y puede crearse
--     sola cuando ya lo tiene: se admite también `VARIABLE` en una definición de transferencia (con cuenta destino). El
--     dominio sigue rechazándolo para el resto de los tipos.
-- La regla mensual reutiliza las columnas existentes (`cadence`, `month_days`, `weekend_adjustment`): sin columnas
-- nuevas. Sin backfill.

-- migrate:up
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_kind_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_kind_check
    CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER', 'LOAN_PAYMENT', 'CARD_PAYMENT')) NOT VALID,
  ADD CONSTRAINT recurring_definition_card_payment_ck
    CHECK (kind <> 'CARD_PAYMENT' OR managed_by = 'DEBT') NOT VALID;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_kind_check;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_card_payment_ck;

ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_mode_ck;
ALTER TABLE commitments.recurring_definition_version
  ADD CONSTRAINT recurring_definition_version_mode_ck CHECK (
    (materialization_mode <> 'AUTO_CREATE'
       OR amount_type IN ('FIXED', 'ESTIMATED') OR indexed_amount IS NOT NULL OR to_account_id IS NOT NULL)
    AND ((materialization_mode = 'AUTO_CREATE') = (auto_create_status IS NOT NULL))
  ) NOT VALID;
ALTER TABLE commitments.recurring_definition_version VALIDATE CONSTRAINT recurring_definition_version_mode_ck;

-- migrate:down
ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_mode_ck;
ALTER TABLE commitments.recurring_definition_version
  ADD CONSTRAINT recurring_definition_version_mode_ck CHECK (
    (materialization_mode <> 'AUTO_CREATE' OR amount_type IN ('FIXED', 'ESTIMATED') OR indexed_amount IS NOT NULL)
    AND ((materialization_mode = 'AUTO_CREATE') = (auto_create_status IS NOT NULL))
  );
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_card_payment_ck,
  DROP CONSTRAINT recurring_definition_kind_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_kind_check CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER', 'LOAN_PAYMENT'));
