-- Pista de auditoría (openspec add-audit-trail, design §5; docs/08 §5.16, docs/12 §13.2, ADR-0023). Expand, no
-- destructiva. Se ejecuta con `pf_migrator` (dueño de todo; ni pf_app ni pf_worker son owners).
--
-- Crea:
--   * `platform.forbid_mutation()`: trigger de inmutabilidad (SQLSTATE PF003, docs/31 D19). `CREATE OR REPLACE`:
--     idempotente con add-ledger-core, que la reutiliza.
--   * schema `audit` y `audit.audit_log` (WS-RO): particionada por mes (`occurred_at`), partición DEFAULT como red
--     de seguridad, RLS habilitada y FORZADA por workspace (fail-closed con PF002), solo SELECT/INSERT para
--     `pf_app` (y `pf_worker`, que lo hereda); UPDATE/DELETE/TRUNCATE bloqueados por grants Y por trigger.
--   * `audit.ensure_partitions(n)`: crea las particiones del mes actual y los `n` siguientes con la misma RLS
--     (SECURITY DEFINER acotada; la invoca el job `audit.ensure-partitions` del worker).
--   * `audit.default_partition_rows()`: filas en la partición DEFAULT (alerta del job).
--
-- Las particiones NO tienen grants para los roles de aplicación: solo se accede por la tabla padre (RLS del padre).
-- Aun así llevan RLS forzada y política propias para el chequeo de catálogo (TC-SECURITY-RLS-004).

-- migrate:up
CREATE OR REPLACE FUNCTION platform.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'PF003';
END
$$;
REVOKE ALL ON FUNCTION platform.forbid_mutation() FROM PUBLIC;

CREATE SCHEMA audit;
GRANT USAGE ON SCHEMA audit TO pf_app;

CREATE TABLE audit.audit_log (
  id                uuid        NOT NULL,
  occurred_at       timestamptz NOT NULL,
  workspace_id      uuid        NOT NULL,
  actor_type        text        NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'WORKER')),
  actor_user_id     uuid        NULL,
  actor_process     text        NULL CHECK (actor_process IS NULL OR length(actor_process) BETWEEN 1 AND 100),
  action            text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9_]*){2}$'),
  aggregate_type    text        NOT NULL CHECK (aggregate_type ~ '^[A-Z][A-Za-z]{0,63}$'),
  aggregate_id      uuid        NOT NULL,
  aggregate_version integer     NULL CHECK (aggregate_version IS NULL OR aggregate_version >= 1),
  changes           jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  reason            text        NULL CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  origin            text        NOT NULL CHECK (origin IN ('ui', 'api', 'import', 'rule', 'recurring', 'system')),
  correlation_id    uuid        NOT NULL,
  request_id        uuid        NULL,
  idempotency_key   text        NULL CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 255),
  client_ip_hash    bytea       NULL CHECK (client_ip_hash IS NULL OR length(client_ip_hash) = 32),
  user_agent        text        NULL CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  -- Reservadas para el hash encadenado (FR-AUDIT-008, Phase 9): NULL hasta entonces.
  prev_hash         bytea       NULL,
  row_hash          bytea       NULL,
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT audit_log_user_actor CHECK (actor_type <> 'USER' OR actor_user_id IS NOT NULL),
  CONSTRAINT audit_log_process_actor CHECK (actor_type = 'USER' OR (actor_process IS NOT NULL AND actor_user_id IS NULL))
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE audit.audit_log IS
  'Pista de auditoría append-only (WS-RO, INV-029): se escribe en la transacción del comando; sin UPDATE/DELETE/TRUNCATE.';
COMMENT ON COLUMN audit.audit_log.client_ip_hash IS 'HMAC-SHA256 de la IP del cliente (AUDIT_IP_HMAC_KEY); nunca la IP en claro.';

CREATE INDEX audit_log_entity_idx ON audit.audit_log (workspace_id, aggregate_type, aggregate_id, occurred_at, id);
CREATE INDEX audit_log_recent_idx ON audit.audit_log (workspace_id, occurred_at DESC, id DESC);
CREATE INDEX audit_log_actor_idx ON audit.audit_log (workspace_id, actor_user_id, occurred_at DESC);

ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation_read ON audit.audit_log FOR SELECT TO pf_app
  USING (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation_write ON audit.audit_log FOR INSERT TO pf_app
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON audit.audit_log FROM PUBLIC, pf_app;
GRANT SELECT, INSERT ON audit.audit_log TO pf_app;

-- Inmutabilidad (defensa adicional a los grants; también frena al owner). Las de fila se clonan a las particiones.
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION platform.forbid_mutation();

-- Protecciones de una partición (RLS forzada + política + TRUNCATE): las de fila llegan clonadas del padre.
CREATE FUNCTION audit.protect_partition(p_table regclass) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, pf_app', p_table);
  EXECUTE format(
    'CREATE POLICY ws_isolation ON %s TO pf_app USING (workspace_id = platform.current_workspace_id()) '
    'WITH CHECK (workspace_id = platform.current_workspace_id())', p_table);
  EXECUTE format(
    'CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
    'EXECUTE FUNCTION platform.forbid_mutation()', p_table);
END
$$;
REVOKE ALL ON FUNCTION audit.protect_partition(regclass) FROM PUBLIC;

CREATE TABLE audit.audit_log_default PARTITION OF audit.audit_log DEFAULT;
SELECT audit.protect_partition('audit.audit_log_default');

-- Particiones mensuales del mes (UTC) de `now()` y los `p_months_ahead` siguientes. Idempotente. Si la DEFAULT ya
-- tiene filas de un mes, esa partición no puede crearse (PostgreSQL lo impide): se omite con WARNING y el job alerta.
CREATE FUNCTION audit.ensure_partitions(p_months_ahead integer DEFAULT 2) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$
DECLARE
  v_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_from  date;
  v_name  text;
  v_created integer := 0;
BEGIN
  IF p_months_ahead IS NULL OR p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'p_months_ahead fuera de rango (0..24)' USING ERRCODE = '22023';
  END IF;
  FOR i IN 0..p_months_ahead LOOP
    v_from := (v_start + make_interval(months => i))::date;
    v_name := format('audit_log_y%sm%s', to_char(v_from, 'YYYY'), to_char(v_from, 'MM'));
    CONTINUE WHEN to_regclass(format('audit.%I', v_name)) IS NOT NULL;
    BEGIN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)',
        v_name,
        (v_from::timestamp AT TIME ZONE 'UTC'),
        ((v_from + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
      PERFORM audit.protect_partition(format('audit.%I', v_name)::regclass);
      v_created := v_created + 1;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'audit partition % not created: DEFAULT partition holds rows of that month', v_name;
    END;
  END LOOP;
  RETURN v_created;
END
$$;
REVOKE ALL ON FUNCTION audit.ensure_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer) TO pf_worker;

-- Filas que cayeron en la partición DEFAULT (no debería haber: el job crea particiones con 2 meses de anticipación).
-- Con RLS FORZADA ni el owner ve filas: una política de solo lectura para el owner (rol migrador, ya todopoderoso
-- sobre el schema) en la DEFAULT permite contarlas; la función solo devuelve el número, nunca filas.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY default_partition_monitor ON audit.audit_log_default FOR SELECT TO %I USING (true)',
    current_user);
END
$$;
CREATE FUNCTION audit.default_partition_rows() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS
$$ SELECT count(*) FROM audit.audit_log_default $$;
REVOKE ALL ON FUNCTION audit.default_partition_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.default_partition_rows() TO pf_worker;

SELECT audit.ensure_partitions(2);

-- migrate:down
DROP TABLE audit.audit_log;
DROP FUNCTION audit.default_partition_rows();
DROP FUNCTION audit.ensure_partitions(integer);
DROP FUNCTION audit.protect_partition(regclass);
DROP SCHEMA audit;
DROP FUNCTION platform.forbid_mutation();
