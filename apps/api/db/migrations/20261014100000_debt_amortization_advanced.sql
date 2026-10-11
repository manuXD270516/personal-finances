-- DEBT: amortización avanzada (openspec add-loan-amortization-advanced, tarea 4.1; design.md § Modelo de datos;
-- docs/08 §5.9). Expand, no destructiva. Se ejecuta con `pf_migrator`. Las tablas de add-loans ya existen.
--
--   * debt.loan                    + fixed_principal_amount (solo FIXED_PRINCIPAL) y custom_schedule (cuotas custom de un
--     borrador, que `DisburseLoan` fija como versión 1; se limpia al desembolsar).
--   * debt.loan_schedule_version   + motivos PREPAYMENT, PREPAYMENT_VOIDED, RATE_CHANGE, CUSTOM_DEFINED, CUSTOM_ADOPTED y
--     las columnas from_installment_no (primera cuota que reemplaza) y source_* (pago, cambio de tasa o referencia que la
--     originó; referencias lógicas sin FK para no romper el orden de importación del workspace).
--   * debt.loan_payment            + kind (REGULAR | PREPAYMENT), prepayment_option y prepayment_fee.
--   * debt.loan_rate_change        NUEVA, WS-RO: historial de tasas de un préstamo de tasa variable; append-only.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): hija antes que el préstamo.
-- Los CHECK ampliados se agregan NOT VALID y se validan aparte (expand sin bloqueos largos). `pf_worker` es miembro de
-- `pf_app` y hereda sus grants y políticas.

-- migrate:up

-- ---------------------------------------------------------------- debt.loan
ALTER TABLE debt.loan
  ADD COLUMN fixed_principal_amount numeric(38,18) NULL,
  ADD COLUMN custom_schedule        jsonb          NULL;
ALTER TABLE debt.loan
  ADD CONSTRAINT loan_fixed_principal_ck CHECK (
    (method = 'FIXED_PRINCIPAL') = (fixed_principal_amount IS NOT NULL)
    AND (fixed_principal_amount IS NULL OR fixed_principal_amount > 0)) NOT VALID,
  ADD CONSTRAINT loan_custom_schedule_ck CHECK (
    custom_schedule IS NULL OR jsonb_typeof(custom_schedule) = 'array') NOT VALID;
ALTER TABLE debt.loan VALIDATE CONSTRAINT loan_fixed_principal_ck;
ALTER TABLE debt.loan VALIDATE CONSTRAINT loan_custom_schedule_ck;
COMMENT ON COLUMN debt.loan.fixed_principal_amount IS
  'Solo FIXED_PRINCIPAL: principal de las cuotas anteriores a la última; la última es el balloon (D194).';
COMMENT ON COLUMN debt.loan.custom_schedule IS
  'Cuotas custom de un borrador (filas del PUT custom-schedule); DisburseLoan las fija como versión 1 y las limpia.';

-- ---------------------------------------------------------------- debt.loan_schedule_version
ALTER TABLE debt.loan_schedule_version DROP CONSTRAINT loan_schedule_version_reason_check;
ALTER TABLE debt.loan_schedule_version
  ADD CONSTRAINT loan_schedule_version_reason_check CHECK (
    reason IN ('INITIAL', 'PREPAYMENT', 'PREPAYMENT_VOIDED', 'RATE_CHANGE', 'CUSTOM_DEFINED', 'CUSTOM_ADOPTED')) NOT VALID;
ALTER TABLE debt.loan_schedule_version VALIDATE CONSTRAINT loan_schedule_version_reason_check;
ALTER TABLE debt.loan_schedule_version
  ADD COLUMN from_installment_no   integer NOT NULL DEFAULT 1 CHECK (from_installment_no >= 1),
  ADD COLUMN source_payment_id     uuid    NULL,
  ADD COLUMN source_rate_change_id uuid    NULL,
  ADD COLUMN source_reference_id   uuid    NULL;
COMMENT ON COLUMN debt.loan_schedule_version.from_installment_no IS
  'Primera cuota que esta versión reemplaza: el cronograma efectivo toma de las versiones anteriores las cuotas con n menor.';

-- ---------------------------------------------------------------- debt.loan_payment
ALTER TABLE debt.loan_payment
  ADD COLUMN kind              text           NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR', 'PREPAYMENT')),
  ADD COLUMN prepayment_option text           NULL CHECK (prepayment_option IN ('REDUCE_TERM', 'REDUCE_INSTALLMENT')),
  ADD COLUMN prepayment_fee    numeric(38,18) NULL CHECK (prepayment_fee IS NULL OR prepayment_fee >= 0);
ALTER TABLE debt.loan_payment
  ADD CONSTRAINT loan_payment_prepayment_ck CHECK (
    (kind = 'PREPAYMENT') = (prepayment_option IS NOT NULL)
    AND (kind = 'PREPAYMENT' OR prepayment_fee IS NULL)) NOT VALID;
ALTER TABLE debt.loan_payment VALIDATE CONSTRAINT loan_payment_prepayment_ck;
COMMENT ON COLUMN debt.loan_payment.kind IS
  'REGULAR: pago imputado a cuotas. PREPAYMENT: pago extraordinario a principal (+ comisión) sin imputaciones; crea una versión del cronograma.';

-- ---------------------------------------------------------------- debt.loan_rate_change
CREATE TABLE debt.loan_rate_change (
  id               uuid           PRIMARY KEY,
  workspace_id     uuid           NOT NULL REFERENCES iam.workspace (id),
  loan_id          uuid           NOT NULL,
  -- Fracción decimal (0.15 = 15 %).
  annual_rate      numeric(38,18) NOT NULL CHECK (annual_rate >= 0 AND annual_rate <= 1),
  effective_from   date           NOT NULL,
  -- Versión del cronograma que originó el cambio.
  schedule_version integer        NOT NULL CHECK (schedule_version >= 1),
  created_by       uuid           NOT NULL,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT loan_rate_change_uk UNIQUE (loan_id, effective_from),
  CONSTRAINT loan_rate_change_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT loan_rate_change_loan_fk FOREIGN KEY (workspace_id, loan_id) REFERENCES debt.loan (workspace_id, id)
);
COMMENT ON TABLE debt.loan_rate_change IS
  'Cambio de tasa de un préstamo de tasa variable con su fecha de vigencia (debt/amortization, FR-DEBT-009); append-only.';
CREATE TRIGGER loan_rate_change_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_rate_change
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_rate_change_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_rate_change
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

ALTER TABLE debt.loan_rate_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_rate_change FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON debt.loan_rate_change TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
REVOKE ALL ON debt.loan_rate_change FROM PUBLIC;
GRANT SELECT, INSERT ON debt.loan_rate_change TO pf_app;

-- Purga del workspace demo (ADR-0026): hija antes que el préstamo (orden 184).
SELECT platform.register_workspace_scoped_table('debt.loan_rate_change'::regclass, 181, 'DELETE');

-- migrate:down
DROP TABLE debt.loan_rate_change;
ALTER TABLE debt.loan_payment
  DROP CONSTRAINT loan_payment_prepayment_ck,
  DROP COLUMN prepayment_fee,
  DROP COLUMN prepayment_option,
  DROP COLUMN kind;
ALTER TABLE debt.loan_schedule_version
  DROP COLUMN source_reference_id,
  DROP COLUMN source_rate_change_id,
  DROP COLUMN source_payment_id,
  DROP COLUMN from_installment_no;
ALTER TABLE debt.loan_schedule_version DROP CONSTRAINT loan_schedule_version_reason_check;
ALTER TABLE debt.loan_schedule_version
  ADD CONSTRAINT loan_schedule_version_reason_check CHECK (reason IN ('INITIAL'));
ALTER TABLE debt.loan DROP CONSTRAINT loan_custom_schedule_ck, DROP CONSTRAINT loan_fixed_principal_ck;
ALTER TABLE debt.loan DROP COLUMN custom_schedule, DROP COLUMN fixed_principal_amount;
