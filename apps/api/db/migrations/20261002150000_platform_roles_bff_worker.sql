-- Roles de BD de add-workspace-identity (tarea 3.2; docs/12 §5-§6, docs/31 D23, ADR-0023). Expand, no destructiva.
-- Se ejecuta con `pf_migrator`.
--
-- Las funciones de contexto `platform.current_workspace_id()` / `platform.current_user_id()` ya existen (las creó
-- add-api-conventions con el comportamiento de D19: sin contexto lanzan SQLSTATE PF002). Aquí se agrega:
--   * `platform.current_workspace_id_if_set()`: variante que devuelve NULL sin contexto. SOLO para políticas USR
--     de iam (tablas consultadas antes de elegir workspace) que además exigen `current_user_id()` (que sí falla
--     con PF002). Las tablas de negocio (WS) usan siempre `current_workspace_id()`.
--   * `pf_worker`: runtime del worker. Miembro de `pf_app` (hereda sus grants y sus políticas `TO pf_app`), sin
--     BYPASSRLS ni DDL. Sin contraseña: se asigna cuando el worker deje de conectarse como `pf_app`.
--   * `pf_bff`: rol del BFF (`finance-web`); solo tendrá grants sobre `iam.bff_session` (los concede la migración
--     de iam). Sin contraseña: la credencial separada llega con el BFF (tarea 8.1).

-- migrate:up
CREATE OR REPLACE FUNCTION platform.current_workspace_id_if_set() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION platform.current_workspace_id_if_set() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_workspace_id_if_set() TO pf_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_worker') THEN
    CREATE ROLE pf_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_bff') THEN
    CREATE ROLE pf_bff LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pf_worker, pf_bff', current_database());
END
$$;
GRANT pf_app TO pf_worker WITH INHERIT TRUE, SET FALSE;

-- migrate:down
REVOKE pf_app FROM pf_worker;
DROP FUNCTION platform.current_workspace_id_if_set();
