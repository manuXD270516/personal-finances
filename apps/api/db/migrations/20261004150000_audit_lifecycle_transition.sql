-- Recorrido del ciclo de vida (openspec add-lifecycle-timeline, design.md decisiones 5, 6 y 8; docs/31 D37). Expand,
-- no destructiva. Se ejecuta con `pf_migrator`.
--
-- Crea:
--   * `audit.lifecycle_transition` (WS-RO): un paso del flujo de un agregado (transición de estado) o una anotación
--     (cambio descriptivo), escrito por `LifecyclePort` en la MISMA transacción que el cambio, su auditoría y su
--     outbox (INV-029). RLS habilitada y FORZADA por workspace (fail-closed con PF002); solo SELECT/INSERT para
--     `pf_app` (y `pf_worker`, que lo hereda: job `audit.lifecycle-backfill`); UPDATE/DELETE/TRUNCATE bloqueados por
--     grants Y por `platform.forbid_mutation()` (SQLSTATE PF003). Sin montos ni texto libre salvo `reason`.
--   * `audit.lifecycle_state_divergences()`: chequeo de consistencia estado del agregado ↔ `to_state` de su última
--     transición (decisión 6). SECURITY INVOKER: corre con la RLS del workspace del llamador (job del worker).
--
-- `platform.workspace_scoped_table` (add-demo-data) aún no existe: el registro de la tabla para la purga de workspaces
-- demo lo hará ese change.

-- migrate:up
CREATE TABLE audit.lifecycle_transition (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL,
  aggregate_type    text        NOT NULL CHECK (aggregate_type ~ '^[A-Z][A-Za-z]{0,63}$'),
  aggregate_id      uuid        NOT NULL,
  sequence          integer     NOT NULL CHECK (sequence >= 1),
  kind              text        NOT NULL CHECK (kind IN ('TRANSITION', 'ANNOTATION')),
  transition        text        NULL CHECK (transition IS NULL OR transition ~ '^[A-Z][A-Z0-9_]*$'),
  from_state        text        NULL CHECK (from_state IS NULL OR from_state ~ '^[A-Z][A-Z0-9_]*$'),
  to_state          text        NULL CHECK (to_state IS NULL OR to_state ~ '^[A-Z][A-Z0-9_]*$'),
  machine_version   integer     NULL CHECK (machine_version IS NULL OR machine_version >= 1),
  revision_from     integer     NULL CHECK (revision_from IS NULL OR revision_from >= 1),
  revision_to       integer     NULL CHECK (revision_to IS NULL OR revision_to >= 1),
  aggregate_version integer     NULL CHECK (aggregate_version IS NULL OR aggregate_version >= 1),
  occurred_at       timestamptz NOT NULL,
  actor_type        text        NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'WORKER')),
  actor_id          uuid        NULL,
  actor_process     text        NULL CHECK (actor_process IS NULL OR length(actor_process) BETWEEN 1 AND 100),
  origin            text        NOT NULL CHECK (origin IN ('ui', 'api', 'import', 'rule', 'recurring', 'system')),
  reason            text        NULL CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  correlation_id    uuid        NOT NULL,
  audit_log_id      uuid        NULL,
  event_ids         uuid[]      NOT NULL DEFAULT '{}',
  event_types       text[]      NOT NULL DEFAULT '{}',
  journal_entries   jsonb       NOT NULL DEFAULT '{"reversed": null, "reversal": null, "posted": null}'::jsonb
                                CHECK (jsonb_typeof(journal_entries) = 'object'),
  detail_refs       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_refs) = 'object'),
  changed_fields    text[]      NOT NULL DEFAULT '{}',
  derived           boolean     NOT NULL DEFAULT false,
  CONSTRAINT lifecycle_transition_sequence_uk UNIQUE (workspace_id, aggregate_type, aggregate_id, sequence),
  CONSTRAINT lifecycle_transition_kind_ck CHECK (
    (kind = 'TRANSITION' AND transition IS NOT NULL AND to_state IS NOT NULL AND machine_version IS NOT NULL
       AND cardinality(changed_fields) = 0)
    OR (kind = 'ANNOTATION' AND transition IS NULL AND from_state IS NULL AND to_state IS NULL
       AND machine_version IS NULL AND reason IS NULL)),
  CONSTRAINT lifecycle_transition_revision_ck CHECK (
    revision_from IS NULL OR (revision_to IS NOT NULL AND revision_to > revision_from)),
  CONSTRAINT lifecycle_transition_events_ck CHECK (cardinality(event_ids) = cardinality(event_types)),
  CONSTRAINT lifecycle_transition_user_actor_ck CHECK (actor_type <> 'USER' OR actor_id IS NOT NULL),
  CONSTRAINT lifecycle_transition_process_actor_ck CHECK (
    actor_type = 'USER' OR (actor_process IS NOT NULL AND actor_id IS NULL))
);
COMMENT ON TABLE audit.lifecycle_transition IS
  'Recorrido append-only de cada agregado con máquina de estados (WS-RO, INV-029, docs/31 D37): transiciones y anotaciones.';
COMMENT ON COLUMN audit.lifecycle_transition.derived IS
  'true si se reconstruyó desde audit.audit_log (job audit.lifecycle-backfill, FR-AUDIT-012).';

CREATE INDEX lifecycle_transition_recent_idx ON audit.lifecycle_transition (workspace_id, occurred_at DESC);
CREATE INDEX lifecycle_transition_audit_idx ON audit.lifecycle_transition (workspace_id, audit_log_id);

ALTER TABLE audit.lifecycle_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.lifecycle_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation_read ON audit.lifecycle_transition FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_write ON audit.lifecycle_transition FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON audit.lifecycle_transition FROM PUBLIC, pf_app;
GRANT SELECT, INSERT ON audit.lifecycle_transition TO pf_app;

CREATE TRIGGER lifecycle_transition_immutable BEFORE UPDATE OR DELETE ON audit.lifecycle_transition
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER lifecycle_transition_no_truncate BEFORE TRUNCATE ON audit.lifecycle_transition
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- Consistencia (decisión 6): agregados del workspace en curso cuyo estado difiere del `to_state` de su última
-- transición (por instante y secuencia). Solo agregados con al menos una transición. SECURITY INVOKER + RLS.
CREATE FUNCTION audit.lifecycle_state_divergences()
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
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
REVOKE ALL ON FUNCTION audit.lifecycle_state_divergences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.lifecycle_state_divergences() TO pf_worker;

-- migrate:down
DROP FUNCTION audit.lifecycle_state_divergences();
DROP TABLE audit.lifecycle_transition;
