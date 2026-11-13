# Tareas

> Requiere los changes 64, 65 y 66 fusionados (y archivados antes para archivar este). Sin preguntas bloqueantes propias; las 30–32 de docs/65 se implementan con la recomendación si el owner no responde antes del grupo que las usa. Por la pregunta 2, conviene implementarlo cuando haya al menos 3 periodos con pronóstico real para validar la vista con datos. Gates: los del change 64, más `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `forecast/expense-forecasting` y `reporting/financial-reports` y las preguntas 30–32 de docs/65; registrar las decisiones y ajustar specs y TC; `openspec validate add-forecast-accuracy --strict`
- [ ] 1.2 Resolver el escenario del catálogo del change 58 según la decisión 7 de design.md (MODIFIED aquí si ya está archivado)
- [ ] 1.3 Revisar TC-FORECAST-ACCURACY-001..008 y TC-REPORTING-ACCURACY-001..006 contra los scenarios (cifras: 4512.40 − 4350.00 = 162.40; (162.40 + 210.00 + 95.60 + 300.00) / 4 = 192.00; (−162.40 + 210.00 − 95.60 + 300.00) / 4 = 63.00; 3 / 4 = 75.00 %; 4512.40 + 80.00 = 4592.40 y 4592.40 − 4350.00 = 242.40); pasar a `ready` y `requirement_status: confirmed` tras las decisiones

## 2. DOMAIN (TDD)

- [ ] 2.1 `ForecastEvaluator` puro test-first (real con la regla de la serie, error, error absoluto, dentro del 80 % y del 95 %, series no publicadas fuera): TC-FORECAST-ACCURACY-001, -002
- [ ] 2.2 `AccuracyAggregator` puro test-first (MAE, cobertura, sesgo, MASE con el ingenuo de la ventana, `periods`, pérdida de precisión con 3 periodos): TC-FORECAST-ACCURACY-003, -007; PBT con timeout explícito (cobertura en [0, 100]; MAE ≥ 0; sesgo de errores simétricos = 0)

## 3. APPLICATION

- [ ] 3.1 `EvaluateEndedPeriods` dentro de `forecasting.schedule` (gracia, reevaluación de los 3 últimos si cambió el real, retención de 24 meses): TC-FORECAST-ACCURACY-004..006 *(pregunta 31)*
- [ ] 3.2 `ForecastAccuracyQuery` y `GetForecastAccuracy`; `ForecastSeries.accuracy`: TC-FORECAST-ACCURACY-003, -007 *(preguntas 30 y 32)*
- [ ] 3.3 REPORTING: reporte 16 (filas, indicadores, `NO_EVALUATIONS` con el primer periodo, `DISABLED`), CSV auditado y drill-down; catálogo 16 de 16: TC-REPORTING-ACCURACY-001..006

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand `forecasting_evaluation` (RLS forzada fail-closed, grants, registro, matriz TC-SECURITY-RLS-007); timestamp posterior a la del change 66
- [ ] 4.2 Test de integración del trabajo diario con dos workspaces (aislamiento, reevaluación tras un import tardío, sin consultas en paralelo sobre el mismo cliente): TC-FORECAST-ACCURACY-004, -005
- [ ] 4.3 Métricas `pf.ml.forecast.mase` y `pf.ml.forecast.coverage80`; variables nuevas en `docs/config-reference.md` (`pnpm config:docs:check`): TC-FORECAST-ACCURACY-008

## 5. API

- [ ] 5.1 `getForecastVsActualReport`, `getForecastAccuracy` y `ForecastSeries.accuracy` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-REPORTING-ACCURACY-001, -002, -004

## 6. UI

- [ ] 6.1 `/reportes/pronostico-vs-real`: selector de serie y horizonte, gráfico SVG con real, esperado y banda, tabla de errores, indicadores, exportación, detalle; i18n es/en/pt: TC-REPORTING-ACCURACY-001..004
- [ ] 6.2 `/pronosticos`: MAE, cobertura e indicador de pérdida de precisión por serie: TC-FORECAST-ACCURACY-007

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test; actualizar el front matter
- [ ] 7.2 E2E sobre un dataset con 4 periodos evaluados: abrir el reporte 16 desde el catálogo, ver la tabla y exportar el CSV: TC-REPORTING-ACCURACY-001, -002, -005
- [ ] 7.3 Actualizar TC-REPORTING-REPORTS-048 y su test a 16 reportes disponibles (escenario «Catálogo completo de Phase 7» con el contenido nuevo)

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
