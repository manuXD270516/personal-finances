-- FORECAST: serie del gasto variable líquido por moneda (openspec add-predicted-cash-flow-band, tarea 4.1; design.md § Plan de
-- migración; docs/66 D435). Expand, no destructiva. Se ejecuta con `pf_migrator`.
--
--   * forecasting.forecast_series.scope  + `LIQUID_VARIABLE_OUTFLOW` (el CHECK se reemplaza por uno más amplio).
--   * forecasting.forecast_series        la unicidad (run, scope, scope_ref) pasa a incluir la moneda: la serie nueva se
--       repite por moneda con `scope_ref` nulo. Las filas existentes siguen cumpliéndola (una sola moneda por serie).
-- Sin tablas nuevas (la RLS y el registro en `platform.workspace_scoped_table` no cambian), sin backfill: las corridas
-- anteriores no tienen la serie y el calendario informa `NO_SERIES` hasta la próxima corrida.

-- migrate:up
ALTER TABLE forecasting.forecast_series DROP CONSTRAINT forecast_series_scope_check;
ALTER TABLE forecasting.forecast_series
  ADD CONSTRAINT forecast_series_scope_check CHECK (scope IN
    ('TOTAL_EXPENSE', 'CATEGORY_GROUP', 'CATEGORY', 'OTHER_CATEGORIES', 'TOTAL_INCOME', 'LIQUID_VARIABLE_OUTFLOW'));
ALTER TABLE forecasting.forecast_series DROP CONSTRAINT forecast_series_scope_uk;
ALTER TABLE forecasting.forecast_series
  ADD CONSTRAINT forecast_series_scope_uk UNIQUE NULLS NOT DISTINCT (run_id, scope, scope_ref, currency);

-- migrate:down
ALTER TABLE forecasting.forecast_series DROP CONSTRAINT forecast_series_scope_uk;
ALTER TABLE forecasting.forecast_series
  ADD CONSTRAINT forecast_series_scope_uk UNIQUE NULLS NOT DISTINCT (run_id, scope, scope_ref);
ALTER TABLE forecasting.forecast_series DROP CONSTRAINT forecast_series_scope_check;
ALTER TABLE forecasting.forecast_series
  ADD CONSTRAINT forecast_series_scope_check CHECK (scope IN
    ('TOTAL_EXPENSE', 'CATEGORY_GROUP', 'CATEGORY', 'OTHER_CATEGORIES', 'TOTAL_INCOME'));
