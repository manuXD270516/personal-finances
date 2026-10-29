-- Cierra los dos huecos de fail-closed de D296 (openspec fix-rls-fail-closed-gaps; docs/48, docs/49, docs/55 D308–D310).
-- Expand, no destructiva, sin backfill. Se ejecuta con `pf_migrator`.
--
-- Causa. Que una política lance PF002 sin contexto, también con la tabla vacía, depende de que PostgreSQL evalúe la
-- función de contexto al PLANIFICAR: la forma `columna = función()` es una restricción «variable = expresión» y el
-- planner evalúa las funciones STABLE para estimar la selectividad (`eqsel`). Una política cuya expresión no tenga esa
-- forma solo se evalúa fila por fila: sin filas que recorrer no lanza nada y la consulta devuelve vacío. Dos políticas
-- no la tenían:
--   * platform.idempotency_key.idempotency_key_scope: un `CASE` (clave de workspace o de usuario) evaluado por fila.
--   * iam.workspace_export.ws_isolation: `current_workspace_id_if_set()` (devuelve NULL sin contexto y nunca lanza),
--     usada a propósito para que el barrido de retención leyera entre workspaces con `retention_scan` del rol pf_worker.
--
-- Corrección (D298: no se reescriben las políticas que ya cumplen; estas dos adoptan la forma vigente).
--   * `platform.current_idempotency_scope_id()` y un conjunto `scope_id = función()` delante del `CASE` (se conserva).
--   * `ws_isolation` de workspace_export pasa a `workspace_id = platform.current_workspace_id()`.
--   * El barrido de retención lee con `pf_maintenance` (ADR-0023), asumido con SET LOCAL ROLE solo en esa transacción:
--     `retention_scan` pasa a `pf_maintenance` y recibe USAGE en `iam` y SELECT de cinco columnas (sin `wrapped_key`
--     ni `object_key`; D308). Sin INSERT ni UPDATE.

-- migrate:up
CREATE FUNCTION platform.current_idempotency_scope_id() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE AS
$$
DECLARE
  ws  text := current_setting('app.workspace_id', true);
  usr text := current_setting('app.user_id', true);
BEGIN
  IF ws IS NOT NULL AND ws <> '' THEN RETURN ws::uuid; END IF;
  IF usr IS NOT NULL AND usr <> '' THEN RETURN usr::uuid; END IF;
  RAISE EXCEPTION 'workspace context not set' USING ERRCODE = 'PF002';
END
$$;
REVOKE ALL ON FUNCTION platform.current_idempotency_scope_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.current_idempotency_scope_id() TO pf_app;

ALTER POLICY idempotency_key_scope ON platform.idempotency_key
  USING (scope_id = platform.current_idempotency_scope_id()
         AND CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
                  ELSE workspace_id = platform.current_workspace_id() END)
  WITH CHECK (scope_id = platform.current_idempotency_scope_id()
              AND CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
                       ELSE workspace_id = platform.current_workspace_id() END);

ALTER POLICY ws_isolation ON iam.workspace_export
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

-- Barrido de retención `identity.export-retention`: lee los vencidos sin contexto como `pf_maintenance`
-- (`pf_worker` ya puede asumirlo: GRANT … WITH INHERIT FALSE, SET TRUE). `pf_maintenance` no es miembro de `pf_app`,
-- así que `ws_isolation` no le aplica; solo rige esta política, con cinco columnas y sin escritura.
ALTER POLICY retention_scan ON iam.workspace_export TO pf_maintenance;
GRANT USAGE ON SCHEMA iam TO pf_maintenance;
GRANT SELECT (id, workspace_id, requested_by, status, expires_at) ON iam.workspace_export TO pf_maintenance;

-- migrate:down
REVOKE SELECT (id, workspace_id, requested_by, status, expires_at) ON iam.workspace_export FROM pf_maintenance;
REVOKE USAGE ON SCHEMA iam FROM pf_maintenance;
ALTER POLICY retention_scan ON iam.workspace_export TO pf_worker;

ALTER POLICY ws_isolation ON iam.workspace_export
  USING (workspace_id = platform.current_workspace_id_if_set())
  WITH CHECK (workspace_id = platform.current_workspace_id_if_set());

ALTER POLICY idempotency_key_scope ON platform.idempotency_key
  USING (CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
              ELSE workspace_id = platform.current_workspace_id() END)
  WITH CHECK (CASE WHEN workspace_id IS NULL THEN user_id = platform.current_user_id()
                   ELSE workspace_id = platform.current_workspace_id() END);

DROP FUNCTION platform.current_idempotency_scope_id();
