-- RULES: decisiones sobre sugerencias de reglas (openspec add-rule-suggestions, tarea 4.1; design.md § Modelo de datos).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * rules.rule_suggestion_decision  WS: SELECT/INSERT/DELETE. Una fila por sugerencia decidida (aceptada o descartada),
--     identificada por su huella (SHA-256 de `v1|tipo|valor|kind|categoría`). Las sugerencias en sí NO se guardan: se
--     calculan a pedido (sin jobs ni consumidores, D249). Restaurar una descartada borra su fila; las aceptadas no se
--     borran (conservan el origen de la regla).
--   * La clave primaria serializa las decisiones concurrentes: la segunda aceptación del mismo patrón no inserta.
--   * La FK a la regla es DIFERIBLE: `createRule` reclama la huella ANTES de insertar la regla para que la segunda
--     aceptación (o una concurrente) responda `RULE_SUGGESTION_DECIDED` y no `NAME_TAKEN`.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026) antes de rules.rule.
-- `pf_worker` es miembro de `pf_app` (hereda SELECT). Referencias a la categoría y la contraparte lógicas (NFR-DATA-015).

-- migrate:up
CREATE TABLE rules.rule_suggestion_decision (
  workspace_id  uuid         NOT NULL REFERENCES iam.workspace (id),
  suggestion_id char(64)     NOT NULL CHECK (suggestion_id ~ '^[0-9a-f]{64}$'),
  pattern_type  text         NOT NULL CHECK (pattern_type IN ('DESCRIPTION', 'COUNTERPARTY')),
  pattern_value text         NOT NULL CHECK (char_length(pattern_value) BETWEEN 1 AND 200),
  kind          text         NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE', 'REFUND')),
  category_id   uuid         NOT NULL,
  decision      text         NOT NULL CHECK (decision IN ('ACCEPTED', 'DISMISSED')),
  rule_id       uuid         NULL,
  -- Instantánea de la sugerencia al decidir (nula si ya no se podía calcular).
  support       integer      NULL CHECK (support IS NULL OR support >= 0),
  evidence_count integer     NULL CHECK (evidence_count IS NULL OR evidence_count >= 0),
  confidence    numeric(5,4) NULL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  decided_at    timestamptz  NOT NULL DEFAULT now(),
  decided_by    uuid         NOT NULL,
  PRIMARY KEY (workspace_id, suggestion_id),
  CONSTRAINT rule_suggestion_decision_rule_ck CHECK ((decision = 'ACCEPTED') = (rule_id IS NOT NULL)),
  CONSTRAINT rule_suggestion_decision_rule_fk FOREIGN KEY (workspace_id, rule_id)
    REFERENCES rules.rule (workspace_id, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX rule_suggestion_decision_rule_ix ON rules.rule_suggestion_decision (workspace_id, rule_id)
  WHERE rule_id IS NOT NULL;
COMMENT ON TABLE rules.rule_suggestion_decision IS
  'Decisión del usuario sobre una sugerencia de regla (rules/rule-engine, FR-RULES-011): aceptada (con la regla creada) o descartada. Las sugerencias se calculan a pedido y no se guardan.';

ALTER TABLE rules.rule_suggestion_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.rule_suggestion_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON rules.rule_suggestion_decision TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON rules.rule_suggestion_decision FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON rules.rule_suggestion_decision TO pf_app;

-- Purga del workspace demo (ADR-0026): las decisiones antes que las reglas (193 < 194).
SELECT platform.register_workspace_scoped_table('rules.rule_suggestion_decision'::regclass, 193, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'rules' AND table_name = 'rule_suggestion_decision';
DROP TABLE rules.rule_suggestion_decision;
