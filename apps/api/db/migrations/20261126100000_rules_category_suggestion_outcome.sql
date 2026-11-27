-- RULES: resultados de las sugerencias de categoría por historial (openspec add-category-suggestions, tarea 4.1; D476, D477).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * rules.category_suggestion_outcome  WS: SELECT/INSERT. Una fila por sugerencia mostrada y resuelta (aceptada,
--     corregida o ignorada), con el canal (alta manual o import) y el nivel. NO guarda descripciones, montos ni
--     categorías: la tasa de aceptación no los necesita (RISK-010). Es telemetría de producto: no viaja en la
--     exportación del workspace (exclusión declarada en `@pf/rules/contracts`) y no se audita.
--   * `import_job_id` y `transaction_id` son referencias lógicas (NFR-DATA-015) sin FK: el resultado sobrevive al
--     staging y a la anulación de la transacción.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
-- `pf_worker` es miembro de `pf_app` (hereda SELECT/INSERT).

-- migrate:up
CREATE TABLE rules.category_suggestion_outcome (
  id            uuid        NOT NULL,
  workspace_id  uuid        NOT NULL REFERENCES iam.workspace (id),
  surface       text        NOT NULL CHECK (surface IN ('MANUAL_ENTRY', 'IMPORT')),
  level         text        NOT NULL CHECK (level IN ('HIGH', 'MEDIUM')),
  outcome       text        NOT NULL CHECK (outcome IN ('ACCEPTED', 'CORRECTED', 'IGNORED')),
  -- Fecha de negocio (zona horaria del workspace) del guardado o de la aprobación.
  occurred_on   date        NOT NULL,
  import_job_id uuid        NULL,
  transaction_id uuid       NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX category_suggestion_outcome_date_ix ON rules.category_suggestion_outcome (workspace_id, occurred_on);
COMMENT ON TABLE rules.category_suggestion_outcome IS
  'Resultado de una sugerencia de categoría mostrada (classification/auto-classification, FR-CLASSIFICATION-014): aceptada, corregida o ignorada, por canal y nivel. Telemetría sin descripciones ni montos.';

ALTER TABLE rules.category_suggestion_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.category_suggestion_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON rules.category_suggestion_outcome TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON rules.category_suggestion_outcome FROM PUBLIC;
GRANT SELECT, INSERT ON rules.category_suggestion_outcome TO pf_app;

-- Purga del workspace demo (ADR-0026): sin dependientes.
SELECT platform.register_workspace_scoped_table('rules.category_suggestion_outcome'::regclass, 192, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'rules' AND table_name = 'category_suggestion_outcome';
DROP TABLE rules.category_suggestion_outcome;
