-- IDENTITY: nombre visible de los actores del log de auditoría (openspec fix-phase-2-gaps, punto 4; design decisión 3).
-- Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- El CSV global de auditoría (`exportAuditLog`, solo OWNER) incluye el nombre visible actual del actor. `iam."user"` solo
-- deja leer la fila propia (RLS `user_self_read`), así que el nombre de los demás actores —incluidos ex-miembros, cuyo id
-- sigue en el log— se lee con una función SECURITY DEFINER acotada:
--   * solo si el contexto RLS de la sesión ya está fijado en ESE workspace (`platform.current_workspace_id()`), que
--     fija la unidad de trabajo tras la autorización del guard;
--   * solo devuelve (id, display_name) de los usuarios de la lista que figuran como actor en `audit.audit_log` del
--     workspace; nunca email, issuer/subject ni preferencias, y nada de usuarios ajenos al log.
-- `audit.audit_log` tiene RLS FORZADA (ni el dueño ve filas): la política `audit_actor_probe` le permite al dueño ver SOLO
-- las filas del workspace que la función fijó en la GUC local `pf.audit_actor_probe` (mismo patrón que
-- `iam.workspace_exists`): sin GUC el dueño sigue sin ver filas y pf_app/pf_worker no ganan nada fijándola (la política
-- no se les aplica).

-- migrate:up
CREATE FUNCTION iam.audit_actor_names(p_workspace uuid, p_user_ids uuid[])
  RETURNS TABLE (user_id uuid, display_name text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF p_workspace IS DISTINCT FROM platform.current_workspace_id() THEN
    RAISE EXCEPTION 'actor names requested outside the workspace context' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('pf.audit_actor_probe', p_workspace::text, true);
  RETURN QUERY
    SELECT u.id, u.display_name
      FROM iam."user" u
     WHERE u.id = ANY (p_user_ids)
       AND EXISTS (
         SELECT 1 FROM audit.audit_log a WHERE a.workspace_id = p_workspace AND a.actor_user_id = u.id
       );
  PERFORM set_config('pf.audit_actor_probe', '', true);
END
$$;
REVOKE ALL ON FUNCTION iam.audit_actor_names(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.audit_actor_names(uuid, uuid[]) TO pf_app;
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY audit_actor_probe ON audit.audit_log FOR SELECT TO %I '
    'USING (workspace_id = nullif(current_setting(''pf.audit_actor_probe'', true), '''')::uuid)', current_user);
END
$$;

-- migrate:down
DROP POLICY audit_actor_probe ON audit.audit_log;
DROP FUNCTION iam.audit_actor_names(uuid, uuid[]);
