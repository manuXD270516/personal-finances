# Diseño

## Contexto

Segundo change de Phase 8. Se apoya en `add-ml-forecasting-service` (64): contexto `@pf/forecasting`, servicio `ml-forecasting`, corridas, series por periodo financiero en la moneda de reporte, preparación de datos, validación, consulta y degradación, con pronósticos de referencia. Referencias: docs/15 §6–§9 (descomposición, modelos candidatos, backtesting, explicabilidad), FR-FORECAST-001..005 y 007, NFR-COMP-004, EPIC-22 (US-241, US-242, US-243), criterio de salida de docs/24 §5.8 («los modelos superan al baseline en backtesting para las series publicadas»).

Insumos existentes que se reutilizan por contrato:

- **Commitments**: ocurrencias no resueltas de todos los tipos con `amountType` (`FIXED`, `ESTIMATED`, `MIN_MAX`, `VARIABLE`), `managedBy` (`USER`, `SUBSCRIPTION`, `DEBT`, `GOAL`), categoría y cuenta (`UpcomingPaymentsQuery.listForCashFlow`, change 60); ocurrencias resueltas de salida (`ResolvedOccurrencesQuery.listResolvedOutflows`: transacción, fecha y monto); horizonte de generación `COMMITMENTS_HORIZON_DAYS` (por omisión 90).
- **Transactions**: `NominalFlowQuery` con `groupBy: ['ORIGIN']` informa el componente de préstamo de cada porción (`INTEREST`, `CHARGES`, `INSURANCE`, `TAXES`).
- **Debt**: cronogramas vigentes de los préstamos (cuotas con capital, interés y cargos).
- **FX**: tasa de hoy para valorar conocidos en otra moneda (como el calendario, change 60).

## Objetivos / No objetivos

**Objetivos**
- Conocidos (deterministas) + variable predicho, con suma exacta e intervalos coherentes.
- Selección por backtesting temporal sin fuga de datos y publicación condicionada a superar la referencia.
- Explicación por motivos que suman exacto, confianza y avisos.
- Vista `/pronosticos` accesible e internacionalizada.

**No objetivos**
- Banda en el calendario, probabilidad de déficit y Home (change 66); precisión frente al real (change 67).
- Pronósticos por cuenta, Prophet, modelos globales, regresores de feriados, exclusión manual de atípicos, anomalías, auto-clasificación.

## Decisiones

1. **Dónde se calculan los conocidos.** En `@pf/forecasting` (TypeScript, Decimal), nunca en el servicio (docs/15 §6.2, principio 5): el servicio recibe solo la historia variable y devuelve la parte variable; el ACL suma los conocidos. Así los conocidos no dependen del servicio y quedan disponibles aunque esté caído (FR-FORECAST-005: «solo baseline + conocidos»). *Alternativa descartada:* enviar los conocidos al servicio como regresor (docs/15 §6.2): agrega datos a la petición sin mejorar series cortas.

2. **Qué es «conocido» y qué se resta de la historia (pregunta 23).** Mismo criterio en los dos lados para evitar doble conteo:
   - Cuentan: ocurrencias de gasto o ingreso (`kind` `EXPENSE`/`INCOME`, incluidas las de suscripciones y las de `managedBy = USER`) y los componentes de gasto de las cuotas de préstamo (interés, cargos, seguro, impuestos).
   - No cuentan: pagos de tarjeta (`CARD_PAYMENT`, son transferencias; las compras con tarjeta ya son gasto), aportes a metas (`managedBy = GOAL`, transferencias), capital de cuotas, transferencias y conversiones programadas.
   - Historia variable del periodo = gasto (o ingreso) del periodo − Σ montos de las ocurrencias de gasto (o ingreso) resueltas cuyo `transactionDate` cae en el periodo − Σ porciones con componente de préstamo del periodo. Por categoría, la resta usa la categoría de la ocurrencia; una ocurrencia sin categoría solo resta del total. Un resultado negativo (ocurrencia emparejada con un monto mayor que el gasto de su categoría) se lleva a 0 y se cuenta en la calidad de datos.

3. **Proyección sin guardar (dependencia S1).** Para periodos más allá del horizonte de generación, Commitments expone `UpcomingPaymentsQuery.projectForForecast({workspaceId, from, to})`: devuelve las ocurrencias no resueltas ya generadas y, para fechas posteriores al horizonte, las fechas que el motor de recurrencia calcularía para cada definición activa (misma expansión, mismas reglas de fin de mes y fin de semana, fin de la definición, versiones vigentes), sin escribir nada. Los préstamos con cronograma explícito (`replaceSchedule`) se proyectan con su calendario. FORECAST no reimplementa reglas de recurrencia (como Reporting, docs/14 §8.2).

4. **Montos de los conocidos.** `FIXED` y `ESTIMATED`: su monto; `MIN_MAX`: el máximo en gasto y el mínimo en ingreso (criterio conservador del calendario, change 60); `VARIABLE`: se lista y se cuenta sin monto (`knownWithoutAmountCount`). En otra moneda: tasa de hoy (`FlowValuation` con la fecha de hoy), declarada en `meta.conversion` de la respuesta; sin tasa, se lista sin convertir y no se suma (nunca 1:1). Redondeo HALF_EVEN a la escala de la moneda de reporte al materializar cada ítem.

5. **Modelos (pregunta 16).** Familia `phase8-v1` del servicio: `NAIVE`, `MEAN_LAST_N` (3, 6, 12), `SEASONAL_NAIVE` (≥ 13), `ETS_DAMPED` (aditivo con tendencia amortiguada, statsmodels `ETSModel`; ≥ 6) y `ETS_SEASONAL` (aditivo, estacionalidad 12; ≥ 24). Intervalos de ETS por simulación con semilla fija (1 000 trayectorias) y de los de referencia empíricos (change 64). Sin Prophet (dependencia pesada, necesita ≥ 24 meses densos), sin regresión ni boosting (docs/15 §7 los pide con ≥ 24 meses y ≥ 5 categorías densas: no aplica al owner en Phase 8).

6. **Backtesting.** Origen móvil con ventana creciente: K = min(6, n − 6) cortes (los últimos K periodos); en cada corte t, cada candidato se ajusta con `y[1..t−1]` y pronostica t y t+2 cuando existen; métrica MASE con escala = MAE del ingenuo en la muestra de entrenamiento (estacional si m = 12 aplica y hay ≥ 24 periodos); error medio ponderado 0.5 (h = 1) y 0.5 (h = 3; si no hay datos para h = 3, solo h = 1). Se guardan por candidato: MASE, cobertura del 80 % y sesgo (`forecasting.backtest_result`). Con n < 7 (sin cortes posibles con historia mínima) se publica la referencia con `selectedBy = SIMPLE`. Sin fuga: ningún dato ≥ t entra al ajuste desde el corte t; los conocidos de la historia se restan con lo resuelto hasta la fecha del periodo (no con lo actual).

7. **Regla de publicación (pregunta 17).** Un modelo no de referencia se publica si `MASE_modelo ≤ 0.95 × MASE_mejor_referencia`; si no, se publica la mejor referencia (`selectedBy = BASELINE_FALLBACK`). El campo `baseline` del punto (change 64) sigue informando la referencia `MEAN_LAST_6` como comparación fija para el usuario. La re-selección ocurre en cada corrida, sin aprobación (pregunta 20).

8. **Motivos (drivers).** Por punto, sobre la parte variable: `HISTORICAL_AVERAGE` = media de los últimos 6 periodos variables (o los disponibles); `SEASONALITY` = componente estacional de `ETS_SEASONAL` para ese periodo (solo con ese modelo); `TREND_AND_LEVEL` = predicción variable − promedio − estacionalidad (cierra la suma exacta); `OUTLIERS` = periodos señalados; y `KNOWN_RECURRING` = suma de conocidos con las referencias (definición u ocurrencia). Las cifras se cuantizan con HALF_EVEN y el residuo de redondeo se asigna a `TREND_AND_LEVEL` para que la suma sea exacta (PBT). Los textos son plantillas i18n (`forecast.driver.*`), no texto libre del servicio.

9. **Confianza.** `LOW`: < 12 periodos, `SIMPLE` o `MASE > 1`; `HIGH`: ≥ 24 periodos, `MASE < 0.8` y cobertura del 80 % en el backtesting en [0.75, 0.85]; `MEDIUM`: el resto (docs/15 §9).

10. **Intervalos (pregunta 18).** Se calculan y guardan el 80 % y el 95 %; la vista muestra el 80 % y el detalle del punto el 95 %. Los intervalos del total suman los conocidos (deterministas) a los límites de la parte variable; un límite inferior variable negativo se trunca a 0 antes de sumar.

11. **Atípicos (pregunta 21).** El servicio marca un periodo como atípico si |y − mediana| > 3.5 × 1.4826 × MAD de la historia variable (con ≥ 6 periodos) y ajusta con el valor recortado al límite; la historia mostrada no cambia. Sin exclusión manual en Phase 8 (docs/15 §5 proponía una etiqueta `exclude_from_forecast`).

12. **Feriados (pregunta 22).** Sin regresores de calendario en Phase 8: la estacionalidad anual (≥ 24 periodos) captura diciembre y el aguinaldo; con menos historia no hay base para estimarlo.

13. **Ingreso total.** Mismo flujo con los ingresos esperados como conocidos (`kind = INCOME`, `MIN_MAX` por el mínimo) y la historia variable del ingreso. Sin series de ingreso por categoría (pregunta 19).

14. **Diferencia entre categorías y total (pregunta 25).** Cada serie se pronostica por separado (sin reconciliación jerárquica); `coherenceGap` del total = valor esperado del total − Σ valores esperados de las categorías publicadas del periodo; la vista la informa si |gap| > 5 % del total.

15. **Reproducibilidad.** Semilla por corrida (`seed` derivada del id de la corrida, guardada), `OMP_NUM_THREADS=1`, versiones fijadas; test de determinismo en el servicio con los ejemplos compartidos.

16. **Vista `/pronosticos`.** Entrada en la navegación (Planificación → Pronósticos). Selector de serie (total de gasto, total de ingreso, grupos y categorías), selector de horizonte (1/3/6/12, por omisión 3), gráfico SVG propio (D368: sin dependencia nueva) con historia, esperado y banda del 80 %, lista de conocidos del periodo elegido (`GET W/forecasts/latest/known-items`), bloque «¿Por qué?» con los motivos, nivel de confianza (texto e icono, no solo color), modelo y versión, `generatedAt`, aviso de no asesoría, aviso de desactualizado (`stale`) y de datos insuficientes por serie con el enlace a las transacciones sin categoría. Tabla accesible equivalente. Formatos del locale (es-BO por omisión). Copy revisado: «Esperado», «Rango probable», nunca «vas a gastar» ni «exactamente» (test de catálogo i18n que lo verifica).

17. **Conexiones y rendimiento.** Sin consumidores ni conexiones nuevas (las lecturas nuevas ocurren en la transacción de lectura de la corrida, en serie). El backtesting de ~60 series × 6 candidatos × 6 cortes se estima en decenas de segundos con un hilo; TC-FORECAST-SERVICE-028 lo vuelve a medir (≤ 300 s).

## Contratos

Cambios requeridos (aditivos; oasdiff limpio, Spectral y Redocly sin errores).

**`contracts/openapi/finance-api.v1.yaml`:**
- `ForecastSeries` (del change 64) + `model.selectedBy` (`BACKTEST|BASELINE_FALLBACK|SIMPLE`, `x-extensible-enum`), `model.mase` (decimal string, 4 decimales, nullable), `model.baselineMase` (nullable), `confidence` (`LOW|MEDIUM|HIGH`), `coherenceGap: Money|null` (solo en el total de gasto).
- `ForecastPoint` + `components {knownFuture: Money, predictedVariable: Money, predictedVariableInterval80 {lower: Money, upper: Money}, knownWithoutAmountCount: integer}` y `drivers[{type: HISTORICAL_AVERAGE|SEASONALITY|TREND_AND_LEVEL|OUTLIERS|KNOWN_RECURRING, value: Money|null, effect: Money|null, periods: PeriodLabel[], refCount: integer}]`.
- `LatestForecast.meta.conversion {rateDate, ratesUsed[]}` para conocidos en otra moneda.
- `GET /workspaces/{workspaceId}/forecasts/latest/known-items` — `listForecastKnownItems`, VIEWER, `x-openspec-capability: [forecast/expense-forecasting]`; parámetros `scope`, `scopeRef`, `period` (requerido); `200` `{items[{date, label, kind: EXPENSE|INCOME|LOAN_INTEREST, amountType, amount: Money|null, originalAmount: Money|null, managedBy, sourceRef {context: COMMITMENTS|DEBT, id}}]}`; `400 INVALID_FILTER`.
- Sin códigos de error nuevos.

**Contrato interno `ml-forecasting` v1 (aditivo):** `policy.modelSet: "phase8-v1"`; por serie, campo opcional `outlierPolicy: "MAD_3_5"`. Respuesta por serie + `backtest {origins: ["YYYY-MM"], candidates[{name, mase, coverage80, bias}], selected, fallback: boolean}`, `outliers: ["YYYY-MM"]`, y por punto `drivers {historicalAverage, seasonality|null, trendAndLevel}` (parte variable). Ejemplos nuevos en `contracts/ml/examples/`.

**Contratos entre módulos (aditivos):**
- `@pf/commitments/contracts`: `UpcomingPaymentsQuery.projectForForecast({workspaceId, from, to}) → ProjectedOccurrenceDto[]` `{date, definitionId, occurrenceId|null, projected: boolean, kind, direction, amountType, amount: MoneyDto|null, minAmount|null, maxAmount|null, categoryId|null, accountId, managedBy, label}`; `ResolvedOccurrencesQuery.listResolved({workspaceId, from, to, direction: OUTFLOW|INFLOW})` con `categoryId` y `kind` (la de salidas existente no cambia).
- `@pf/debt/contracts`: `LoanScheduleQuery.listUpcomingInstallments({workspaceId, from, to}) → [{loanId, label, dueDate, currency, principal, interest, charges, insurance, taxes}]` (si `LoanPortfolioQuery` ya lo expone, se reutiliza sin contrato nuevo).

## Dependencias con otros changes

| # | Necesidad | Estado | Qué hace este change |
|---|---|---|---|
| S1 | `projectForForecast` en Commitments | Pedido (aditivo) | Lo implementa sobre el motor de recurrencia, sin escrituras |
| S2 | `listResolved` con categoría y dirección | Pedido (aditivo) | Lo agrega junto a `listResolvedOutflows` |
| S3 | Cuotas futuras con componentes | Pedido (aditivo en Debt) o existente | Lo agrega si falta |
| S4 | `add-ml-forecasting-service` (64) | Este diseño | Requisito: archivado o fusionado antes de implementar este change |
| S5 | `add-predicted-cash-flow-band` (66) | Este diseño | Usa la proyección de S1 y el servicio con `phase8-v1` |

## Riesgos / Trade-offs

- [Sobreajuste con pocos datos (RISK-014)] → candidatos según la historia, regla del 5 %, confianza baja con < 12 periodos.
- [Confianza indebida (RISK-015)] → rango siempre, confianza visible, aviso de no asesoría, copy verificado.
- [Doble conteo de recurrentes] → mismo criterio de tipos en conocidos e historia; PBT: historia variable + resueltos = gasto del periodo cuando no hay truncamiento.
- [Ocurrencias emparejadas a montos distintos] → la resta usa el monto de la transacción emparejada; negativos llevados a 0 y contados.
- [Conocidos valorados con la tasa de hoy] → declarado; los periodos lejanos pueden diferir del real por tipo de cambio.
- [Tiempo de la corrida con backtesting] → medición nocturna; si se acerca a 300 s, reducir K o candidatos por configuración del servicio.

## Plan de migración

Una migración expand `YYYYMMDDHHMMSS_forecasting_components.sql` (posterior a la del change 64):

- `forecasting.forecast_point` + `known_future numeric NULL`, `predicted_variable numeric NULL`, `variable_lower_80 numeric NULL`, `variable_upper_80 numeric NULL`, `known_without_amount smallint NOT NULL DEFAULT 0`, `drivers jsonb NOT NULL DEFAULT '[]'` (nulos en corridas anteriores a este change: la API los informa como no disponibles).
- `forecasting.forecast_series` + `selected_by text NULL`, `mase numeric NULL`, `baseline_mase numeric NULL`, `coverage_80 numeric NULL`, `confidence text NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH'))`; `forecasting.forecast_run` + `seed bigint NULL`, `model_set text NULL`.
- `forecasting.forecast_known_item (series_id uuid → forecast_series ON DELETE CASCADE, workspace_id uuid NOT NULL, period text NOT NULL, item_date date NOT NULL, label text NOT NULL, kind text NOT NULL, amount_type text NOT NULL, amount numeric NULL, currency text NOT NULL, original_amount numeric NULL, original_currency text NULL, managed_by text NULL, source_context text NOT NULL, source_id uuid NOT NULL)`; índice `(series_id, period)`.
- `forecasting.backtest_result (series_id uuid → forecast_series ON DELETE CASCADE, workspace_id uuid NOT NULL, model_name text NOT NULL, origins smallint NOT NULL, mase numeric NULL, coverage_80 numeric NULL, bias numeric NULL, selected boolean NOT NULL, PRIMARY KEY (series_id, model_name))`.
- RLS forzada fail-closed, grants (`pf_worker` INSERT/SELECT, `pf_app` SELECT, `pf_maintenance` DELETE por cascada), registro en `platform.workspace_scoped_table`, matriz TC-SECURITY-RLS-007.
- La etiqueta guardada en `forecast_known_item.label` es una copia del nombre al momento de la corrida (las corridas se purgan según la retención del change 64).

Configuración nueva: `ML_BACKTEST_MAX_ORIGINS` (servicio; `6`), `ML_PUBLISH_MIN_IMPROVEMENT` (servicio; `0.05`), `ML_ETS_SIMULATIONS` (servicio; `1000`), `FORECASTING_COHERENCE_GAP_RATIO` (api; `0.05`).

## Preguntas abiertas

Consolidadas en [docs/65](../../../docs/65-phase-8-consolidation-questions.md): 16 (modelos candidatos), 17 (regla de publicación del 5 %), 18 (intervalos visibles), 19 (series de Phase 8: sin pronóstico por cuenta), 20 (re-selección automática), 21 (atípicos sin exclusión manual), 22 (sin regresores de feriados), 23 (qué cuenta como conocido), 24 (backtest con datos reales del owner como evidencia del criterio de salida), 25 (diferencia entre categorías y total). Ninguna bloquea; dependen de las bloqueantes 1–4 del change 64.

## Cambios a docs compartidos

Los aplica el implementador (tarea 9.1):

- **docs/01:** notas as-built en FR-FORECAST-001..005 y 007.
- **docs/14 §9:** sin cambios (el Home es del change 66).
- **docs/15:** §6–§9 as-built (conocidos en el ACL, criterio de tipos, candidatos `phase8-v1`, backtesting, regla del 5 %, motivos con suma exacta, confianza).
- **docs/10:** `listForecastKnownItems` y campos nuevos.
- **docs/08 §5.17:** columnas y tablas nuevas.
- **docs/28:** vista `/pronosticos` (gráfico con banda, conocidos aparte, motivos, confianza, avisos).
- **docs/25:** US-241..243 como implementadas.
- **docs/17:** matriz con TC-FORECAST-EXPENSE-*.
- **docs/38:** estado del change.
