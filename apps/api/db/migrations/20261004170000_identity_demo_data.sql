-- Datos de demostración en un workspace dedicado (openspec add-demo-data, tareas 4.1/4.2/4.3; ADR-0026; docs/31
-- D36/D41). Expand, no destructiva para datos reales. Se ejecuta con `pf_migrator` (dueño de todo).
--
-- Crea / amplía:
--   * iam.workspace: `is_demo` (inmutable por trigger, PF003), `demo_status`, `demo_origin_workspace_id`,
--     `demo_requested_by`, `demo_dataset_version`; `status` admite `ARCHIVED` y `PURGED` (PURGED solo demo); índice
--     único parcial "un demo vigente por usuario" (FR-IDENTITY-016).
--   * platform.demo_workspace_run: registro de cargas y purgas a nivel instalación (sin datos financieros). RLS
--     forzada: pf_app/pf_worker solo ven las filas que solicitó el usuario en contexto.
--   * platform.workspace_scoped_table: catálogo de TODAS las tablas acotadas por `workspace_id` con su orden de purga
--     (hijas antes que padres). El chequeo de catálogo (TC-SECURITY-RLS-004 ampliado) falla si una tabla nueva con
--     `workspace_id` no se registra con `platform.register_workspace_scoped_table(...)`.
--   * platform.purge_demo_workspace(uuid): SECURITY DEFINER (dueño pf_migrator), EXECUTE solo pf_worker, rechaza con
--     PF006 (DEMO_PURGE_NOT_ALLOWED) a otros llamadores, workspaces no demo o no en limpieza. Borra todas las filas del
--     workspace demo de las tablas registradas y deja una lápida (status/demo_status = PURGED).
--   * platform.forbid_mutation() (nueva versión): para `DELETE` de fila permite SOLO si a la vez (1) el usuario
--     efectivo es el dueño de la tabla (es decir, dentro de la función de purga), (2) la GUC
--     `pf.demo_purge_workspace` coincide con el `workspace_id` de la fila y (3) ese workspace es demo y está en
--     `CLEANING`. UPDATE y TRUNCATE siguen prohibidos siempre; para todo workspace real el comportamiento PF003 no cambia.
--   * platform.workspace_is_retired(uuid): los consumidores de eventos ignoran workspaces demo archivados/purgados.
--
-- Políticas para el dueño (pf_migrator) acotadas a la GUC de purga: con RLS FORZADA ni el dueño ve filas; las
-- políticas `demo_purge_*` le permiten ver/borrar SOLO las filas del workspace que la función fijó en la GUC. pf_app y
-- pf_worker no ganan nada fijando la GUC: las políticas no se aplican a ellos y no tienen grant DELETE.

-- migrate:up

-- ---------------------------------------------------------------- iam.workspace: marca demo
ALTER TABLE iam.workspace
  ADD COLUMN is_demo                  boolean NOT NULL DEFAULT false,
  ADD COLUMN demo_status              text    NULL,
  ADD COLUMN demo_origin_workspace_id uuid    NULL REFERENCES iam.workspace (id),
  ADD COLUMN demo_requested_by        uuid    NULL REFERENCES iam."user" (id),
  ADD COLUMN demo_dataset_version     text    NULL;

ALTER TABLE iam.workspace DROP CONSTRAINT workspace_status_check;
ALTER TABLE iam.workspace
  ADD CONSTRAINT workspace_status_check
    CHECK (status IN ('ACTIVE', 'PENDING_DELETION', 'ARCHIVED', 'PURGED')),
  ADD CONSTRAINT workspace_purged_only_demo CHECK (status <> 'PURGED' OR is_demo),
  ADD CONSTRAINT workspace_demo_status_check
    CHECK (demo_status IS NULL OR demo_status IN ('LOADING', 'READY', 'FAILED', 'CLEANING', 'PURGED')),
  ADD CONSTRAINT workspace_demo_fields CHECK (
    (is_demo AND demo_status IS NOT NULL AND demo_origin_workspace_id IS NOT NULL AND demo_requested_by IS NOT NULL
      AND demo_dataset_version IS NOT NULL AND personal_of_user_id IS NULL AND demo_origin_workspace_id <> id)
    OR (NOT is_demo AND demo_status IS NULL AND demo_origin_workspace_id IS NULL AND demo_requested_by IS NULL
      AND demo_dataset_version IS NULL)
  );

-- FR-IDENTITY-016: como máximo un workspace demo no purgado por usuario (también bajo concurrencia).
CREATE UNIQUE INDEX workspace_demo_active_per_user_uq ON iam.workspace (demo_requested_by)
  WHERE is_demo AND demo_status IN ('LOADING', 'READY', 'FAILED', 'CLEANING');
CREATE INDEX workspace_demo_origin_idx ON iam.workspace (demo_origin_workspace_id) WHERE is_demo;

-- Barrera 1 de ADR-0026: la marca demo (y su origen) nunca cambia después del INSERT; transiciones de estado válidas.
CREATE FUNCTION iam.guard_demo_workspace() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo
     OR NEW.demo_origin_workspace_id IS DISTINCT FROM OLD.demo_origin_workspace_id
     OR NEW.demo_requested_by IS DISTINCT FROM OLD.demo_requested_by
     OR NEW.demo_dataset_version IS DISTINCT FROM OLD.demo_dataset_version THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: is_demo of workspace % cannot change', OLD.id USING ERRCODE = 'PF003';
  END IF;
  IF NEW.demo_status IS DISTINCT FROM OLD.demo_status AND NOT (
       (OLD.demo_status = 'LOADING' AND NEW.demo_status IN ('READY', 'FAILED'))
    OR (OLD.demo_status IN ('READY', 'FAILED') AND NEW.demo_status = 'CLEANING')
    OR (OLD.demo_status = 'CLEANING' AND NEW.demo_status = 'PURGED')
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: demo workspace % from % to %', OLD.id, OLD.demo_status,
      NEW.demo_status USING ERRCODE = 'PF003';
  END IF;
  -- Un workspace archivado o purgado nunca vuelve a estar activo; PURGED es terminal.
  IF OLD.status IN ('ARCHIVED', 'PURGED') AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'ARCHIVED' AND NEW.status = 'PURGED') THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: workspace % from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'PF003';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION iam.guard_demo_workspace() FROM PUBLIC;
CREATE TRIGGER workspace_demo_guard BEFORE UPDATE ON iam.workspace
  FOR EACH ROW EXECUTE FUNCTION iam.guard_demo_workspace();

-- El directorio de workspaces del worker (FX) ya filtra status = 'ACTIVE' AND archived_at IS NULL: un demo
-- archivado deja de recibir tasas de providers sin cambios en FX.

-- ---------------------------------------------------------------- GUC de purga
-- Workspace que la función de purga está borrando (GUC LOCAL a la transacción); NULL fuera de ella.
CREATE FUNCTION platform.demo_purge_target() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS
$$ SELECT nullif(current_setting('pf.demo_purge_workspace', true), '')::uuid $$;
REVOKE ALL ON FUNCTION platform.demo_purge_target() FROM PUBLIC;

-- ---------------------------------------------------------------- platform.demo_workspace_run
CREATE TABLE platform.demo_workspace_run (
  workspace_id         uuid        PRIMARY KEY REFERENCES iam.workspace (id),
  origin_workspace_id  uuid        NOT NULL REFERENCES iam.workspace (id),
  requested_by         uuid        NOT NULL REFERENCES iam."user" (id),
  dataset_version      text        NOT NULL CHECK (length(dataset_version) BETWEEN 1 AND 20),
  anchor_date          date        NOT NULL,
  requested_at         timestamptz NOT NULL,
  loaded_at            timestamptz NULL,
  failed_at            timestamptz NULL,
  error_code           text        NULL CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  progress             jsonb       NOT NULL DEFAULT '{"completedModules": [], "totalModules": 0}'::jsonb
                                   CHECK (jsonb_typeof(progress) = 'object'),
  cleanup_requested_at timestamptz NULL,
  purged_at            timestamptz NULL,
  rows_deleted         jsonb       NULL CHECK (rows_deleted IS NULL OR jsonb_typeof(rows_deleted) = 'object')
);
COMMENT ON TABLE platform.demo_workspace_run IS
  'Cargas y purgas de workspaces demo (ADR-0026): evidencia de instalación que sobrevive a la purga; sin datos financieros.';
CREATE INDEX demo_workspace_run_origin_idx ON platform.demo_workspace_run (origin_workspace_id, requested_at DESC);

ALTER TABLE platform.demo_workspace_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.demo_workspace_run FORCE ROW LEVEL SECURITY;
CREATE POLICY demo_run_requester ON platform.demo_workspace_run TO pf_app
  USING (requested_by = platform.current_user_id())
  WITH CHECK (requested_by = platform.current_user_id());
REVOKE ALL ON platform.demo_workspace_run FROM PUBLIC, pf_app;
GRANT SELECT, INSERT ON platform.demo_workspace_run TO pf_app;
GRANT UPDATE (progress, loaded_at, failed_at, error_code, cleanup_requested_at) ON platform.demo_workspace_run
  TO pf_app;

-- ---------------------------------------------------------------- platform.workspace_scoped_table
CREATE TABLE platform.workspace_scoped_table (
  schema_name  text    NOT NULL,
  table_name   text    NOT NULL,
  purge_order  integer NOT NULL CHECK (purge_order BETWEEN 1 AND 1000),
  purge_action text    NOT NULL CHECK (purge_action IN ('DELETE', 'RETAIN')),
  PRIMARY KEY (schema_name, table_name)
);
COMMENT ON TABLE platform.workspace_scoped_table IS
  'Tablas acotadas por workspace_id y su orden de purga demo (hijas antes que padres). Lo pueblan las migraciones.';
REVOKE ALL ON platform.workspace_scoped_table FROM PUBLIC, pf_app;

-- Registra una tabla acotada por workspace (idempotente). Con `DELETE` y RLS habilitada crea las políticas del dueño
-- acotadas a la GUC de purga. Toda migración que cree una tabla con `workspace_id` DEBE invocarla.
CREATE FUNCTION platform.register_workspace_scoped_table(p_table regclass, p_order integer,
                                                         p_action text DEFAULT 'DELETE') RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_schema text;
  v_name   text;
  v_rls    boolean;
BEGIN
  SELECT n.nspname, c.relname, c.relrowsecurity INTO v_schema, v_name, v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = p_table;
  INSERT INTO platform.workspace_scoped_table (schema_name, table_name, purge_order, purge_action)
  VALUES (v_schema, v_name, p_order, p_action)
  ON CONFLICT (schema_name, table_name)
    DO UPDATE SET purge_order = EXCLUDED.purge_order, purge_action = EXCLUDED.purge_action;
  IF p_action = 'DELETE' AND v_rls THEN
    EXECUTE format('DROP POLICY IF EXISTS demo_purge_read ON %s', p_table);
    EXECUTE format('DROP POLICY IF EXISTS demo_purge_delete ON %s', p_table);
    EXECUTE format(
      'CREATE POLICY demo_purge_read ON %s FOR SELECT TO %I USING (workspace_id = platform.demo_purge_target())',
      p_table, current_user);
    EXECUTE format(
      'CREATE POLICY demo_purge_delete ON %s FOR DELETE TO %I USING (workspace_id = platform.demo_purge_target())',
      p_table, current_user);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION platform.register_workspace_scoped_table(regclass, integer, text) FROM PUBLIC;

-- Orden de purga (menor primero): hijas antes que padres según las FKs (el test de catálogo lo verifica).
SELECT platform.register_workspace_scoped_table(t.tbl::regclass, t.ord, t.act)
  FROM (VALUES
    ('txn.split_tag', 10, 'DELETE'),
    ('txn.conversion_fee', 10, 'DELETE'),
    ('txn.transaction_journal_link', 10, 'DELETE'),
    ('txn.conversion_detail', 20, 'DELETE'),
    ('txn.transaction_leg', 20, 'DELETE'),
    ('txn.transaction_split', 30, 'DELETE'),
    ('txn.transaction', 40, 'DELETE'),
    ('ledger.posting', 50, 'DELETE'),
    ('ledger.entry_reversal', 50, 'DELETE'),
    ('ledger.balance_snapshot', 50, 'DELETE'),
    ('ledger.journal_entry', 60, 'DELETE'),
    ('ledger.period_lock', 60, 'DELETE'),
    ('ledger.ledger_account', 70, 'DELETE'),
    ('accounts.account_tag', 80, 'DELETE'),
    ('accounts.account', 90, 'DELETE'),
    ('accounts.institution', 100, 'DELETE'),
    ('classification.counterparty_alias', 110, 'DELETE'),
    ('classification.counterparty', 120, 'DELETE'),
    ('classification.category', 130, 'DELETE'),
    ('classification.category_group', 140, 'DELETE'),
    ('classification.tag', 140, 'DELETE'),
    ('fx.rate_anomaly_review', 150, 'DELETE'),
    ('fx.exchange_rate', 160, 'DELETE'),
    ('fx.rate_preference', 160, 'DELETE'),
    ('fx.rate_preference_set', 160, 'DELETE'),
    ('fx.workspace_currency', 160, 'DELETE'),
    ('reporting.workspace_data_version', 170, 'DELETE'),
    ('platform.idempotency_key', 170, 'DELETE'),
    ('platform.outbox', 170, 'DELETE'),
    ('platform.inbox', 170, 'DELETE'),
    ('platform.dead_letter', 170, 'DELETE'),
    ('audit.audit_log', 170, 'DELETE'),
    ('audit.lifecycle_transition', 170, 'DELETE'),
    ('iam.workspace_membership', 180, 'DELETE'),
    -- Evidencia de la carga/purga: sobrevive (ADR-0026 §5).
    ('platform.demo_workspace_run', 1000, 'RETAIN')
  ) AS t (tbl, ord, act);

-- Cobertura genérica: toda tabla con `workspace_id` creada por migraciones anteriores que no figure arriba (p. ej.
-- `audit.lifecycle_transition` de add-lifecycle-timeline) se registra como hoja (orden 5: se borra primero). Si otra
-- tabla la referenciara, el chequeo de catálogo (orden de FKs) falla en CI y hay que registrarla con su orden real.
-- Las migraciones POSTERIORES deben invocar platform.register_workspace_scoped_table(...) explícitamente: el test de
-- catálogo falla si una tabla con `workspace_id` queda sin registrar.
SELECT platform.register_workspace_scoped_table(c.oid::regclass, 5, 'DELETE')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped)
   AND NOT EXISTS (SELECT 1 FROM platform.workspace_scoped_table t
                    WHERE t.schema_name = n.nspname AND t.table_name = c.relname);

-- La lápida (iam.workspace) y la evidencia (demo_workspace_run): el dueño solo ve/actualiza la fila en purga.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY demo_purge_lock ON iam.workspace FOR SELECT TO %I USING (id = platform.demo_purge_target())',
    current_user);
  EXECUTE format(
    'CREATE POLICY demo_purge_tombstone ON iam.workspace FOR UPDATE TO %I '
    'USING (id = platform.demo_purge_target()) WITH CHECK (id = platform.demo_purge_target())', current_user);
  EXECUTE format(
    'CREATE POLICY demo_purge_run_read ON platform.demo_workspace_run FOR SELECT TO %I '
    'USING (workspace_id = platform.demo_purge_target())', current_user);
  EXECUTE format(
    'CREATE POLICY demo_purge_run_update ON platform.demo_workspace_run FOR UPDATE TO %I '
    'USING (workspace_id = platform.demo_purge_target()) WITH CHECK (workspace_id = platform.demo_purge_target())',
    current_user);
END
$$;

-- ---------------------------------------------------------------- platform.forbid_mutation (nueva versión)
-- Barrera 3 de ADR-0026. Mismo comportamiento que la versión anterior salvo la excepción acotada de DELETE de fila.
-- `to_jsonb(OLD)` evita fallar en tablas sin `workspace_id` (sin columna ⇒ NULL ⇒ PF003).
CREATE OR REPLACE FUNCTION platform.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_target text;
BEGIN
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND TG_WHEN = 'BEFORE' THEN
    v_target := nullif(current_setting('pf.demo_purge_workspace', true), '');
    -- Guardas anidadas (orden de evaluación garantizado): la consulta a iam.workspace solo corre para el dueño.
    IF v_target IS NOT NULL
       AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
      IF to_jsonb(OLD) ->> 'workspace_id' = v_target THEN
        IF EXISTS (SELECT 1 FROM iam.workspace w
                    WHERE w.id = v_target::uuid AND w.is_demo AND w.demo_status = 'CLEANING') THEN
          RETURN OLD;
        END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'PF003';
END
$$;
REVOKE ALL ON FUNCTION platform.forbid_mutation() FROM PUBLIC;

-- ---------------------------------------------------------------- platform.purge_demo_workspace
CREATE FUNCTION platform.purge_demo_workspace(p_workspace uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_ws      record;
  v_table   record;
  v_count   bigint;
  v_deleted jsonb := '{}'::jsonb;
BEGIN
  -- Barrera 2: solo el worker (EXECUTE solo pf_worker; además, nunca otra sesión aunque el dueño la invoque).
  IF session_user <> 'pf_worker' THEN
    RAISE EXCEPTION 'DEMO_PURGE_NOT_ALLOWED: caller % is not allowed', session_user USING ERRCODE = 'PF006';
  END IF;
  IF p_workspace IS NULL THEN
    RAISE EXCEPTION 'DEMO_PURGE_NOT_ALLOWED: workspace is required' USING ERRCODE = 'PF006';
  END IF;
  PERFORM set_config('pf.demo_purge_workspace', p_workspace::text, true);
  SELECT w.id, w.is_demo, w.demo_status INTO v_ws FROM iam.workspace w WHERE w.id = p_workspace FOR UPDATE;
  IF NOT FOUND OR NOT v_ws.is_demo OR v_ws.demo_status IS DISTINCT FROM 'CLEANING' THEN
    RAISE EXCEPTION 'DEMO_PURGE_NOT_ALLOWED: workspace % is not a demo workspace pending cleanup', p_workspace
      USING ERRCODE = 'PF006';
  END IF;
  FOR v_table IN
    SELECT schema_name, table_name FROM platform.workspace_scoped_table
     WHERE purge_action = 'DELETE' ORDER BY purge_order, schema_name, table_name
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE workspace_id = $1', v_table.schema_name, v_table.table_name)
      USING p_workspace;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object(v_table.schema_name || '.' || v_table.table_name, v_count);
  END LOOP;
  -- Lápida: sin datos de negocio (nombre conservado para la evidencia del origen).
  UPDATE iam.workspace
     SET status = 'PURGED', demo_status = 'PURGED', min_liquidity_reserve_amount = NULL,
         min_liquidity_reserve_currency = NULL, archived_at = coalesce(archived_at, now()), updated_at = now(),
         version = version + 1
   WHERE id = p_workspace;
  UPDATE platform.demo_workspace_run SET purged_at = now(), rows_deleted = v_deleted
   WHERE workspace_id = p_workspace;
  PERFORM set_config('pf.demo_purge_workspace', '', true);
  RETURN v_deleted;
END
$$;
REVOKE ALL ON FUNCTION platform.purge_demo_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.purge_demo_workspace(uuid) TO pf_worker;

-- ---------------------------------------------------------------- platform.workspace_is_retired
-- Workspace demo archivado o purgado: los consumidores de eventos lo ignoran (no-op idempotente, sin inbox).
CREATE FUNCTION platform.workspace_is_retired(p_workspace uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
  SELECT EXISTS (SELECT 1 FROM iam.workspace w
                  WHERE w.id = p_workspace AND w.is_demo AND w.status IN ('ARCHIVED', 'PURGED'))
$$;
REVOKE ALL ON FUNCTION platform.workspace_is_retired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.workspace_is_retired(uuid) TO pf_worker;
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY workspace_retired_probe ON iam.workspace FOR SELECT TO %I '
    'USING (is_demo AND status IN (''ARCHIVED'', ''PURGED''))', current_user);
END
$$;

-- migrate:down
DROP POLICY workspace_retired_probe ON iam.workspace;
DROP FUNCTION platform.workspace_is_retired(uuid);
DROP FUNCTION platform.purge_demo_workspace(uuid);
CREATE OR REPLACE FUNCTION platform.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'PF003';
END
$$;
DROP POLICY demo_purge_run_update ON platform.demo_workspace_run;
DROP POLICY demo_purge_run_read ON platform.demo_workspace_run;
DROP POLICY demo_purge_tombstone ON iam.workspace;
DROP POLICY demo_purge_lock ON iam.workspace;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schema_name, table_name FROM platform.workspace_scoped_table WHERE purge_action = 'DELETE' LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_purge_read ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS demo_purge_delete ON %I.%I', r.schema_name, r.table_name);
  END LOOP;
END
$$;
DROP FUNCTION platform.register_workspace_scoped_table(regclass, integer, text);
DROP TABLE platform.workspace_scoped_table;
DROP TABLE platform.demo_workspace_run;
DROP FUNCTION platform.demo_purge_target();
DROP TRIGGER workspace_demo_guard ON iam.workspace;
DROP FUNCTION iam.guard_demo_workspace();
DROP INDEX iam.workspace_demo_origin_idx;
DROP INDEX iam.workspace_demo_active_per_user_uq;
ALTER TABLE iam.workspace
  DROP CONSTRAINT workspace_demo_fields,
  DROP CONSTRAINT workspace_demo_status_check,
  DROP CONSTRAINT workspace_purged_only_demo,
  DROP CONSTRAINT workspace_status_check;
ALTER TABLE iam.workspace
  ADD CONSTRAINT workspace_status_check CHECK (status IN ('ACTIVE', 'PENDING_DELETION'));
ALTER TABLE iam.workspace
  DROP COLUMN demo_dataset_version,
  DROP COLUMN demo_requested_by,
  DROP COLUMN demo_origin_workspace_id,
  DROP COLUMN demo_status,
  DROP COLUMN is_demo;
