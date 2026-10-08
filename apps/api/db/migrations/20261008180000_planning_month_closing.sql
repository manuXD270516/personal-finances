-- PLANNING: cierre de mes (openspec add-month-closing, tareas 4.3 y 4.6; design.md § Modelo de datos y decisiones 3, 9,
-- 10, 16 y 17; docs/08 §5.6; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * planning.closing_policy               WS: SELECT/INSERT/UPDATE para pf_app (una fila por workspace, creada
--     perezosamente; ausencia = valores por defecto). Las cinco severidades configurables (docs/33 D66).
--   * planning.close_snapshot               WS-RO: SELECT/INSERT; `platform.forbid_mutation()` (PF003, INV-007,
--     NFR-DATA-006). Cabecera y contenido no tabular (jsonb con montos SOLO como `{amount, currency}` de texto) +
--     `content_sha256` del contenido canónico (lo verifica `planning.verify-closings`). UNIQUE (periodo, close_no).
--   * planning.close_snapshot_balance       WS-RO: una fila por cuenta (NUMERIC(38,18), con la escala del texto original
--     para la ida y vuelta exacta) y la evidencia de conciliación (`reconciliation_basis`, docs/33 D111).
--   * planning.close_snapshot_without_statement WS-RO: transacciones del periodo conciliadas sin extracto al cerrar
--     (D111); sin FK cross-schema a `txn`.
--   * planning.period_reopening             WS-RO: una fila por reapertura (motivo 1..500, quién, cuándo).
--   * planning.close_pending_notice         WS-RO: una fila por periodo en toda su vida (aviso de cierre pendiente,
--     decisión 16; árbitro del `ON CONFLICT DO NOTHING`).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): hijas antes que el periodo (160).
-- Sin backfill.

-- migrate:up
CREATE TABLE planning.closing_policy (
  workspace_id          uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  pending_transactions  text        NOT NULL CHECK (pending_transactions IN ('BLOCKING', 'WARNING')),
  unreconciled_accounts text        NOT NULL CHECK (unreconciled_accounts IN ('BLOCKING', 'WARNING')),
  unresolved_duplicates text        NOT NULL CHECK (unresolved_duplicates IN ('BLOCKING', 'WARNING')),
  uncategorized         text        NOT NULL CHECK (uncategorized IN ('BLOCKING', 'WARNING')),
  unresolved_recurring  text        NOT NULL CHECK (unresolved_recurring IN ('BLOCKING', 'WARNING')),
  version               integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid        NULL
);
COMMENT ON TABLE planning.closing_policy IS
  'Política de cierre del workspace (planning/month-closing): severidad BLOCKING|WARNING de cada ítem del checklist.';

CREATE TABLE planning.close_snapshot (
  id                    uuid        PRIMARY KEY,
  workspace_id          uuid        NOT NULL REFERENCES iam.workspace (id),
  period_id             uuid        NOT NULL,
  close_no              integer     NOT NULL CHECK (close_no >= 1),
  label                 char(7)     NOT NULL,
  period_start          date        NOT NULL,
  period_end            date        NOT NULL,
  start_day             smallint    NOT NULL,
  base_currency         text        NOT NULL REFERENCES fx.currency (code),
  closed_at             timestamptz NOT NULL,
  closed_by             uuid        NULL,
  previous_snapshot_id  uuid        NULL,
  checklist             jsonb       NOT NULL,
  acknowledged_warnings jsonb       NULL,
  flows                 jsonb       NOT NULL,
  net_worth             jsonb       NOT NULL,
  budget_vs_actual      jsonb       NULL,
  goal_contributions    jsonb       NULL,
  content_schema_version smallint   NOT NULL,
  content_sha256        char(64)    NOT NULL,
  CONSTRAINT close_snapshot_period_no_uk UNIQUE (period_id, close_no),
  CONSTRAINT close_snapshot_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT close_snapshot_period_fk FOREIGN KEY (workspace_id, period_id)
    REFERENCES planning.financial_period (workspace_id, id),
  CONSTRAINT close_snapshot_previous_fk FOREIGN KEY (workspace_id, previous_snapshot_id)
    REFERENCES planning.close_snapshot (workspace_id, id)
);
CREATE INDEX close_snapshot_period_ix ON planning.close_snapshot (workspace_id, period_id, close_no DESC);
COMMENT ON TABLE planning.close_snapshot IS
  'Snapshot de cierre inmutable y versionado (append-only, PF003): una fila por cierre de un periodo.';

CREATE TABLE planning.close_snapshot_balance (
  snapshot_id           uuid           NOT NULL,
  account_id            uuid           NOT NULL,
  workspace_id          uuid           NOT NULL REFERENCES iam.workspace (id),
  ledger_account_id     uuid           NULL,
  account_name          text           NOT NULL,
  currency              text           NOT NULL REFERENCES fx.currency (code),
  scale                 smallint       NOT NULL CHECK (scale BETWEEN 0 AND 18),
  balance               numeric(38,18) NOT NULL,
  presented             numeric(38,18) NOT NULL,
  reconciliation_id     uuid           NULL,
  statement_date        date           NULL,
  statement_balance     numeric(38,18) NULL,
  reconciliation_basis  text           NULL CHECK (reconciliation_basis IN ('STATEMENT', 'WITHOUT_STATEMENT')),
  PRIMARY KEY (snapshot_id, account_id),
  CONSTRAINT close_snapshot_balance_snapshot_fk FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES planning.close_snapshot (workspace_id, id)
);

CREATE TABLE planning.close_snapshot_without_statement (
  snapshot_id    uuid           NOT NULL,
  transaction_id uuid           NOT NULL,
  workspace_id   uuid           NOT NULL REFERENCES iam.workspace (id),
  account_id     uuid           NOT NULL,
  business_date  date           NOT NULL,
  amount         numeric(38,18) NOT NULL,
  scale          smallint       NOT NULL CHECK (scale BETWEEN 0 AND 18),
  currency       text           NOT NULL REFERENCES fx.currency (code),
  PRIMARY KEY (snapshot_id, transaction_id),
  CONSTRAINT close_snapshot_without_statement_snapshot_fk FOREIGN KEY (workspace_id, snapshot_id)
    REFERENCES planning.close_snapshot (workspace_id, id)
);

CREATE TABLE planning.period_reopening (
  id                 uuid        PRIMARY KEY,
  workspace_id       uuid        NOT NULL REFERENCES iam.workspace (id),
  period_id          uuid        NOT NULL,
  reopen_no          integer     NOT NULL CHECK (reopen_no >= 1),
  reason             text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  reopened_by        uuid        NULL,
  reopened_at        timestamptz NOT NULL,
  closed_snapshot_id uuid        NOT NULL,
  CONSTRAINT period_reopening_no_uk UNIQUE (period_id, reopen_no),
  CONSTRAINT period_reopening_period_fk FOREIGN KEY (workspace_id, period_id)
    REFERENCES planning.financial_period (workspace_id, id),
  CONSTRAINT period_reopening_snapshot_fk FOREIGN KEY (workspace_id, closed_snapshot_id)
    REFERENCES planning.close_snapshot (workspace_id, id)
);

CREATE TABLE planning.close_pending_notice (
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  period_id    uuid        NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  event_id     uuid        NOT NULL,
  PRIMARY KEY (workspace_id, period_id),
  CONSTRAINT close_pending_notice_period_fk FOREIGN KEY (workspace_id, period_id)
    REFERENCES planning.financial_period (workspace_id, id)
);

-- Inmutabilidad (INV-007, PF003): defensa adicional a los grants (frena también al owner).
CREATE TRIGGER close_snapshot_immutable_trg BEFORE UPDATE OR DELETE ON planning.close_snapshot
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_snapshot_no_truncate_trg BEFORE TRUNCATE ON planning.close_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_snapshot_balance_immutable_trg BEFORE UPDATE OR DELETE ON planning.close_snapshot_balance
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_snapshot_balance_no_truncate_trg BEFORE TRUNCATE ON planning.close_snapshot_balance
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_snapshot_without_statement_immutable_trg
  BEFORE UPDATE OR DELETE ON planning.close_snapshot_without_statement
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_snapshot_without_statement_no_truncate_trg
  BEFORE TRUNCATE ON planning.close_snapshot_without_statement
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER period_reopening_immutable_trg BEFORE UPDATE OR DELETE ON planning.period_reopening
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER period_reopening_no_truncate_trg BEFORE TRUNCATE ON planning.period_reopening
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_pending_notice_immutable_trg BEFORE UPDATE OR DELETE ON planning.close_pending_notice
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER close_pending_notice_no_truncate_trg BEFORE TRUNCATE ON planning.close_pending_notice
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE planning.closing_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.closing_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot_balance FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot_without_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.close_snapshot_without_statement FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.period_reopening ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.period_reopening FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.close_pending_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.close_pending_notice FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON planning.closing_policy TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.close_snapshot TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.close_snapshot_balance TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.close_snapshot_without_statement TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.period_reopening TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.close_pending_notice TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON planning.closing_policy, planning.close_snapshot, planning.close_snapshot_balance,
  planning.close_snapshot_without_statement, planning.period_reopening, planning.close_pending_notice
  FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON planning.closing_policy TO pf_app;
GRANT SELECT, INSERT ON planning.close_snapshot, planning.close_snapshot_balance,
  planning.close_snapshot_without_statement, planning.period_reopening, planning.close_pending_notice TO pf_app;

-- Purga del workspace demo (ADR-0026): hijas antes que los snapshots y estos antes que el periodo (160).
SELECT platform.register_workspace_scoped_table('planning.close_pending_notice'::regclass, 100, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.period_reopening'::regclass, 102, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.close_snapshot_without_statement'::regclass, 104, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.close_snapshot_balance'::regclass, 106, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.close_snapshot'::regclass, 108, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.closing_policy'::regclass, 110, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'planning'
   AND table_name IN ('close_pending_notice', 'period_reopening', 'close_snapshot_without_statement',
                      'close_snapshot_balance', 'close_snapshot', 'closing_policy');
DROP TABLE planning.close_pending_notice;
DROP TABLE planning.period_reopening;
DROP TABLE planning.close_snapshot_without_statement;
DROP TABLE planning.close_snapshot_balance;
DROP TABLE planning.close_snapshot;
DROP TABLE planning.closing_policy;
