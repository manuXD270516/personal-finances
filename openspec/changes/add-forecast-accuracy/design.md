# Diseño

## Contexto

Cuarto change de Phase 8. El change 64 conserva, por cada uno de los últimos 24 periodos terminados, la última corrida completada antes de que el periodo empezara (decisión 16), y el 65 guarda el backtesting de cada serie. El reporte 16 «Pronóstico vs real» está planificado en el catálogo de `reporting/financial-reports` (changes 58 y 59; docs/14 §7). docs/15 §10 propone un job mensual posterior al cierre y una tabla `forecasting.forecast_accuracy`; docs/14 §3 proponía una proyección `reporting.forecast_vs_actual` alimentada por `forecasting.ForecastGenerated`, que sumaría un consumidor (D249).

## Objetivos / No objetivos

**Objetivos**
- Evaluación reproducible de cada punto publicado contra el real, con la misma regla de la historia.
- Indicadores por serie y horizonte, visibles en `/pronosticos` y en el reporte 16.
- Reporte 16 disponible en el catálogo, con CSV y detalle.

**No objetivos**
- Notificar la pérdida de precisión, recalibrar intervalos, cambiar la selección de modelos por la evaluación (la selección sigue siendo por backtesting en cada corrida).

## Decisiones

1. **Dónde vive la evaluación.** En FORECAST (`forecasting.forecast_evaluation`), no en un read model de REPORTING: el real se calcula con `PeriodSeriesBuilder` y las reglas de historia de los changes 64–66 (gasto total y por categoría en la moneda de reporte, ingreso total, gasto variable líquido por moneda), y REPORTING solo lee `ForecastAccuracyQuery`. Sin consumidor de `forecast.ForecastGenerated.v1` (D249). *Alternativa descartada:* proyección en REPORTING (docs/14 §3): duplicaría las reglas del real y sumaría un consumidor.

2. **Qué se evalúa.** Para el periodo P: cada punto de P de las corridas conservadas para P y para periodos anteriores (P a 1, 2, 3… periodos hacia adelante), solo de series publicadas. Se compara el **valor total** (conocidos + variable) con el real total del periodo; el real del gasto variable líquido usa su propia regla.

3. **Cuándo (pregunta 31).** Dentro de `forecasting.schedule` (diario): primera evaluación de P cuando `hoy ≥ fin(P) + FORECASTING_ACCURACY_GRACE_DAYS + 1` (por omisión 5); reevaluación de los 3 últimos periodos evaluados si el real cambió (se compara el real recalculado con el guardado; `evaluated_at` se actualiza solo si cambia). Lecturas por conjunto en la transacción de lectura del trabajo, sin consultas en paralelo sobre el mismo cliente. Un periodo con historia truncada por huecos no se evalúa (motivo `GAP`).

4. **Indicadores.** `AccuracyAggregator` (puro, TDD) sobre los últimos 12 periodos evaluados por serie y `monthsAhead`: MAE (escala de la moneda, HALF_EVEN), cobertura del 80 % (porcentaje con 2 decimales), sesgo = media de (esperado − real) (positivo = sobreestima), MASE = MAE / MAE del ingenuo de un periodo sobre la misma ventana de reales (`null` si el ingenuo tiene MAE 0), y `periods`. Pérdida de precisión: MASE a 1 periodo > 1.2 en cada uno de los 3 últimos periodos evaluados (con < 3 periodos, nunca); se calcula por periodo con el error absoluto del periodo sobre el MAE del ingenuo de la ventana (pregunta 32).

5. **Métricas visibles (pregunta 30).** La vista y el reporte muestran MAE en la moneda («me equivoco en promedio Bs 192,00») y la cobertura del 80 %; MASE y sesgo en el detalle. Métricas OTel `pf.ml.forecast.mase` y `pf.ml.forecast.coverage80` (gauges por `scope_type`, agregadas sin ids).

6. **Reporte 16.** `GET W/reports/forecast-vs-actual` (REPORTING, `x-openspec-capability: [reporting/financial-reports]`): parámetros `scope` (por omisión `TOTAL_EXPENSE`), `scopeRef`, `monthsAhead` (1–12, por omisión 1), `from`/`to` (etiquetas de periodo; por omisión los últimos 12 evaluados), `format=csv` (CSV UTF-8 con BOM, coma y punto decimal, D366; tope de filas como los demás). Respuesta con filas por periodo, indicadores, `meta.model` por fila y `status` (`AVAILABLE`, `NO_EVALUATIONS` con `firstEvaluation {period, from}`, `DISABLED`). Gráfico SVG propio (D368): línea del real, línea del esperado y banda. Drill-down: enlace al reporte de gastos por categoría del periodo; para una serie de categoría, a sus movimientos (FR-REPORTING-010). Exportación auditada como las demás (D365).

7. **Catálogo.** El requirement «Reportes ampliados en el catálogo» (change 59, archivado) se modifica: 16 de 16 disponibles; con la función deshabilitada el reporte sigue listado y se explica al abrirlo. El requirement «Catálogo de reportes con su disponibilidad» del change 58 (aún sin archivar) dice en su escenario que el reporte 16 queda planificado «al terminar este change»: si el change 58 ya está archivado cuando se implemente este, el implementador agrega aquí un MODIFIED de ese escenario; si no, lo ajusta en el change 58 antes de archivarlo. El MODIFIED conserva el nombre del escenario «Catálogo completo de Phase 7» (OpenSpec no permite perderlo) con el contenido nuevo; TC-REPORTING-REPORTS-048 se actualiza al implementar (16 disponibles) y TC-REPORTING-ACCURACY-005 cubre el mismo escenario desde este change.

8. **Retención.** Las evaluaciones viven 24 meses (como las corridas conservadas) y se purgan en `forecasting.schedule`; si una corrida conservada se purga, sus evaluaciones se conservan (no tienen FK con borrado en cascada a la corrida, guardan modelo y versión).

## Contratos

Cambios requeridos (aditivos; oasdiff limpio, Spectral y Redocly sin errores).

**`contracts/openapi/finance-api.v1.yaml`:**
- `GET /workspaces/{workspaceId}/reports/forecast-vs-actual` — `getForecastVsActualReport`, VIEWER; `200` `ForecastVsActualReport {status: AVAILABLE|NO_EVALUATIONS|DISABLED, firstEvaluation {period, from: LocalDate}|null, scope, scopeRef|null, currency, monthsAhead, rows[{period, actual: Money, prediction: Money, interval80 {lower, upper}, error: Money, absError: Money, inInterval80, inInterval95, model {name, version}, forecastRunId, evaluatedAt}], indicators {mae: Money|null, coverage80|null, bias: Money|null, mase|null, periods}, meta {generatedAt}}` o `text/csv`; `400 INVALID_FILTER`, `413 REPORT_EXPORT_TOO_LARGE`.
- `GET /workspaces/{workspaceId}/forecasts/accuracy` — `getForecastAccuracy`, VIEWER, `x-openspec-capability: [forecast/expense-forecasting]`; `200` `{series[{scope, scopeRef|null, currency, byMonthsAhead[{monthsAhead, mae, coverage80, bias, mase, periods}], degraded}]}`.
- `ForecastSeries.accuracy` (nullable): `{mae, coverage80, bias, mase, periods, degraded}` a 1 periodo.
- Catálogo: el ítem 16 pasa a `AVAILABLE` (valor existente del enum de estado).

**Contratos entre módulos:** `@pf/forecasting/contracts` `ForecastAccuracyQuery.listEvaluations({workspaceId, scope, scopeRef?, monthsAhead, from?, to?})` y `.indicators(…)`; REPORTING ya depende de FORECAST por el change 66.

## Dependencias con otros changes

| # | Necesidad | Estado | Qué hace este change |
|---|---|---|---|
| S1 | Changes 64, 65 y 66 | Este diseño | Requisitos fusionados; se archiva después de ellos |
| S2 | `add-financial-reports` (58) | Implementado sin archivar | Ver decisión 7 sobre su escenario del catálogo |
| S3 | `add-financial-reports-extended` (59) | Archivado | MODIFIED de «Reportes ampliados en el catálogo» |

## Riesgos / Trade-offs

- [Pocos periodos evaluados] → `periods` visible, sin pérdida de precisión con < 3, texto que lo aclara.
- [Real que cambia con imports tardíos] → reevaluación de los 3 últimos; más atrás queda fijo (declarado).
- [Confianza indebida por buen historial (RISK-015)] → la cobertura y el MAE acompañan siempre al rango.
- [Costo del trabajo diario] → pocos periodos por workspace; lecturas por conjunto; medido con el benchmark del change 64.

## Plan de migración

Una migración expand `YYYYMMDDHHMMSS_forecasting_evaluation.sql` (posterior a la del change 66):

- `forecasting.forecast_evaluation (id uuid PK, workspace_id uuid NOT NULL, period text NOT NULL, scope text NOT NULL, scope_ref uuid NULL, currency text NOT NULL, months_ahead smallint NOT NULL, forecast_run_id uuid NOT NULL, model_name text NOT NULL, model_version text NOT NULL, prediction numeric NOT NULL, lower_80 numeric NOT NULL, upper_80 numeric NOT NULL, lower_95 numeric NOT NULL, upper_95 numeric NOT NULL, actual numeric NOT NULL, naive_value numeric NULL, evaluated_at timestamptz NOT NULL, first_evaluated_at timestamptz NOT NULL)`; `UNIQUE (workspace_id, period, scope, scope_ref, currency, months_ahead)` con `NULLS NOT DISTINCT`; índice `(workspace_id, scope, scope_ref, months_ahead, period DESC)`.
- RLS forzada fail-closed, grants (`pf_worker` SELECT/INSERT/UPDATE, `pf_app` SELECT, `pf_maintenance` DELETE), registro en `platform.workspace_scoped_table`, matriz TC-SECURITY-RLS-007.

Configuración nueva: `FORECASTING_ACCURACY_GRACE_DAYS` (worker; `5`), `FORECASTING_ACCURACY_WINDOW` (api; `12`), `FORECASTING_DEGRADED_MASE` (api; `1.2`).

## Preguntas abiertas

Consolidadas en [docs/65](../../../docs/65-phase-8-consolidation-questions.md): 30 (métricas visibles), 31 (gracia y reevaluación), 32 (pérdida de precisión sin notificación). Ninguna bloquea.

## Cambios a docs compartidos

Los aplica el implementador (tarea 8.1):

- **docs/14:** §3 sin la proyección `reporting.forecast_vs_actual` (la evaluación vive en FORECAST); §7 reporte 16 disponible y as-built.
- **docs/15 §10:** monitoreo as-built (evaluación diaria con gracia, indicadores, pérdida de precisión sin alerta).
- **docs/01:** nota as-built en FR-FORECAST-009 y FR-REPORTING-008.
- **docs/08 §5.17:** `forecasting.forecast_evaluation`.
- **docs/10:** endpoints nuevos.
- **docs/18:** métricas `pf.ml.forecast.mase` y `pf.ml.forecast.coverage80`.
- **docs/28:** reporte 16 e indicador en `/pronosticos`.
- **docs/25:** US-244 implementada.
- **docs/17 y docs/38:** matriz y estado.
