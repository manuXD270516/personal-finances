-- GOALS: metas de ahorro (openspec add-savings-goals, tarea 4.2; design.md § Modelo de datos; docs/08 §5.8).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * goals.savings_goal             WS: SELECT/INSERT/UPDATE. La meta y su máquina de estados (`ACTIVE`, `PAUSED`,
--     `ACHIEVED`, `CLOSED`, `CANCELLED`). Sin DELETE: se conserva como historia (se archiva).
--   * goals.goal_linked_account      WS: SELECT/INSERT/DELETE. Cuentas (activos) vinculadas a la meta; se desvincula
--     solo sin fondos reales.
--   * goals.goal_movement            WS-RO: SELECT/INSERT + `platform.forbid_mutation()`. Fuente única del progreso
--     (INV-018): aportes, reservas, retiros, liberaciones, inversos y reasignaciones; monto firmado en la moneda de la cuenta.
--   * goals.goal_plan                WS: SELECT/INSERT/UPDATE/DELETE. Aporte mensual planificado y su programación.
--   * goals.account_reservation_state WS: SELECT/INSERT/UPDATE. Candado por cuenta (serializa reservas) y episodio de
--     sobre-asignación vigente.
--   * goals.recurring_materialization WS: SELECT/INSERT/UPDATE. Aportes recurrentes materializados que esperan su
--     transferencia posteada.
--   * goals.contribution_suggestion  WS: SELECT/INSERT/UPDATE. Sugerencia de registrar una transferencia como aporte.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), hijas antes que padres.
--   * audit.lifecycle_state_divergences(): cubre también `SavingsGoal`.
-- Referencias a otros schemas (cuentas, transacciones, definición recurrente) son lógicas, sin FK (NFR-DATA-015).
-- `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas.

-- migrate:up
CREATE SCHEMA goals;
GRANT USAGE ON SCHEMA goals TO pf_app;

-- ---------------------------------------------------------------- goals.savings_goal
CREATE TABLE goals.savings_goal (
  id                uuid           PRIMARY KEY,
  workspace_id      uuid           NOT NULL REFERENCES iam.workspace (id),
  name              text           NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  goal_type         text           NOT NULL CHECK (goal_type IN
                      ('EMERGENCY_FUND', 'PURCHASE', 'TRAVEL', 'EDUCATION', 'RETIREMENT', 'CUSTOM')),
  target_amount     numeric(38,18) NOT NULL CHECK (target_amount > 0),
  currency          varchar(16)    NOT NULL REFERENCES fx.currency (code),
  start_date        date           NOT NULL,
  target_date       date           NULL,
  priority          smallint       NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  icon              text           NULL CHECK (icon IS NULL OR length(icon) <= 40),
  color             text           NULL CHECK (color IS NULL OR length(color) <= 32),
  notes             text           NULL CHECK (notes IS NULL OR length(notes) <= 2000),
  tolerance_percent numeric(5,2)   NOT NULL DEFAULT 5.00 CHECK (tolerance_percent BETWEEN 0 AND 50),
  pace_periods      smallint       NOT NULL DEFAULT 3 CHECK (pace_periods BETWEEN 1 AND 12),
  status            text           NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'ACHIEVED', 'CLOSED', 'CANCELLED')),
  achieved_on       date           NULL,
  closed_on         date           NULL,
  cancelled_on      date           NULL,
  cancel_reason     text           NULL CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  archived_at       timestamptz    NULL,
  version           integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        uuid           NOT NULL,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_by        uuid           NOT NULL,
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT savings_goal_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT savings_goal_dates_ck CHECK (target_date IS NULL OR target_date > start_date),
  CONSTRAINT savings_goal_archive_ck CHECK (archived_at IS NULL OR status IN ('CLOSED', 'CANCELLED'))
);
-- El nombre es único (sin distinguir mayúsculas) entre las metas no archivadas del workspace.
CREATE UNIQUE INDEX savings_goal_name_uk ON goals.savings_goal (workspace_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX savings_goal_ws_status_ix ON goals.savings_goal (workspace_id, status);
COMMENT ON TABLE goals.savings_goal IS
  'Meta de ahorro (goals/savings-goals, FR-GOALS-001). Estados ACTIVE, PAUSED, ACHIEVED, CLOSED, CANCELLED. Sin progreso persistido: se deriva de goals.goal_movement.';

-- ---------------------------------------------------------------- goals.goal_linked_account
CREATE TABLE goals.goal_linked_account (
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  goal_id      uuid        NOT NULL,
  account_id   uuid        NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  linked_by    uuid        NOT NULL,
  PRIMARY KEY (workspace_id, goal_id, account_id),
  CONSTRAINT goal_linked_account_goal_fk FOREIGN KEY (workspace_id, goal_id)
    REFERENCES goals.savings_goal (workspace_id, id)
);
CREATE INDEX goal_linked_account_account_ix ON goals.goal_linked_account (workspace_id, account_id);

-- ---------------------------------------------------------------- goals.goal_movement
CREATE TABLE goals.goal_movement (
  id                    uuid           PRIMARY KEY,
  workspace_id          uuid           NOT NULL REFERENCES iam.workspace (id),
  goal_id               uuid           NOT NULL,
  fund                  text           NOT NULL CHECK (fund IN ('REAL', 'EARMARK')),
  movement              text           NOT NULL CHECK (movement IN
                          ('CONTRIBUTION', 'WITHDRAWAL', 'REVERSAL', 'REASSIGN_IN', 'REASSIGN_OUT')),
  -- Firmado, en la moneda de la cuenta (CONTRIBUTION y REASSIGN_IN > 0; WITHDRAWAL y REASSIGN_OUT < 0; REVERSAL opuesto).
  amount                numeric(38,18) NOT NULL,
  currency              varchar(16)    NOT NULL REFERENCES fx.currency (code),
  account_id            uuid           NOT NULL,
  occurred_on           date           NOT NULL,
  transaction_id        uuid           NULL,
  transaction_revision  integer        NULL CHECK (transaction_revision IS NULL OR transaction_revision >= 1),
  reverses_id           uuid           NULL REFERENCES goals.goal_movement (id),
  reassignment_id       uuid           NULL,
  origin                text           NOT NULL CHECK (origin IN ('USER', 'RECURRING', 'SUGGESTION', 'SYSTEM')),
  note                  text           NULL CHECK (note IS NULL OR length(note) <= 500),
  recorded_at           timestamptz    NOT NULL DEFAULT now(),
  recorded_by           uuid           NOT NULL,
  CONSTRAINT goal_movement_goal_fk FOREIGN KEY (workspace_id, goal_id)
    REFERENCES goals.savings_goal (workspace_id, id),
  CONSTRAINT goal_movement_sign_ck CHECK (
    (movement IN ('CONTRIBUTION', 'REASSIGN_IN') AND amount > 0)
    OR (movement IN ('WITHDRAWAL', 'REASSIGN_OUT') AND amount < 0)
    OR (movement = 'REVERSAL' AND amount <> 0)),
  -- Una reserva nunca respalda una transacción; un aporte o retiro real siempre.
  CONSTRAINT goal_movement_transaction_ck CHECK (
    (fund = 'EARMARK' AND transaction_id IS NULL AND transaction_revision IS NULL)
    OR (fund = 'REAL' AND movement IN ('REASSIGN_IN', 'REASSIGN_OUT', 'REVERSAL'))
    OR (fund = 'REAL' AND movement IN ('CONTRIBUTION', 'WITHDRAWAL')
        AND transaction_id IS NOT NULL AND transaction_revision IS NOT NULL)),
  CONSTRAINT goal_movement_reversal_ck CHECK ((movement = 'REVERSAL') = (reverses_id IS NOT NULL)),
  CONSTRAINT goal_movement_reassign_ck CHECK (
    (movement IN ('REASSIGN_IN', 'REASSIGN_OUT')) = (reassignment_id IS NOT NULL)),
  CONSTRAINT goal_movement_reverses_uk UNIQUE (reverses_id)
);
-- Una transferencia respalda como máximo un aporte real por revisión (de cualquier meta); un retiro por meta.
CREATE UNIQUE INDEX goal_movement_contribution_tx_uk
  ON goals.goal_movement (workspace_id, transaction_id, transaction_revision)
  WHERE movement = 'CONTRIBUTION' AND fund = 'REAL';
CREATE UNIQUE INDEX goal_movement_withdrawal_tx_uk
  ON goals.goal_movement (workspace_id, transaction_id, transaction_revision, goal_id)
  WHERE movement = 'WITHDRAWAL' AND fund = 'REAL';
CREATE INDEX goal_movement_goal_date_ix ON goals.goal_movement (workspace_id, goal_id, occurred_on);
CREATE INDEX goal_movement_account_ix ON goals.goal_movement (workspace_id, account_id);
CREATE INDEX goal_movement_transaction_ix ON goals.goal_movement (workspace_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
COMMENT ON TABLE goals.goal_movement IS
  'Movimiento de una meta, append-only (INV-018): saldo acumulado = Σ amount; toda corrección es un movimiento inverso. WS-RO con forbid_mutation (PF003).';
CREATE TRIGGER goal_movement_immutable_trg
  BEFORE UPDATE OR DELETE ON goals.goal_movement
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER goal_movement_no_truncate_trg
  BEFORE TRUNCATE ON goals.goal_movement
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- goals.goal_plan
CREATE TABLE goals.goal_plan (
  goal_id                uuid           PRIMARY KEY,
  workspace_id           uuid           NOT NULL REFERENCES iam.workspace (id),
  monthly_amount         numeric(38,18) NOT NULL CHECK (monthly_amount > 0),
  currency               varchar(16)    NOT NULL REFERENCES fx.currency (code),
  fund                   text           NOT NULL CHECK (fund IN ('REAL', 'EARMARK')),
  source_account_id      uuid           NULL,
  destination_account_id uuid           NULL,
  day_of_month           smallint       NULL CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  automation             text           NOT NULL DEFAULT 'NONE' CHECK (automation IN ('NONE', 'RECURRING')),
  materialization_mode   text           NULL CHECK (materialization_mode IS NULL OR materialization_mode IN
                           ('PENDING_APPROVAL', 'AUTO_CREATE')),
  auto_create_status     text           NULL CHECK (auto_create_status IS NULL OR auto_create_status IN
                           ('PENDING', 'POSTED')),
  definition_id          uuid           NULL,
  version                integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT goal_plan_goal_fk FOREIGN KEY (workspace_id, goal_id) REFERENCES goals.savings_goal (workspace_id, id),
  CONSTRAINT goal_plan_automation_ck CHECK (
    automation = 'NONE'
    OR (fund = 'REAL' AND definition_id IS NOT NULL AND materialization_mode IS NOT NULL
        AND source_account_id IS NOT NULL AND destination_account_id IS NOT NULL AND day_of_month IS NOT NULL))
);
CREATE INDEX goal_plan_definition_ix ON goals.goal_plan (workspace_id, definition_id) WHERE definition_id IS NOT NULL;

-- ---------------------------------------------------------------- goals.account_reservation_state
CREATE TABLE goals.account_reservation_state (
  workspace_id uuid           NOT NULL REFERENCES iam.workspace (id),
  account_id   uuid           NOT NULL,
  state        text           NOT NULL DEFAULT 'NORMAL' CHECK (state IN ('NORMAL', 'OVER_ALLOCATED')),
  episode_id   uuid           NULL,
  since        date           NULL,
  shortfall    numeric(38,18) NULL CHECK (shortfall IS NULL OR shortfall > 0),
  currency     varchar(16)    NULL REFERENCES fx.currency (code),
  evaluated_at timestamptz    NULL,
  version      integer        NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (workspace_id, account_id),
  CONSTRAINT account_reservation_state_ck CHECK (
    (state = 'OVER_ALLOCATED') = (episode_id IS NOT NULL AND since IS NOT NULL AND shortfall IS NOT NULL
                                  AND currency IS NOT NULL))
);

-- ---------------------------------------------------------------- goals.recurring_materialization
CREATE TABLE goals.recurring_materialization (
  workspace_id   uuid        NOT NULL REFERENCES iam.workspace (id),
  transaction_id uuid        NOT NULL,
  goal_id        uuid        NOT NULL,
  definition_id  uuid        NOT NULL,
  occurrence_id  uuid        NOT NULL,
  status         text        NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'RECORDED', 'RELEASED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, transaction_id),
  CONSTRAINT recurring_materialization_goal_fk FOREIGN KEY (workspace_id, goal_id)
    REFERENCES goals.savings_goal (workspace_id, id)
);
CREATE INDEX recurring_materialization_goal_ix ON goals.recurring_materialization (workspace_id, goal_id)
  WHERE status = 'WAITING';

-- ---------------------------------------------------------------- goals.contribution_suggestion
CREATE TABLE goals.contribution_suggestion (
  id                   uuid           PRIMARY KEY,
  workspace_id         uuid           NOT NULL REFERENCES iam.workspace (id),
  transaction_id       uuid           NOT NULL,
  transaction_revision integer        NOT NULL CHECK (transaction_revision >= 1),
  account_id           uuid           NOT NULL,
  amount               numeric(38,18) NOT NULL CHECK (amount > 0),
  currency             varchar(16)    NOT NULL REFERENCES fx.currency (code),
  goal_id              uuid           NULL,
  status               text           NOT NULL DEFAULT 'PENDING' CHECK (status IN
                         ('PENDING', 'CONFIRMED', 'DISMISSED', 'EXPIRED')),
  business_date        date           NOT NULL,
  decided_at           timestamptz    NULL,
  decided_by           uuid           NULL,
  movement_id          uuid           NULL,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT contribution_suggestion_tx_uk UNIQUE (workspace_id, transaction_id, transaction_revision),
  CONSTRAINT contribution_suggestion_goal_fk FOREIGN KEY (workspace_id, goal_id)
    REFERENCES goals.savings_goal (workspace_id, id),
  CONSTRAINT contribution_suggestion_decided_ck CHECK (
    (status IN ('CONFIRMED', 'DISMISSED')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CONSTRAINT contribution_suggestion_movement_ck CHECK ((status = 'CONFIRMED') = (movement_id IS NOT NULL))
);
CREATE INDEX contribution_suggestion_pending_ix ON goals.contribution_suggestion (workspace_id, created_at)
  WHERE status = 'PENDING';

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE goals.savings_goal ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.savings_goal FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_linked_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_linked_account FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_movement FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.goal_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.account_reservation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.account_reservation_state FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.recurring_materialization ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.recurring_materialization FORCE ROW LEVEL SECURITY;
ALTER TABLE goals.contribution_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals.contribution_suggestion FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON goals.savings_goal TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.goal_linked_account TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.goal_movement TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.goal_plan TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.account_reservation_state TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.recurring_materialization TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON goals.contribution_suggestion TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA goals FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON goals.savings_goal TO pf_app;
GRANT SELECT, INSERT, DELETE ON goals.goal_linked_account TO pf_app;
GRANT SELECT, INSERT ON goals.goal_movement TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON goals.goal_plan TO pf_app;
GRANT SELECT, INSERT, UPDATE ON goals.account_reservation_state TO pf_app;
GRANT SELECT, INSERT, UPDATE ON goals.recurring_materialization TO pf_app;
GRANT SELECT, INSERT, UPDATE ON goals.contribution_suggestion TO pf_app;

-- Purga del workspace demo (ADR-0026): hijas antes que padres (movimientos, plan y sugerencias → cuentas vinculadas → meta).
SELECT platform.register_workspace_scoped_table('goals.goal_movement'::regclass, 195, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.goal_plan'::regclass, 195, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.account_reservation_state'::regclass, 195, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.recurring_materialization'::regclass, 195, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.contribution_suggestion'::regclass, 195, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.goal_linked_account'::regclass, 196, 'DELETE');
SELECT platform.register_workspace_scoped_table('goals.savings_goal'::regclass, 197, 'DELETE');

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + SavingsGoal.
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
    UNION ALL
    SELECT 'SavingsGoal', g.id, g.status
      FROM goals.savings_goal g WHERE g.workspace_id = platform.current_workspace_id()
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
    UNION ALL
    SELECT 'Loan', l.id, l.status
      FROM debt.loan l WHERE l.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'goals';
DROP TABLE goals.contribution_suggestion;
DROP TABLE goals.recurring_materialization;
DROP TABLE goals.account_reservation_state;
DROP TABLE goals.goal_plan;
DROP TABLE goals.goal_movement;
DROP TABLE goals.goal_linked_account;
DROP TABLE goals.savings_goal;
DROP SCHEMA goals;
