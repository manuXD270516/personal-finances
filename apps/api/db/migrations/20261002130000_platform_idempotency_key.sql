-- Idempotencia de POST financieros (openspec add-api-conventions, design §3 y §9; docs/08 §5.18). Expand, no
-- destructiva. Se ejecuta con `pf_migrator`.
--
-- Crea:
--   * funciones de contexto RLS `platform.current_workspace_id()` / `platform.current_user_id()` (docs/08 §1.4,
--     ADR-0023): sin contexto la consulta FALLA con SQLSTATE PF002 (nunca 0 filas). `CREATE OR REPLACE` para que
--     `add-workspace-identity` las reutilice sin conflicto.
--   * rol `pf_maintenance` (NOLOGIN, sin BYPASSRLS): purgas por retención. `pf_app` puede asumirlo solo de forma
--     explícita (`SET LOCAL ROLE`, sin heredar privilegios) desde el job de purga del worker.
--   * tabla `platform.idempotency_key` con RLS FORZADA: `pf_app` ve/escribe solo filas de su workspace (o de su
--     usuario en operaciones sin workspace); `pf_maintenance` solo ve y borra filas vencidas.

-- migrate:up
CREATE OR REPLACE FUNCTION platform.current_workspace_id() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE AS
$$
DECLARE v text := current_setting('app.workspace_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'workspace context not set' USING ERRCODE = 'PF002';
  END IF;
  RETURN v::uuid;
END
$$;

CREATE OR REPLACE FUNCTION platform.current_user_id() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE AS
$$
DECLARE v text := current_setting('app.user_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'user context not set' USING ERRCODE = 'PF002';
  END IF;
  RETURN v::uuid;
END
$$;

GRANT EXECUTE ON FUNCTION platform.current_workspace_id(), platform.current_user_id() TO pf_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_maintenance') THEN
    CREATE ROLE pf_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA platform TO pf_maintenance;
-- PG ≥ 16: pf_app NO hereda los privilegios de pf_maintenance; solo puede asumirlo con SET ROLE.
GRANT pf_maintenance TO pf_app WITH INHERIT FALSE, SET TRUE;

CREATE TABLE platform.idempotency_key (
  scope_id         uuid        NOT NULL,
  key              text        NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{16,128}$'),
  workspace_id     uuid        NULL,
  user_id          uuid        NOT NULL,
  method           text        NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  route            text        NOT NULL CHECK (length(route) BETWEEN 1 AND 300),
  request_hash     bytea       NOT NULL CHECK (length(request_hash) = 32),
  status           text        NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  lock_token       uuid        NULL,
  locked_until     timestamptz NULL,
  response_status  smallint    NULL CHECK (response_status BETWEEN 200 AND 499 AND response_status <> 429),
  response_headers jsonb       NULL,
  response_body    jsonb       NULL,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (scope_id, key),
  CONSTRAINT idempotency_key_scope CHECK (scope_id = coalesce(workspace_id, user_id)),
  CONSTRAINT idempotency_key_state CHECK (
    (status = 'IN_PROGRESS' AND lock_token IS NOT NULL AND locked_until IS NOT NULL AND response_status IS NULL)
    OR (status = 'COMPLETED' AND lock_token IS NULL AND response_status IS NOT NULL)
  ),
  CONSTRAINT idempotency_key_retention CHECK (
    expires_at >= created_at + interval '24 hours' AND expires_at <= created_at + interval '7 days'
  )
);
COMMENT ON TABLE platform.idempotency_key IS
  'Respuestas de POST financieros por Idempotency-Key (docs/10 §7). Contiene datos financieros: RLS por workspace/usuario y retención 24 h–7 días.';

CREATE INDEX idempotency_key_expires_at_idx ON platform.idempotency_key (expires_at);

ALTER TABLE platform.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.idempotency_key FORCE ROW LEVEL SECURITY;

-- CASE garantiza el orden de evaluación: una fila de usuario nunca exige contexto de workspace y viceversa.
CREATE POLICY idempotency_key_scope ON platform.idempotency_key TO pf_app
  USING (CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
              ELSE workspace_id = platform.current_workspace_id() END)
  WITH CHECK (CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
                   ELSE workspace_id = platform.current_workspace_id() END);

CREATE POLICY idempotency_key_retention_read ON platform.idempotency_key FOR SELECT TO pf_maintenance
  USING (expires_at < now());
CREATE POLICY idempotency_key_retention_purge ON platform.idempotency_key FOR DELETE TO pf_maintenance
  USING (expires_at < now());

REVOKE ALL ON platform.idempotency_key FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.idempotency_key TO pf_app;
GRANT SELECT, DELETE ON platform.idempotency_key TO pf_maintenance;

-- migrate:down
DROP TABLE platform.idempotency_key;
REVOKE pf_maintenance FROM pf_app;
REVOKE USAGE ON SCHEMA platform FROM pf_maintenance;
DROP FUNCTION platform.current_user_id();
DROP FUNCTION platform.current_workspace_id();
