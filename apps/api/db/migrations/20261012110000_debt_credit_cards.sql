-- DEBT: tarjetas de crédito (openspec add-credit-cards, tarea 4.1; design.md § Modelo de datos; docs/08 §5.9).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`. El schema `debt` ya existe (add-loans).
--
--   * debt.credit_card             WS: SELECT/INSERT/UPDATE. Perfil de la tarjeta (nombre, límites, umbrales, recordatorio,
--     tasa informativa, estado ACTIVE/ARCHIVED). Sin DELETE: se conserva como historia.
--   * debt.credit_card_terms       WS-RO: versiones de los términos del calendario (día de cierre/vencimiento y ajuste);
--     append-only (`forbid_mutation`): un cambio agrega una versión con su fecha de vigencia.
--   * debt.credit_card_account     WS: una cuenta `credit_card` por moneda de la tarjeta, con su límite, regla de pago
--     mínimo y plan de pago administrado. `card_status` denormalizado para el índice único parcial (una cuenta pertenece a
--     lo sumo a una tarjeta ACTIVA).
--   * debt.card_statement          WS: estado de cuenta emitido UNA vez por (cuenta, cierre) con las cifras congeladas;
--     solo cambian el estado listado y los montos informados por el banco (UPDATE por columnas).
--   * debt.card_installment_plan / card_installment   WS: plan de cuotas de una compra y sus cuotas (las no facturadas
--     se reasignan al cambiar los términos; las facturadas no cambian).
--   * debt.card_utilization_state  WS: umbral armado/desarmado por (tarjeta, ámbito, umbral).
--   * debt.card_utilization_crossing / card_reminder   WS-RO: cruces de umbral y recordatorios emitidos (append-only).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), hijas antes que padres.
-- Referencias a otros schemas (cuentas, transacciones, definición recurrente) son lógicas, sin FK (NFR-DATA-015).
-- `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas.

-- migrate:up

-- ---------------------------------------------------------------- debt.credit_card
CREATE TABLE debt.credit_card (
  id                    uuid           PRIMARY KEY,
  workspace_id          uuid           NOT NULL REFERENCES iam.workspace (id),
  name                  text           NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  limit_mode            text           NOT NULL CHECK (limit_mode IN ('SEPARATE', 'SHARED')),
  shared_limit_amount   numeric(38,18) NULL CHECK (shared_limit_amount IS NULL OR shared_limit_amount > 0),
  shared_limit_currency varchar(16)    NULL REFERENCES fx.currency (code),
  -- Porcentaje nominal anual informativo (0.00 a 999.99); NO se usa para calcular intereses (RISK-005).
  annual_rate           numeric(9,4)   NULL CHECK (annual_rate IS NULL OR annual_rate BETWEEN 0 AND 999.99),
  utilization_thresholds numeric(5,2)[] NOT NULL DEFAULT ARRAY[30.00, 80.00]::numeric(5,2)[],
  reminder_days         smallint       NOT NULL DEFAULT 3 CHECK (reminder_days BETWEEN 1 AND 30),
  status                text           NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  archived_at           timestamptz    NULL,
  version               integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by            uuid           NOT NULL,
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT credit_card_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT credit_card_limit_ck CHECK (
    (limit_mode = 'SHARED') = (shared_limit_amount IS NOT NULL AND shared_limit_currency IS NOT NULL)),
  CONSTRAINT credit_card_thresholds_ck CHECK (
    cardinality(utilization_thresholds) BETWEEN 1 AND 3
    AND 0.01 <= ALL (utilization_thresholds) AND 100 >= ALL (utilization_thresholds)),
  CONSTRAINT credit_card_archived_ck CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX credit_card_name_active_uk ON debt.credit_card (workspace_id, lower(name)) WHERE status = 'ACTIVE';
CREATE INDEX credit_card_ws_status_ix ON debt.credit_card (workspace_id, status);
COMMENT ON TABLE debt.credit_card IS
  'Perfil de una tarjeta de crédito sobre cuentas credit_card existentes (debt/credit-cards, FR-DEBT-012). Sin máquina de estados (D178).';

-- ---------------------------------------------------------------- debt.credit_card_terms
CREATE TABLE debt.credit_card_terms (
  workspace_id            uuid        NOT NULL REFERENCES iam.workspace (id),
  card_id                 uuid        NOT NULL,
  -- Secuencia de versiones; la última versión con la misma fecha de vigencia manda.
  seq                     integer     NOT NULL CHECK (seq >= 1),
  -- La primera versión rige desde siempre (0001-01-01) para poder consultar ciclos previos al registro.
  effective_from          date        NOT NULL,
  statement_day           smallint    NOT NULL CHECK (statement_day BETWEEN 1 AND 31),
  due_day                 smallint    NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  due_weekend_adjustment  text        NOT NULL DEFAULT 'NONE' CHECK (due_weekend_adjustment IN ('NONE', 'PREVIOUS', 'NEXT')),
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  recorded_by             uuid        NOT NULL,
  PRIMARY KEY (card_id, seq),
  CONSTRAINT credit_card_terms_card_fk FOREIGN KEY (workspace_id, card_id) REFERENCES debt.credit_card (workspace_id, id)
);
COMMENT ON TABLE debt.credit_card_terms IS
  'Versiones de los términos del calendario de la tarjeta; WS-RO con forbid_mutation (PF003): los estados emitidos no cambian sus fechas.';
CREATE TRIGGER credit_card_terms_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.credit_card_terms
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER credit_card_terms_no_truncate_trg
  BEFORE TRUNCATE ON debt.credit_card_terms
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.credit_card_account
CREATE TABLE debt.credit_card_account (
  id                       uuid           PRIMARY KEY,
  workspace_id             uuid           NOT NULL REFERENCES iam.workspace (id),
  card_id                  uuid           NOT NULL,
  account_id               uuid           NOT NULL,
  currency                 varchar(16)    NOT NULL REFERENCES fx.currency (code),
  -- Solo con límite separado.
  credit_limit_amount      numeric(38,18) NULL CHECK (credit_limit_amount IS NULL OR credit_limit_amount > 0),
  minimum_rule_type        text           NOT NULL CHECK (minimum_rule_type IN ('PERCENT', 'FIXED')),
  minimum_percent          numeric(5,2)   NULL,
  minimum_floor_amount     numeric(38,18) NULL CHECK (minimum_floor_amount IS NULL OR minimum_floor_amount >= 0),
  minimum_amount           numeric(38,18) NULL,
  -- Plan de pago administrado (definición CARD_PAYMENT en COMMITMENTS).
  plan_source_account_id   uuid           NULL,
  plan_policy              text           NULL CHECK (plan_policy IS NULL OR plan_policy IN ('NO_INTEREST', 'MINIMUM')),
  plan_materialization     jsonb          NULL CHECK (plan_materialization IS NULL OR jsonb_typeof(plan_materialization) = 'object'),
  plan_definition_id       uuid           NULL,
  plan_enabled_at          timestamptz    NULL,
  -- Denormalizado de debt.credit_card.status para el índice único parcial.
  card_status              text           NOT NULL DEFAULT 'ACTIVE' CHECK (card_status IN ('ACTIVE', 'ARCHIVED')),
  version                  integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT credit_card_account_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT credit_card_account_currency_uk UNIQUE (card_id, currency),
  CONSTRAINT credit_card_account_account_uk UNIQUE (card_id, account_id),
  CONSTRAINT credit_card_account_minimum_ck CHECK (
    (minimum_rule_type = 'PERCENT' AND minimum_percent BETWEEN 0.01 AND 100 AND minimum_amount IS NULL)
    OR (minimum_rule_type = 'FIXED' AND minimum_amount > 0 AND minimum_percent IS NULL AND minimum_floor_amount IS NULL)),
  CONSTRAINT credit_card_account_plan_ck CHECK (
    (plan_definition_id IS NULL) = (plan_source_account_id IS NULL)
    AND (plan_definition_id IS NULL) = (plan_policy IS NULL)
    AND (plan_definition_id IS NULL) = (plan_enabled_at IS NULL)),
  CONSTRAINT credit_card_account_card_fk FOREIGN KEY (workspace_id, card_id) REFERENCES debt.credit_card (workspace_id, id)
);
-- Una cuenta pertenece a lo sumo a una tarjeta ACTIVA (CREDIT_CARD_ACCOUNT_IN_USE); archivar la libera.
CREATE UNIQUE INDEX credit_card_account_active_uk ON debt.credit_card_account (workspace_id, account_id)
  WHERE card_status = 'ACTIVE';
CREATE INDEX credit_card_account_account_ix ON debt.credit_card_account (workspace_id, account_id);
COMMENT ON TABLE debt.credit_card_account IS
  'Cuenta credit_card de una tarjeta (una por moneda): límite, regla de pago mínimo y plan de pago administrado.';

-- ---------------------------------------------------------------- debt.card_statement
CREATE TABLE debt.card_statement (
  id                       uuid           PRIMARY KEY,
  workspace_id             uuid           NOT NULL REFERENCES iam.workspace (id),
  card_account_id          uuid           NOT NULL,
  cycle_start              date           NOT NULL,
  closing_date             date           NOT NULL,
  due_date                 date           NOT NULL,
  nominal_due_date         date           NOT NULL,
  currency                 varchar(16)    NOT NULL REFERENCES fx.currency (code),
  previous_balance         numeric(38,18) NOT NULL,
  purchases                numeric(38,18) NOT NULL,
  refunds                  numeric(38,18) NOT NULL,
  payments                 numeric(38,18) NOT NULL,
  other_net                numeric(38,18) NOT NULL,
  closing_balance          numeric(38,18) NOT NULL,
  unbilled_installments    numeric(38,18) NOT NULL DEFAULT 0 CHECK (unbilled_installments >= 0),
  billed_balance           numeric(38,18) NOT NULL,
  minimum_due              numeric(38,18) NOT NULL CHECK (minimum_due >= 0),
  reported_billed_balance  numeric(38,18) NULL,
  reported_minimum_due     numeric(38,18) NULL CHECK (reported_minimum_due IS NULL OR reported_minimum_due >= 0),
  -- Último estado calculado (solo para listar y filtrar; el estado vigente se calcula al leer).
  status                   text           NOT NULL DEFAULT 'ISSUED'
                             CHECK (status IN ('ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE')),
  issued_at                timestamptz    NOT NULL DEFAULT now(),
  event_id                 uuid           NULL,
  version                  integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT card_statement_ws_id_uk UNIQUE (workspace_id, id),
  -- Emisión única por (cuenta, cierre): el job y el alta la repiten sin duplicar.
  CONSTRAINT card_statement_closing_uk UNIQUE (card_account_id, closing_date),
  CONSTRAINT card_statement_dates_ck CHECK (closing_date >= cycle_start AND due_date >= closing_date),
  CONSTRAINT card_statement_billed_ck CHECK (billed_balance = closing_balance - unbilled_installments),
  CONSTRAINT card_statement_account_fk FOREIGN KEY (workspace_id, card_account_id)
    REFERENCES debt.credit_card_account (workspace_id, id)
);
CREATE INDEX card_statement_ws_due_ix ON debt.card_statement (workspace_id, due_date);
COMMENT ON TABLE debt.card_statement IS
  'Estado de cuenta emitido una vez por (cuenta, cierre) con las cifras congeladas (INV-022: derivadas del ledger al emitir).';

-- ---------------------------------------------------------------- debt.card_installment_plan / card_installment
CREATE TABLE debt.card_installment_plan (
  id                       uuid           PRIMARY KEY,
  workspace_id             uuid           NOT NULL REFERENCES iam.workspace (id),
  card_account_id          uuid           NOT NULL,
  purchase_transaction_id  uuid           NOT NULL,
  purchase_date            date           NOT NULL,
  principal                numeric(38,18) NOT NULL CHECK (principal > 0),
  currency                 varchar(16)    NOT NULL REFERENCES fx.currency (code),
  installment_count        smallint       NOT NULL CHECK (installment_count BETWEEN 2 AND 60),
  annual_rate              numeric(9,4)   NOT NULL DEFAULT 0 CHECK (annual_rate >= 0),
  start_cycle              text           NOT NULL DEFAULT 'PURCHASE' CHECK (start_cycle IN ('PURCHASE', 'NEXT')),
  status                   text           NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  cancel_reason            text           NULL CHECK (cancel_reason IS NULL OR cancel_reason IN
                             ('PURCHASE_VOIDED', 'PURCHASE_REVISED', 'USER')),
  created_by               uuid           NOT NULL,
  created_at               timestamptz    NOT NULL DEFAULT now(),
  updated_at               timestamptz    NOT NULL DEFAULT now(),
  version                  integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT card_installment_plan_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT card_installment_plan_cancel_ck CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL)),
  CONSTRAINT card_installment_plan_account_fk FOREIGN KEY (workspace_id, card_account_id)
    REFERENCES debt.credit_card_account (workspace_id, id)
);
-- Una compra tiene a lo sumo un plan vigente (INSTALLMENT_PLAN_INVALID).
CREATE UNIQUE INDEX card_installment_plan_purchase_uk ON debt.card_installment_plan (workspace_id, purchase_transaction_id)
  WHERE status <> 'CANCELLED';
CREATE INDEX card_installment_plan_account_ix ON debt.card_installment_plan (workspace_id, card_account_id, status);

CREATE TABLE debt.card_installment (
  workspace_id          uuid           NOT NULL REFERENCES iam.workspace (id),
  plan_id               uuid           NOT NULL,
  n                     smallint       NOT NULL CHECK (n >= 1),
  billing_closing_date  date           NOT NULL,
  due_date              date           NOT NULL,
  nominal_due_date      date           NOT NULL,
  principal             numeric(38,18) NOT NULL CHECK (principal >= 0),
  interest              numeric(38,18) NOT NULL CHECK (interest >= 0),
  total                 numeric(38,18) NOT NULL,
  PRIMARY KEY (plan_id, n),
  CONSTRAINT card_installment_total_ck CHECK (total = principal + interest),
  CONSTRAINT card_installment_plan_fk FOREIGN KEY (workspace_id, plan_id)
    REFERENCES debt.card_installment_plan (workspace_id, id)
);
CREATE INDEX card_installment_billing_ix ON debt.card_installment (workspace_id, billing_closing_date);
COMMENT ON TABLE debt.card_installment IS
  'Cuota de un plan de la tarjeta: el capital se descuenta del saldo facturado hasta su ciclo; el interés es solo proyección.';

-- ---------------------------------------------------------------- debt.card_utilization_state / crossing
CREATE TABLE debt.card_utilization_state (
  workspace_id  uuid         NOT NULL REFERENCES iam.workspace (id),
  card_id       uuid         NOT NULL,
  -- 'SHARED' o el id de la cuenta de la tarjeta (ámbito del límite separado).
  scope_key     text         NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 64),
  threshold     numeric(5,2) NOT NULL CHECK (threshold BETWEEN 0.01 AND 100),
  armed         boolean      NOT NULL,
  crossing_no   integer      NOT NULL DEFAULT 0 CHECK (crossing_no >= 0),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, scope_key, threshold),
  CONSTRAINT card_utilization_state_card_fk FOREIGN KEY (workspace_id, card_id)
    REFERENCES debt.credit_card (workspace_id, id)
);

CREATE TABLE debt.card_utilization_crossing (
  workspace_id  uuid         NOT NULL REFERENCES iam.workspace (id),
  card_id       uuid         NOT NULL,
  scope_key     text         NOT NULL,
  threshold     numeric(5,2) NOT NULL,
  crossing_no   integer      NOT NULL CHECK (crossing_no >= 1),
  utilization   numeric(9,4) NOT NULL,
  crossed_at    timestamptz  NOT NULL,
  -- Solo el umbral más alto de un cambio lleva el hecho; los demás cruzados en el mismo cambio no tienen evento propio.
  event_id      uuid         NULL,
  PRIMARY KEY (card_id, scope_key, threshold, crossing_no),
  CONSTRAINT card_utilization_crossing_card_fk FOREIGN KEY (workspace_id, card_id)
    REFERENCES debt.credit_card (workspace_id, id)
);
COMMENT ON TABLE debt.card_utilization_crossing IS
  'Cruces de umbral de utilización (append-only): un hecho por cambio, con el umbral más alto.';
CREATE TRIGGER card_utilization_crossing_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.card_utilization_crossing
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER card_utilization_crossing_no_truncate_trg
  BEFORE TRUNCATE ON debt.card_utilization_crossing
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- debt.card_reminder
CREATE TABLE debt.card_reminder (
  workspace_id     uuid        NOT NULL REFERENCES iam.workspace (id),
  card_account_id  uuid        NOT NULL,
  closing_date     date        NOT NULL,
  due_date         date        NOT NULL,
  emitted_at       timestamptz NOT NULL DEFAULT now(),
  event_id         uuid        NOT NULL,
  -- Un recordatorio por (cuenta, cierre): el job repetido no publica un segundo hecho.
  PRIMARY KEY (workspace_id, card_account_id, closing_date),
  CONSTRAINT card_reminder_account_fk FOREIGN KEY (workspace_id, card_account_id)
    REFERENCES debt.credit_card_account (workspace_id, id)
);
COMMENT ON TABLE debt.card_reminder IS 'Recordatorios de vencimiento emitidos (append-only), una vez por cuenta y cierre.';
CREATE TRIGGER card_reminder_immutable_trg
  BEFORE UPDATE OR DELETE ON debt.card_reminder
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER card_reminder_no_truncate_trg
  BEFORE TRUNCATE ON debt.card_reminder
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE debt.credit_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.credit_card FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.credit_card_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.credit_card_terms FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.credit_card_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.credit_card_account FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_statement FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_installment_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_installment_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_installment ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_installment FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_utilization_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_utilization_state FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_utilization_crossing ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_utilization_crossing FORCE ROW LEVEL SECURITY;
ALTER TABLE debt.card_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt.card_reminder FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON debt.credit_card TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.credit_card_terms TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.credit_card_account TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_statement TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_installment_plan TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_installment TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_utilization_state TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_utilization_crossing TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON debt.card_reminder TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

GRANT SELECT, INSERT, UPDATE ON debt.credit_card TO pf_app;
GRANT SELECT, INSERT ON debt.credit_card_terms TO pf_app;
GRANT SELECT, INSERT, UPDATE ON debt.credit_card_account TO pf_app;
GRANT SELECT, INSERT ON debt.card_statement TO pf_app;
-- Del estado de cuenta solo cambian el estado listado, los montos informados por el banco y la versión.
GRANT UPDATE (status, reported_billed_balance, reported_minimum_due, version) ON debt.card_statement TO pf_app;
GRANT SELECT, INSERT, UPDATE ON debt.card_installment_plan TO pf_app;
GRANT SELECT, INSERT, UPDATE ON debt.card_installment TO pf_app;
-- Las cuotas no facturadas se reasignan al cambiar los términos; nunca se borran filas sueltas.
GRANT SELECT, INSERT, UPDATE, DELETE ON debt.card_utilization_state TO pf_app;
GRANT SELECT, INSERT ON debt.card_utilization_crossing TO pf_app;
GRANT SELECT, INSERT ON debt.card_reminder TO pf_app;

-- Purga del workspace demo (ADR-0026): hijas antes que padres.
SELECT platform.register_workspace_scoped_table('debt.card_reminder'::regclass, 190, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.card_utilization_crossing'::regclass, 190, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.card_utilization_state'::regclass, 190, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.card_installment'::regclass, 191, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.card_installment_plan'::regclass, 192, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.card_statement'::regclass, 192, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.credit_card_terms'::regclass, 192, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.credit_card_account'::regclass, 193, 'DELETE');
SELECT platform.register_workspace_scoped_table('debt.credit_card'::regclass, 194, 'DELETE');

-- migrate:down
DROP TABLE debt.card_reminder;
DROP TABLE debt.card_utilization_crossing;
DROP TABLE debt.card_utilization_state;
DROP TABLE debt.card_installment;
DROP TABLE debt.card_installment_plan;
DROP TABLE debt.card_statement;
DROP TABLE debt.credit_card_account;
DROP TABLE debt.credit_card_terms;
DROP TABLE debt.credit_card;
