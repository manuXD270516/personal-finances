-- AUDIT: vista global del log (openspec add-global-audit-view, tareas 3.3 y 4.1; design.md decisiones 4 y 6). Expand, no
-- destructiva. Se ejecuta con `pf_migrator`.
--
-- Crea:
--   * Índices de consulta de `audit.audit_log` (tabla padre particionada; PostgreSQL los propaga a cada partición, las
--     existentes y las que cree `audit.ensure_partitions`):
--       - audit_log_correlation_idx (workspace_id, correlation_id): todos los registros de una operación (edición
--         masiva por `bulkOperationId`, que se guarda como `correlation_id`).
--       - audit_log_action_idx (workspace_id, action, occurred_at DESC): filtro por acción y vista de eventos de
--         seguridad (`action = ANY(…)`), del más reciente al más antiguo.
--     El filtro por actor usa el índice existente `audit_log_actor_idx` y el de entidad `audit_log_entity_idx`.
--   * iam.workspace_exists(uuid): ¿existe un workspace activo con ese id? El registro de un fallo de autorización de un
--     NO miembro (`WORKSPACE_ACCESS_DENIED`) solo se escribe si el workspace existe (si no, no hay dónde auditar y se
--     permitiría sembrar filas en workspaces inventados). SECURITY DEFINER acotada: devuelve solo un booleano, nunca
--     filas. Con RLS FORZADA ni el dueño ve filas de `iam.workspace`; la política `workspace_existence_probe` le permite
--     ver SOLO la fila que la función fijó en la GUC local `pf.workspace_probe` (mismo patrón que la GUC de purga de
--     add-demo-data): sin GUC, el dueño sigue sin ver filas, y pf_app/pf_worker no ganan nada fijándola (la política
--     no se aplica a ellos).

-- migrate:up
CREATE INDEX audit_log_correlation_idx ON audit.audit_log (workspace_id, correlation_id);
CREATE INDEX audit_log_action_idx ON audit.audit_log (workspace_id, action, occurred_at DESC);

CREATE FUNCTION iam.workspace_exists(p_workspace uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_exists boolean;
BEGIN
  PERFORM set_config('pf.workspace_probe', p_workspace::text, true);
  SELECT EXISTS (SELECT 1 FROM iam.workspace w WHERE w.id = p_workspace AND w.status NOT IN ('ARCHIVED', 'PURGED'))
    INTO v_exists;
  PERFORM set_config('pf.workspace_probe', '', true);
  RETURN v_exists;
END
$$;
REVOKE ALL ON FUNCTION iam.workspace_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.workspace_exists(uuid) TO pf_app;
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY workspace_existence_probe ON iam.workspace FOR SELECT TO %I '
    'USING (id = nullif(current_setting(''pf.workspace_probe'', true), '''')::uuid '
    'AND status NOT IN (''ARCHIVED'', ''PURGED''))', current_user);
END
$$;

-- migrate:down
DROP POLICY workspace_existence_probe ON iam.workspace;
DROP FUNCTION iam.workspace_exists(uuid);
DROP INDEX audit.audit_log_action_idx;
DROP INDEX audit.audit_log_correlation_idx;
