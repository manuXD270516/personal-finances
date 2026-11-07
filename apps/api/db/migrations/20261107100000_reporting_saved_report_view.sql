-- REPORTING: vistas guardadas de reportes (openspec add-financial-reports-extended, tarea 4.1; design.md decisión 9;
-- FR-REPORTING-019). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * reporting.saved_report_view  WS + USR: combinación nombrada de reporte, rango (relativo o fijo) y filtros de UN
--     usuario en un workspace. `params` (jsonb) guarda solo ids y parámetros validados por el dominio: nunca montos ni
--     resultados. RLS FORZADA por workspace Y usuario (fail-closed: sin contexto PF002), así que otro miembro del
--     workspace no las ve ni las modifica. UNIQUE (workspace, usuario, reporte, lower(nombre)); el tope de 50 por usuario
--     y workspace lo verifica la aplicación bajo un bloqueo de asesoría por (workspace, usuario). Borrado físico: es una
--     preferencia personal sin valor contable (sin auditoría).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026) y sección de portabilidad
--     `saved-report-views` (el export corre con el contexto del solicitante y solo incluye sus vistas).

-- migrate:up
CREATE TABLE reporting.saved_report_view (
  id           uuid        PRIMARY KEY,
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  user_id      uuid        NOT NULL REFERENCES iam."user" (id),
  report_id    text        NOT NULL CHECK (report_id ~ '^[A-Z][A-Z_]{2,40}$'),
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  params       jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  version      integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saved_report_view_name_uk
  ON reporting.saved_report_view (workspace_id, user_id, report_id, lower(name));
CREATE INDEX saved_report_view_user_ix
  ON reporting.saved_report_view (workspace_id, user_id, report_id);
COMMENT ON TABLE reporting.saved_report_view IS
  'Vista guardada de un reporte (reporting/financial-reports): reporte, rango y filtros de un usuario; sin montos ni resultados.';

ALTER TABLE reporting.saved_report_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.saved_report_view FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_user_isolation ON reporting.saved_report_view TO pf_app
  USING (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id())
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());

REVOKE ALL ON reporting.saved_report_view FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON reporting.saved_report_view TO pf_app;

SELECT platform.register_workspace_scoped_table('reporting.saved_report_view'::regclass, 171, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'reporting' AND table_name = 'saved_report_view';
DROP TABLE reporting.saved_report_view;
