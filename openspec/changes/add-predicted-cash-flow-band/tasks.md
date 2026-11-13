# Tareas

> Requiere `add-ml-forecasting-service` (64) y `add-expense-forecasts` (65) fusionados; para archivar, ambos archivados antes. La pregunta 26 de docs/65 bloquea los grupos 2 a 6; las 27–29 se implementan con la recomendación si el owner no responde antes del grupo que las usa. Gates: los del change 64, más `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `forecast/expense-forecasting`, `reporting/cash-flow-calendar` y `reporting/dashboard` y las preguntas 26–29 de docs/65; registrar las decisiones y ajustar specs y TC; `openspec validate add-predicted-cash-flow-band --strict`
- [ ] 1.2 Revisar TC-FORECAST-CASHFLOW-001..003 y TC-REPORTING-PREDICTED-001..011 contra los scenarios (cifras: 3900.00 − 2748.00 = 1152.00; (1500.00 − 1050.00) / 10 = 45.00 y 5000.00 − 8 × 45.00 = 4640.00; (1900.00 − 1050.00) / 10 = 85.00 ⇒ 4320.00; (1200.00 − 1050.00) / 10 = 15.00 ⇒ 4880.00; 1550.00 / 31 = 50.00); fechas fijas con `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` tras las decisiones

## 2. DOMAIN (TDD)

- [ ] 2.1 FORECAST: `VariableLiquidOutflowBuilder` puro test-first (porciones pagadas desde cuentas líquidas por moneda, resta de resueltos y componentes de cuotas pagados desde ellas, tarjetas fuera, sin conversión): TC-FORECAST-CASHFLOW-001..003 *(pregunta 26)*
- [ ] 2.2 REPORTING: `PredictedSpendingBand` puro test-first (restante del periodo en curso nunca negativo, reparto por día con HALF_EVEN y residuo en el último día, tres series, mínimo por serie): TC-REPORTING-PREDICTED-001..003; PBT con timeout explícito (Σ reparto del periodo = q; serie alta ≤ esperada ≤ baja en cada día) *(pregunta 28)*
- [ ] 2.3 REPORTING: probabilidad de déficit (`LIKELY`/`POSSIBLE`/`UNLIKELY`/`NOT_AVAILABLE`, fecha) con el umbral del riesgo: TC-REPORTING-PREDICTED-004, -005 *(pregunta 27)*

## 3. APPLICATION

- [ ] 3.1 FORECAST: serie `LIQUID_VARIABLE_OUTFLOW` por moneda en `ExecuteForecastRun` (horizonte 4 periodos) y `LatestForecastQuery` con `scopes` y `currency`: TC-FORECAST-CASHFLOW-001
- [ ] 3.2 REPORTING: `GetCashFlowCalendar` con `predicted` por moneda (lectura del pronóstico en la transacción de la petición, elección por etiqueta de periodo, motivos de no disponible); riesgo, episodio y alerta sin cambios: TC-REPORTING-PREDICTED-001, -006..008
- [ ] 3.3 REPORTING: `ReportSummary.forecast` y `CashFlowHomeBlock.predictedShortfall`: TC-REPORTING-PREDICTED-009, -010 *(pregunta 29)*

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand del CHECK de `forecasting.forecast_series.scope` (si existe); timestamp posterior a la del change 65
- [ ] 4.2 Test de integración: corrida con la serie nueva y calendario con banda sobre PostgreSQL real (Testcontainers): TC-FORECAST-CASHFLOW-001, TC-REPORTING-PREDICTED-001
- [ ] 4.3 `arch:check` con la dependencia REPORTING → FORECAST (contratos) y sin ciclo

## 5. API

- [ ] 5.1 `CashFlowCurrency.predicted`, `ReportSummary.forecast`, `CashFlowHomeBlock.predictedShortfall` y `ForecastSeries.scope` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-REPORTING-PREDICTED-001, -004, -009
- [ ] 5.2 Benchmarks: calendario de 90 días ≤ 500 ms p95 con la banda y resumen del Home ≤ 300 ms p95 con el bloque del pronóstico: TC-REPORTING-PREDICTED-011

## 6. UI

- [ ] 6.1 `/flujo-de-caja`: área entre gasto alto y bajo y línea del gasto esperado por moneda, leyenda, probabilidad de déficit con su texto (gasto alto = límite superior del 80 %), motivo cuando no hay banda, aviso de desactualizado; tabla accesible con las columnas nuevas; i18n es/en/pt: TC-REPORTING-PREDICTED-001, -004, -006
- [ ] 6.2 Tarjetas Q3 (gasto esperado con rango) y Q8 (probabilidad de déficit en una línea aparte del riesgo): TC-REPORTING-PREDICTED-009, -010

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test; actualizar el front matter
- [ ] 7.2 E2E con el perfil `ml` y el dataset Demo: el calendario de 30 días muestra la banda y la probabilidad; con la función deshabilitada el calendario y el Home quedan como en Phase 7: TC-REPORTING-PREDICTED-006, -009
- [ ] 7.3 Regresión: TC-REPORTING-FORECAST-* (riesgo, episodio y alerta) en verde sin cambios: TC-REPORTING-PREDICTED-008

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
