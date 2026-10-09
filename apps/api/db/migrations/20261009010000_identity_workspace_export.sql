-- IDENTITY: exportación e importación del workspace (openspec add-workspace-export, tarea 4.1; design.md § Modelo de
-- datos y decisiones 4, 7, 8 y 10; docs/08 §OPERATION; docs/30 §10-§11; ADR-0023). Expand, no destructiva. Se ejecuta
-- con `pf_migrator`.
--
--   * platform.operation        WS: operación asíncrona `202 + operation` (docs/10 §8). La crea este change (es el único
--     de Phase 2 con operaciones asíncronas). pf_app: SELECT/INSERT; pf_worker (hereda pf_app) además UPDATE de las
--     columnas de progreso/resultado.
--   * iam.workspace_export      WS forzada: una exportación (REQUESTED → RUNNING → READY | FAILED; READY → EXPIRED |
--     DISCARDED). Único parcial: UNA exportación en curso por workspace. Guarda `{ key_id, wrapped_key }` de la clave de
--     datos (cifrado de sobre); la clave maestra NUNCA está en la base ni en el bucket. El registro se conserva al
--     expirar o eliminarse el archivo (fechas, tamaño, sha256, actor).
--   * iam.workspace_import      RLS por solicitante (`requested_by`): aún no existe el workspace destino. Una importación
--     en curso por usuario. El archivo subido vive cifrado en el bucket de exports hasta terminar.
--   * iam.workspace             `status` admite RESTORING (el workspace nace RESTORING y pasa a ACTIVE en el mismo commit
--     de la importación) y `restored_from_export jsonb` (origen de la restauración).
--
-- Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
-- Sin backfill.

-- migrate:up

-- ---------------------------------------------------------------- iam.workspace
ALTER TABLE iam.workspace DROP CONSTRAINT workspace_status_check;
ALTER TABLE iam.workspace
  ADD CONSTRAINT workspace_status_check
    CHECK (status IN ('ACTIVE', 'PENDING_DELETION', 'ARCHIVED', 'PURGED', 'RESTORING'));
ALTER TABLE iam.workspace
  ADD COLUMN restored_from_export jsonb NULL
    CONSTRAINT workspace_restored_from_export_object CHECK (
      restored_from_export IS NULL OR jsonb_typeof(restored_from_export) = 'object');
COMMENT ON COLUMN iam.workspace.restored_from_export IS
  'Origen de un workspace creado por importación: { sourceWorkspaceId, exportedAt, importId } (FR-IDENTITY-017).';
GRANT INSERT (restored_from_export), UPDATE (restored_from_export) ON iam.workspace TO pf_app;

-- ---------------------------------------------------------------- platform.operation
CREATE TABLE platform.operation (
  id            uuid        PRIMARY KEY,
  workspace_id  uuid        NOT NULL REFERENCES iam.workspace (id),
  kind          text        NOT NULL CHECK (kind IN ('EXPORT')),
  status        text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  progress_pct  smallint    NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  resource_type text        NOT NULL,
  resource_id   uuid        NOT NULL,
  result        jsonb       NULL CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error         jsonb       NULL CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  requested_by  uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NULL,
  CONSTRAINT operation_ws_id_uk UNIQUE (workspace_id, id)
);
CREATE INDEX operation_resource_ix ON platform.operation (workspace_id, resource_type, resource_id);
COMMENT ON TABLE platform.operation IS
  'Operaciones asíncronas consultables (docs/10 §8): hoy EXPORT. Sin datos financieros: solo estado y referencias.';
ALTER TABLE platform.operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.operation FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON platform.operation TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
REVOKE ALL ON platform.operation FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT ON platform.operation TO pf_app;
GRANT UPDATE (status, progress_pct, result, error, updated_at) ON platform.operation TO pf_worker;

-- ---------------------------------------------------------------- iam.workspace_export
CREATE TABLE iam.workspace_export (
  id            uuid        PRIMARY KEY,
  workspace_id  uuid        NOT NULL REFERENCES iam.workspace (id),
  operation_id  uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'REQUESTED'
                            CHECK (status IN ('REQUESTED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED', 'DISCARDED')),
  format_version integer     NOT NULL CHECK (format_version >= 1),
  object_key    text        NULL,
  size_bytes    bigint      NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256        bytea       NULL CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  key_id        text        NULL,
  wrapped_key   bytea       NULL,
  counts        jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(counts) = 'object'),
  requested_by  uuid        NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz NULL,
  expires_at    timestamptz NULL,
  discarded_at  timestamptz NULL,
  discarded_by  uuid        NULL,
  expired_at    timestamptz NULL,
  error         jsonb       NULL CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT workspace_export_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT workspace_export_operation_fk FOREIGN KEY (workspace_id, operation_id)
    REFERENCES platform.operation (workspace_id, id),
  -- READY exige archivo cifrado completo; el archivo solo existe mientras está READY.
  CONSTRAINT workspace_export_ready_shape CHECK (
    status <> 'READY' OR (object_key IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL
      AND key_id IS NOT NULL AND wrapped_key IS NOT NULL AND completed_at IS NOT NULL AND expires_at IS NOT NULL)),
  CONSTRAINT workspace_export_gone_no_object CHECK (status NOT IN ('EXPIRED', 'DISCARDED', 'FAILED') OR object_key IS NULL)
);
-- UNA exportación en curso por workspace (EXPORT_IN_PROGRESS, también bajo concurrencia).
CREATE UNIQUE INDEX workspace_export_in_progress_uq ON iam.workspace_export (workspace_id)
  WHERE status IN ('REQUESTED', 'RUNNING');
CREATE INDEX workspace_export_listing_ix ON iam.workspace_export (workspace_id, requested_at DESC, id DESC);
-- Barrido de retención (job `identity.export-retention`): solo los READY por expirar.
CREATE INDEX workspace_export_expiry_ix ON iam.workspace_export (expires_at) WHERE status = 'READY';
COMMENT ON TABLE iam.workspace_export IS
  'Exportación del workspace (identity/workspace-portability): metadatos y clave de datos ENVUELTA; el archivo cifrado vive en el bucket de exports y expira (docs/33 D102).';
COMMENT ON COLUMN iam.workspace_export.wrapped_key IS
  'Clave de datos AES-256 envuelta con la clave maestra `key_id` (cifrado de sobre). La clave maestra nunca se guarda aquí.';
ALTER TABLE iam.workspace_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.workspace_export FORCE ROW LEVEL SECURITY;
-- `current_workspace_id_if_set()`: sin contexto NO lanza (el barrido de retención lee entre workspaces por `retention_scan`);
-- las escrituras siguen exigiendo el workspace (NULL nunca iguala una fila).
CREATE POLICY ws_isolation ON iam.workspace_export TO pf_app
  USING (workspace_id = platform.current_workspace_id_if_set())
  WITH CHECK (workspace_id = platform.current_workspace_id_if_set());
REVOKE ALL ON iam.workspace_export FROM PUBLIC, pf_app, pf_worker;
-- Barrido de retención (job `identity.export-retention`, rol pf_worker, entre workspaces): SOLO ve los exports vencidos
-- (READY con `expires_at` pasado); cualquier escritura sigue exigiendo el contexto del workspace (política ws_isolation).
CREATE POLICY retention_scan ON iam.workspace_export FOR SELECT TO pf_worker
  USING (status = 'READY' AND expires_at < now());
GRANT SELECT, INSERT ON iam.workspace_export TO pf_app;
GRANT UPDATE (status, object_key, size_bytes, sha256, key_id, wrapped_key, counts, completed_at, expires_at,
              discarded_at, discarded_by, expired_at, error, version) ON iam.workspace_export TO pf_app;

-- ---------------------------------------------------------------- iam.workspace_import
CREATE TABLE iam.workspace_import (
  id                  uuid        PRIMARY KEY,
  requested_by        uuid        NOT NULL REFERENCES iam."user" (id),
  status              text        NOT NULL DEFAULT 'RECEIVED'
                                  CHECK (status IN ('RECEIVED', 'VALIDATING', 'IMPORTING', 'VERIFYING', 'SUCCEEDED', 'FAILED')),
  object_key          text        NULL,
  key_id              text        NULL,
  wrapped_key         bytea       NULL,
  size_bytes          bigint      NOT NULL CHECK (size_bytes >= 0),
  source_workspace_id uuid        NOT NULL,
  source_exported_at  timestamptz NOT NULL,
  format_version      integer     NOT NULL CHECK (format_version >= 1),
  target_workspace_id uuid        NULL REFERENCES iam.workspace (id),
  report              jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(report) = 'object'),
  error               jsonb       NULL CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz NULL,
  CONSTRAINT workspace_import_target_iff_ok CHECK ((status = 'SUCCEEDED') = (target_workspace_id IS NOT NULL))
);
-- Una importación en curso por usuario.
CREATE UNIQUE INDEX workspace_import_in_progress_uq ON iam.workspace_import (requested_by)
  WHERE status IN ('RECEIVED', 'VALIDATING', 'IMPORTING', 'VERIFYING');
CREATE INDEX workspace_import_requester_ix ON iam.workspace_import (requested_by, created_at DESC, id DESC);
COMMENT ON TABLE iam.workspace_import IS
  'Importación de un export a un workspace NUEVO (FR-IDENTITY-017). Sin workspace_id: aún no existe; RLS por solicitante.';
ALTER TABLE iam.workspace_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.workspace_import FORCE ROW LEVEL SECURITY;
CREATE POLICY requester_isolation ON iam.workspace_import TO pf_app
  USING (requested_by = platform.current_user_id()) WITH CHECK (requested_by = platform.current_user_id());
REVOKE ALL ON iam.workspace_import FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT, INSERT ON iam.workspace_import TO pf_app;
GRANT UPDATE (status, object_key, key_id, wrapped_key, target_workspace_id, report, error, completed_at)
  ON iam.workspace_import TO pf_app;

-- El export resuelve los nombres de los miembros en el manifiesto (`actors`): el rol de directorio (solo el worker lo asume con
-- SET LOCAL ROLE) gana UNA columna más de iam."user"; sigue sin ver issuer/subject ni preferencias.
GRANT SELECT (display_name) ON iam."user" TO pf_workspace_directory;

-- Purga del workspace demo (ADR-0026): después de los asientos y antes de la membresía (180); la exportación (hija)
-- antes que su operación (padre).
SELECT platform.register_workspace_scoped_table('iam.workspace_export'::regclass, 171, 'DELETE');
SELECT platform.register_workspace_scoped_table('platform.operation'::regclass, 172, 'DELETE');

-- migrate:down
REVOKE SELECT (display_name) ON iam."user" FROM pf_workspace_directory;
DELETE FROM platform.workspace_scoped_table
 WHERE (schema_name = 'iam' AND table_name = 'workspace_export')
    OR (schema_name = 'platform' AND table_name = 'operation');
DROP TABLE iam.workspace_import;
DROP TABLE iam.workspace_export;
DROP TABLE platform.operation;
REVOKE INSERT (restored_from_export), UPDATE (restored_from_export) ON iam.workspace FROM pf_app;
ALTER TABLE iam.workspace DROP COLUMN restored_from_export;
ALTER TABLE iam.workspace DROP CONSTRAINT workspace_status_check;
ALTER TABLE iam.workspace
  ADD CONSTRAINT workspace_status_check CHECK (status IN ('ACTIVE', 'PENDING_DELETION', 'ARCHIVED', 'PURGED'));
