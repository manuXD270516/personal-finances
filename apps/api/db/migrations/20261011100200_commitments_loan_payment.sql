-- COMMITMENTS: cuotas de préstamo como compromisos (openspec add-loans, design § Dependencias con el motor N1-N9).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * recurring_definition.managed_by: el CHECK admite también `DEBT`; `kind` admite `LOAN_PAYMENT`, solo para
--     definiciones administradas por `DEBT` (N2). Los CHECK se amplían con NOT VALID + VALIDATE.
--   * recurring_definition_version.explicit_schedule jsonb: calendario explícito `[{key, dueDate, amount}]` (N3). La
--     cadencia `EXPLICIT` y el calendario van juntos (XOR con la regla: sin RRULE, fin ni máximo) y solo operan en
--     modo `NOTIFY_ONLY`.
--   * recurring_occurrence.schedule_key: clave del ítem del calendario (número de cuota); única por definición.
--   * recurring_occurrence.shares_transaction: `true` solo en `LOAN_PAYMENT` (N5). El índice único de vinculación
--     (1 transacción <-> 1 ocurrencia) pasa a ser parcial y excluye las ocurrencias que comparten transacción.
-- Sin backfill: las filas existentes quedan con `shares_transaction = false` (comportamiento previo).

-- migrate:up
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_kind_check,
  DROP CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_kind_check
    CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER', 'LOAN_PAYMENT')) NOT VALID,
  ADD CONSTRAINT recurring_definition_managed_by_check
    CHECK (managed_by IN ('USER', 'SUBSCRIPTION', 'DEBT')) NOT VALID,
  ADD CONSTRAINT recurring_definition_loan_payment_ck
    CHECK (kind <> 'LOAN_PAYMENT' OR managed_by = 'DEBT') NOT VALID;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_kind_check;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_managed_by_check;
ALTER TABLE commitments.recurring_definition VALIDATE CONSTRAINT recurring_definition_loan_payment_ck;

ALTER TABLE commitments.recurring_definition_version
  ADD COLUMN explicit_schedule jsonb NULL;
ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_cadence_check;
ALTER TABLE commitments.recurring_definition_version
  ADD CONSTRAINT recurring_definition_version_cadence_check
    CHECK (cadence IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY',
                       'SEMIANNUAL', 'ANNUAL', 'CUSTOM', 'EXPLICIT')) NOT VALID,
  ADD CONSTRAINT recurring_definition_version_explicit_ck
    CHECK ((cadence = 'EXPLICIT') = (explicit_schedule IS NOT NULL)
           AND (explicit_schedule IS NULL OR (jsonb_typeof(explicit_schedule) = 'array'
                AND rrule IS NULL AND until_date IS NULL AND max_count IS NULL
                AND materialization_mode = 'NOTIFY_ONLY'))) NOT VALID;
ALTER TABLE commitments.recurring_definition_version VALIDATE CONSTRAINT recurring_definition_version_cadence_check;
ALTER TABLE commitments.recurring_definition_version VALIDATE CONSTRAINT recurring_definition_version_explicit_ck;

ALTER TABLE commitments.recurring_occurrence
  ADD COLUMN schedule_key        text    NULL CHECK (schedule_key IS NULL OR char_length(schedule_key) BETWEEN 1 AND 40),
  ADD COLUMN shares_transaction  boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX recurring_occurrence_schedule_key_uq
  ON commitments.recurring_occurrence (definition_id, schedule_key) WHERE schedule_key IS NOT NULL;
-- N5: una transacción resuelve a lo sumo una ocurrencia, salvo las de cuotas de préstamo (1:N dentro de su préstamo).
CREATE UNIQUE INDEX recurring_occurrence_txn_excl_uq
  ON commitments.recurring_occurrence (workspace_id, transaction_id)
  WHERE status IN ('MATERIALIZED', 'MATCHED') AND NOT shares_transaction;
CREATE INDEX recurring_occurrence_txn_shared_ix
  ON commitments.recurring_occurrence (workspace_id, transaction_id)
  WHERE status IN ('MATERIALIZED', 'MATCHED') AND shares_transaction;
DROP INDEX commitments.recurring_occurrence_txn_uq;

-- migrate:down
CREATE UNIQUE INDEX recurring_occurrence_txn_uq
  ON commitments.recurring_occurrence (workspace_id, transaction_id) WHERE status IN ('MATERIALIZED', 'MATCHED');
DROP INDEX commitments.recurring_occurrence_txn_shared_ix;
DROP INDEX commitments.recurring_occurrence_txn_excl_uq;
DROP INDEX commitments.recurring_occurrence_schedule_key_uq;
ALTER TABLE commitments.recurring_occurrence DROP COLUMN shares_transaction, DROP COLUMN schedule_key;
ALTER TABLE commitments.recurring_definition_version
  DROP CONSTRAINT recurring_definition_version_explicit_ck,
  DROP CONSTRAINT recurring_definition_version_cadence_check;
ALTER TABLE commitments.recurring_definition_version
  ADD CONSTRAINT recurring_definition_version_cadence_check
    CHECK (cadence IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY',
                       'SEMIANNUAL', 'ANNUAL', 'CUSTOM'));
ALTER TABLE commitments.recurring_definition_version DROP COLUMN explicit_schedule;
ALTER TABLE commitments.recurring_definition
  DROP CONSTRAINT recurring_definition_loan_payment_ck,
  DROP CONSTRAINT recurring_definition_managed_by_check,
  DROP CONSTRAINT recurring_definition_kind_check;
ALTER TABLE commitments.recurring_definition
  ADD CONSTRAINT recurring_definition_kind_check CHECK (kind IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  ADD CONSTRAINT recurring_definition_managed_by_check CHECK (managed_by IN ('USER', 'SUBSCRIPTION'));
