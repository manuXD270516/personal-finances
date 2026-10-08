-- PLANNING: templates de presupuesto versionados (openspec add-budget-templates, tarea 4.1; design.md § Modelo de datos
-- y decisiones 1, 5 y 8; docs/08 §5.6; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * planning.budget_template          WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: se archiva, nunca se borra).
--     Único activo por nombre (sin distinguir mayúsculas) y a lo sumo UN predeterminado activo por workspace (índices
--     únicos parciales: el árbitro de las solicitudes concurrentes de "marcar como predeterminado").
--   * planning.budget_template_version  WS-RO: SELECT/INSERT; `platform.forbid_mutation()` (versiones inmutables, PF003).
--   * planning.budget_template_line     WS-RO: SELECT/INSERT; `platform.forbid_mutation()`. Misma forma y CHECKs que
--     `planning.budget_line`, generalizada a `target_kind/target_id` (grupos y tags) y SIN `effective_from`: la versión
--     se elige al aplicar, no hay vigencias por fecha.
--   * FKs nuevas `planning.budget.template_version_id` y `planning.budget_line.template_line_id` (columnas nulas de
--     add-budgets): `NOT VALID` + `VALIDATE` (sin bloqueo largo; no hay datos que migrar).
--   * pf_workspace_directory: + SELECT (base_currency) en iam.workspace — el worker (job de creación de periodos) crea
--     el plan del predeterminado en la moneda base del workspace.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026): después de los planes (150).
-- Sin backfill.

-- migrate:up
CREATE TABLE planning.budget_template (
  id                 uuid        PRIMARY KEY,
  workspace_id       uuid        NOT NULL REFERENCES iam.workspace (id),
  name               text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description        text        NULL CHECK (description IS NULL OR char_length(description) <= 500),
  is_default         boolean     NOT NULL DEFAULT false,
  status             text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  archived_at        timestamptz NULL,
  current_version_no integer     NOT NULL DEFAULT 1 CHECK (current_version_no >= 1),
  version            integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NULL,
  CONSTRAINT budget_template_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT budget_template_default_active_ck CHECK (NOT is_default OR status = 'ACTIVE')
);
CREATE UNIQUE INDEX budget_template_active_name_uq
  ON planning.budget_template (workspace_id, lower(btrim(name))) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX budget_template_default_uq
  ON planning.budget_template (workspace_id) WHERE is_default AND status = 'ACTIVE';
COMMENT ON TABLE planning.budget_template IS
  'Template de presupuesto (planning/budget-templates): nombre, estado y versión vigente; las líneas viven en sus versiones inmutables.';

CREATE TABLE planning.budget_template_version (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  template_id         uuid        NOT NULL,
  version_no          integer     NOT NULL CHECK (version_no >= 1),
  based_on_version_no integer     NULL CHECK (based_on_version_no IS NULL OR based_on_version_no >= 1),
  change_note         text        NULL CHECK (change_note IS NULL OR char_length(change_note) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NULL,
  CONSTRAINT budget_template_version_uk UNIQUE (template_id, version_no),
  CONSTRAINT budget_template_version_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT budget_template_version_template_fk FOREIGN KEY (workspace_id, template_id)
    REFERENCES planning.budget_template (workspace_id, id)
);
COMMENT ON TABLE planning.budget_template_version IS
  'Versión inmutable de un template (instantánea completa de sus líneas); WS-RO con forbid_mutation (PF003).';

CREATE TABLE planning.budget_template_line (
  id                  uuid           PRIMARY KEY,
  workspace_id        uuid           NOT NULL REFERENCES iam.workspace (id),
  template_version_id uuid           NOT NULL,
  target_kind         text           NOT NULL CHECK (target_kind IN ('CATEGORY', 'GROUP', 'TAG')),
  -- Referencia lógica a classification.* (sin FK entre schemas, NFR-DATA-015).
  target_id           uuid           NOT NULL,
  nature              text           NOT NULL CHECK (nature IN ('EXPENSE', 'INCOME')),
  kind                text           NOT NULL CHECK (kind IN ('FIXED', 'MAXIMUM', 'MINIMUM', 'RANGE', 'PERCENT_OF_INCOME')),
  planned_amount      numeric(38,18) NULL CHECK (planned_amount IS NULL OR planned_amount >= 0),
  min_amount          numeric(38,18) NULL CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount          numeric(38,18) NULL CHECK (max_amount IS NULL OR max_amount >= 0),
  percent             numeric(9,4)   NULL CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  income_basis        text           NULL CHECK (income_basis IS NULL OR income_basis IN ('EXPECTED', 'ACTUAL')),
  rollover_policy     text           NOT NULL DEFAULT 'NONE' CHECK (rollover_policy IN ('NONE', 'CARRY_POSITIVE', 'CARRY_ALL')),
  rollover_cap        numeric(38,18) NULL CHECK (rollover_cap IS NULL OR rollover_cap >= 0),
  thresholds          numeric(7,2)[] NOT NULL DEFAULT '{}',
  currency            text           NOT NULL REFERENCES fx.currency (code),
  CONSTRAINT budget_template_line_target_uk UNIQUE (template_version_id, target_kind, target_id),
  CONSTRAINT budget_template_line_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT budget_template_line_version_fk FOREIGN KEY (workspace_id, template_version_id)
    REFERENCES planning.budget_template_version (workspace_id, id),
  CONSTRAINT budget_template_line_range_ck CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount),
  CONSTRAINT budget_template_line_thresholds_ck CHECK (cardinality(thresholds) <= 10),
  CONSTRAINT budget_template_line_kind_shape_ck CHECK (
       (kind IN ('FIXED', 'MAXIMUM') AND planned_amount IS NOT NULL AND min_amount IS NULL AND max_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'MINIMUM' AND min_amount IS NOT NULL AND planned_amount IS NULL AND max_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'RANGE' AND min_amount IS NOT NULL AND max_amount IS NOT NULL AND planned_amount IS NULL
          AND percent IS NULL AND income_basis IS NULL)
    OR (kind = 'PERCENT_OF_INCOME' AND percent IS NOT NULL AND income_basis IS NOT NULL AND planned_amount IS NULL
          AND min_amount IS NULL AND max_amount IS NULL)
  ),
  CONSTRAINT budget_template_line_nature_ck CHECK (
    (nature = 'EXPENSE' OR (kind = 'FIXED' AND cardinality(thresholds) = 0 AND rollover_policy = 'NONE'))
    AND (target_kind <> 'TAG' OR nature = 'EXPENSE')
    AND (kind <> 'MINIMUM' OR (cardinality(thresholds) = 0 AND rollover_policy = 'NONE'))
  ),
  CONSTRAINT budget_template_line_rollover_ck CHECK (
    (rollover_policy = 'NONE' AND rollover_cap IS NULL)
    OR (rollover_policy <> 'NONE' AND kind IN ('FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'))
  )
);
CREATE INDEX budget_template_line_target_ix ON planning.budget_template_line (workspace_id, target_kind, target_id);
COMMENT ON TABLE planning.budget_template_line IS
  'Línea de una versión de template (mismo formato que budget_line, sin gastado ni rollover recibido); WS-RO.';

-- Inmutabilidad de versiones y líneas (design decisión 1): defensa adicional a los grants (PF003).
CREATE TRIGGER budget_template_version_immutable_trg BEFORE UPDATE OR DELETE ON planning.budget_template_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER budget_template_version_no_truncate_trg BEFORE TRUNCATE ON planning.budget_template_version
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER budget_template_line_immutable_trg BEFORE UPDATE OR DELETE ON planning.budget_template_line
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER budget_template_line_no_truncate_trg BEFORE TRUNCATE ON planning.budget_template_line
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- Trazabilidad plan -> template (columnas nulas de add-budgets): FK NOT VALID + VALIDATE.
ALTER TABLE planning.budget ADD CONSTRAINT budget_template_version_fk
  FOREIGN KEY (workspace_id, template_version_id) REFERENCES planning.budget_template_version (workspace_id, id) NOT VALID;
ALTER TABLE planning.budget VALIDATE CONSTRAINT budget_template_version_fk;
ALTER TABLE planning.budget_line ADD CONSTRAINT budget_line_template_line_fk
  FOREIGN KEY (workspace_id, template_line_id) REFERENCES planning.budget_template_line (workspace_id, id) NOT VALID;
ALTER TABLE planning.budget_line VALIDATE CONSTRAINT budget_line_template_line_fk;
CREATE INDEX budget_template_version_ix ON planning.budget (workspace_id, template_version_id)
  WHERE template_version_id IS NOT NULL;

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE planning.budget_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_template FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_template_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_template_version FORCE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_template_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.budget_template_line FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON planning.budget_template TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.budget_template_version TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON planning.budget_template_line TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON planning.budget_template, planning.budget_template_version, planning.budget_template_line
  FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON planning.budget_template TO pf_app;
GRANT SELECT, INSERT ON planning.budget_template_version TO pf_app;
GRANT SELECT, INSERT ON planning.budget_template_line TO pf_app;

-- El worker (creación automática de periodos con predeterminado) lee la moneda base del workspace.
GRANT SELECT (base_currency) ON iam.workspace TO pf_workspace_directory;

-- Purga del workspace demo (ADR-0026): después de los planes (150), líneas -> versiones -> templates.
SELECT platform.register_workspace_scoped_table('planning.budget_template_line'::regclass, 151, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.budget_template_version'::regclass, 152, 'DELETE');
SELECT platform.register_workspace_scoped_table('planning.budget_template'::regclass, 153, 'DELETE');

-- migrate:down
REVOKE SELECT (base_currency) ON iam.workspace FROM pf_workspace_directory;
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'planning'
   AND table_name IN ('budget_template_line', 'budget_template_version', 'budget_template');
ALTER TABLE planning.budget_line DROP CONSTRAINT budget_line_template_line_fk;
DROP INDEX planning.budget_template_version_ix;
ALTER TABLE planning.budget DROP CONSTRAINT budget_template_version_fk;
DROP TABLE planning.budget_template_line;
DROP TABLE planning.budget_template_version;
DROP TABLE planning.budget_template;
