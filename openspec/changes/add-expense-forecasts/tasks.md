# Tareas

> Requiere `add-ml-forecasting-service` (64) fusionado y, para archivar, archivado antes (crea `forecast/expense-forecasting`). Depende de las preguntas bloqueantes 1–4 de docs/65 (las del change 64); las preguntas 16–25 se implementan con la recomendación si el owner no responde antes del grupo que las usa. Gates: los del change 64, más `pnpm test:e2e` con `PF_E2E_PROJECT` por la vista nueva.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner el delta de `forecast/expense-forecasting` y las preguntas 16–25 de docs/65; registrar las decisiones y ajustar spec y TC; `openspec validate add-expense-forecasts --strict` *(2026-11-13: D410–D442 aceptadas en docs/66; spec y TC ajustados a la implementación; `openspec validate add-expense-forecasts --strict` en verde)*
- [x] 1.2 Acordar con Commitments S1 (`projectForForecast`) y S2 (`listResolved`) y con Debt S3 (cuotas futuras con componentes); registrar el acuerdo en design.md *(2026-11-13: S1, S2 y S3 implementados en este mismo change como contratos aditivos de `@pf/commitments/contracts` y `@pf/debt/contracts`; `LoanPortfolioQuery` no exponía las cuotas, así que se agregó `LoanScheduleQuery.listUpcomingInstallments`)*
- [x] 1.3 Revisar TC-FORECAST-EXPENSE-001..023 contra los scenarios (cifras: 2500.00 + 199.00 + 49.00 = 2748.00; 2748.00 + 1660.00 = 4408.00; 2748.00 + 1290.00 = 4038.00; 2748.00 + 2040.00 = 4788.00; 4300.00 − 2748.00 = 1552.00; 9.99 × 6.96 = 69.5304 ⇒ 69.53; 420.35 + 15.00 = 435.35; 1552.00 + 120.00 − 12.00 = 1660.00; 0.95 × 0.90 = 0.855; 8000.00 + 350.00 = 8350.00; 4700.00 − 4408.00 = 292.00); pasar a `ready` y `requirement_status: confirmed` tras las decisiones *(2026-11-13: TC-FORECAST-EXPENSE-001..023 en `status: automated` y `requirement_status: confirmed`; las cifras de los scenarios se verifican en los tests)*

## 2. DOMAIN (TDD, lógica crítica)

- [x] 2.1 `KnownFutureCalculator` puro test-first (tipos de ocurrencia que cuentan, montos por `amountType`, `VARIABLE` sin monto, componentes de cuotas sin capital, conversión con la tasa de hoy declarada, sin tasa ⇒ sin sumar): TC-FORECAST-EXPENSE-004..007 *(pregunta 23)* *(2026-11-13: `known-future.ts` + `known-future.test.ts`)*
- [x] 2.2 `VariableHistoryBuilder` puro test-first (resta de resueltos por periodo y categoría, componentes de préstamo, negativos a 0 contados): TC-FORECAST-EXPENSE-002, -003; PBT con timeout explícito (historia variable + resueltos + componentes = gasto del periodo sin truncamiento) *(2026-11-13: `variable-history.ts` + test con PBT y timeout explícito)*
- [x] 2.3 `ForecastComposer` puro test-first (suma exacta conocidos + variable, intervalos, motivos con suma exacta y residuo de redondeo en `TREND_AND_LEVEL`, confianza, diferencia categorías-total, ingreso total): TC-FORECAST-EXPENSE-001, -012..014, -019, -020; PBT (promedio + efectos = variable; `lower80 ≤ esperado ≤ upper80`) *(2026-11-13: `forecast-composer.ts` + test con PBT; el residuo de redondeo cae en `TREND_AND_LEVEL`)*

## 3. APPLICATION

- [x] 3.1 Commitments: `UpcomingPaymentsQuery.projectForForecast` con la expansión del motor de recurrencia, sin escrituras (S1), y `ResolvedOccurrencesQuery.listResolved` (S2); TC-REPORTING-UPCOMING-* y TC-REPORTING-FORECAST-* en verde: TC-FORECAST-EXPENSE-004 *(2026-11-13: `UpcomingPaymentsQuery.projectForForecast` (misma expansión de `OccurrenceGenerator`, sin escrituras, con la estimación de precios indexados) y `ResolvedOccurrencesQuery.listResolved`; las ocurrencias anteriores al periodo en curso no se incluyen (`from` acota); tests en `forecast-sources.test.ts` y `pg-commitments.int.test.ts`)*
- [x] 3.2 Debt: cuotas futuras con componentes (S3), reutilizando `LoanPortfolioQuery` si ya lo expone: TC-FORECAST-EXPENSE-007 *(2026-11-13: `LoanScheduleQuery.listUpcomingInstallments` con lo pendiente por componente de las cuotas no pagadas de préstamos activos)*
- [x] 3.3 `ExecuteForecastRun` con la descomposición (lecturas en serie dentro de la transacción de lectura; petición con historia variable y `modelSet: phase8-v1`; composición y persistencia de conocidos, motivos y backtesting): TC-FORECAST-EXPENSE-001, -002, -019 *(2026-11-13: `ExecuteForecastRun.prepare` con lecturas en serie, historia variable, conocidos, semilla derivada del id de la corrida y metadatos; `expense-forecast.test.ts`)*
- [x] 3.4 `GetLatestForecast` con los campos nuevos y `ListForecastKnownItems`: TC-FORECAST-EXPENSE-001, -017 *(2026-11-13: `GetLatestForecast` con componentes, motivos, confianza, `coherenceGap` por punto del gasto total y `meta.conversion`; `listKnownItems`)*

## 4. SERVICIO `ml-forecasting`

- [x] 4.1 `ETS_DAMPED` y `ETS_SEASONAL` (statsmodels) con intervalos por simulación con semilla: TC-FORECAST-EXPENSE-008, -021 *(pregunta 16)* *(2026-11-13: `phase8.py`: `ETS_DAMPED` y `ETS_SEASONAL` con intervalos por simulación con semilla por serie)*
- [x] 4.2 Backtesting de origen móvil con ventana creciente, MASE ponderado, cobertura y sesgo, sin fuga de datos: TC-FORECAST-EXPENSE-009 *(pregunta 20)* *(2026-11-13: origen móvil con ventana creciente; solo compiten los candidatos evaluados en todos los cortes; MASE ponderado, cobertura y sesgo)*
- [x] 4.3 Regla de publicación (5 %) y respaldo de referencia: TC-FORECAST-EXPENSE-010, -011 *(pregunta 17)* *(2026-11-13: regla del 5 % y `BASELINE_FALLBACK`; `baselineMase` es el de la mejor referencia)*
- [x] 4.4 Atípicos por MAD con recorte en el ajuste y motivos de la parte variable: TC-FORECAST-EXPENSE-012, -022 *(pregunta 21)* *(2026-11-13: atípicos por MAD con recorte en el ajuste; motivos de la parte variable)*
- [x] 4.5 Contrato v1 aditivo (`phase8-v1`, `backtest`, `outliers`, `drivers`), ejemplos compartidos y verificación del OpenAPI publicado; tests con hypothesis (intervalos ordenados, determinismo con semilla): TC-FORECAST-EXPENSE-021 *(2026-11-13: contrato v1 aditivo (`phase8-v1`, `outlierPolicy`, `backtest`, `outliers`, `drivers`), ejemplos `request.phase8.valid.json` y `response.phase8.valid.json`, OpenAPI regenerado y verificado; hypothesis para el orden de los intervalos y el determinismo)*

## 5. INFRASTRUCTURE

- [x] 5.1 Migración expand `forecasting_components` (columnas nuevas, `forecast_known_item`, `backtest_result`, RLS forzada fail-closed, grants, registro, matriz TC-SECURITY-RLS-007); timestamp posterior a la del change 64 *(2026-11-13: `20261113100000_forecasting_components.sql`; añade `forecast_run.known_conversion jsonb` (conversión declarada) y `forecast_known_item.category_id`; RLS forzada y registro verificados por TC-SECURITY-RLS-007)*
- [x] 5.2 Repositorios y test de integración de una corrida completa con el servicio falso y los ejemplos compartidos: TC-FORECAST-EXPENSE-001, -019 *(2026-11-13: `pg-forecasting.int.test.ts` y `forecasting.api.test.ts` con el servicio simulado)*
- [x] 5.3 Benchmark nightly de la corrida con `phase8-v1` sobre el conjunto Large (≤ 300 s): TC-FORECAST-EXPENSE-023 *(2026-11-13: `services/ml-forecasting/tests/test_perf.py` (`pytest -m perf`, 60 series de 36 periodos con backtesting: ~45 s en local) y pasos del job `perf` de `nightly.yml` (el nightly conserva sus cuatro jobs, D291); el servicio real con el conjunto Large completo de la corrida queda para el nightly)*
- [x] 5.4 Variables nuevas en `docs/config-reference.md` (`pnpm config:docs:check`) *(2026-11-13: `FORECASTING_COHERENCE_GAP_RATIO` en `docs/config-reference.md`; las `ML_*` del servicio se documentan en su README)*

## 6. API

- [x] 6.1 Campos nuevos de `ForecastSeries`, `ForecastPoint` y `LatestForecast.meta.conversion`, y `listForecastKnownItems` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-FORECAST-EXPENSE-001, -005, -016 *(2026-11-13: contrato aditivo; Redocly y Spectral sin errores y `oasdiff` limpio; `coherenceGap` va por punto porque la diferencia es por periodo)*

## 7. UI

- [x] 7.1 Vista `/pronosticos`: series, horizonte, gráfico SVG con banda del 80 %, detalle con el 95 %, conocidos aparte, motivos, confianza, modelo, `generatedAt`, desactualizado, tabla accesible; botón «Actualizar pronóstico» solo para OWNER y EDITOR; i18n es/en/pt: TC-FORECAST-EXPENSE-015, -018 *(2026-11-13: `apps/web/src/ui/forecasts/*` y `/pronosticos`; la historia numérica no se grafica porque el contrato del design no la expone: se muestra el tramo y la cantidad de periodos)*
- [x] 7.2 Avisos de no asesoría financiera y de datos insuficientes (con periodos faltantes y enlace a las transacciones sin categoría); test del catálogo i18n sin «vas a gastar» ni «exactamente»: TC-FORECAST-EXPENSE-015..017 *(2026-11-13: avisos y test del catálogo i18n es/en/pt sin «vas a gastar» ni «exactamente»; el porcentaje de gasto sin categoría no está en el contrato: el aviso enlaza las transacciones)*

## 8. AUTOMATED TESTS y E2E

- [x] 8.1 Automatizar todos los TC del change con el TC-id en el nombre del test (TypeScript) o en el docstring (Python); actualizar el front matter *(2026-11-13: todos los TC con su id en el nombre del test o en el docstring)*
- [x] 8.2 E2E con el perfil `ml` y el dataset Demo: abrir `/pronosticos`, cambiar el horizonte a 3, ver conocidos y motivos, solicitar una corrida como EDITOR y verla completada; como VIEWER, sin botón: TC-FORECAST-EXPENSE-018 *(2026-11-13: `tests/e2e/specs/expense-forecasts.spec.ts` con el perfil `ml` del stack (servicio real, `FORECASTING_ENABLED=true`) en verde: OWNER solicita la corrida y la ve completada, horizonte, rango, conocidos, motivos, axe, aviso es/en; VIEWER sin botón. Usa un workspace personal preparado por API, no el Demo: el worker no puede leer workspaces demo (PF002 preexistente que también rompe el job de tarjetas). Se corrigió además el compose de desarrollo: `read_only` del worker y del servicio solo en producción, porque la credencial `content` no es compatible con raíz de solo lectura)*
- [x] 8.3 Comando de evidencia para el owner (`pnpm forecast:backtest:report`) que imprime, en su instancia, solo métricas agregadas por tipo de serie (MASE del publicado y de la referencia, cobertura, cantidad de series), sin montos ni nombres *(pregunta 24)* *(2026-11-13: `pnpm forecast:backtest:report` (comando `forecast-report` de la imagen finance-api); imprime solo métricas agregadas por tipo de serie)*

## 9. DOCUMENTATION

- [x] 9.1 Aplicar design.md § «Cambios a docs compartidos» *(2026-11-13: docs/01, 08, 10, 15, 17, 25, 28 y 38)*
- [x] 9.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check` *(2026-11-13: `traceability:check`, `spec:validate`, `format:check` y `config:docs:check` en verde)*
- [ ] 9.3 Evidencia del owner del criterio de salida de Phase 8 (modelos que superan la referencia en las series publicadas) con la salida de 8.3 sobre sus datos reales, registrada sin montos *(espera al owner)*
