-- NOTIFY: centro de notificaciones, entregas por email y preferencias (openspec add-alerts, tarea 4.1; design.md
-- § Modelo de datos y decisiones 2, 5, 7, 10 y 11; docs/08 §5.15; ADR-0023). Expand, no destructiva. Se ejecuta con
-- `pf_migrator`.
--
--   * notifications.notification            WS + USR: una fila por (workspace, destinatario, hecho de origen).
--     UNIQUE (workspace_id, user_id, dedupe_key) es la segunda capa de idempotencia (la primera es platform.inbox);
--     `message_key` + `params` (sin texto congelado). `pf_app` SELECT propias + UPDATE de estado propio (política con
--     `user_id = app.user_id`, fail-closed con PF002); `pf_worker` INSERT/SELECT/DELETE (purga) por workspace.
--   * notifications.notification_delivery   WS: entrega por email con lease, intentos y estado. UNIQUE (notification_id,
--     channel). `pf_worker` todo; `pf_app` solo (workspace_id, notification_id, channel, status) de las entregas de
--     SUS notificaciones (estado agregado `emailStatus`; el resto nunca sale por la API).
--   * notifications.notification_preference WS + USR: tipo × canal; la ausencia de fila equivale a "activado".
--   * notifications.user_setting            WS + USR: horario de silencio e inclusión de detalles en el email.
--   Ninguna tabla guarda direcciones de email (se resuelven al despachar, RISK-010).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
--
-- `pf_worker` es miembro de `pf_app` y hereda sus políticas `TO pf_app`: toda política de `pf_app` que filtra por
-- usuario deja pasar a `pf_worker` explícitamente en lectura mediante `notifications.is_row_user(user_id)`, una función
-- PL/pgSQL (opaca al planificador) que devuelve `true` para `pf_worker` y, para los demás roles, compara con
-- `platform.current_user_id()` (PF002 si falta el contexto). Una comparación directa `user_id = current_user_id()` dentro
-- de un OR NO sirve: el planificador evalúa en tiempo de plan las funciones STABLE para estimar la selectividad y
-- lanzaría PF002 a `pf_worker` aunque el OR corto-circuite en ejecución. Al worker no se le concede escritura por usuario.
-- Sin backfill: no hay histórico en Phase 2.

-- migrate:up
CREATE SCHEMA notifications;
GRANT USAGE ON SCHEMA notifications TO pf_app;

CREATE TABLE notifications.notification (
  id              uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES iam.workspace (id),
  user_id         uuid        NOT NULL REFERENCES iam."user" (id),
  -- Catálogo extensible por fase (FR-NOTIFY-004): solo formato, sin enumerar tipos.
  notification_type text      NOT NULL CHECK (notification_type ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  severity        text        NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message_key     text        NOT NULL CHECK (char_length(message_key) BETWEEN 1 AND 100),
  params          jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  link            jsonb       NOT NULL CHECK (jsonb_typeof(link) = 'object'),
  dedupe_key      text        NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 300),
  source_event_id uuid        NOT NULL,
  status          text        NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD', 'READ', 'ARCHIVED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz NULL,
  archived_at     timestamptz NULL,
  CONSTRAINT notification_dedupe_uk UNIQUE (workspace_id, user_id, dedupe_key),
  CONSTRAINT notification_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT notification_unread_ck CHECK (status <> 'UNREAD' OR (read_at IS NULL AND archived_at IS NULL)),
  CONSTRAINT notification_read_ck CHECK (status <> 'READ' OR (read_at IS NOT NULL AND archived_at IS NULL)),
  CONSTRAINT notification_archived_ck CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);
CREATE INDEX notification_inbox_ix
  ON notifications.notification (workspace_id, user_id, status, created_at DESC, id DESC);
CREATE INDEX notification_retention_ix ON notifications.notification (created_at);
COMMENT ON TABLE notifications.notification IS
  'Notificación in-app por destinatario y hecho de origen (notifications/alerts): message_key + params, sin texto ni email.';

CREATE TABLE notifications.notification_delivery (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  notification_id     uuid        NOT NULL,
  channel             text        NOT NULL CHECK (channel IN ('EMAIL')),
  status              text        NOT NULL
                      CHECK (status IN ('PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SUPPRESSED')),
  suppression_reason  text        NULL CHECK (suppression_reason IS NULL OR suppression_reason ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  not_before          timestamptz NOT NULL,
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until         timestamptz NULL,
  provider            text        NULL CHECK (provider IS NULL OR char_length(provider) <= 40),
  provider_message_id text        NULL CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 300),
  last_error_code     text        NULL CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
  sent_at             timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_notification_channel_uk UNIQUE (notification_id, channel),
  CONSTRAINT delivery_notification_fk FOREIGN KEY (workspace_id, notification_id)
    REFERENCES notifications.notification (workspace_id, id),
  CONSTRAINT delivery_suppressed_ck CHECK (status <> 'SUPPRESSED' OR suppression_reason IS NOT NULL),
  CONSTRAINT delivery_sent_ck CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);
-- Despacho y barrido de entregas vencidas (PENDING/RETRY) y de leases expirados (SENDING).
CREATE INDEX delivery_pending_ix ON notifications.notification_delivery (status, not_before)
  WHERE status IN ('PENDING', 'RETRY');
CREATE INDEX delivery_lease_ix ON notifications.notification_delivery (lease_until) WHERE status = 'SENDING';
COMMENT ON TABLE notifications.notification_delivery IS
  'Entrega por email de una notificación (lease, intentos, Message-ID determinista = id); sin dirección de email.';

CREATE TABLE notifications.notification_preference (
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  user_id           uuid        NOT NULL REFERENCES iam."user" (id),
  notification_type text        NOT NULL CHECK (notification_type ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  channel           text        NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
  enabled           boolean     NOT NULL,
  version           integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, notification_type, channel)
);
COMMENT ON TABLE notifications.notification_preference IS
  'Preferencia por tipo y canal; sin fila = activado (docs/33 D88).';

CREATE TABLE notifications.user_setting (
  workspace_id            uuid        NOT NULL REFERENCES iam.workspace (id),
  user_id                 uuid        NOT NULL REFERENCES iam."user" (id),
  quiet_hours_start       time        NULL,
  quiet_hours_end         time        NULL,
  include_details_in_email boolean    NOT NULL DEFAULT false,
  version                 integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT user_setting_quiet_hours_ck CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL AND quiet_hours_start <> quiet_hours_end)
  )
);
COMMENT ON TABLE notifications.user_setting IS
  'Horario de silencio (zona horaria del usuario) e inclusión de detalles en el email; ETag de las preferencias.';

-- Visibilidad por usuario de las filas (ver nota de cabecera). STABLE, PL/pgSQL (no inlinable), SECURITY INVOKER.
CREATE FUNCTION notifications.is_row_user(p_user_id uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE AS
$$
BEGIN
  IF current_user = 'pf_worker' THEN
    RETURN true;
  END IF;
  RETURN p_user_id = platform.current_user_id();
END
$$;
REVOKE ALL ON FUNCTION notifications.is_row_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.is_row_user(uuid) TO pf_app;

-- RLS forzada (fail-closed con PF002 si falta el contexto).
ALTER TABLE notifications.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.notification FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications.notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.notification_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications.notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.notification_preference FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications.user_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.user_setting FORCE ROW LEVEL SECURITY;

-- notification: el usuario solo ve y cambia el estado de las SUYAS; el worker inserta, lee y purga por workspace.
CREATE POLICY notification_select ON notifications.notification FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id()
         AND notifications.is_row_user(user_id));
CREATE POLICY notification_update ON notifications.notification FOR UPDATE TO pf_app
  USING (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id())
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());
CREATE POLICY notification_insert ON notifications.notification FOR INSERT TO pf_worker
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY notification_delete ON notifications.notification FOR DELETE TO pf_worker
  USING (workspace_id = platform.current_workspace_id());

-- notification_delivery: el worker opera por workspace; la API solo lee el estado de las entregas de sus notificaciones.
CREATE POLICY delivery_worker ON notifications.notification_delivery TO pf_worker
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY delivery_select ON notifications.notification_delivery FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id()
         AND (current_user = 'pf_worker'
              OR EXISTS (SELECT 1 FROM notifications.notification n
                          WHERE n.workspace_id = notification_delivery.workspace_id
                            AND n.id = notification_delivery.notification_id)));

-- notification_preference / user_setting: propias del usuario (API); el worker las lee por workspace.
CREATE POLICY preference_select ON notifications.notification_preference FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id()
         AND notifications.is_row_user(user_id));
CREATE POLICY preference_insert ON notifications.notification_preference FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());
CREATE POLICY preference_update ON notifications.notification_preference FOR UPDATE TO pf_app
  USING (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id())
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());
CREATE POLICY preference_delete ON notifications.notification_preference FOR DELETE TO pf_worker
  USING (workspace_id = platform.current_workspace_id());

CREATE POLICY setting_select ON notifications.user_setting FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id()
         AND notifications.is_row_user(user_id));
CREATE POLICY setting_insert ON notifications.user_setting FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());
CREATE POLICY setting_update ON notifications.user_setting FOR UPDATE TO pf_app
  USING (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id())
  WITH CHECK (workspace_id = platform.current_workspace_id() AND user_id = platform.current_user_id());
CREATE POLICY setting_delete ON notifications.user_setting FOR DELETE TO pf_worker
  USING (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA notifications FROM PUBLIC, pf_app, pf_worker;
GRANT SELECT ON notifications.notification TO pf_app;
GRANT UPDATE (status, read_at, archived_at) ON notifications.notification TO pf_app;
GRANT INSERT, DELETE ON notifications.notification TO pf_worker;
GRANT SELECT (workspace_id, notification_id, channel, status) ON notifications.notification_delivery TO pf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.notification_delivery TO pf_worker;
GRANT SELECT, INSERT ON notifications.notification_preference TO pf_app;
GRANT UPDATE (enabled, version, updated_at) ON notifications.notification_preference TO pf_app;
GRANT DELETE ON notifications.notification_preference TO pf_worker;
GRANT SELECT, INSERT ON notifications.user_setting TO pf_app;
GRANT UPDATE (quiet_hours_start, quiet_hours_end, include_details_in_email, version, updated_at)
  ON notifications.user_setting TO pf_app;
GRANT DELETE ON notifications.user_setting TO pf_worker;

-- Purga del workspace demo (ADR-0026): entregas antes que sus notificaciones.
SELECT platform.register_workspace_scoped_table('notifications.notification_delivery'::regclass, 120, 'DELETE');
SELECT platform.register_workspace_scoped_table('notifications.notification'::regclass, 122, 'DELETE');
SELECT platform.register_workspace_scoped_table('notifications.notification_preference'::regclass, 124, 'DELETE');
SELECT platform.register_workspace_scoped_table('notifications.user_setting'::regclass, 126, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'notifications'
   AND table_name IN ('notification_delivery', 'notification', 'notification_preference', 'user_setting');
DROP TABLE notifications.notification_delivery;
DROP TABLE notifications.user_setting;
DROP TABLE notifications.notification_preference;
DROP TABLE notifications.notification;
DROP FUNCTION notifications.is_row_user(uuid);
DROP SCHEMA notifications;
