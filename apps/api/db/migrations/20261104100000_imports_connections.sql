-- IMPORTS: conexiones con proveedores bancarios y de exchange (openspec add-banking-providers, tarea 4.1; design.md
-- § Modelo de datos; docs/13 §6 y §14). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * imports.connection             Conexión con un proveedor: mapeo de activos a cuentas, estado, cursor CONFIRMADO,
--     sincronización pendiente (cursor provisional), espera persistida (`retry_not_before`). WS forzada; `pf_app`
--     SELECT/INSERT/UPDATE (el worker hereda). Sin DELETE: la conexión revocada se conserva (auditoría).
--   * imports.connection_credential  Credencial CIFRADA con sobre X25519 + HKDF + AES-256-GCM (D342: la clave privada
--     solo la tiene el worker). Grants POR COLUMNA: `pf_app` cifra y destruye pero NO lee `wrapped_dek` ni `ciphertext`;
--     solo `pf_worker` los lee. La revocación pone ambos en NULL con `destroyed_at` (destrucción criptográfica). La
--     tabla se EXCLUYE del export del workspace (identity/workspace-portability).
--   * imports.import_job             `connection_id` (nullable) y las fuentes `EXCHANGE_API` y `EXCHANGE_FILE`.
--   * imports.staged_transaction     `account_id` (cuenta de la fila en un import de varias cuentas) y `external`
--     (referencia externa, señal y conversión propuesta de un registro del proveedor).
--   * audit.lifecycle_state_divergences(): cubre también `ImportConnection`.
-- Los índices únicos parciales (`CONCURRENTLY`) van en las migraciones siguientes. Referencias a otros schemas lógicas.

-- migrate:up

-- ---------------------------------------------------------------- imports.connection
CREATE TABLE imports.connection (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  provider_id         text        NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  status              text        NOT NULL CHECK (status IN
                        ('PENDING_VERIFICATION', 'ACTIVE', 'NEEDS_ATTENTION', 'REJECTED', 'REVOKED', 'NEEDS_CREDENTIAL')),
  asset_mappings      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sync_cursor         text        NULL,
  cursor_confirmed_at timestamptz NULL,
  pending_sync        jsonb       NULL,
  retry_not_before    timestamptz NULL,
  last_error_code     text        NULL,
  last_sync_at        timestamptz NULL,
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  revoked_at          timestamptz NULL,
  CONSTRAINT connection_revoked_ck CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CONSTRAINT connection_ws_id_uk UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX connection_name_uk ON imports.connection (workspace_id, lower(name)) WHERE status <> 'REVOKED';
CREATE INDEX connection_ws_ix ON imports.connection (workspace_id, created_at DESC, id DESC);
COMMENT ON TABLE imports.connection IS
  'Conexión con un proveedor de movimientos (imports/banking-providers, FR-IMPORTS-013): mapeo de activos a cuentas, estado y cursor confirmado. Sin credenciales.';

-- ---------------------------------------------------------------- imports.connection_credential
CREATE TABLE imports.connection_credential (
  workspace_id         uuid        NOT NULL REFERENCES iam.workspace (id),
  connection_id        uuid        NOT NULL,
  credential_version   integer     NOT NULL CHECK (credential_version >= 1),
  kid                  text        NOT NULL,
  ephemeral_public_key bytea       NOT NULL,
  wrapped_dek          bytea       NULL,
  dek_nonce            bytea       NOT NULL,
  ciphertext           bytea       NULL,
  nonce                bytea       NOT NULL,
  key_fingerprint      text        NOT NULL CHECK (length(key_fingerprint) <= 16),
  permissions          jsonb       NULL,
  verified_at          timestamptz NULL,
  destroyed_at         timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id),
  CONSTRAINT connection_credential_conn_fk FOREIGN KEY (workspace_id, connection_id)
    REFERENCES imports.connection (workspace_id, id),
  CONSTRAINT connection_credential_destroyed_ck
    CHECK ((destroyed_at IS NULL) = (wrapped_dek IS NOT NULL AND ciphertext IS NOT NULL))
);
COMMENT ON TABLE imports.connection_credential IS
  'Credencial cifrada (cifrado de sobre X25519): la API no puede leer wrapped_dek ni ciphertext (grants por columna); solo el worker. Excluida del export.';

-- ---------------------------------------------------------------- RLS (WS) y grants
ALTER TABLE imports.connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.connection FORCE ROW LEVEL SECURITY;
ALTER TABLE imports.connection_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.connection_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON imports.connection TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON imports.connection_credential TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON imports.connection FROM PUBLIC;
REVOKE ALL ON imports.connection_credential FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON imports.connection TO pf_app;
-- pf_app cifra (INSERT), destruye (UPDATE) y lee solo lo no secreto; el texto cifrado y la clave envuelta solo los lee el worker.
GRANT SELECT (workspace_id, connection_id, credential_version, kid, ephemeral_public_key, dek_nonce, nonce,
              key_fingerprint, permissions, verified_at, destroyed_at, created_at)
  ON imports.connection_credential TO pf_app;
GRANT INSERT ON imports.connection_credential TO pf_app;
GRANT UPDATE (credential_version, kid, ephemeral_public_key, wrapped_dek, dek_nonce, ciphertext, nonce,
              key_fingerprint, permissions, verified_at, destroyed_at)
  ON imports.connection_credential TO pf_app;
GRANT SELECT ON imports.connection_credential TO pf_worker;

SELECT platform.register_workspace_scoped_table('imports.connection_credential'::regclass, 9, 'DELETE');
SELECT platform.register_workspace_scoped_table('imports.connection'::regclass, 10, 'DELETE');

-- ---------------------------------------------------------------- imports.import_job
ALTER TABLE imports.import_job ADD COLUMN connection_id uuid NULL;
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check
  CHECK (source IN ('FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX', 'FILE_PDF',
                    'EXCHANGE_API', 'EXCHANGE_FILE'));
CREATE INDEX import_job_connection_ix ON imports.import_job (workspace_id, connection_id) WHERE connection_id IS NOT NULL;

-- ---------------------------------------------------------------- imports.staged_transaction
ALTER TABLE imports.staged_transaction
  ADD COLUMN account_id uuid  NULL,
  ADD COLUMN external   jsonb NULL;

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
    UNION ALL
    SELECT 'ImportJob', ij.id, ij.status
      FROM imports.import_job ij WHERE ij.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ImportConnection', ic.id, ic.status
      FROM imports.connection ic WHERE ic.workspace_id = platform.current_workspace_id()
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
    UNION ALL
    SELECT 'Document', d.id, d.status
      FROM documents.document d WHERE d.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ImportJob', ij.id, ij.status
      FROM imports.import_job ij WHERE ij.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
ALTER TABLE imports.staged_transaction DROP COLUMN account_id, DROP COLUMN external;
DROP INDEX imports.import_job_connection_ix;
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check
  CHECK (source IN ('FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX', 'FILE_PDF'));
ALTER TABLE imports.import_job DROP COLUMN connection_id;
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'imports' AND table_name IN ('connection_credential', 'connection');
DROP TABLE imports.connection_credential;
DROP TABLE imports.connection;
