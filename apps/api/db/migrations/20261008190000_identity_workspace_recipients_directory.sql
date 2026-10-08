-- IDENTITY: destinatarios de notificaciones para el worker (openspec add-alerts, tarea 3.3; design.md § Contexto y
-- § Contratos: `WorkspaceRecipientsQuery`). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
-- NOTIFY resuelve, al procesar un hecho, los miembros ACTIVOS del workspace con su rol, locale y zona horaria, y al
-- despachar un email la dirección VERIFICADA de un usuario. `pf_worker` no ve `iam.*` por membresía (RLS), así que lo
-- lee con el rol de directorio (`SET LOCAL ROLE pf_workspace_directory`, NOINHERIT, sin BYPASSRLS) con grants de
-- COLUMNA mínimos y políticas SELECT propias de ese rol:
--   * iam.workspace_membership (workspace_id, user_id, role, status)
--   * iam."user" (id, email, email_verified, locale, time_zone, status)
-- Ninguna otra columna (nombre visible, issuer/subject del IdP, preferencias) queda a su alcance. El email NUNCA se
-- copia a las tablas de NOTIFY: se lee en el momento del despacho.

-- migrate:up
GRANT SELECT (workspace_id, user_id, role, status) ON iam.workspace_membership TO pf_workspace_directory;
CREATE POLICY membership_directory_read ON iam.workspace_membership FOR SELECT TO pf_workspace_directory
  USING (true);

GRANT SELECT (id, email, email_verified, locale, time_zone, status) ON iam."user" TO pf_workspace_directory;
CREATE POLICY user_directory_read ON iam."user" FOR SELECT TO pf_workspace_directory USING (true);

-- migrate:down
DROP POLICY user_directory_read ON iam."user";
REVOKE SELECT (id, email, email_verified, locale, time_zone, status) ON iam."user" FROM pf_workspace_directory;
DROP POLICY membership_directory_read ON iam.workspace_membership;
REVOKE SELECT (workspace_id, user_id, role, status) ON iam.workspace_membership FROM pf_workspace_directory;
