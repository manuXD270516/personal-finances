-- DEBT: préstamos (openspec add-loans, tarea 4.1; design.md § Modelo de datos; docs/08 §5.9). Expand, no destructiva.
-- Se ejecuta con `pf_migrator`.
--
--   * debt.loan                      WS: SELECT/INSERT/UPDATE. Condiciones del préstamo y su estado (`DRAFT → ACTIVE →
--     PAID_OFF`, `CANCELLED`). Sin DELETE: se conserva como historia.
--   * debt.loan_schedule_version     WS-RO: SELECT/INSERT + `platform.forbid_mutation()` (versión inmutable del cronograma).
--   * debt.loan_installment          WS-RO: cuotas de una versión; el estado de pago NO vive aquí (se deriva de las
--     imputaciones vigentes), por eso la versión es inmutable.
--   * debt.loan_payment              WS: SELECT/INSERT/UPDATE (solo `status`/anulación). `UNIQUE (transaction_id)`.
--   * debt.loan_payment_allocation   WS-RO: imputación por cuota y componente.
--   * debt.loan_reference_schedule / loan_reference_row   WS-RO: tabla del banco cargada (solo las filas parseadas).
--   * debt.loan_schedule_comparison  WS: SELECT/INSERT/UPDATE (estado y explicación).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), hijas antes que padres.
--   * audit.lifecycle_state_divergences(): cubre también `Loan`.
-- Referencias a otros schemas (cuentas, transacciones, definición recurrente, contraparte) son lógicas, sin FK
-- (NFR-DATA-015). `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas.

-- migrate:up
CREATE SCHEMA debt;
GRANT USAGE ON SCHEMA debt TO pf_app;

-- ---------------------------------------------------------------- debt.loan
CREATE TABLE debt.loan (
  id                          uuid           PRIMARY KEY,
  workspace_id                uuid           NOT NULL REFERENCES iam.workspace (id),
  name                        text           NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  account_id                  uuid           NOT NULL,
  disbursement_account_id     uuid           NOT NULL,
  payment_account_id          uuid           NOT NULL,
  lender_counterparty_id      uuid           NULL,
  -- NEW: principal desembolsado. EXISTING: saldo de principal pendiente a `existing_as_of`.
  principal                   numeric(38,18) NOT NULL CHECK (principal > 0),
  currency                    varchar(16)    NOT NULL REFERENCES fx.currency (code),
  annual_rate                 numeric(38,18) NOT NULL CHECK (annual_rate >= 0),
  rate_type                   text           NOT NULL CHECK (rate_type IN ('FIXED', 'VARIABLE')),
  day_count                   text           NOT NULL CHECK (day_count IN ('D30_360', 'ACT_360', 'ACT_365')),
  frequency                   text           NOT NULL CHECK (frequency IN
                                ('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL')),
  -- NEW: plazo total. EXISTING: cuotas restantes.
  term_installments           integer        NOT NULL CHECK (term_installments BETWEEN 1 AND 600),
  method                      text           NOT NULL CHECK (method IN ('FRENCH', 'GERMAN', 'FIXED_PRINCIPAL', 'CUSTOM')),
  -- EXISTING: fecha del saldo pendiente (`existing_as_of`).
  disbursement_date           date           NOT NULL,
  first_due_date              date           NOT NULL,
  charges                     jsonb          NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(charges) = 'object'),
  retained_fee                numeric(38,18) NOT NULL DEFAULT 0 CHECK (retained_fee >= 0),
  origin                      text           NOT NULL CHECK (origin IN ('NEW', 'EXISTING')),
  existing_as_of              date           NULL,
  existing_outstanding        numeric(38,18) NULL CHECK (existing_outstanding IS NULL OR existing_outstanding > 0),
  next_installment_no         integer        NULL CHECK (next_installment_no IS NULL OR next_installment_no >= 1),
  status                      text           NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAID_OFF', 'CANCELLED')),
  current_schedule_version    integer        NULL CHECK (current_schedule_version IS NULL OR current_schedule_version >= 1),
  recurring_definition_id     uuid           NULL,
  disbursement_transaction_id uuid           NULL,
  cancelled_reason            text           NULL CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 500),
  created_by                  uuid           NOT NULL,
  created_at                  timestamptz    NOT NULL DEFAULT now(),
  updated_at                  timestamptz    NOT NULL DEFAULT now(),
  version                     integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT loan_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT loan_first_due_ck CHECK (first_due_date > disbursement_date OR origin = 'EXISTING'),
  CONSTRAINT loan_origin_ck CHECK (
    (origin = 'NEW' AND existing_as_of IS NULL AND existing_outstanding IS NULL AND next_installment_no IS NULL)
    OR (origin = 'EXISTING' AND existing_as_of IS NOT NULL AND existing_outstanding IS NOT NULL
        AND next_installment_no IS NOT NULL AND disbursement_transaction_id IS NULL)),
  CONSTRAINT loan_schedule_ck CHECK (
    status = 'CANCELLED' OR ((status IN ('ACTIVE', 'PAID_OFF')) = (current_schedule_version IS NOT NULL)))
);
-- Una cuenta de pasivo respalda como máximo un préstamo no cancelado.
CREATE UNIQUE INDEX loan_account_active_uk ON debt.loan (workspace_id, account_id) WHERE status <> 'CANCELLED';
CREATE INDEX loan_ws_status_ix ON debt.loan (workspace_id, status);
COMMENT ON TABLE debt.loan IS
  'Préstamo amortizable (debt/loans, FR-DEBT-001). Estados DRAFT → ACTIVE → PAID_OFF, CANCELLED; sin morosidad ni refinanciación en Phase 4.';

-- ---------------------------------------------------------------- debt.loan_schedule_version
CREATE TABLE debt.loan_schedule_version (
  loan_id           uuid        NOT NULL,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  schedule_version  integer     NOT NULL CHECK (schedule_version >= 1),
  reason            text        NOT NULL CHECK (reason IN ('INITIAL')),
  effective_from    date        NOT NULL,
  parameters        jsonb       NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  PRIMARY KEY (loan_id, schedule_version),
  CONSTRAINT loan_schedule_version_loan_fk FOREIGN KEY (workspace_id, loan_id) REFERENCES debt.loan (workspace_id, id)
);
COMMENT ON TABLE debt.loan_schedule_version IS
  'Versión inmutable del cronograma de un préstamo (debt/amortization); WS-RO con forbid_mutation (PF003).';
CREATE TRIGGER loan_schedule_version_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_schedule_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_schedule_version_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_schedule_version
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.loan_installment
CREATE TABLE debt.loan_installment (
  id                uuid           PRIMARY KEY,
  workspace_id      uuid           NOT NULL REFERENCES iam.workspace (id),
  loan_id           uuid           NOT NULL,
  schedule_version  integer        NOT NULL,
  installment_no    integer        NOT NULL CHECK (installment_no >= 1),
  due_date          date           NOT NULL,
  period_start      date           NOT NULL,
  period_end        date           NOT NULL,
  principal_amount  numeric(38,18) NOT NULL CHECK (principal_amount >= 0),
  interest_amount   numeric(38,18) NOT NULL CHECK (interest_amount >= 0),
  fees_amount       numeric(38,18) NOT NULL CHECK (fees_amount >= 0),
  insurance_amount  numeric(38,18) NOT NULL CHECK (insurance_amount >= 0),
  tax_amount        numeric(38,18) NOT NULL CHECK (tax_amount >= 0),
  total_amount      numeric(38,18) NOT NULL,
  opening_balance   numeric(38,18) NOT NULL CHECK (opening_balance >= 0),
  closing_balance   numeric(38,18) NOT NULL CHECK (closing_balance >= 0),
  currency          varchar(16)    NOT NULL REFERENCES fx.currency (code),
  CONSTRAINT loan_installment_uk UNIQUE (loan_id, schedule_version, installment_no),
  CONSTRAINT loan_installment_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT loan_installment_total_ck CHECK (
    total_amount = principal_amount + interest_amount + fees_amount + insurance_amount + tax_amount),
  CONSTRAINT loan_installment_version_fk FOREIGN KEY (loan_id, schedule_version)
    REFERENCES debt.loan_schedule_version (loan_id, schedule_version)
);
COMMENT ON TABLE debt.loan_installment IS
  'Cuota de una versión del cronograma. Inmutable: el estado de pago se deriva de debt.loan_payment_allocation.';
CREATE TRIGGER loan_installment_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_installment
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_installment_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_installment
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.loan_payment
CREATE TABLE debt.loan_payment (
  id                 uuid           PRIMARY KEY,
  workspace_id       uuid           NOT NULL REFERENCES iam.workspace (id),
  loan_id            uuid           NOT NULL,
  -- Orden de registro dentro del préstamo (solo el ACTIVE de mayor número puede anularse).
  payment_no         integer        NOT NULL CHECK (payment_no >= 1),
  transaction_id     uuid           NOT NULL,
  account_id         uuid           NOT NULL,
  business_date      date           NOT NULL,
  amount             numeric(38,18) NOT NULL CHECK (amount > 0),
  principal          numeric(38,18) NOT NULL CHECK (principal >= 0),
  interest           numeric(38,18) NOT NULL CHECK (interest >= 0),
  fees               numeric(38,18) NOT NULL CHECK (fees >= 0),
  insurance          numeric(38,18) NOT NULL CHECK (insurance >= 0),
  taxes              numeric(38,18) NOT NULL CHECK (taxes >= 0),
  explicit_breakdown boolean        NOT NULL DEFAULT false,
  payment_method     text           NULL CHECK (payment_method IS NULL OR length(payment_method) <= 40),
  status             text           NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
  voided_at          timestamptz    NULL,
  voided_by          uuid           NULL,
  voided_reason      text           NULL CHECK (voided_reason IS NULL OR length(voided_reason) <= 500),
  created_by         uuid           NOT NULL,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT loan_payment_transaction_uk UNIQUE (transaction_id),
  CONSTRAINT loan_payment_no_uk UNIQUE (loan_id, payment_no),
  CONSTRAINT loan_payment_ws_id_uk UNIQUE (workspace_id, id),
  -- INV-016: Σ componentes = monto pagado.
  CONSTRAINT loan_payment_sum_ck CHECK (amount = principal + interest + fees + insurance + taxes),
  CONSTRAINT loan_payment_void_ck CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CONSTRAINT loan_payment_loan_fk FOREIGN KEY (workspace_id, loan_id) REFERENCES debt.loan (workspace_id, id)
);
CREATE INDEX loan_payment_loan_ix ON debt.loan_payment (loan_id, status, business_date);
CREATE INDEX loan_payment_ws_date_ix ON debt.loan_payment (workspace_id, business_date) WHERE status = 'ACTIVE';
COMMENT ON TABLE debt.loan_payment IS
  'Pago de un préstamo (una transacción LOAN_PAYMENT); INV-016: amount = Σ componentes. Solo cambia al anularse.';

-- ---------------------------------------------------------------- debt.loan_payment_allocation
CREATE TABLE debt.loan_payment_allocation (
  payment_id      uuid           NOT NULL,
  installment_id  uuid           NOT NULL,
  workspace_id    uuid           NOT NULL REFERENCES iam.workspace (id),
  loan_id         uuid           NOT NULL,
  installment_no  integer        NOT NULL CHECK (installment_no >= 1),
  principal       numeric(38,18) NOT NULL CHECK (principal >= 0),
  interest        numeric(38,18) NOT NULL CHECK (interest >= 0),
  fees            numeric(38,18) NOT NULL CHECK (fees >= 0),
  insurance       numeric(38,18) NOT NULL CHECK (insurance >= 0),
  taxes           numeric(38,18) NOT NULL CHECK (taxes >= 0),
  PRIMARY KEY (payment_id, installment_id),
  CONSTRAINT loan_payment_allocation_payment_fk FOREIGN KEY (workspace_id, payment_id)
    REFERENCES debt.loan_payment (workspace_id, id),
  CONSTRAINT loan_payment_allocation_installment_fk FOREIGN KEY (workspace_id, installment_id)
    REFERENCES debt.loan_installment (workspace_id, id)
);
CREATE INDEX loan_payment_allocation_loan_ix ON debt.loan_payment_allocation (loan_id, installment_no);
COMMENT ON TABLE debt.loan_payment_allocation IS
  'Imputación de un pago a una cuota por componente; el estado de la cuota se deriva de las imputaciones de pagos ACTIVE.';
CREATE TRIGGER loan_payment_allocation_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_payment_allocation
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_payment_allocation_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_payment_allocation
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.loan_reference_schedule / loan_reference_row
CREATE TABLE debt.loan_reference_schedule (
  id                 uuid        PRIMARY KEY,
  workspace_id       uuid        NOT NULL REFERENCES iam.workspace (id),
  loan_id            uuid        NOT NULL,
  reference_version  integer     NOT NULL CHECK (reference_version >= 1),
  source             text        NOT NULL CHECK (source IN ('CSV', 'PASTE', 'MANUAL')),
  mapping            jsonb       NULL,
  row_count          integer     NOT NULL CHECK (row_count BETWEEN 1 AND 600),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  CONSTRAINT loan_reference_schedule_uk UNIQUE (loan_id, reference_version),
  CONSTRAINT loan_reference_schedule_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT loan_reference_schedule_loan_fk FOREIGN KEY (workspace_id, loan_id) REFERENCES debt.loan (workspace_id, id)
);
COMMENT ON TABLE debt.loan_reference_schedule IS
  'Tabla de amortización del banco cargada como referencia (append-only). El archivo original NO se guarda, solo las filas parseadas.';
CREATE TRIGGER loan_reference_schedule_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_reference_schedule
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_reference_schedule_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_reference_schedule
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

CREATE TABLE debt.loan_reference_row (
  reference_id    uuid           NOT NULL,
  workspace_id    uuid           NOT NULL REFERENCES iam.workspace (id),
  installment_no  integer        NOT NULL CHECK (installment_no >= 1),
  due_date        date           NOT NULL,
  principal       numeric(38,18) NOT NULL CHECK (principal >= 0),
  interest        numeric(38,18) NOT NULL CHECK (interest >= 0),
  fees            numeric(38,18) NOT NULL CHECK (fees >= 0),
  insurance       numeric(38,18) NOT NULL CHECK (insurance >= 0),
  taxes           numeric(38,18) NOT NULL CHECK (taxes >= 0),
  total           numeric(38,18) NOT NULL CHECK (total >= 0),
  balance         numeric(38,18) NULL CHECK (balance IS NULL OR balance >= 0),
  PRIMARY KEY (reference_id, installment_no),
  CONSTRAINT loan_reference_row_ref_fk FOREIGN KEY (workspace_id, reference_id)
    REFERENCES debt.loan_reference_schedule (workspace_id, id)
);
CREATE TRIGGER loan_reference_row_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.loan_reference_row
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER loan_reference_row_no_truncate_trg
  BEFORE TRUNCATE ON debt.loan_reference_row
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.loan_schedule_comparison
CREATE TABLE debt.loan_schedule_comparison (
  id                    uuid        PRIMARY KEY,
  workspace_id          uuid        NOT NULL REFERENCES iam.workspace (id),
  loan_id               uuid        NOT NULL,
  reference_id          uuid        NOT NULL,
  -- 0 = vista previa del borrador (aún sin cronograma fijado).
  schedule_version      integer     NOT NULL CHECK (schedule_version >= 0),
  matched               integer     NOT NULL CHECK (matched >= 0),
  total_rows            integer     NOT NULL CHECK (total_rows >= 0),
  first_difference_no   integer     NULL,
  summary               jsonb       NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  status                text        NOT NULL CHECK (status IN ('MATCH', 'UNEXPLAINED', 'EXPLAINED')),
  explanation           text        NULL CHECK (explanation IS NULL OR length(explanation) BETWEEN 1 AND 1000),
  explained_by          uuid        NULL,
  explained_at          timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loan_schedule_comparison_uk UNIQUE (reference_id, schedule_version),
  CONSTRAINT loan_schedule_comparison_explained_ck CHECK ((status = 'EXPLAINED') = (explanation IS NOT NULL)),
  CONSTRAINT loan_schedule_comparison_ref_fk FOREIGN KEY (workspace_id, reference_id)
    REFERENCES debt.loan_reference_schedule (workspace_id, id),
  CONSTRAINT loan_schedule_comparison_loan_fk FOREIGN KEY (workspace_id, loan_id)
    REFERENCES debt.loan (workspace_id, id)
);
COMMENT ON TABLE debt.loan_schedule_comparison IS
  'Resultado de comparar una referencia del banco con el cronograma (exit criterion de Phase 4): MATCH, UNEXPLAINED o EXPLAINED.';

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE debt.loan ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_schedule_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_schedule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_installment ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_installment FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_payment FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_payment_allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_reference_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_reference_schedule FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_reference_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_reference_row FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_schedule_comparison ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.loan_schedule_comparison FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON debt.loan TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_schedule_version TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_installment TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_payment TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_payment_allocation TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_reference_schedule TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_reference_row TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.loan_schedule_comparison TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA debt FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON debt.loan TO pf_app;
GRANT SELECT, INSERT ON debt.loan_schedule_version TO pf_app;
GRANT SELECT, INSERT ON debt.loan_installment TO pf_app;
GRANT SELECT, INSERT, UPDATE ON debt.loan_payment TO pf_app;
GRANT SELECT, INSERT ON debt.loan_payment_allocation TO pf_app;
GRANT SELECT, INSERT ON debt.loan_reference_schedule TO pf_app;
GRANT SELECT, INSERT ON debt.loan_reference_row TO pf_app;
GRANT SELECT, INSERT, UPDATE ON debt.loan_schedule_comparison TO pf_app;

-- Purga del workspace demo (ADR-0026): hijas antes que padres (allocation → payment/installment → versión → préstamo).
SELECT platform.register_workspace_scoped_table('debt.loan_payment_allocation'::regclass, 180, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_payment'::regclass, 181, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_schedule_comparison'::regclass, 181, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_reference_row'::regclass, 181, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_reference_schedule'::regclass, 182, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_installment'::regclass, 182, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan_schedule_version'::regclass, 183, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.loan'::regclass, 184, 'DELETE');

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + Loan.
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringDefinition', rd.id, rd.status
      FROM commitments.recurring_definition rd WHERE rd.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringOccurrence', ro.id, ro.status
      FROM commitments.recurring_occurrence ro WHERE ro.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Subscription', s.id, s.status
      FROM commitments.subscription s WHERE s.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Loan', l.id, l.status
      FROM debt.loan l WHERE l.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringDefinition', rd.id, rd.status
      FROM commitments.recurring_definition rd WHERE rd.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringOccurrence', ro.id, ro.status
      FROM commitments.recurring_occurrence ro WHERE ro.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Subscription', s.id, s.status
      FROM commitments.subscription s WHERE s.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'debt';
DROP TABLE debt.loan_schedule_comparison;
DROP TABLE debt.loan_reference_row;
DROP TABLE debt.loan_reference_schedule;
DROP TABLE debt.loan_payment_allocation;
DROP TABLE debt.loan_payment;
DROP TABLE debt.loan_installment;
DROP TABLE debt.loan_schedule_version;
DROP TABLE debt.loan;
DROP SCHEMA debt;
