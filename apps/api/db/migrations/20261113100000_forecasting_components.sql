-- FORECAST: componentes del pronóstico de gasto e ingreso (openspec add-expense-forecasts, tarea 5.1; design.md § Plan de
-- migración; docs/66 D410–D442). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * forecasting.forecast_point   + conocidos, variable predicho (y su intervalo del 80 %), conocidos sin monto y motivos.
--       Nulos en las corridas anteriores a este change: la API los informa como no disponibles.
--   * forecasting.forecast_series  + modelo elegido (`selected_by`), MASE del publicado y de la mejor referencia, cobertura
--       del 80 % del backtesting y confianza.
--   * forecasting.forecast_run     + semilla, familia de modelos y la conversión de los conocidos con la tasa de hoy.
--   * forecasting.forecast_known_item  WS: los costos conocidos del horizonte de cada serie (la etiqueta es una copia del
--       nombre al momento de la corrida; las corridas se purgan por retención).
--   * forecasting.backtest_result      WS: el resultado del backtesting de cada candidato de cada serie.
-- Tablas nuevas: RLS ENABLE + FORCE fail-closed (`platform.current_workspace_id()` lanza PF002 sin contexto, D298) y
-- registro en `platform.workspace_scoped_table` (hijas de la serie, antes que ella). `pf_worker` es miembro de `pf_app` y
-- hereda sus grants y políticas. Sin backfill.

-- migrate:up
ALTER TABLE forecasting.forecast_point
  ADD COLUMN known_future         numeric  NULL,
  ADD COLUMN predicted_variable   numeric  NULL,
  ADD COLUMN variable_lower_80    numeric  NULL,
  ADD COLUMN variable_upper_80    numeric  NULL,
  ADD COLUMN known_without_amount smallint NOT NULL DEFAULT 0 CHECK (known_without_amount >= 0),
  ADD COLUMN drivers              jsonb    NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(drivers) = 'array');

ALTER TABLE forecasting.forecast_series
  ADD COLUMN selected_by   text    NULL CHECK (selected_by IS NULL OR selected_by IN
                             ('BACKTEST', 'BASELINE_FALLBACK', 'SIMPLE')),
  ADD COLUMN mase          numeric NULL,
  ADD COLUMN baseline_mase numeric NULL,
  ADD COLUMN coverage_80   numeric NULL,
  ADD COLUMN confidence    text    NULL CHECK (confidence IS NULL OR confidence IN ('LOW', 'MEDIUM', 'HIGH'));

ALTER TABLE forecasting.forecast_run
  ADD COLUMN seed             bigint NULL,
  ADD COLUMN model_set        text   NULL,
  ADD COLUMN known_conversion jsonb  NULL CHECK (known_conversion IS NULL OR jsonb_typeof(known_conversion) = 'object');

CREATE TABLE forecasting.forecast_known_item (
  series_id         uuid        NOT NULL REFERENCES forecasting.forecast_series (id) ON DELETE CASCADE,
  workspace_id      uuid        NOT NULL REFERENCES iam.workspace (id),
  period            text        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  item_date         date        NOT NULL,
  label             text        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('EXPENSE', 'INCOME', 'LOAN_INTEREST')),
  amount_type       text        NOT NULL,
  amount            numeric     NULL,
  currency          varchar(16) NOT NULL,
  original_amount   numeric     NULL,
  original_currency varchar(16) NULL,
  managed_by        text        NULL,
  source_context    text        NOT NULL CHECK (source_context IN ('COMMITMENTS', 'DEBT')),
  source_id         uuid        NOT NULL,
  category_id       uuid        NULL
);
CREATE INDEX forecast_known_item_series_period_ix ON forecasting.forecast_known_item (series_id, period);
COMMENT ON TABLE forecasting.forecast_known_item IS
  'Costos o ingresos conocidos del horizonte de una serie (deterministas, calculados por el sistema); la etiqueta es una copia al momento de la corrida.';

CREATE TABLE forecasting.backtest_result (
  series_id    uuid     NOT NULL REFERENCES forecasting.forecast_series (id) ON DELETE CASCADE,
  workspace_id uuid     NOT NULL REFERENCES iam.workspace (id),
  model_name   text     NOT NULL,
  origins      smallint NOT NULL CHECK (origins >= 0),
  mase         numeric  NULL,
  coverage_80  numeric  NULL,
  bias         numeric  NULL,
  selected     boolean  NOT NULL,
  PRIMARY KEY (series_id, model_name)
);
COMMENT ON TABLE forecasting.backtest_result IS
  'Resultado del backtesting de origen móvil por candidato: MASE ponderado, cobertura del 80 % y sesgo (solo inserción).';

ALTER TABLE forecasting.forecast_known_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.forecast_known_item FORCE ROW LEVEL SECURITY;
ALTER TABLE forecasting.backtest_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasting.backtest_result FORCE ROW LEVEL SECURITY;

CREATE POLICY ws_isolation ON forecasting.forecast_known_item TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());
CREATE POLICY ws_isolation ON forecasting.backtest_result TO pf_app
  USING (workspace_id = platform.current_workspace_id()) WITH CHECK (workspace_id = platform.current_workspace_id());

REVOKE ALL ON forecasting.forecast_known_item, forecasting.backtest_result FROM PUBLIC, pf_app, pf_worker, pf_maintenance;
GRANT SELECT ON forecasting.forecast_known_item, forecasting.backtest_result TO pf_app;
GRANT INSERT, DELETE ON forecasting.forecast_known_item, forecasting.backtest_result TO pf_worker;

-- Purga del workspace demo (ADR-0026): hijas de la serie antes que ella.
SELECT platform.register_workspace_scoped_table('forecasting.forecast_known_item'::regclass, 200, 'DELETE');
SELECT platform.register_workspace_scoped_table('forecasting.backtest_result'::regclass, 200, 'DELETE');

-- migrate:down
DELETE FROM platform.workspace_scoped_table
 WHERE schema_name = 'forecasting' AND table_name IN ('forecast_known_item', 'backtest_result');
DROP TABLE forecasting.backtest_result;
DROP TABLE forecasting.forecast_known_item;
ALTER TABLE forecasting.forecast_run DROP COLUMN known_conversion, DROP COLUMN model_set, DROP COLUMN seed;
ALTER TABLE forecasting.forecast_series
  DROP COLUMN confidence, DROP COLUMN coverage_80, DROP COLUMN baseline_mase, DROP COLUMN mase, DROP COLUMN selected_by;
ALTER TABLE forecasting.forecast_point
  DROP COLUMN drivers, DROP COLUMN known_without_amount, DROP COLUMN variable_upper_80, DROP COLUMN variable_lower_80,
  DROP COLUMN predicted_variable, DROP COLUMN known_future;
