-- FORECAST: schema `forecasting` (openspec add-ml-forecasting-service, tarea 5.1; design.md § Plan de migración y decisiones
-- 12, 15 y 16; docs/66 D410–D442). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * forecasting.forecast_run     WS: una corrida de pronóstico (máquina `FORECAST_RUN_LIFECYCLE`). El índice único parcial
--       garantiza UNA corrida solicitada o en curso por workspace aunque dos solicitudes lleguen a la vez.
--   * forecasting.forecast_series  WS: una serie de la corrida (con su preparación de datos y la referencia opaca de la
--       petición al servicio; el mapeo solo vive aquí).
--   * forecasting.forecast_point   WS: un punto pronosticado (solo inserción para la app).
--   * platform.operation           + `FORECAST` en `kind` (la corrida manual es una operación asíncrona con el mismo id).
-- Las tres tablas: RLS ENABLE + FORCE fail-closed (`platform.current_workspace_id()` lanza PF002 sin contexto, D298) y
-- registro en `platform.workspace_scoped_table` (purga del workspace demo, ADR-0026; hijas antes que padres). `pf_worker`
-- es miembro de `pf_app` y hereda sus grants y políticas; `pf_maintenance` solo lee columnas operativas de `forecast_run`
-- (barrido entre workspaces del ejecutor y de la retención); cada mutación corre luego con el contexto de su workspace.
-- Sin backfill. Reversible por un contract posterior.

-- migrate:up
CREATE SCHEMA forecasting;
GRANT USAGE ON SCHEMA forecasting TO pf_app, pf_maintenance;

CREATE TABLE forecasting.forecast_run (
  id                  uuid        PRIMARY KEY,
  workspace_id        uuid        NOT NULL REFERENCES iam.workspace (id),
  trigger             text        NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
  status              text        NOT NULL CHECK (status IN
                        ('REQUESTED', 'RUNNING', 'COMPLETED', 'INSUFFICIENT_DATA', 'FAILED', 'SUPERSEDED')),
  requested_by        uuid        NULL,
  requested_at        timestamptz NOT NULL,
  started_at          timestamptz NULL,
  completed_at        timestamptz NULL,
  as_of_period        text        NULL CHECK (as_of_period IS NULL OR as_of_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reporting_currency  varchar(16) NOT NULL,
  attempts            smallint    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at     timestamptz NOT NULL,
  failure_reason      text        NULL CHECK (failure_reason IS NULL OR failure_reason IN
                        ('SERVICE_UNAVAILABLE', 'SERVICE_REJECTED', 'TIMEOUT', 'INVALID_OUTPUT')),
  dataset_snapshot_id text        NULL,
  service_version     text        NULL,
  superseded_by       uuid        NULL,
  series_published    smallint    NOT NULL DEFAULT 0 CHECK (series_published >= 0),
  series_insufficient smallint    NOT NULL DEFAULT 0 CHECK (series_insufficient >= 0),
  series_invalid      smallint    NOT NULL DEFAULT 0 CHECK (series_invalid >= 0),
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT forecast_run_ws_id_uk UNIQUE (workspace_id, id)
);
-- Una sola corrida activa por workspace (a prueba de dos solicitudes simultáneas).
CREATE UNIQUE INDEX forecast_run_active_uk ON forecasting.forecast_run (workspace_id)
  WHERE status IN ('REQUESTED', 'RUNNING');
CREATE INDEX forecast_run_completed_ix ON forecasting.forecast_run (workspace_id, completed_at DESC)
  WHERE status = 'COMPLETED';
CREATE INDEX forecast_run_due_ix ON forecasting.forecast_run (status, next_attempt_at)
  WHERE status = 'REQUESTED';
CREATE INDEX forecast_run_ws_requested_ix ON forecasting.forecast_run (workspace_id, requested_at DESC, id DESC);
COMMENT ON TABLE forecasting.forecast_run IS
  'Corrida de pronóstico del workspace (máquina FORECAST_RUN_LIFECYCLE): una activa por workspace; reintentos con espera creciente.';

CREATE TABLE forecasting.forecast_series (
  id                   uuid        PRIMARY KEY,
  workspace_id         uuid        NOT NULL REFERENCES iam.workspace (id),
  run_id               uuid        NOT NULL REFERENCES forecasting.forecast_run (id) ON DELETE CASCADE,
  opaque_ref           text        NOT NULL,
  scope                text        NOT NULL CHECK (scope IN
                         ('TOTAL_EXPENSE', 'CATEGORY_GROUP', 'CATEGORY', 'OTHER_CATEGORIES', 'TOTAL_INCOME')),
  scope_ref            uuid        NULL,
  name                 text        NOT NULL,
  currency             varchar(16) NOT NULL,
  scale                smallint    NOT NULL CHECK (scale BETWEEN 0 AND 18),
  readiness            text        NOT NULL CHECK (readiness IN ('MODEL', 'SIMPLE', 'INSUFFICIENT')),
  readiness_reasons    jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(readiness_reasons) = 'array'),
  history_from         text        NULL,
  history_to           text        NULL,
  history_periods      smallint    NOT NULL CHECK (history_periods >= 0),
  grouped_category_ids uuid[]      NOT NULL DEFAULT '{}',
  model_name           text        NULL,
  model_version        text        NULL,
  baseline_method      text        NULL CHECK (baseline_method IS NULL OR baseline_method IN
                         ('NAIVE', 'SEASONAL_NAIVE', 'MEAN_LAST_N')),
  baseline_n           smallint    NULL CHECK (baseline_n IS NULL OR baseline_n >= 1),
  status               text        NOT NULL CHECK (status IN ('PUBLISHED', 'INSUFFICIENT', 'INVALID')),
  CONSTRAINT forecast_series_scope_uk UNIQUE NULLS NOT DISTINCT (run_id, scope, scope_ref),
  CONSTRAINT forecast_series_ref_uk UNIQUE (run_id, opaque_ref)
);
CREATE INDEX forecast_series_run_ix ON forecasting.forecast_series (workspace_id, run_id);
COMMENT ON TABLE forecasting.forecast_series IS
  'Serie de una corrida con su preparación de datos; opaque_ref es la referencia de la petición al servicio (solo vive aquí).';

CREATE TABLE forecasting.forecast_point (
  series_id      uuid     NOT NULL REFERENCES forecasting.forecast_series (id) ON DELETE CASCADE,
  workspace_id   uuid     NOT NULL REFERENCES iam.workspace (id),
  period         text     NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  months_ahead   smallint NOT NULL CHECK (months_ahead BETWEEN 1 AND 12),
  prediction     numeric  NOT NULL,
  lower_80       numeric  NOT NULL,
  upper_80       numeric  NOT NULL,
  lower_95       numeric  NOT NULL,
  upper_95       numeric  NOT NULL,
  baseline_value numeric  NOT NULL,
  PRIMARY KEY (series_id, period),
  CONSTRAINT forecast_point_interval_ck CHECK (
    lower_95 >= 0 AND lower_95 <= lower_80 AND lower_80 <= prediction AND prediction <= upper_80 AND upper_80 <= upper_95)
);
COMMENT ON TABLE forecasting.forecast_point IS
  'Punto pronosticado (solo inserción para la app); montos en la escala de la moneda de la serie.';

-- RLS forzada (fail-closed con PF002 si falta el contexto).
ALTER TABLE forecasting.forecast_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_run FORCE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_series FORCE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_point ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_point FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON forecasting.forecast_run TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON forecasting.forecast_series TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON forecasting.forecast_point TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

-- Barrido entre workspaces (ejecutor y retención) como `pf_maintenance` asumido con SET LOCAL ROLE: solo SELECT y solo
-- columnas operativas de la corrida.
CREATE POLICY retention_scan ON forecasting.forecast_run FOR SELECT TO pf_maintenance USING (true);

REVOKE ALL ON ALL TABLES IN SCHEMA forecasting FROM PUBLIC, pf_app, pf_worker, pf_maintenance;
-- La API lee y crea la corrida manual; el worker la actualiza y escribe series y puntos (solo inserción) y purga.
GRANT SELECT, INSERT ON forecasting.forecast_run TO pf_app;
GRANT SELECT ON forecasting.forecast_series, forecasting.forecast_point TO pf_app;
GRANT UPDATE, DELETE ON forecasting.forecast_run TO pf_worker;
GRANT INSERT, DELETE ON forecasting.forecast_series, forecasting.forecast_point TO pf_worker;
GRANT SELECT (id, workspace_id, status, requested_at, started_at, completed_at, next_attempt_at)
  ON forecasting.forecast_run TO pf_maintenance;

-- La corrida manual es una operación asíncrona consultable (`kind` ampliado, expand).
ALTER TABLE platform.operation DROP CONSTRAINT operation_kind_check;
ALTER TABLE platform.operation
  ADD CONSTRAINT operation_kind_check CHECK (kind IN ('EXPORT', 'DOCUMENT_CONTENTS_RESTORE', 'FORECAST'));

-- Purga del workspace demo (ADR-0026): puntos → series → corridas.
SELECT platform.register_workspace_scoped_table('forecasting.forecast_point'::regclass, 200, 'DELETE');
SELECT platform.register_workspace_scoped_table('forecasting.forecast_series'::regclass, 201, 'DELETE');
SELECT platform.register_workspace_scoped_table('forecasting.forecast_run'::regclass, 202, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'forecasting'
   AND table_name IN ('forecast_point', 'forecast_series', 'forecast_run');
DELETE FROM platform.operation WHERE kind = 'FORECAST';
ALTER TABLE platform.operation DROP CONSTRAINT operation_kind_check;
ALTER TABLE platform.operation
  ADD CONSTRAINT operation_kind_check CHECK (kind IN ('EXPORT', 'DOCUMENT_CONTENTS_RESTORE'));
DROP SCHEMA forecasting CASCADE;
