-- Entrega de eventos de dominio (openspec add-event-outbox, design §3; ADR-0008 con enmienda; docs/11 §6).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- Crea:
--   * `platform.outbox`: eventos escritos en la MISMA transacción que el cambio de estado (rol pf_app, solo INSERT
--     de su workspace). El relay del worker (rol pf_worker) los lee de todos los workspaces y marca `published_at`.
--   * `platform.inbox`: `(consumer, event_id)` procesados; se inserta en la transacción del efecto del consumidor.
--     Sin datos de negocio: en la allowlist del chequeo de catálogo RLS. Solo pf_worker.
--   * `platform.dead_letter`: eventos que agotaron sus reintentos (estado OPEN hasta resolverse).
--   * trigger `outbox_notify`: `pg_notify('pf_outbox')` al confirmar inserts (despertador del relay).
--   * `pf_worker` puede asumir `pf_maintenance` (purgas): la cadena pf_worker → pf_app no tiene SET.
--
-- Los default privileges del schema `platform` conceden DML a pf_app sobre toda tabla nueva: aquí se revoca lo que
-- no corresponde y se conceden grants mínimos por rol.

-- migrate:up
CREATE TABLE platform.outbox (
  id                uuid        PRIMARY KEY,
  sequence          bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  workspace_id      uuid        NOT NULL,
  event_type        text        NOT NULL CHECK (event_type ~ '^[a-z]+[.][A-Z][A-Za-z0-9]+$'),
  event_version     smallint    NOT NULL CHECK (event_version >= 1),
  aggregate_type    text        NOT NULL CHECK (aggregate_type ~ '^[A-Z][A-Za-z0-9]+$'),
  aggregate_id      uuid        NOT NULL,
  aggregate_version integer     NOT NULL CHECK (aggregate_version >= 1),
  occurred_at       timestamptz NOT NULL,
  correlation_id    uuid        NOT NULL,
  envelope          jsonb       NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  trace_context     jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trace_context) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at      timestamptz NULL,
  publish_attempts  integer     NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error        text        NULL CHECK (length(last_error) <= 1000),
  -- La publicación dual vN/vN+1 de docs/11 §4 escribe dos filas con la misma versión de agregado.
  CONSTRAINT outbox_aggregate_event_unique UNIQUE (aggregate_id, aggregate_version, event_type, event_version)
);
COMMENT ON TABLE platform.outbox IS
  'Outbox transaccional (ADR-0008): eventos de dominio escritos con el cambio de estado; el relay del worker los publica en pg-boss.';

CREATE INDEX outbox_pending_idx ON platform.outbox (sequence) WHERE published_at IS NULL;
CREATE INDEX outbox_published_at_idx ON platform.outbox (published_at) WHERE published_at IS NOT NULL;

ALTER TABLE platform.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.outbox FORCE ROW LEVEL SECURITY;

-- api (pf_app): solo registra eventos de su workspace, nunca los lee ni modifica.
CREATE POLICY outbox_write ON platform.outbox FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());
-- relay (pf_worker): lee y marca eventos de todos los workspaces (sin BYPASSRLS).
CREATE POLICY outbox_relay_read ON platform.outbox FOR SELECT TO pf_worker USING (true);
CREATE POLICY outbox_relay_mark ON platform.outbox FOR UPDATE TO pf_worker USING (true) WITH CHECK (true);
-- purga (pf_maintenance): solo ve y borra eventos ya publicados; un pendiente nunca se purga.
CREATE POLICY outbox_retention_read ON platform.outbox FOR SELECT TO pf_maintenance
  USING (published_at IS NOT NULL);
CREATE POLICY outbox_retention_purge ON platform.outbox FOR DELETE TO pf_maintenance
  USING (published_at IS NOT NULL);

REVOKE ALL ON platform.outbox FROM PUBLIC, pf_app;
GRANT INSERT ON platform.outbox TO pf_app;
GRANT SELECT ON platform.outbox TO pf_worker;
GRANT UPDATE (published_at, publish_attempts, last_error) ON platform.outbox TO pf_worker;
GRANT SELECT, DELETE ON platform.outbox TO pf_maintenance;

CREATE FUNCTION platform.outbox_notify() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  PERFORM pg_notify('pf_outbox', '');
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION platform.outbox_notify() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.outbox_notify() TO pf_app;
CREATE TRIGGER outbox_notify AFTER INSERT ON platform.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION platform.outbox_notify();

CREATE TABLE platform.inbox (
  consumer     text        NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  event_id     uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer, event_id)
);
COMMENT ON TABLE platform.inbox IS
  'Eventos ya procesados por consumidor (idempotencia, INV-028). Sin datos de negocio; solo pf_worker.';
CREATE INDEX inbox_processed_at_idx ON platform.inbox (processed_at);

REVOKE ALL ON platform.inbox FROM PUBLIC, pf_app;
GRANT SELECT, INSERT ON platform.inbox TO pf_worker;
GRANT SELECT, DELETE ON platform.inbox TO pf_maintenance;

CREATE TABLE platform.dead_letter (
  consumer        text        NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  event_id        uuid        NOT NULL,
  workspace_id    uuid        NOT NULL,
  event_type      text        NOT NULL,
  envelope        jsonb       NOT NULL,
  error           text        NOT NULL CHECK (length(error) <= 1000),
  attempts        integer     NOT NULL CHECK (attempts >= 1),
  status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REPLAYED', 'DISCARDED')),
  first_failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_failed_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at     timestamptz NULL,
  PRIMARY KEY (consumer, event_id),
  CONSTRAINT dead_letter_resolution CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);
COMMENT ON TABLE platform.dead_letter IS
  'Eventos que agotaron sus reintentos por consumidor (NFR-REL-012). OPEN hasta replay/descarte.';
CREATE INDEX dead_letter_open_idx ON platform.dead_letter (first_failed_at) WHERE status = 'OPEN';

ALTER TABLE platform.dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.dead_letter FORCE ROW LEVEL SECURITY;
CREATE POLICY dead_letter_worker ON platform.dead_letter TO pf_worker USING (true) WITH CHECK (true);

REVOKE ALL ON platform.dead_letter FROM PUBLIC, pf_app;
GRANT SELECT, INSERT, UPDATE ON platform.dead_letter TO pf_worker;

-- PG ≥ 16: pf_worker no hereda privilegios de pf_maintenance; solo puede asumirlo con SET LOCAL ROLE.
GRANT pf_maintenance TO pf_worker WITH INHERIT FALSE, SET TRUE;

-- migrate:down
REVOKE pf_maintenance FROM pf_worker;
DROP TABLE platform.dead_letter;
DROP TABLE platform.inbox;
DROP TRIGGER outbox_notify ON platform.outbox;
DROP FUNCTION platform.outbox_notify();
DROP TABLE platform.outbox;
