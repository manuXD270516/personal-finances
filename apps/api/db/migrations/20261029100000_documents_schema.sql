-- DOCUMENTS: adjuntos de documentos (openspec add-document-attachments, tareas 4.1 y 4.2; design.md § Modelo de datos;
-- docs/08 §5.11, docs/57 D313–D323). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * documents.document         WS: SELECT/INSERT/UPDATE. El documento y su máquina de estados (`PENDING_UPLOAD`,
--     `UPLOADED`, `AVAILABLE`, `REJECTED`, `DELETED`, `CONTENT_PENDING`). Sin DELETE: los metadatos se conservan tras
--     eliminar el contenido (crypto-shredding: `wrapped_key` y `key_id` pasan a NULL). `{ key_id, wrapped_key }` es la
--     clave de datos envuelta; la clave maestra nunca está en la base ni en el bucket.
--   * documents.attachment_link  WS: SELECT/INSERT/DELETE. Vínculo N:M polimórfico (sin FK cruzadas, ARCHITECTURE §2).
--     Desvincular borra la fila (no es un dato financiero) y queda auditado.
--   * documents.storage_usage    WS: SELECT/INSERT/UPDATE. Contadores de la cuota (usado, reservado, pendientes).
--   * RLS forzada y fail-closed (`platform.current_workspace_id()` lanza PF002 sin contexto) en las tres; registro en
--     `platform.workspace_scoped_table` (purga demo, ADR-0026), hijas antes que padres.
--   * `retention_scan` para `pf_maintenance` (patrón de D308–D310, fix-rls-fail-closed-gaps): los jobs de
--     mantenimiento encuentran candidatos entre workspaces SIN contexto, solo SELECT y solo de columnas operativas
--     (nunca `object_key`, `wrapped_key` ni el nombre original). Cada mutación corre después con el contexto de su
--     workspace. `pf_worker` es miembro de `pf_app` y hereda sus grants y políticas.
--   * iam.workspace_export: columnas `contents_*` del archivo de contenidos de documentos (D315), todas NULL.
--   * audit.lifecycle_state_divergences(): cubre también `Document`.
-- Los elementos destino de los vínculos son lógicos (NFR-DATA-015); la única FK física es hacia `iam.workspace`.

-- migrate:up
CREATE SCHEMA documents;
GRANT USAGE ON SCHEMA documents TO pf_app, pf_maintenance;

-- ---------------------------------------------------------------- documents.document
CREATE TABLE documents.document (
  id                       uuid        PRIMARY KEY,
  workspace_id             uuid        NOT NULL REFERENCES iam.workspace (id),
  purpose                  text        NOT NULL CHECK (purpose IN
                             ('RECEIPT', 'INVOICE', 'STATEMENT', 'CONTRACT', 'IMPORT_SOURCE', 'OTHER')),
  status                   text        NOT NULL CHECK (status IN
                             ('PENDING_UPLOAD', 'UPLOADED', 'AVAILABLE', 'REJECTED', 'DELETED', 'CONTENT_PENDING')),
  original_name            text        NOT NULL CHECK (length(original_name) BETWEEN 1 AND 1020),
  extension                text        NOT NULL CHECK (length(extension) BETWEEN 1 AND 10),
  declared_content_type    text        NOT NULL,
  declared_format          text        NOT NULL CHECK (declared_format IN
                             ('PDF', 'PNG', 'JPEG', 'WEBP', 'HEIC', 'CSV', 'OFX', 'QIF', 'JSON', 'XLSX')),
  detected_content_type    text        NULL,
  detected_format          text        NULL CHECK (detected_format IS NULL OR detected_format IN
                             ('PDF', 'PNG', 'JPEG', 'WEBP', 'HEIC', 'CSV', 'OFX', 'QIF', 'JSON', 'XLSX')),
  size_bytes               bigint      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256                   bytea       NOT NULL CHECK (octet_length(sha256) = 32),
  quarantine_key           text        NULL,
  object_key               text        NULL,
  encrypted_size_bytes     bigint      NULL CHECK (encrypted_size_bytes IS NULL OR encrypted_size_bytes > 0),
  key_id                   text        NULL,
  wrapped_key              bytea       NULL,
  envelope_version         smallint    NULL,
  scan_status              text        NULL CHECK (scan_status IS NULL OR scan_status IN ('NOT_SCANNED', 'CLEAN')),
  scan_engine              text        NULL,
  rejection_reason         text        NULL,
  upload_expires_at        timestamptz NULL,
  verification_started_at  timestamptz NULL,
  uploaded_at              timestamptz NULL,
  available_at             timestamptz NULL,
  rejected_at              timestamptz NULL,
  archived_at              timestamptz NULL,
  archived_by              uuid        NULL,
  deleted_at               timestamptz NULL,
  deleted_by               text        NULL,
  last_unlinked_at         timestamptz NULL,
  restored_from            jsonb       NULL,
  created_by               uuid        NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT document_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT document_object_key_uk UNIQUE (workspace_id, object_key),
  CONSTRAINT document_rejected_ck CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CONSTRAINT document_available_ck CHECK (
    status <> 'AVAILABLE' OR (object_key IS NOT NULL AND key_id IS NOT NULL AND wrapped_key IS NOT NULL)),
  CONSTRAINT document_deleted_ck CHECK (status <> 'DELETED' OR wrapped_key IS NULL),
  CONSTRAINT document_key_pair_ck CHECK ((key_id IS NULL) = (wrapped_key IS NULL))
);
-- Deduplicación por contenido dentro del workspace (FR-DOCUMENTS-006): un solo documento disponible por suma.
CREATE UNIQUE INDEX document_sha256_available_uk ON documents.document (workspace_id, sha256)
  WHERE status = 'AVAILABLE';
CREATE INDEX document_pending_ix ON documents.document (workspace_id, status)
  WHERE status IN ('PENDING_UPLOAD', 'UPLOADED');
CREATE INDEX document_purpose_ix ON documents.document (workspace_id, purpose, available_at DESC);
CREATE INDEX document_listing_ix ON documents.document (workspace_id, created_at DESC, id DESC);
CREATE INDEX document_key_id_ix ON documents.document (key_id) WHERE wrapped_key IS NOT NULL;
COMMENT ON TABLE documents.document IS
  'Documento adjunto (documents/attachments). El contenido vive cifrado en el bucket de documentos; aquí solo metadatos y la clave de datos envuelta. original_name es PII potencial: nunca a logs, métricas, auditoría ni claves de objeto.';
COMMENT ON COLUMN documents.document.wrapped_key IS
  'Clave de datos AES-256 envuelta con la clave maestra `key_id` (cifrado de sobre). NULL tras eliminar (crypto-shredding).';

-- ---------------------------------------------------------------- documents.attachment_link
CREATE TABLE documents.attachment_link (
  id            uuid        PRIMARY KEY,
  workspace_id  uuid        NOT NULL REFERENCES iam.workspace (id),
  document_id   uuid        NOT NULL,
  target_type   text        NOT NULL CHECK (target_type IN
                  ('TRANSACTION', 'CONVERSION', 'LOAN', 'SUBSCRIPTION', 'ACCOUNT', 'IMPORT_JOB', 'MONTH_CLOSING')),
  target_id     uuid        NOT NULL,
  created_by    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_link_document_fk FOREIGN KEY (workspace_id, document_id)
    REFERENCES documents.document (workspace_id, id),
  CONSTRAINT attachment_link_uk UNIQUE (workspace_id, document_id, target_type, target_id)
);
CREATE INDEX attachment_link_target_ix ON documents.attachment_link (workspace_id, target_type, target_id);
COMMENT ON TABLE documents.attachment_link IS
  'Vínculo N:M de un documento con un elemento del workspace (sin FK cruzadas: el destino lo valida el contrato de su contexto dueño). El CHECK de target_type se amplía (expand) cuando haya un uso (D321).';

-- ---------------------------------------------------------------- documents.storage_usage
CREATE TABLE documents.storage_usage (
  workspace_id     uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  used_bytes       bigint      NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes   bigint      NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  pending_uploads  integer     NOT NULL DEFAULT 0 CHECK (pending_uploads >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE documents.storage_usage IS
  'Contadores de la cuota por workspace (decisión 11). Se actualizan en la misma transacción que la transición del documento; la fila se bloquea para serializar las solicitudes concurrentes.';

-- ---------------------------------------------------------------- RLS forzada (fail-closed) y grants
ALTER TABLE documents.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.document FORCE ROW LEVEL SECURITY;
ALTER TABLE documents.attachment_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.attachment_link FORCE ROW LEVEL SECURITY;
ALTER TABLE documents.storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.storage_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON documents.document TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON documents.attachment_link TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON documents.storage_usage TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA documents FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON documents.document TO pf_app;
GRANT SELECT, INSERT, DELETE ON documents.attachment_link TO pf_app;
GRANT SELECT, INSERT, UPDATE ON documents.storage_usage TO pf_app;

-- Barrido de mantenimiento entre workspaces (jobs de DOCUMENTS), como `pf_maintenance` asumido con SET LOCAL ROLE solo
-- en esa transacción (D308–D310). Solo SELECT y solo columnas operativas: sin object_key, wrapped_key ni original_name.
CREATE POLICY retention_scan ON documents.document FOR SELECT TO pf_maintenance USING (true);
CREATE POLICY retention_scan ON documents.attachment_link FOR SELECT TO pf_maintenance USING (true);
GRANT SELECT (id, workspace_id, status, upload_expires_at, verification_started_at, available_at, created_at,
              last_unlinked_at, archived_at, key_id) ON documents.document TO pf_maintenance;
GRANT SELECT (workspace_id, document_id) ON documents.attachment_link TO pf_maintenance;

-- Purga del workspace demo (ADR-0026): vínculos → documentos; los objetos quedan huérfanos y los barre
-- `SweepOrphanObjects` (las claves ya no existen: crypto-shredding).
SELECT platform.register_workspace_scoped_table('documents.attachment_link'::regclass, 198, 'DELETE');
SELECT platform.register_workspace_scoped_table('documents.document'::regclass, 199, 'DELETE');
SELECT platform.register_workspace_scoped_table('documents.storage_usage'::regclass, 199, 'DELETE');

-- ---------------------------------------------------------------- iam.workspace_export: archivo de contenidos (D315)
ALTER TABLE iam.workspace_export
  ADD COLUMN contents_object_key  text    NULL,
  ADD COLUMN contents_size_bytes  bigint  NULL CHECK (contents_size_bytes IS NULL OR contents_size_bytes >= 0),
  ADD COLUMN contents_sha256      bytea   NULL CHECK (contents_sha256 IS NULL OR octet_length(contents_sha256) = 32),
  ADD COLUMN contents_key_id      text    NULL,
  ADD COLUMN contents_wrapped_key bytea   NULL,
  ADD COLUMN contents_count       integer NULL CHECK (contents_count IS NULL OR contents_count >= 0);
COMMENT ON COLUMN iam.workspace_export.contents_wrapped_key IS
  'Clave de datos del archivo de contenidos de documentos, envuelta con la clave maestra `contents_key_id` (llavero de exports).';
GRANT UPDATE (contents_object_key, contents_size_bytes, contents_sha256, contents_key_id, contents_wrapped_key,
              contents_count) ON iam.workspace_export TO pf_app;

-- Operación asíncrona de la restauración del archivo de contenidos (tarea 8.3): se amplía el conjunto de `kind`.
ALTER TABLE platform.operation DROP CONSTRAINT operation_kind_check;
ALTER TABLE platform.operation
  ADD CONSTRAINT operation_kind_check CHECK (kind IN ('EXPORT', 'DOCUMENT_CONTENTS_RESTORE'));

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + Document.
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringDefinition', rd.id, rd.status
      FROM commitments.recurring_definition rd WHERE rd.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringOccurrence', ro.id, ro.status
      FROM commitments.recurring_occurrence ro WHERE ro.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Subscription', s.id, s.status
      FROM commitments.subscription s WHERE s.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Loan', l.id, l.status
      FROM debt.loan l WHERE l.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'SavingsGoal', g.id, g.status
      FROM goals.savings_goal g WHERE g.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Document', d.id, d.status
      FROM documents.document d WHERE d.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Reconciliation', rc.id, rc.status
      FROM txn.reconciliation rc WHERE rc.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringDefinition', rd.id, rd.status
      FROM commitments.recurring_definition rd WHERE rd.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'RecurringOccurrence', ro.id, ro.status
      FROM commitments.recurring_occurrence ro WHERE ro.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Subscription', s.id, s.status
      FROM commitments.subscription s WHERE s.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Loan', l.id, l.status
      FROM debt.loan l WHERE l.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'SavingsGoal', g.id, g.status
      FROM goals.savings_goal g WHERE g.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;

DELETE FROM platform.operation WHERE kind = 'DOCUMENT_CONTENTS_RESTORE';
ALTER TABLE platform.operation DROP CONSTRAINT operation_kind_check;
ALTER TABLE platform.operation ADD CONSTRAINT operation_kind_check CHECK (kind IN ('EXPORT'));
REVOKE UPDATE (contents_object_key, contents_size_bytes, contents_sha256, contents_key_id, contents_wrapped_key,
               contents_count) ON iam.workspace_export FROM pf_app;
ALTER TABLE iam.workspace_export
  DROP COLUMN contents_count, DROP COLUMN contents_wrapped_key, DROP COLUMN contents_key_id,
  DROP COLUMN contents_sha256, DROP COLUMN contents_size_bytes, DROP COLUMN contents_object_key;
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'documents';
DROP SCHEMA documents CASCADE;
