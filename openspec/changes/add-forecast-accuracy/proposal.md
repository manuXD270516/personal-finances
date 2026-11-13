# Propuesta: add-forecast-accuracy

## Why

Un pronóstico solo es honesto si muestra cuánto se equivocó antes (docs/15 §10, principio 4). FR-FORECAST-009 y US-244 (FEAT-22.3) piden el historial de pronósticos frente al real, y el catálogo de reportes de Phase 7 dejó «Pronóstico vs real» (reporte 16, docs/14 §7) planificado para Phase 8. Los changes 64 y 65 ya conservan, por periodo, la corrida que lo pronosticó (retención de la decisión 16 del change 64), pero nada compara esos puntos con lo que pasó. Este change agrega la evaluación, los indicadores, el reporte 16 y un indicador de pérdida de precisión, sin notificaciones ni consumidores nuevos.

## What Changes

- **Evaluación por periodo** (FORECAST): al terminar un periodo y pasada una gracia de 5 días, cada punto publicado de ese periodo (por serie y por periodos hacia adelante) se compara con el real calculado con la misma regla de la historia: error, error absoluto y si cayó dentro del 80 % y del 95 %. Reevaluación de los 3 últimos periodos si su real cambió (imports tardíos). Tabla `forecasting.forecast_evaluation`; trabajo dentro de `forecasting.schedule` (sin consumidores ni conexiones nuevas).
- **Indicadores** por serie y horizonte sobre los últimos 12 periodos: error absoluto medio, cobertura del 80 %, sesgo y error escalado.
- **Pérdida de precisión** (Could): indicador en `/pronosticos` cuando el error escalado a 1 periodo supera 1.2 tres periodos seguidos; sin notificación.
- **Reporte 16 «Pronóstico vs real»** en `/reportes`: real y esperado con banda del 80 %, tabla de errores, indicadores, modelo y versión por periodo, CSV y detalle al reporte de gastos por categoría del periodo (Could); el catálogo pasa a 16 de 16 disponibles.
- **Métricas** `pf.ml.forecast.mase` y `pf.ml.forecast.coverage80` por tipo de serie, sin identificadores.
- **Fuera de alcance:** notificaciones o alertas por pérdida de precisión (pregunta 32 de docs/65), recalibración automática de intervalos (conformal), dashboards de drift, MLflow, comparación entre modelos en producción (A/B) y evaluación de periodos de más de 24 meses atrás.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `forecast/expense-forecasting`: 5 ADDED (4 Should, 1 Could).
- `reporting/financial-reports`: 1 MODIFIED («Reportes ampliados en el catálogo»: 16 de 16 disponibles) y 3 ADDED (2 Should, 1 Could).

## Impact

**Specs impactadas:** `forecast/expense-forecasting` (5 ADDED), `reporting/financial-reports` (1 MODIFIED, 3 ADDED). Lee sin modificar: `transactions/transaction-recording`, `commitments/recurrence-engine` (para el real con la misma regla).

**Componentes/contextos impactados:** FORECAST: DS puros `ForecastEvaluator` (error, intervalos) y `AccuracyAggregator` (MAE, cobertura, sesgo, MASE, pérdida de precisión); `EvaluateEndedPeriods` dentro de `forecasting.schedule`; `ForecastAccuracyQuery` en los contratos. REPORTING: reporte 16 (`GET W/reports/forecast-vs-actual`) con CSV y drill-down, que lee `ForecastAccuracyQuery`; catálogo con el reporte disponible. `apps/web`: `/reportes/pronostico-vs-real` e indicador de pérdida de precisión en `/pronosticos`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): `GET W/reports/forecast-vs-actual` (`getForecastVsActualReport`, VIEWER; `scope`, `scopeRef`, `monthsAhead` 1–12, `from`, `to`, `format=csv`), `GET W/forecasts/accuracy` (`getForecastAccuracy`, VIEWER), `ForecastSeries.accuracy {mae, coverage80, bias, mase, periods, degraded}` (nullable). Sin códigos de error nuevos (`INVALID_FILTER`, `REPORT_EXPORT_TOO_LARGE` existentes).

**Tablas impactadas:** nueva `forecasting.forecast_evaluation` (RLS forzada fail-closed, registrada en `platform.workspace_scoped_table`).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** una migración expand, no destructiva, posterior a la del change 66.

**Test cases:** AÑADIDOS — TC-FORECAST-ACCURACY-001..008 (8) y TC-REPORTING-ACCURACY-001..006 (6). MODIFICADOS — TC-REPORTING-REPORTS-048 (escenario «Catálogo completo de Phase 7», que el MODIFIED conserva con el contenido nuevo: 16 disponibles), se actualiza al implementar. DEPRECADOS — ninguno.

**Impacto de regresión:** el catálogo cambia el estado del reporte 16 (TC-REPORTING-REPORTS-048 se actualiza a 16 disponibles; el escenario «Catálogo al terminar este change» del change 58 describe el estado de ese change y se ajusta si ya está archivado, ver design.md); el trabajo diario suma la evaluación de pocos periodos por workspace (lecturas por conjunto, medidas en el nightly del change 64).

**Riesgos introducidos:** RISK-015 (un buen historial puede generar confianza indebida: indicadores con la cantidad de periodos y la cobertura visible), métricas engañosas con pocos periodos (se informa `periods` y no se marca pérdida de precisión con menos de 3), RISK-017 (real y esperado en la misma moneda de la serie).

**Invariantes afectadas:** INV-001, INV-002 e INV-020 (errores e indicadores en Decimal; porcentajes con dos decimales HALF_EVEN). Ninguna escritura en el ledger.
