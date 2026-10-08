-- PLANNING: periodos financieros (openspec add-financial-periods, tarea 4.1; design.md decisiones 11 y 13, § Modelo de
-- datos; docs/08 §5.6; ADR-0023). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * planning.financial_period  WS: SELECT/INSERT/UPDATE para pf_app (sin DELETE: los periodos nunca se borran);
--     pf_worker hereda de pf_app y opera por workspace con `SET LOCAL app.workspace_id`.
--     Barreras: exclusión gist DIFERIBLE de rangos por workspace (el recálculo de DRAFT reordena rangos en sitio dentro
--     de una transacción), únicos (workspace, label) — árbitro de `ON CONFLICT DO NOTHING`, por eso NO diferible — y
--     (workspace, period_start), CHECKs de rango/día/estado y trigger de rango congelado fuera de DRAFT
--     (SQLSTATE 23514, constraint lógico `financial_period_range_frozen`). La contigüidad la garantiza
--     `PeriodCalendar` (no es expresable como constraint simple).
--   * pf_workspace_directory: + SELECT (fiscal_month_start_day) en iam.workspace — el worker calcula los rangos de
--     cada workspace (job `planning.ensure-periods` y consumidores) con el día de inicio vigente.
--   * audit.lifecycle_state_divergences(): cubre también `FinancialPeriod` (estado ↔ última transición del recorrido).
--   * Registro en platform.workspace_scoped_table (purga del workspace demo, ADR-0026).
-- Sin backfill: los periodos los crea `EnsurePeriods` (job al arrancar el worker y cron horario).

-- migrate:up
-- Exclusión con igualdad de uuid + solapamiento de rangos (docs/08 §11): extensión de confianza, la instala el dueño.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA planning;
GRANT USAGE ON SCHEMA planning TO pf_app;

CREATE TABLE planning.financial_period (
  id              uuid        PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES iam.workspace (id),
  label           char(7)     NOT NULL CHECK (label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  start_day       smallint    NOT NULL CHECK (start_day BETWEEN 1 AND 28),
  is_transition   boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'REOPENED')),
  close_count     integer     NOT NULL DEFAULT 0 CHECK (close_count >= 0),
  reopen_count    integer     NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  latest_close_no integer     NULL CHECK (latest_close_no IS NULL OR latest_close_no >= 1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT financial_period_range_ck CHECK (period_end >= period_start),
  -- La etiqueta es el año y mes del inicio (docs/33 D59).
  CONSTRAINT financial_period_label_ck CHECK (label = to_char(period_start, 'YYYY-MM')),
  CONSTRAINT financial_period_activated_ck CHECK (status = 'DRAFT' OR activated_at IS NOT NULL),
  CONSTRAINT financial_period_label_uk UNIQUE (workspace_id, label),
  CONSTRAINT financial_period_start_uk UNIQUE (workspace_id, period_start),
  CONSTRAINT financial_period_ws_id_uk UNIQUE (workspace_id, id),
  CONSTRAINT financial_period_no_overlap EXCLUDE USING gist (
    workspace_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX financial_period_status_ix ON planning.financial_period (workspace_id, status);
CREATE INDEX financial_period_start_desc_ix ON planning.financial_period (workspace_id, period_start DESC);
COMMENT ON TABLE planning.financial_period IS
  'Periodos financieros mensuales del workspace (planning/financial-periods): rango inclusivo, etiqueta YYYY-MM del inicio.';

-- Rango congelado fuera de DRAFT (decisión 11): un periodo iniciado, cerrado o reabierto nunca cambia de fechas.
CREATE FUNCTION planning.assert_period_range_frozen() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS
$$
BEGIN
  IF OLD.status <> 'DRAFT'
     AND (NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
          OR NEW.label IS DISTINCT FROM OLD.label) THEN
    RAISE EXCEPTION 'FINANCIAL_PERIOD_RANGE_FROZEN: period % (%) is % and its range cannot change',
      OLD.label, OLD.id, OLD.status
      USING ERRCODE = '23514', CONSTRAINT = 'financial_period_range_frozen';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION planning.assert_period_range_frozen() FROM PUBLIC;
CREATE TRIGGER financial_period_range_frozen BEFORE UPDATE ON planning.financial_period
  FOR EACH ROW EXECUTE FUNCTION planning.assert_period_range_frozen();

ALTER TABLE planning.financial_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning.financial_period FORCE ROW LEVEL SECURITY;
-- Fail-closed (PF002): `platform.current_workspace_id()` falla si la transacción no fijó el workspace.
CREATE POLICY ws_isolation ON planning.financial_period TO pf_app
  USING (workspace_id = platform.current_workspace_id())
  WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON ALL TABLES IN SCHEMA planning FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON planning.financial_period TO pf_app;

-- Purga del workspace demo (ADR-0026): hoja (nadie la referencia todavía; pf-p2b y add-month-closing registrarán sus
-- hijas con un orden menor).
SELECT platform.register_workspace_scoped_table('planning.financial_period'::regclass, 160, 'DELETE');

-- Día de inicio del mes financiero para el worker (directorio de workspaces, migración 20261003230100).
GRANT SELECT (fiscal_month_start_day) ON iam.workspace TO pf_workspace_directory;

-- Consistencia del recorrido (add-lifecycle-timeline decisión 6): + FinancialPeriod (estado persistido).
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'FinancialPeriod', fp.id, fp.status
      FROM planning.financial_period fp WHERE fp.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION audit.lifecycle_state_divergences()
  RETURNS TABLE (aggregate_type text, aggregate_id uuid, recorded_state text, actual_state text)
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS
$$
  WITH last_transition AS (
    SELECT DISTINCT ON (lt.aggregate_type, lt.aggregate_id)
           lt.aggregate_type, lt.aggregate_id, lt.to_state
      FROM audit.lifecycle_transition lt
     WHERE lt.workspace_id = platform.current_workspace_id() AND lt.kind = 'TRANSITION'
     ORDER BY lt.aggregate_type, lt.aggregate_id, lt.occurred_at DESC, lt.sequence DESC
  ), actual AS (
    SELECT 'Transaction'::text AS aggregate_type, t.id AS aggregate_id, t.status AS state
      FROM txn.transaction t WHERE t.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Account', a.id,
           CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
                WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END
      FROM accounts.account a WHERE a.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'ExchangeRate', r.id,
           CASE WHEN EXISTS (SELECT 1 FROM fx.exchange_rate n WHERE n.supersedes_id = r.id)
                THEN 'SUPERSEDED' ELSE 'RECORDED' END
      FROM fx.exchange_rate r WHERE r.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Category', c.id, CASE WHEN c.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.category c WHERE c.workspace_id = platform.current_workspace_id()
    UNION ALL
    SELECT 'Counterparty', cp.id, CASE WHEN cp.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE 'ACTIVE' END
      FROM classification.counterparty cp WHERE cp.workspace_id = platform.current_workspace_id()
  )
  SELECT l.aggregate_type, l.aggregate_id, l.to_state, a.state
    FROM last_transition l
    JOIN actual a ON a.aggregate_type = l.aggregate_type AND a.aggregate_id = l.aggregate_id
   WHERE a.state IS DISTINCT FROM l.to_state
$$;
REVOKE SELECT (fiscal_month_start_day) ON iam.workspace FROM pf_workspace_directory;
DELETE FROM platform.workspace_scoped_table WHERE schema_name = 'planning' AND table_name = 'financial_period';
DROP SCHEMA planning CASCADE;
