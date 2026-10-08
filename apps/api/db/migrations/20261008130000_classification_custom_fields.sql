-- CLASSIFICATION / TRANSACTIONS / ACCOUNTS: custom fields (openspec add-custom-fields, tarea 4.1; design.md decisiones
-- 1–7 y 11, § Modelo de datos; docs/08 §5.4–§5.5; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * classification.custom_field_definition  WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: archivado suave,
--     INV-019). Clave `snake_case` única SOLO entre las activas (índice parcial: la clave de una archivada queda libre).
--     `options` es un arreglo JSON `[{key, label, position}]` con al menos una opción si y solo si el tipo es SELECT.
--   * txn.split_custom_field_value            WS: tabla de enlace por split nominal (SELECT/INSERT/UPDATE/DELETE).
--     Una sola columna `value_*` con valor por fila (CHECK num_nonnulls = 1, docs/08). `value_number numeric(38,18)`
--     guarda NUMBER (entero) y DECIMAL exactos. `field_id` es lógico (sin FK entre schemas, NFR-DATA-015). Los splits
--     reemplazados por una revisión conservan sus filas (los valores históricos no se borran).
--   * accounts.account_custom_field_value     WS: ídem por cuenta.
--   * Índices por tipo de valor para el filtro del listado: (workspace, field, value_*).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
-- Sin backfill.

-- migrate:up
CREATE TABLE classification.custom_field_definition (
  id           uuid        PRIMARY KEY,
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  key          text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  data_type    text        NOT NULL CHECK (data_type IN ('TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'BOOLEAN', 'SELECT')),
  target       text        NOT NULL CHECK (target IN ('TRANSACTION', 'ACCOUNT')),
  required     boolean     NOT NULL DEFAULT false,
  options      jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  position     integer     NOT NULL DEFAULT 0,
  archived_at  timestamptz NULL,
  archived_by  uuid        NULL,
  version      integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_options_ck CHECK (
    (data_type = 'SELECT' AND jsonb_array_length(options) >= 1) OR (data_type <> 'SELECT' AND options = '[]'::jsonb)
  ),
  UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX custom_field_active_key_uq ON classification.custom_field_definition (workspace_id, key)
  WHERE archived_at IS NULL;
CREATE INDEX custom_field_key_ix ON classification.custom_field_definition (workspace_id, key);
COMMENT ON TABLE classification.custom_field_definition IS
  'Definiciones de custom fields tipados (classification/custom-fields): clave única entre activas, opciones con clave.';

CREATE TABLE txn.split_custom_field_value (
  workspace_id uuid          NOT NULL,
  split_id     uuid          NOT NULL,
  field_id     uuid          NOT NULL,
  value_text   text          NULL CHECK (value_text IS NULL OR length(value_text) BETWEEN 1 AND 500),
  value_number numeric(38,18) NULL,
  value_date   date          NULL,
  value_bool   boolean       NULL,
  PRIMARY KEY (workspace_id, split_id, field_id),
  CONSTRAINT split_custom_field_value_one_ck CHECK (
    num_nonnulls(value_text, value_number, value_date, value_bool) = 1
  ),
  CONSTRAINT split_custom_field_value_split_fk FOREIGN KEY (workspace_id, split_id)
    REFERENCES txn.transaction_split (workspace_id, id)
);
CREATE INDEX split_cfv_text_ix ON txn.split_custom_field_value (workspace_id, field_id, value_text)
  WHERE value_text IS NOT NULL;
CREATE INDEX split_cfv_number_ix ON txn.split_custom_field_value (workspace_id, field_id, value_number)
  WHERE value_number IS NOT NULL;
CREATE INDEX split_cfv_date_ix ON txn.split_custom_field_value (workspace_id, field_id, value_date)
  WHERE value_date IS NOT NULL;
CREATE INDEX split_cfv_bool_ix ON txn.split_custom_field_value (workspace_id, field_id, value_bool)
  WHERE value_bool IS NOT NULL;
CREATE INDEX split_cfv_split_ix ON txn.split_custom_field_value (workspace_id, split_id);

CREATE TABLE accounts.account_custom_field_value (
  workspace_id uuid          NOT NULL,
  account_id   uuid          NOT NULL,
  field_id     uuid          NOT NULL,
  value_text   text          NULL CHECK (value_text IS NULL OR length(value_text) BETWEEN 1 AND 500),
  value_number numeric(38,18) NULL,
  value_date   date          NULL,
  value_bool   boolean       NULL,
  PRIMARY KEY (workspace_id, account_id, field_id),
  CONSTRAINT account_custom_field_value_one_ck CHECK (
    num_nonnulls(value_text, value_number, value_date, value_bool) = 1
  ),
  CONSTRAINT account_custom_field_value_account_fk FOREIGN KEY (workspace_id, account_id)
    REFERENCES accounts.account (workspace_id, id)
);
CREATE INDEX account_cfv_field_ix ON accounts.account_custom_field_value (workspace_id, field_id);

-- RLS forzada por workspace (fail-closed con PF002) y grants.
ALTER TABLE classification.custom_field_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification.custom_field_definition FORCE ROW LEVEL SECURITY;
ALTER TABLE txn.split_custom_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn.split_custom_field_value FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts.account_custom_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts.account_custom_field_value FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON classification.custom_field_definition TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON txn.split_custom_field_value TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON accounts.account_custom_field_value TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON classification.custom_field_definition, txn.split_custom_field_value,
  accounts.account_custom_field_value FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT, UPDATE ON classification.custom_field_definition TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON txn.split_custom_field_value TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts.account_custom_field_value TO pf_app;

-- Purga del workspace demo (ADR-0026): los valores son hijas de split/cuenta (se borran antes que ellas).
SELECT platform.register_workspace_scoped_table('txn.split_custom_field_value'::regclass, 10, 'DELETE');
SELECT platform.register_workspace_scoped_table('accounts.account_custom_field_value'::regclass, 80, 'DELETE');
SELECT platform.register_workspace_scoped_table('classification.custom_field_definition'::regclass, 140, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE (schema_name, table_name) IN (
   ('txn', 'split_custom_field_value'),
   ('accounts', 'account_custom_field_value'),
   ('classification', 'custom_field_definition')
 );
DROP TABLE accounts.account_custom_field_value;
DROP TABLE txn.split_custom_field_value;
DROP TABLE classification.custom_field_definition;
