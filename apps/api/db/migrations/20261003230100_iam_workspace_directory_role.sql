-- Directorio de workspaces activos para jobs de instalación del worker (openspec add-market-rate-providers, tarea
-- 4.4; design.md decisión 3). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- El job de tasas de mercado hace UNA solicitud por provider y ciclo y copia las muestras a cada workspace activo en
-- su propia transacción (`SET LOCAL app.workspace_id`). `pf_worker` no puede listar `iam.workspace` (RLS por
-- membresía). Mismo patrón que `pf_ledger_maintenance`: rol `pf_workspace_directory` (NOLOGIN, sin BYPASSRLS,
-- NOINHERIT) que SOLO el worker asume con `SET LOCAL ROLE` dentro de la transacción de la consulta, con lectura de las
-- columnas `id`, `time_zone`, `status` y `archived_at` (ningún otro dato de IDENTITY: nombre, miembros, moneda).

-- migrate:up
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pf_workspace_directory') THEN
    CREATE ROLE pf_workspace_directory NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA iam TO pf_workspace_directory;
GRANT SELECT (id, time_zone, status, archived_at) ON iam.workspace TO pf_workspace_directory;
CREATE POLICY workspace_directory_read ON iam.workspace FOR SELECT TO pf_workspace_directory USING (true);

-- PG ≥ 16: pf_worker no hereda sus privilegios; solo puede asumirlo con SET LOCAL ROLE (pf_app no puede).
GRANT pf_workspace_directory TO pf_worker WITH INHERIT FALSE, SET TRUE;

-- migrate:down
REVOKE pf_workspace_directory FROM pf_worker;
DROP POLICY workspace_directory_read ON iam.workspace;
REVOKE SELECT (id, time_zone, status, archived_at) ON iam.workspace FROM pf_workspace_directory;
REVOKE USAGE ON SCHEMA iam FROM pf_workspace_directory;
