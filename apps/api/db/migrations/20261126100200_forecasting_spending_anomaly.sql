-- FORECAST: gastos atípicos (openspec add-spending-anomaly-detection, tarea 4.1; design.md § Base de datos y decisiones 6, 8 y
-- 12; docs/77 D473 y D474). Expand, no destructiva, sin backfill. Se ejecuta con `pf_migrator`.
--
--   * forecasting.spending_anomaly       WS: un gasto atípico por transacción y versión (`OPEN`, `DISMISSED`, `SUPERSEDED`)
--       con sus motivos (`reasons`, texto jsonb sin nombres ni descripciones) y su monto en la moneda de reporte. La API
--       lee, descarta y restaura; el worker inserta, reemplaza y purga.
--   * forecasting.spending_anomaly_scan  WS: la versión de cada gasto ya evaluada, para no reevaluarla cada día; se purga a los
--       30 días.
-- Las dos tablas: RLS ENABLE + FORCE fail-closed (`platform.current_workspace_id()` lanza PF002 sin contexto, D298) y
-- registro en `platform.workspace_scoped_table` (purga del workspace demo, ADR-0026). `pf_worker` es miembro de `pf_app` y
-- hereda sus grants y políticas; `pf_maintenance` solo lee las columnas de fecha (barrido de retención entre workspaces) y
-- cada borrado corre luego con el contexto de su workspace.

-- migrate:up
CREATE TABLE forecasting.spending_anomaly (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  transaction_id      uuid        NOT NULL,
  transaction_version integer     NOT NULL CHECK (transaction_version >= 1),
  transaction_date    date        NOT NULL,
  amount              numeric     NOT NULL,
  currency            varchar(16) NOT NULL,
  reporting_amount    numeric     NOT NULL,
  reporting_currency  varchar(16) NOT NULL,
  category_ids        uuid[]      NOT NULL DEFAULT '{}',
  counterparty_id     uuid        NULL,
  reasons             jsonb       NOT NULL CHECK (jsonb_typeof(reasons) = 'array' AND jsonb_array_length(reasons) >= 1),
  status              text        NOT NULL CHECK (status IN ('OPEN', 'DISMISSED', 'SUPERSEDED')),
  dismiss_reason      text        NULL CHECK (dismiss_reason IS NULL OR dismiss_reason IN
                        ('EXPECTED_ONE_OFF', 'NOT_UNUSUAL', 'OTHER')),
  dismiss_note        text        NULL CHECK (dismiss_note IS NULL OR length(dismiss_note) <= 200),
  detected_at         timestamptz NOT NULL,
  decided_at          timestamptz NULL,
  decided_by          uuid        NULL,
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT spending_anomaly_tx_version_uk UNIQUE (workspace_id, transaction_id, transaction_version)
);
CREATE INDEX spending_anomaly_status_ix
  ON forecasting.spending_anomaly (workspace_id, status, transaction_date DESC, id DESC);
CREATE INDEX spending_anomaly_tx_ix ON forecasting.spending_anomaly (workspace_id, transaction_id);
CREATE INDEX spending_anomaly_retention_ix ON forecasting.spending_anomaly (transaction_date);
COMMENT ON TABLE forecasting.spending_anomaly IS
  'Gasto atípico de una transacción y versión (mediana y MAD, D473): OPEN, DISMISSED o SUPERSEDED; nunca bloquea ni modifica la transacción.';

CREATE TABLE forecasting.spending_anomaly_scan (
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  transaction_id      uuid        NOT NULL,
  transaction_version integer     NOT NULL CHECK (transaction_version >= 1),
  evaluated_at        timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, transaction_id, transaction_version)
);
CREATE INDEX spending_anomaly_scan_retention_ix ON forecasting.spending_anomaly_scan (evaluated_at);
COMMENT ON TABLE forecasting.spending_anomaly_scan IS
  'Versión de cada gasto ya evaluada por la detección diaria; se purga a los 30 días.';

ALTER TABLE forecasting.spending_anomaly ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.spending_anomaly FORCE ROW LEVEL SECURITY;
ALTER TABLE forecasting.spending_anomaly_scan ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.spending_anomaly_scan FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON forecasting.spending_anomaly TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON forecasting.spending_anomaly_scan TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

-- Barrido de retención entre workspaces como `pf_maintenance` (SET LOCAL ROLE): solo SELECT de las columnas de fecha.
CREATE POLICY retention_scan ON forecasting.spending_anomaly FOR SELECT TO pf_maintenance USING (true);
CREATE POLICY retention_scan ON forecasting.spending_anomaly_scan FOR SELECT TO pf_maintenance USING (true);

REVOKE ALL ON forecasting.spending_anomaly, forecasting.spending_anomaly_scan
  FROM PUBLIC, pf_app, pf_worker, pf_maintenance;
-- La API lee y decide (descartar y restaurar); el worker (miembro de `pf_app`) inserta y reemplaza, y además borra.
GRANT SELECT, INSERT, UPDATE ON forecasting.spending_anomaly TO pf_app;
GRANT SELECT, INSERT ON forecasting.spending_anomaly_scan TO pf_app;
GRANT DELETE ON forecasting.spending_anomaly, forecasting.spending_anomaly_scan TO pf_worker;
GRANT SELECT (workspace_id, transaction_date) ON forecasting.spending_anomaly TO pf_maintenance;
GRANT SELECT (workspace_id, evaluated_at) ON forecasting.spending_anomaly_scan TO pf_maintenance;

-- Purga del workspace demo (ADR-0026).
SELECT platform.register_workspace_scoped_table('forecasting.spending_anomaly_scan'::regclass, 203, 'DELETE');
SELECT platform.register_workspace_scoped_table('forecasting.spending_anomaly'::regclass, 204, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'forecasting' AND table_name IN ('spending_anomaly', 'spending_anomaly_scan');
DROP TABLE forecasting.spending_anomaly_scan;
DROP TABLE forecasting.spending_anomaly;
