# Tareas

> Requiere `add-ml-forecasting-service` (64) fusionado y, para archivar, archivado antes (crea `forecast/expense-forecasting`). Depende de las preguntas bloqueantes 1–4 de docs/65 (las del change 64); las preguntas 16–25 se implementan con la recomendación si el owner no responde antes del grupo que las usa. Gates: los del change 64, más `pnpm test:e2e` con `PF_E2E_PROJECT` por la vista nueva.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner el delta de `forecast/expense-forecasting` y las preguntas 16–25 de docs/65; registrar las decisiones y ajustar spec y TC; `openspec validate add-expense-forecasts --strict`
- [ ] 1.2 Acordar con Commitments S1 (`projectForForecast`) y S2 (`listResolved`) y con Debt S3 (cuotas futuras con componentes); registrar el acuerdo en design.md
- [ ] 1.3 Revisar TC-FORECAST-EXPENSE-001..023 contra los scenarios (cifras: 2500.00 + 199.00 + 49.00 = 2748.00; 2748.00 + 1660.00 = 4408.00; 2748.00 + 1290.00 = 4038.00; 2748.00 + 2040.00 = 4788.00; 4300.00 − 2748.00 = 1552.00; 9.99 × 6.96 = 69.5304 ⇒ 69.53; 420.35 + 15.00 = 435.35; 1552.00 + 120.00 − 12.00 = 1660.00; 0.95 × 0.90 = 0.855; 8000.00 + 350.00 = 8350.00; 4700.00 − 4408.00 = 292.00); pasar a `ready` y `requirement_status: confirmed` tras las decisiones

## 2. DOMAIN (TDD, lógica crítica)

- [ ] 2.1 `KnownFutureCalculator` puro test-first (tipos de ocurrencia que cuentan, montos por `amountType`, `VARIABLE` sin monto, componentes de cuotas sin capital, conversión con la tasa de hoy declarada, sin tasa ⇒ sin sumar): TC-FORECAST-EXPENSE-004..007 *(pregunta 23)*
- [ ] 2.2 `VariableHistoryBuilder` puro test-first (resta de resueltos por periodo y categoría, componentes de préstamo, negativos a 0 contados): TC-FORECAST-EXPENSE-002, -003; PBT con timeout explícito (historia variable + resueltos + componentes = gasto del periodo sin truncamiento)
- [ ] 2.3 `ForecastComposer` puro test-first (suma exacta conocidos + variable, intervalos, motivos con suma exacta y residuo de redondeo en `TREND_AND_LEVEL`, confianza, diferencia categorías-total, ingreso total): TC-FORECAST-EXPENSE-001, -012..014, -019, -020; PBT (promedio + efectos = variable; `lower80 ≤ esperado ≤ upper80`)

## 3. APPLICATION

- [ ] 3.1 Commitments: `UpcomingPaymentsQuery.projectForForecast` con la expansión del motor de recurrencia, sin escrituras (S1), y `ResolvedOccurrencesQuery.listResolved` (S2); TC-REPORTING-UPCOMING-* y TC-REPORTING-FORECAST-* en verde: TC-FORECAST-EXPENSE-004
- [ ] 3.2 Debt: cuotas futuras con componentes (S3), reutilizando `LoanPortfolioQuery` si ya lo expone: TC-FORECAST-EXPENSE-007
- [ ] 3.3 `ExecuteForecastRun` con la descomposición (lecturas en serie dentro de la transacción de lectura; petición con historia variable y `modelSet: phase8-v1`; composición y persistencia de conocidos, motivos y backtesting): TC-FORECAST-EXPENSE-001, -002, -019
- [ ] 3.4 `GetLatestForecast` con los campos nuevos y `ListForecastKnownItems`: TC-FORECAST-EXPENSE-001, -017

## 4. SERVICIO `ml-forecasting`

- [ ] 4.1 `ETS_DAMPED` y `ETS_SEASONAL` (statsmodels) con intervalos por simulación con semilla: TC-FORECAST-EXPENSE-008, -021 *(pregunta 16)*
- [ ] 4.2 Backtesting de origen móvil con ventana creciente, MASE ponderado, cobertura y sesgo, sin fuga de datos: TC-FORECAST-EXPENSE-009 *(pregunta 20)*
- [ ] 4.3 Regla de publicación (5 %) y respaldo de referencia: TC-FORECAST-EXPENSE-010, -011 *(pregunta 17)*
- [ ] 4.4 Atípicos por MAD con recorte en el ajuste y motivos de la parte variable: TC-FORECAST-EXPENSE-012, -022 *(pregunta 21)*
- [ ] 4.5 Contrato v1 aditivo (`phase8-v1`, `backtest`, `outliers`, `drivers`), ejemplos compartidos y verificación del OpenAPI publicado; tests con hypothesis (intervalos ordenados, determinismo con semilla): TC-FORECAST-EXPENSE-021

## 5. INFRASTRUCTURE

- [ ] 5.1 Migración expand `forecasting_components` (columnas nuevas, `forecast_known_item`, `backtest_result`, RLS forzada fail-closed, grants, registro, matriz TC-SECURITY-RLS-007); timestamp posterior a la del change 64
- [ ] 5.2 Repositorios y test de integración de una corrida completa con el servicio falso y los ejemplos compartidos: TC-FORECAST-EXPENSE-001, -019
- [ ] 5.3 Benchmark nightly de la corrida con `phase8-v1` sobre el conjunto Large (≤ 300 s): TC-FORECAST-EXPENSE-023
- [ ] 5.4 Variables nuevas en `docs/config-reference.md` (`pnpm config:docs:check`)

## 6. API

- [ ] 6.1 Campos nuevos de `ForecastSeries`, `ForecastPoint` y `LatestForecast.meta.conversion`, y `listForecastKnownItems` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-FORECAST-EXPENSE-001, -005, -016

## 7. UI

- [ ] 7.1 Vista `/pronosticos`: series, horizonte, gráfico SVG con banda del 80 %, detalle con el 95 %, conocidos aparte, motivos, confianza, modelo, `generatedAt`, desactualizado, tabla accesible; botón «Actualizar pronóstico» solo para OWNER y EDITOR; i18n es/en/pt: TC-FORECAST-EXPENSE-015, -018
- [ ] 7.2 Avisos de no asesoría financiera y de datos insuficientes (con periodos faltantes y enlace a las transacciones sin categoría); test del catálogo i18n sin «vas a gastar» ni «exactamente»: TC-FORECAST-EXPENSE-015..017

## 8. AUTOMATED TESTS y E2E

- [ ] 8.1 Automatizar todos los TC del change con el TC-id en el nombre del test (TypeScript) o en el docstring (Python); actualizar el front matter
- [ ] 8.2 E2E con el perfil `ml` y el dataset Demo: abrir `/pronosticos`, cambiar el horizonte a 3, ver conocidos y motivos, solicitar una corrida como EDITOR y verla completada; como VIEWER, sin botón: TC-FORECAST-EXPENSE-018
- [ ] 8.3 Comando de evidencia para el owner (`pnpm forecast:backtest:report`) que imprime, en su instancia, solo métricas agregadas por tipo de serie (MASE del publicado y de la referencia, cobertura, cantidad de series), sin montos ni nombres *(pregunta 24)*

## 9. DOCUMENTATION

- [ ] 9.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 9.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
- [ ] 9.3 Evidencia del owner del criterio de salida de Phase 8 (modelos que superan la referencia en las series publicadas) con la salida de 8.3 sobre sus datos reales, registrada sin montos *(espera al owner)*
