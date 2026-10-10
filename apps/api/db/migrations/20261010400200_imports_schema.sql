-- IMPORTS: importación CSV básica de una cuenta (openspec add-basic-csv-import, tarea 4.1; design.md § Modelo de datos;
-- docs/08 §IMPORTS en su subconjunto de Phase 3; docs/13 §14; ADR-0023). Expand, no destructiva. Se ejecuta con
-- `pf_migrator`.
--
--   * imports.import_job          WS: SELECT/INSERT/UPDATE. Sin DELETE: el job y sus conteos se conservan (auditoría).
--   * imports.staged_transaction  WS: SELECT/INSERT/UPDATE/DELETE. Celdas crudas del archivo y su normalización; dato
--     técnico PURGABLE (cancelar/expirar/90 días tras terminar). Phase 6 agrega columnas nullable.
--   * imports.row_link            WS: SELECT/INSERT/UPDATE. Vínculo huella de fila → transacción (idempotencia, INV-014).
--     UNIQUE parcial sobre los vínculos ACTIVE; sin DELETE: un vínculo superado queda como historia.
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026), hijas antes que padres.
-- `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas. Referencias a otros schemas (cuenta, transacciones)
-- son lógicas, sin FK (NFR-DATA-015). El archivo binario nunca se guarda (docs/24 A6).

-- migrate:up
CREATE SCHEMA imports;
GRANT USAGE ON SCHEMA imports TO pf_app;

-- ---------------------------------------------------------------- imports.import_job
CREATE TABLE imports.import_job (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  target_account_id uuid        NOT NULL,
  source            text        NOT NULL DEFAULT 'FILE_CSV' CHECK (source IN ('FILE_CSV')),
  status            text        NOT NULL CHECK (status IN
                      ('AWAITING_MAPPING', 'AWAITING_REVIEW', 'APPROVED', 'PERSISTING', 'COMPLETED',
                       'PARTIALLY_FAILED', 'COMPLETED_WITH_ERRORS', 'CANCELLED')),
  original_name     text        NULL CHECK (original_name IS NULL OR length(original_name) <= 255),
  file_checksum     bytea       NOT NULL CHECK (octet_length(file_checksum) = 32),
  file_size_bytes   integer     NOT NULL CHECK (file_size_bytes >= 0),
  encoding          text        NOT NULL CHECK (encoding IN ('utf-8', 'windows-1252')),
  delimiter         text        NOT NULL CHECK (delimiter IN (',', ';', E'\t', '|')),
  row_count         integer     NOT NULL CHECK (row_count >= 0),
  column_count      integer     NOT NULL CHECK (column_count >= 1),
  header            jsonb       NOT NULL,
  mapping           jsonb       NULL,
  counters          jsonb       NOT NULL,
  progress          jsonb       NOT NULL,
  errors            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  warnings          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  approved_by       uuid        NULL,
  approved_at       timestamptz NULL,
  completed_at      timestamptz NULL,
  cancelled_at      timestamptz NULL,
  -- NULL con `cancelled_at` informado = cancelada por el sistema (expiración).
  cancelled_by      uuid        NULL,
  expires_at        timestamptz NULL,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT import_job_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT import_job_cancelled_ck CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT import_job_approved_ck CHECK (
    (status IN ('AWAITING_MAPPING', 'AWAITING_REVIEW', 'CANCELLED')) OR approved_at IS NOT NULL)
);
CREATE INDEX import_job_ws_status_ix ON imports.import_job (workspace_id, status);
CREATE INDEX import_job_account_created_ix ON imports.import_job (workspace_id, target_account_id, created_at DESC);
-- Aviso de archivo ya importado: NO único (reimportar adrede es legítimo; la huella de fila evita duplicados).
CREATE INDEX import_job_checksum_ix ON imports.import_job (workspace_id, target_account_id, file_checksum);
-- Barrido de revisiones vencidas.
CREATE INDEX import_job_expiry_ix ON imports.import_job (expires_at) WHERE expires_at IS NOT NULL;
COMMENT ON TABLE imports.import_job IS
  'Importación de un archivo CSV a una cuenta (imports/import-pipeline, FR-IMPORTS-003). Estados del subconjunto de Phase 3; status ampliable (expand).';

-- ---------------------------------------------------------------- imports.staged_transaction
CREATE TABLE imports.staged_transaction (
  id                     uuid           PRIMARY KEY,
  workspace_id           uuid           NOT NULL REFERENCES iam.workspace (id),
  import_job_id          uuid           NOT NULL,
  -- Línea física del archivo donde empieza el registro (1-based).
  row_number             integer        NOT NULL CHECK (row_number >= 1),
  -- Celdas crudas del registro (arreglo de strings): dato no confiable, purgable.
  raw                    jsonb          NOT NULL,
  booking_date           date           NULL,
  -- Monto SIEMPRE positivo en la escala de la moneda de la cuenta; `direction` da el sentido.
  amount                 numeric(38,18) NULL CHECK (amount IS NULL OR amount >= 0),
  currency               varchar(16)    NULL REFERENCES fx.currency (code),
  direction              text           NULL CHECK (direction IN ('IN', 'OUT')),
  description            text           NULL CHECK (description IS NULL OR length(description) <= 500),
  occurrence_index       integer        NULL CHECK (occurrence_index IS NULL OR occurrence_index >= 0),
  fingerprint            bytea          NULL CHECK (fingerprint IS NULL OR octet_length(fingerprint) = 32),
  -- NULL = fila de encabezado, saltada o aún sin clasificar (antes de aplicar el mapeo).
  classification         text           NULL CHECK (classification IN
                           ('NEW', 'DUPLICATE_EXACT', 'DUPLICATE_PROBABLE', 'INVALID')),
  decision               text           NULL CHECK (decision IN ('CREATE', 'SKIP', 'EXCLUDE')),
  issues                 jsonb          NOT NULL DEFAULT '[]'::jsonb,
  matched_transaction_id uuid           NULL,
  transaction_id         uuid           NULL,
  batch_no               integer        NULL CHECK (batch_no IS NULL OR batch_no >= 1),
  batch_error            jsonb          NULL,
  CONSTRAINT staged_transaction_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT staged_transaction_job_row_uk UNIQUE (import_job_id, row_number),
  CONSTRAINT staged_transaction_job_fk FOREIGN KEY (workspace_id, import_job_id)
    REFERENCES imports.import_job (workspace_id, id)
);
CREATE INDEX staged_transaction_job_class_ix ON imports.staged_transaction (import_job_id, classification);
CREATE INDEX staged_transaction_fingerprint_ix ON imports.staged_transaction (workspace_id, fingerprint);
CREATE INDEX staged_transaction_batch_ix ON imports.staged_transaction (import_job_id, batch_no)
  WHERE batch_no IS NOT NULL;
COMMENT ON TABLE imports.staged_transaction IS
  'Filas del archivo en staging (celdas crudas + normalización). Dato técnico purgable: 90 días tras terminar, o al cancelar/expirar (docs/13 §11).';

-- ---------------------------------------------------------------- imports.row_link
CREATE TABLE imports.row_link (
  id                    uuid        PRIMARY KEY,
  workspace_id          uuid        NOT NULL REFERENCES iam.workspace (id),
  account_id            uuid        NOT NULL,
  fingerprint           bytea       NOT NULL CHECK (octet_length(fingerprint) = 32),
  -- Referencia lógica a txn.transaction (otro schema, sin FK).
  transaction_id        uuid        NOT NULL,
  staged_transaction_id uuid        NULL,
  kind                  text        NOT NULL CHECK (kind IN ('CREATED', 'SKIPPED_AS_DUPLICATE')),
  status                text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz NULL,
  CONSTRAINT row_link_staged_fk FOREIGN KEY (workspace_id, staged_transaction_id)
    REFERENCES imports.staged_transaction (workspace_id, id) ON DELETE SET NULL (staged_transaction_id),
  CONSTRAINT row_link_superseded_ck CHECK ((status = 'SUPERSEDED') = (superseded_at IS NOT NULL))
);
-- Idempotencia por fila (INV-014): una huella ACTIVE por cuenta.
CREATE UNIQUE INDEX row_link_active_uk ON imports.row_link (workspace_id, account_id, fingerprint)
  WHERE status = 'ACTIVE';
CREATE INDEX row_link_transaction_ix ON imports.row_link (workspace_id, transaction_id);
COMMENT ON TABLE imports.row_link IS
  'Vínculo huella de fila → transacción (imports/import-pipeline, INV-014). Se conserva al purgar el staging.';

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE imports.import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.import_job FORCE ROW LEVEL SECURITY;
ALTER TABLE imports.staged_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.staged_transaction FORCE ROW LEVEL SECURITY;
ALTER TABLE imports.row_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.row_link FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON imports.import_job TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON imports.staged_transaction TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON imports.row_link TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA imports FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON imports.import_job TO pf_app;
-- DELETE solo sobre el staging: cancelar (API) y expirar o purgar (worker) descartan las celdas crudas.
GRANT SELECT, INSERT, UPDATE, DELETE ON imports.staged_transaction TO pf_app;
GRANT SELECT, INSERT, UPDATE ON imports.row_link TO pf_app;

-- Purga del workspace demo (ADR-0026): hijas antes que padres (row_link → staged → job).
SELECT platform.register_workspace_scoped_table('imports.row_link'::regclass, 6, 'DELETE');
SELECT platform.register_workspace_scoped_table('imports.staged_transaction'::regclass, 7, 'DELETE');
SELECT platform.register_workspace_scoped_table('imports.import_job'::regclass, 8, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'imports' AND table_name IN ('row_link', 'staged_transaction', 'import_job');
DROP TABLE imports.row_link;
DROP TABLE imports.staged_transaction;
DROP TABLE imports.import_job;
DROP SCHEMA imports;
