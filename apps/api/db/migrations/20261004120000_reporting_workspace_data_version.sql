-- REPORTING: versión derivada de los datos del workspace (openspec add-basic-dashboard, tarea 4.1; design.md
-- decisión 7 y § Modelo de datos). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * reporting.workspace_data_version  DRV: la escribe SOLO el consumidor idempotente del worker
--     (`reporting.data-version`, inbox en la misma transacción) ante los eventos que cambian el resumen; `pf_app` solo
--     la lee para el ETag de `GET /reports/summary`. Derivada y reconstruible: sin auditoría, se inicializa en 0.
-- El índice de lectura de docs/14 §11 sobre `ledger.posting (workspace_id, ledger_account_id, entry_date) INCLUDE
-- (amount)` ya existe (`posting_balance_ix`, add-ledger-core): no se crea otro.

-- migrate:up
CREATE SCHEMA IF NOT EXISTS reporting;
GRANT USAGE ON SCHEMA reporting TO pf_app;

CREATE TABLE reporting.workspace_data_version (
  workspace_id uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  version      bigint      NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE reporting.workspace_data_version IS
  'Versión derivada (DRV) de los datos del workspace para el ETag del resumen del Home; la escribe el worker.';

ALTER TABLE reporting.workspace_data_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.workspace_data_version FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation_read ON reporting.workspace_data_version FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_worker ON reporting.workspace_data_version TO pf_worker
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON reporting.workspace_data_version FROM pf_app, pf_worker;
GRANT SELECT ON reporting.workspace_data_version TO pf_app;
GRANT SELECT, INSERT, UPDATE ON reporting.workspace_data_version TO pf_worker;

-- migrate:down
DROP TABLE reporting.workspace_data_version;
DROP SCHEMA IF EXISTS reporting;
