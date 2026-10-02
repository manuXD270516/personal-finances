-- Schema `iam` (openspec add-workspace-identity, tarea 6.1; docs/08 §5.1, docs/31 D23, ADR-0023). Expand, no
-- destructiva. Se ejecuta con `pf_migrator` (dueño de todo; ni pf_app ni pf_bff son owners).
--
-- Contexto RLS (fijado por la UnitOfWork con set_config(..., true)):
--   * app.user_id      — siempre (las funciones fallan con PF002 si falta).
--   * app.workspace_id — en operaciones de un workspace. Crear un workspace (o el personal en la provisión) se
--                        ejecuta con app.workspace_id = id del NUEVO workspace: así las políticas WS cubren el alta.
-- Políticas:
--   * iam.user                 USR: lectura/escritura propia; alta SOLO vía iam.provision_user (SECURITY DEFINER).
--                              RLS habilitada pero NO forzada: el owner (función de provisión) la atraviesa; pf_app
--                              no tiene INSERT ni DELETE.
--   * iam.workspace            USR/WS forzada: SELECT con membresía activa del usuario (y, si hay workspace en
--                              contexto, solo ese); INSERT/UPDATE solo id = current_workspace_id().
--   * iam.workspace_membership USR forzada: SELECT propias o del workspace en contexto; INSERT/UPDATE solo en el
--                              workspace en contexto. Invariante ≥ 1 OWNER activo con constraint trigger diferido.
--   * iam.bff_session          técnica, sin RLS por workspace (allowlist): solo pf_bff (CRUD) y pf_maintenance (purga).

-- migrate:up
CREATE SCHEMA iam;
GRANT USAGE ON SCHEMA iam TO pf_app, pf_bff, pf_maintenance;

-- ---------------------------------------------------------------- iam.user
CREATE TABLE iam."user" (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  idp_issuer     text        NOT NULL CHECK (length(idp_issuer) BETWEEN 1 AND 500),
  idp_subject    text        NOT NULL CHECK (length(idp_subject) BETWEEN 1 AND 255),
  email          text        NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  email_verified boolean     NOT NULL DEFAULT false,
  display_name   text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  locale         text        NOT NULL DEFAULT 'es-BO' CHECK (length(locale) BETWEEN 2 AND 35),
  time_zone      text        NULL CHECK (time_zone IS NULL OR length(time_zone) BETWEEN 1 AND 64),
  status         text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  preferences    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_login_at  timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT user_idp_identity UNIQUE (idp_issuer, idp_subject)
);
CREATE UNIQUE INDEX user_email_active_uq ON iam."user" (lower(email)) WHERE status = 'ACTIVE';

ALTER TABLE iam."user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_self_read ON iam."user" FOR SELECT TO pf_app USING (id = platform.current_user_id());
CREATE POLICY user_self_update ON iam."user" FOR UPDATE TO pf_app
  USING (id = platform.current_user_id()) WITH CHECK (id = platform.current_user_id());
REVOKE ALL ON iam."user" FROM PUBLIC;
GRANT SELECT, UPDATE (locale, time_zone, display_name, preferences, updated_at, version) ON iam."user" TO pf_app;

-- ---------------------------------------------------------------- iam.workspace
CREATE TABLE iam.workspace (
  id                             uuid          PRIMARY KEY,
  name                           text          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  base_currency                  varchar(16)   NOT NULL REFERENCES fx.currency (code),
  time_zone                      text          NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
  locale                         text          NOT NULL CHECK (length(locale) BETWEEN 2 AND 35),
  fiscal_month_start_day         smallint      NOT NULL DEFAULT 1 CHECK (fiscal_month_start_day BETWEEN 1 AND 28),
  min_liquidity_reserve_amount   numeric(38, 18) NULL,
  min_liquidity_reserve_currency varchar(16)   NULL REFERENCES fx.currency (code),
  personal_of_user_id            uuid          NULL REFERENCES iam."user" (id),
  status                         text          NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PENDING_DELETION')),
  deletion_requested_at          timestamptz   NULL,
  created_at                     timestamptz   NOT NULL DEFAULT now(),
  updated_at                     timestamptz   NOT NULL DEFAULT now(),
  archived_at                    timestamptz   NULL,
  version                        integer       NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT workspace_reserve_pair CHECK (
    (min_liquidity_reserve_amount IS NULL) = (min_liquidity_reserve_currency IS NULL)
  ),
  CONSTRAINT workspace_reserve_non_negative CHECK (min_liquidity_reserve_amount IS NULL OR min_liquidity_reserve_amount >= 0)
);
-- Como máximo un workspace personal por usuario, aun ante carreras de provisión.
CREATE UNIQUE INDEX workspace_personal_uq ON iam.workspace (personal_of_user_id) WHERE personal_of_user_id IS NOT NULL;

-- ---------------------------------------------------------------- iam.workspace_membership
CREATE TABLE iam.workspace_membership (
  workspace_id uuid        NOT NULL REFERENCES iam.workspace (id),
  user_id      uuid        NOT NULL REFERENCES iam."user" (id),
  role         text        NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
  status       text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  invited_by   uuid        NULL REFERENCES iam."user" (id),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  version      integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT membership_revoked_at CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX workspace_membership_user_active_idx ON iam.workspace_membership (user_id) WHERE status = 'ACTIVE';

-- RLS de workspace (después de crear membership: la política la consulta).
ALTER TABLE iam.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.workspace FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_member_read ON iam.workspace FOR SELECT TO pf_app USING (
  (platform.current_workspace_id_if_set() IS NULL OR id = platform.current_workspace_id_if_set())
  AND EXISTS (
    SELECT 1 FROM iam.workspace_membership m
     WHERE m.workspace_id = workspace.id AND m.user_id = platform.current_user_id() AND m.status = 'ACTIVE'
  )
);
CREATE POLICY workspace_insert ON iam.workspace FOR INSERT TO pf_app
  WITH CHECK (
    id = platform.current_workspace_id()
    AND (personal_of_user_id IS NULL OR personal_of_user_id = platform.current_user_id())
  );
CREATE POLICY workspace_update ON iam.workspace FOR UPDATE TO pf_app
  USING (id = platform.current_workspace_id()) WITH CHECK (id = platform.current_workspace_id());
REVOKE ALL ON iam.workspace FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON iam.workspace TO pf_app;

ALTER TABLE iam.workspace_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.workspace_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON iam.workspace_membership FOR SELECT TO pf_app USING (
  user_id = platform.current_user_id() OR workspace_id = platform.current_workspace_id_if_set()
);
CREATE POLICY membership_insert ON iam.workspace_membership FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY membership_update ON iam.workspace_membership FOR UPDATE TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
REVOKE ALL ON iam.workspace_membership FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON iam.workspace_membership TO pf_app;

-- Invariante "≥ 1 OWNER activo por workspace" (docs/08 §5.1): constraint trigger DIFERIDO (se evalúa al COMMIT,
-- así crear workspace + membresía OWNER en la misma transacción es válido). Se ejecuta con el rol invocador: la
-- transacción que modifica membresías tiene el workspace en contexto y ve todas sus filas.
CREATE FUNCTION iam.assert_workspace_has_owner() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE ws uuid;
BEGIN
  IF TG_TABLE_NAME = 'workspace' THEN
    ws := NEW.id;
  ELSE
    ws := NEW.workspace_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.workspace_membership
     WHERE workspace_id = ws AND role = 'OWNER' AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'workspace % must have at least one active OWNER', ws
      USING ERRCODE = '23514', CONSTRAINT = 'workspace_has_owner';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER workspace_has_owner AFTER INSERT ON iam.workspace
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iam.assert_workspace_has_owner();
CREATE CONSTRAINT TRIGGER membership_keeps_owner AFTER INSERT OR UPDATE ON iam.workspace_membership
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iam.assert_workspace_has_owner();

-- ---------------------------------------------------------------- iam.provision_user
-- Alta/actualización JIT de la identidad (design §4). SECURITY DEFINER acotada: solo hace el upsert por
-- (iss, sub) y devuelve el id; la identidad viene de un JWT ya validado por la API. Idempotente bajo concurrencia.
CREATE FUNCTION iam.provision_user(p_issuer text, p_subject text, p_email text, p_display_name text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE v_id uuid;
BEGIN
  INSERT INTO iam."user" AS u (idp_issuer, idp_subject, email, email_verified, display_name, last_login_at)
  VALUES (p_issuer, p_subject, p_email, true, p_display_name, now())
  ON CONFLICT (idp_issuer, idp_subject) DO UPDATE
    SET email = EXCLUDED.email, email_verified = true, display_name = EXCLUDED.display_name,
        last_login_at = now(), updated_at = now()
  RETURNING u.id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION iam.provision_user(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.provision_user(text, text, text, text) TO pf_app;

-- ---------------------------------------------------------------- iam.bff_session
CREATE TABLE iam.bff_session (
  id                  uuid        PRIMARY KEY DEFAULT uuidv7(),
  sid_hash            bytea       NOT NULL UNIQUE CHECK (length(sid_hash) = 32),
  kind                text        NOT NULL CHECK (kind IN ('PENDING_LOGIN', 'ACTIVE')),
  user_id             uuid        NULL REFERENCES iam."user" (id) ON DELETE CASCADE,
  tokens_enc          bytea       NULL,
  csrf_secret_enc     bytea       NULL,
  login_state_enc     bytea       NULL,
  active_workspace_id uuid        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT bff_session_active_user CHECK (kind <> 'ACTIVE' OR user_id IS NOT NULL)
);
CREATE INDEX bff_session_idle_idx ON iam.bff_session (idle_expires_at);
CREATE INDEX bff_session_absolute_idx ON iam.bff_session (absolute_expires_at);
COMMENT ON TABLE iam.bff_session IS
  'Sesiones del BFF (tokens cifrados AES-256-GCM, sid hasheado). Técnica, sin RLS por workspace: solo pf_bff.';
REVOKE ALL ON iam.bff_session FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.bff_session TO pf_bff;
GRANT SELECT, DELETE ON iam.bff_session TO pf_maintenance;

-- migrate:down
DROP TABLE iam.bff_session;
DROP FUNCTION iam.provision_user(text, text, text, text);
DROP TABLE iam.workspace_membership;
DROP TABLE iam.workspace;
DROP FUNCTION iam.assert_workspace_has_owner();
DROP TABLE iam."user";
DROP SCHEMA iam;
