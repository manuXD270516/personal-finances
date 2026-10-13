-- FX y NOTIFY: aviso agrupado de muestras retenidas como anómalas (openspec refine-rate-anomaly-alert-grouping, tareas
-- 4.1 y 4.2; design.md § Plan de migración). Expand, no destructiva, sin tablas nuevas ni migración de datos. Se ejecuta
-- con `pf_migrator`.
--
--   * Índice parcial de las muestras retenidas de un par en un workspace (`anomaly_flagged`): la lectura del grupo
--     vigente (`retainedOfPair`) recorre de la más reciente hacia atrás y solo corre para pares con alguna muestra
--     retenida nueva en la transacción.
--   * `pf_worker` actualiza SOLO `params`, `message_key` y `link` de `notifications.notification` (el aviso agrupado se
--     actualiza con cada muestra posterior del grupo, `INSERT … ON CONFLICT DO UPDATE` acotado al tipo en el
--     repositorio). Nunca `status`, `read_at`, `archived_at`, `created_at` ni `severity`: el estado de lectura del
--     usuario no se toca. La política de actualización del worker es por workspace (la del usuario, `notification_update`,
--     sigue siendo solo de `pf_app` con `user_id = app.user_id`).
--   * `pf_worker` es miembro de `pf_app` y hereda su `GRANT UPDATE (status, read_at, archived_at)`: como la política del
--     worker deja pasar todas las filas del workspace, un disparador BEFORE UPDATE rechaza (42501) que el worker cambie
--     cualquier columna distinta de `params`, `message_key` y `link`. Defensa en profundidad del estado de lectura.

-- migrate:up
CREATE INDEX exchange_rate_retained_ix
  ON fx.exchange_rate (workspace_id, base_currency, quote_currency, created_at DESC, id DESC)
  WHERE anomaly_flagged;

GRANT UPDATE (params, message_key, link) ON notifications.notification TO pf_worker;
CREATE POLICY notification_refresh ON notifications.notification FOR UPDATE TO pf_worker
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

CREATE FUNCTION notifications.guard_worker_refresh() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF current_user = 'pf_worker' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.read_at IS DISTINCT FROM OLD.read_at
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.severity IS DISTINCT FROM OLD.severity
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
  ) THEN
    RAISE EXCEPTION 'permission denied: the worker can only refresh params, message_key and link of a notification'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER notification_guard_worker_refresh BEFORE UPDATE ON notifications.notification
  FOR EACH ROW EXECUTE FUNCTION notifications.guard_worker_refresh();

-- migrate:down
DROP TRIGGER notification_guard_worker_refresh ON notifications.notification;
DROP FUNCTION notifications.guard_worker_refresh();
DROP POLICY notification_refresh ON notifications.notification;
REVOKE UPDATE (params, message_key, link) ON notifications.notification FROM pf_worker;
DROP INDEX fx.exchange_rate_retained_ix;
