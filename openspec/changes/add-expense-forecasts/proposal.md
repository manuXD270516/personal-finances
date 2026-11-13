# Propuesta: add-expense-forecasts

## Why

`add-ml-forecasting-service` (64) deja el camino completo —servicio, corridas, preparación de datos, validación y degradación— con pronósticos de referencia, pero todavía no cumple lo que el owner ve como pronóstico (EPIC-22, FEAT-22.2 y parte de FEAT-22.3): separar lo que ya se sabe que se va a pagar (suscripciones, alquiler, cuotas) de lo que se estima (FR-FORECAST-003), elegir un modelo mejor que la referencia solo cuando el backtesting lo demuestra (FR-FORECAST-007, criterio de salida de Phase 8 en docs/24 §5.8), explicar por qué (drivers), presentarlo siempre como rango (FR-FORECAST-004) con el aviso de no asesoría (NFR-COMP-004) y avisar con claridad cuando no hay datos (US-243). Este change agrega eso y la vista `/pronosticos` (US-241, US-242).

## What Changes

- **Descomposición conocidos + variables** (FR-FORECAST-003): los costos e ingresos conocidos de cada periodo pronosticado se calculan de forma determinista en `@pf/forecasting` con las ocurrencias no resueltas y la proyección sin guardar de las definiciones activas (más allá del horizonte de generación de 90 días), con montos por tipo (`FIXED`, `ESTIMATED`, máximo de `MIN_MAX`, `VARIABLE` sin monto) y los componentes de gasto de las cuotas de préstamo; el modelo se entrena con la historia variable (gasto menos recurrentes resueltos y componentes de gasto de cuotas). Valor esperado = conocidos + variable predicho, exacto.
- **Modelos y selección** (FR-FORECAST-007): suavizado exponencial con tendencia amortiguada (≥ 6 periodos) y estacional (≥ 24) además de los de referencia; validación de origen móvil con ventana creciente; error escalado (MASE) a 1 y 3 periodos; publicación solo si mejora ≥ 5 % al mejor de referencia; backtesting guardado con la corrida.
- **Explicación**: motivos que suman exactamente la parte variable (promedio de 6, estacionalidad, tendencia y nivel), costos conocidos con referencias, periodos atípicos señalados (Could), nivel de confianza (baja, media, alta) y diferencia entre categorías y total (Could).
- **Ingreso total** con la misma descomposición (ingresos esperados conocidos + variable).
- **Vista `/pronosticos`** (es/en/pt): historia, esperado y banda del 80 % por periodo con horizonte 1/3/6/12, 95 % en el detalle, costos conocidos aparte, motivos, confianza, modelo y versión, instante de generación, tabla accesible, botón «Actualizar pronóstico» para OWNER y EDITOR, avisos de datos insuficientes y de no asesoría financiera; el texto siempre es «Esperado» y «Rango probable».
- **Reproducibilidad**: semilla, versión de modelos e identificador del conjunto guardados; mismo conjunto ⇒ mismos valores.
- **Fuera de alcance:** la banda en el calendario de flujo de caja, la probabilidad de déficit y el Home (change 66); la precisión frente al real y el reporte 16 (change 67); pronósticos por cuenta (docs/15 §6.1; pregunta 19 de docs/65); Prophet, regresión y gradient boosting (pregunta 16); feriados y aguinaldo como regresores (pregunta 22); exclusión manual de periodos atípicos (pregunta 21); anomalías (FR-FORECAST-010); categorización por ML (W-13).

## Capabilities

### New Capabilities

Ninguna: el comportamiento completa `forecast/expense-forecasting`, que crea el change 64.

### Modified Capabilities
- `forecast/expense-forecasting`: 17 requirements ADDED (9 Must, 6 Should, 2 Could) sobre la capability que crea `add-ml-forecasting-service`; se archiva después de ese change.

## Impact

**Specs impactadas:** `forecast/expense-forecasting` (17 ADDED). Lee sin modificar: `commitments/recurrence-engine` (ocurrencias, definiciones, tipos de monto, horizonte de generación), `commitments/subscriptions`, `debt/loans` y `debt/amortization` (cronograma vigente), `transactions/transaction-recording` (porciones con componente de préstamo), `fx/market-rates`, `classification/categories`.

**Componentes/contextos impactados:** FORECAST: DS puros `KnownFutureCalculator`, `VariableHistoryBuilder`, `ForecastComposer` (conocidos + variable, motivos, confianza, diferencia categorías-total); `ExecuteForecastRun` con la descomposición; `GetLatestForecast` con los campos nuevos. COMMITMENTS: `UpcomingPaymentsQuery.projectForForecast` (proyección sin guardar con el motor de recurrencia) y `categoryId`/dirección en `ResolvedOccurrencesQuery` (aditivos). DEBT: `LoanScheduleQuery.listUpcomingInstallments` con componentes (aditivo; si ya lo expone `LoanPortfolioQuery`, se reutiliza). Servicio `ml-forecasting`: ETS (statsmodels), backtesting, selección, motivos, atípicos, `modelSet: phase8-v1`. `apps/web`: vista `/pronosticos`, i18n es/en/pt.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): en `ForecastSeries` los campos `model.selectedBy`, `model.mase`, `model.baselineMase`, `confidence`, `coherenceGap`; en `ForecastPoint` `components {knownFuture, predictedVariable, predictedVariableInterval80, knownWithoutAmountCount}` y `drivers[]`; endpoint nuevo `GET W/forecasts/latest/known-items` (`listForecastKnownItems`, VIEWER; `scope`, `scopeRef`, `period`). Sin códigos de error nuevos. Contrato interno `ml-forecasting` v1 (aditivo): `policy.modelSet` acepta `phase8-v1`; respuesta con `backtest`, `drivers` y `outliers` por serie.

**Tablas impactadas:** `forecasting.forecast_point` + `known_future`, `predicted_variable`, `variable_lower_80`, `variable_upper_80`, `known_without_amount`, `drivers jsonb`; `forecasting.forecast_series` + `selected_by`, `mase`, `baseline_mase`, `coverage_80`, `confidence`, `seed`; nuevas `forecasting.forecast_known_item` y `forecasting.backtest_result` (RLS forzada fail-closed, registradas en `platform.workspace_scoped_table`).

**Eventos impactados:** ninguno nuevo; `forecast.ForecastGenerated.v1` sin cambios.

**Migraciones requeridas:** una migración expand, no destructiva (columnas nulas o con valor por omisión y dos tablas nuevas), timestamp posterior a la del change 64.

**Test cases:** AÑADIDOS — TC-FORECAST-EXPENSE-001..023 (23). MODIFICADOS — ninguno (TC-FORECAST-SERVICE-028 se vuelve a medir con el conjunto de modelos de este change, sin cambiar su texto). DEPRECADOS — ninguno.

**Impacto de regresión:** el benchmark de la corrida (NFR-PERF-012, TC-FORECAST-SERVICE-028) sube por el backtesting: vigilar que siga ≤ 300 s; los consumidores y las conexiones no cambian; las consultas de Commitments y Debt son lecturas nuevas por contrato sin cambiar las existentes (TC-REPORTING-UPCOMING-*, TC-REPORTING-FORECAST-* en verde).

**Riesgos introducidos:** RISK-014 (modelos sobreajustados con pocas series: publicación solo si superan a la referencia), RISK-015 (confianza indebida: siempre rango, confianza y aviso), doble conteo de recurrentes (historia variable y conocidos con el mismo criterio de tipos), RISK-017 (conocidos en otra moneda con la tasa de hoy declarada), memoria del servicio con statsmodels durante el backtesting (medición del change 64).

**Invariantes afectadas:** INV-001, INV-002 e INV-020 (suma exacta conocidos + variable en Decimal, HALF_EVEN a la escala de la moneda). Ninguna escritura en el ledger.
