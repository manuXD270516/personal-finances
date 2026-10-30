-- IMPORTS: pipeline completo de Phase 6 (openspec add-import-pipeline, tarea 5.1; design.md § Modelo de datos; docs/13
-- §14). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * imports.mapping_profile  Perfiles de mapeo por institución, versionados e INMUTABLES por versión (PK (id, version)).
--     WS forzada; `pf_app` SELECT/INSERT y UPDATE solo de `archived_at` (archivar afecta al perfil completo);
--     `pf_worker` hereda de `pf_app`. Referencias a institución y cuenta lógicas (sin FK, NFR-DATA-015).
--   * imports.import_job       Columnas nullable del documento de origen, formato, perfil aplicado, ayuda de mapeo, saldo
--     del extracto, reconciliación, deshacer, cobertura de reglas y falla de lectura; CHECK de `source` y `status`
--     ampliados (los jobs previos siguen válidos); `import_job_approved_ck` admite los estados previos a la aprobación.
--   * imports.staged_transaction Columnas nullable de la fila: identificador externo, hora, fecha valor, saldo corrido,
--     tipo, propuesta de clasificación (origen por campo), ediciones del usuario, candidatos con puntaje, candidatas de
--     compromisos, vínculo confirmado, decisión con su autor y puntaje, y advertencias.
--   * imports.row_link         Identificador externo, job de origen (para superar los vínculos al deshacer) e índice.
--   * audit.lifecycle_state_divergences(): cubre también `ImportJob`.
-- Sin DEFAULT que reescriba tablas. Los datos previos (CSV básico) no cambian.

-- migrate:up

-- ---------------------------------------------------------------- imports.mapping_profile
CREATE TABLE imports.mapping_profile (
  id                     uuid        NOT NULL,
  version                integer     NOT NULL CHECK (version >= 1),
  workspace_id           uuid        NOT NULL REFERENCES iam.workspace (id),
  institution_id         uuid        NULL,
  account_id             uuid        NULL,
  name                   text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  format                 text        NOT NULL CHECK (format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX')),
  options                jsonb       NOT NULL,
  options_schema_version smallint    NOT NULL DEFAULT 1,
  archived_at            timestamptz NULL,
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT mapping_profile_target_ck CHECK (institution_id IS NOT NULL OR account_id IS NOT NULL)
);
CREATE INDEX mapping_profile_institution_ix ON imports.mapping_profile (workspace_id, institution_id, format)
  WHERE archived_at IS NULL;
CREATE INDEX mapping_profile_account_ix ON imports.mapping_profile (workspace_id, account_id, format)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX mapping_profile_name_version_uk ON imports.mapping_profile (workspace_id, lower(name), version);
CREATE INDEX mapping_profile_ws_ix ON imports.mapping_profile (workspace_id, id);
COMMENT ON TABLE imports.mapping_profile IS
  'Perfil de mapeo por institución (imports/import-pipeline, FR-IMPORTS-005): una fila por versión, inmutable salvo archived_at.';

ALTER TABLE imports.mapping_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports.mapping_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON imports.mapping_profile TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
REVOKE ALL ON imports.mapping_profile FROM PUBLIC;
GRANT SELECT, INSERT ON imports.mapping_profile TO pf_app;
GRANT UPDATE (archived_at) ON imports.mapping_profile TO pf_app;
SELECT platform.register_workspace_scoped_table('imports.mapping_profile'::regclass, 9, 'DELETE');

-- ---------------------------------------------------------------- imports.import_job
ALTER TABLE imports.import_job
  ADD COLUMN document_id             uuid        NULL,
  ADD COLUMN format                  text        NULL,
  ADD COLUMN mapping_profile_id      uuid        NULL,
  ADD COLUMN mapping_profile_version integer     NULL,
  ADD COLUMN profile_mapping         jsonb       NULL,
  ADD COLUMN read_options            jsonb       NULL,
  ADD COLUMN mapping_help            jsonb       NULL,
  ADD COLUMN statement               jsonb       NULL,
  ADD COLUMN reconciliation          jsonb       NULL,
  ADD COLUMN revert                  jsonb       NULL,
  ADD COLUMN reverted_at             timestamptz NULL,
  ADD COLUMN reverted_by             uuid        NULL,
  ADD COLUMN rules_summary           jsonb       NULL,
  ADD COLUMN failure                 jsonb       NULL;

ALTER TABLE imports.import_job ADD CONSTRAINT import_job_format_ck
  CHECK (format IS NULL OR format IN ('CSV', 'OFX', 'QIF', 'JSON', 'XLSX'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check
  CHECK (source IN ('FILE_CSV', 'FILE_OFX', 'FILE_QIF', 'FILE_JSON', 'FILE_XLSX'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_status_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_status_check CHECK (status IN
  ('UPLOADED', 'PROCESSING', 'PARSE_FAILED', 'AWAITING_MAPPING', 'AWAITING_REVIEW', 'APPROVED', 'PERSISTING',
   'COMPLETED', 'PARTIALLY_FAILED', 'COMPLETED_WITH_DIFFERENCE', 'COMPLETED_WITH_ERRORS', 'REVERTING',
   'ROLLED_BACK', 'PARTIALLY_ROLLED_BACK', 'CANCELLED'));

ALTER TABLE imports.import_job DROP CONSTRAINT import_job_approved_ck;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_approved_ck CHECK (
  (status IN ('UPLOADED', 'PROCESSING', 'PARSE_FAILED', 'AWAITING_MAPPING', 'AWAITING_REVIEW', 'CANCELLED'))
  OR approved_at IS NOT NULL);

CREATE INDEX import_job_document_ix ON imports.import_job (workspace_id, document_id) WHERE document_id IS NOT NULL;

-- ---------------------------------------------------------------- imports.staged_transaction
ALTER TABLE imports.staged_transaction
  ADD COLUMN external_id           text           NULL,
  ADD COLUMN booking_time          time           NULL,
  ADD COLUMN value_date            date           NULL,
  ADD COLUMN running_balance       numeric(38,18) NULL,
  ADD COLUMN reference             text           NULL,
  ADD COLUMN counterparty_text     text           NULL,
  ADD COLUMN kind                  text           NULL CHECK (kind IS NULL OR kind IN
                                     ('EXPENSE', 'INCOME', 'TRANSFER', 'CONVERSION')),
  ADD COLUMN proposal              jsonb          NULL,
  ADD COLUMN edits                 jsonb          NULL,
  ADD COLUMN candidates            jsonb          NULL,
  ADD COLUMN occurrence_candidates jsonb          NULL,
  ADD COLUMN occurrence_link       jsonb          NULL,
  ADD COLUMN duplicate_of_row      integer        NULL CHECK (duplicate_of_row IS NULL OR duplicate_of_row >= 1),
  ADD COLUMN decided_by            uuid           NULL,
  ADD COLUMN decided_at            timestamptz    NULL,
  ADD COLUMN decided_score         numeric(5,4)   NULL,
  ADD COLUMN warnings              jsonb          NULL;
CREATE INDEX staged_transaction_external_ix ON imports.staged_transaction (import_job_id, external_id)
  WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------- imports.row_link
ALTER TABLE imports.row_link
  ADD COLUMN external_ref_namespace text NULL,
  ADD COLUMN external_ref_id        text NULL,
  ADD COLUMN import_job_id          uuid NULL;
CREATE INDEX row_link_job_ix ON imports.row_link (workspace_id, import_job_id) WHERE import_job_id IS NOT NULL;
CREATE INDEX row_link_external_ix ON imports.row_link (workspace_id, account_id, external_ref_id)
  WHERE external_ref_id IS NOT NULL AND status = 'ACTIVE';

-- ---------------------------------------------------------------- audit.lifecycle_state_divergences()
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

-- migrate:down
DROP INDEX imports.row_link_external_ix;
DROP INDEX imports.row_link_job_ix;
ALTER TABLE imports.row_link
  DROP COLUMN external_ref_namespace, DROP COLUMN external_ref_id, DROP COLUMN import_job_id;
DROP INDEX imports.staged_transaction_external_ix;
ALTER TABLE imports.staged_transaction
  DROP COLUMN external_id, DROP COLUMN booking_time, DROP COLUMN value_date, DROP COLUMN running_balance,
  DROP COLUMN reference, DROP COLUMN counterparty_text, DROP COLUMN kind, DROP COLUMN proposal, DROP COLUMN edits,
  DROP COLUMN candidates, DROP COLUMN occurrence_candidates, DROP COLUMN occurrence_link,
  DROP COLUMN duplicate_of_row, DROP COLUMN decided_by, DROP COLUMN decided_at, DROP COLUMN decided_score,
  DROP COLUMN warnings;
DROP INDEX imports.import_job_document_ix;
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_approved_ck;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_approved_ck CHECK (
  (status IN ('AWAITING_MAPPING', 'AWAITING_REVIEW', 'CANCELLED')) OR approved_at IS NOT NULL);
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_status_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_status_check CHECK (status IN
  ('AWAITING_MAPPING', 'AWAITING_REVIEW', 'APPROVED', 'PERSISTING', 'COMPLETED',
   'PARTIALLY_FAILED', 'COMPLETED_WITH_ERRORS', 'CANCELLED'));
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_source_check;
ALTER TABLE imports.import_job ADD CONSTRAINT import_job_source_check CHECK (source IN ('FILE_CSV'));
ALTER TABLE imports.import_job DROP CONSTRAINT import_job_format_ck;
ALTER TABLE imports.import_job
  DROP COLUMN document_id, DROP COLUMN format, DROP COLUMN mapping_profile_id, DROP COLUMN mapping_profile_version,
  DROP COLUMN profile_mapping, DROP COLUMN read_options, DROP COLUMN mapping_help, DROP COLUMN statement, DROP COLUMN reconciliation,
  DROP COLUMN revert, DROP COLUMN reverted_at, DROP COLUMN reverted_by, DROP COLUMN rules_summary,
  DROP COLUMN failure;
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'imports' AND table_name = 'mapping_profile';
DROP TABLE imports.mapping_profile;
