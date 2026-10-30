-- RULES: motor de reglas de clasificación (openspec add-rule-engine, tarea 4.1; design.md § Modelo de datos; docs/08 §5.13).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * rules.rule          WS: SELECT/INSERT/UPDATE. Estado vigente de la regla: prioridad, disparadores, condiciones y
--     acciones (JSONB validado por contracts/rules/*.v1.schema.json y por el dominio), `version` (de la DEFINICIÓN) y
--     `row_version` (ETag). Sin DELETE: se archiva (`archived_at`) y la referencia desde los splits sigue resolviéndose.
--   * rules.rule_version  WS-RO: SELECT/INSERT + `platform.forbid_mutation()`. Instantánea inmutable de cada versión de
--     la definición; PK (workspace_id, rule_id, version).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), versiones antes que reglas.
-- Sin consumidores de eventos ni tablas de cola nuevas (presupuesto de conexiones, D249). Las referencias a categorías,
-- etiquetas y demás destinos son lógicas, dentro del JSON (NFR-DATA-015). `pf_worker` es miembro de `pf_app`.

-- migrate:up
CREATE SCHEMA rules;
GRANT USAGE ON SCHEMA rules TO pf_app;

-- ---------------------------------------------------------------- rules.rule
CREATE TABLE rules.rule (
  id               uuid        PRIMARY KEY,
  workspace_id     uuid        NOT NULL REFERENCES iam.workspace (id),
  name             text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description      text        NULL CHECK (description IS NULL OR length(description) <= 500),
  priority         integer     NOT NULL CHECK (priority BETWEEN 0 AND 1000000),
  triggers         text[]      NOT NULL CHECK (
                     cardinality(triggers) BETWEEN 1 AND 3
                     AND triggers <@ ARRAY['IMPORT', 'MANUAL_CREATE', 'RETROACTIVE']::text[]),
  match_mode       text        NOT NULL CHECK (match_mode IN ('ALL', 'ANY')),
  conditions       jsonb       NOT NULL CHECK (jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) BETWEEN 1 AND 20),
  actions          jsonb       NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
  schema_version   smallint    NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  stop_processing  boolean     NOT NULL DEFAULT false,
  enabled          boolean     NOT NULL DEFAULT true,
  -- Última verificación de destinos archivados (el listado la recalcula al leer).
  needs_attention  boolean     NOT NULL DEFAULT false,
  archived_at      timestamptz NULL,
  -- Versión de la definición (sube solo con un cambio de condiciones, acciones, modo, disparadores o stop_processing).
  version          integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Versión de la fila (ETag / If-Match): sube con cualquier cambio.
  row_version      integer     NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_ws_id_uk UNIQUE (workspace_id, id),
  -- Una regla archivada no se evalúa.
  CONSTRAINT rule_archived_disabled_ck CHECK (archived_at IS NULL OR enabled = false)
);
-- El nombre es único (sin distinguir mayúsculas) entre las reglas no archivadas del workspace.
CREATE UNIQUE INDEX rule_name_uk ON rules.rule (workspace_id, lower(name)) WHERE archived_at IS NULL;
-- Cadena de evaluación: una consulta ordenada por (priority, created_at, id) de las reglas activas.
CREATE INDEX rule_evaluable_ix ON rules.rule (workspace_id, priority, created_at, id)
  WHERE enabled AND archived_at IS NULL;
CREATE INDEX rule_actions_gin ON rules.rule USING gin (actions jsonb_path_ops);
COMMENT ON TABLE rules.rule IS
  'Regla WHEN/THEN de clasificación (rules/rule-engine, FR-RULES-001). Activa, inactiva o archivada; nunca se borra. Cada cambio de definición inserta una fila inmutable en rules.rule_version.';

-- ---------------------------------------------------------------- rules.rule_version
CREATE TABLE rules.rule_version (
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  rule_id      uuid        NOT NULL,
  version      integer     NOT NULL CHECK (version >= 1),
  -- nombre, triggers, match_mode, conditions, actions, stop_processing, schema_version
  snapshot     jsonb       NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,
  PRIMARY KEY (workspace_id, rule_id, version),
  CONSTRAINT rule_version_rule_fk FOREIGN KEY (workspace_id, rule_id) REFERENCES rules.rule (workspace_id, id)
);
COMMENT ON TABLE rules.rule_version IS
  'Instantánea inmutable de cada versión de la definición de una regla (append-only, WS-RO con forbid_mutation PF003). Los splits clasificados por la regla la referencian por (rule_id, version).';
CREATE TRIGGER rule_version_immutable_trg
  BEFORE UPDATE OR DELETE ON rules.rule_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER rule_version_no_truncate_trg
  BEFORE TRUNCATE ON rules.rule_version
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE rules.rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.rule FORCE ROW LEVEL SECURITY;
ALTER TABLE rules.rule_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.rule_version FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON rules.rule TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON rules.rule_version TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA rules FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON rules.rule TO pf_app;
GRANT SELECT, INSERT ON rules.rule_version TO pf_app;

-- Purga del workspace demo (ADR-0026): versiones antes que reglas.
SELECT platform.register_workspace_scoped_table('rules.rule_version'::regclass, 193, 'DELETE');
SELECT platform.register_workspace_scoped_table('rules.rule'::regclass, 194, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'rules';
DROP TABLE rules.rule_version;
DROP TABLE rules.rule;
DROP SCHEMA rules;
