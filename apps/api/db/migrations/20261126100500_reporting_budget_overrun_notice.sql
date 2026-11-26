-- REPORTING: aviso de riesgo de exceder un presupuesto (openspec add-budget-overrun-risk, tarea 4.1; design.md decisión 7 y
-- § Base de datos; docs/77 D478 y D484). Expand, no destructiva, sin backfill. Se ejecuta con `pf_migrator`.
--
--   * reporting.budget_overrun_notice  WS: un registro por línea de presupuesto y periodo que ya se avisó como «probable»
--       (pk `(workspace_id, period_id, budget_line_id)`); hace idempotente el aviso de `reporting.cash-flow-watch`: bajar y
--       volver a subir el riesgo no avisa otra vez. Registro técnico: fuera del export (tras importar, una línea en riesgo
--       puede avisarse otra vez una sola vez). Sin llaves foráneas a PLANNING (los contextos no se acoplan por tablas).
-- RLS ENABLE + FORCE fail-closed (`platform.current_workspace_id()` lanza PF002 sin contexto, D298) y registro en
-- `platform.workspace_scoped_table` (purga del workspace demo, ADR-0026). `pf_worker` es miembro de `pf_app` y hereda sus
-- grants y políticas: el paso de avisos corre con el contexto de cada workspace.

-- migrate:up
CREATE TABLE reporting.budget_overrun_notice (
  workspace_id   uuid        NOT NULL REFERENCES iam.workspace (id),
  period_id      uuid        NOT NULL,
  budget_line_id uuid        NOT NULL,
  level          text        NOT NULL CHECK (level IN ('LIKELY')),
  estimated_date date        NULL,
  notified_at    timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, period_id, budget_line_id)
);
COMMENT ON TABLE reporting.budget_overrun_notice IS
  'Aviso de riesgo de presupuesto ya emitido por línea y periodo (idempotencia del paso de reporting.cash-flow-watch).';

ALTER TABLE reporting.budget_overrun_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.budget_overrun_notice FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON reporting.budget_overrun_notice TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON reporting.budget_overrun_notice FROM PUBLIC, pf_app, pf_worker, pf_maintenance;
-- Solo el paso de avisos del worker escribe; la API no lo lee ni lo escribe (lo hereda `pf_app` solo para leer).
GRANT SELECT ON reporting.budget_overrun_notice TO pf_app;
GRANT INSERT ON reporting.budget_overrun_notice TO pf_worker;

-- Purga del workspace demo (ADR-0026).
SELECT platform.register_workspace_scoped_table('reporting.budget_overrun_notice'::regclass, 205, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'reporting' AND table_name = 'budget_overrun_notice';
DROP TABLE reporting.budget_overrun_notice;
