# Propuesta: add-ml-forecasting-service

## Why

Phase 8 agrega pronósticos estadísticos de gasto, ingreso y saldo (docs/24 §5.8, EPIC-22, FEAT-22.1) con una condición que atraviesa todo el diseño: el producto es completamente útil sin ML y el servicio de ML nunca está en el camino crítico (ARCHITECTURE §1 y §2, ADR-0017, FR-FORECAST-006). Hoy no existe el contexto `FORECAST`: no hay schema `forecasting`, ni servicio `ml-forecasting`, ni contrato interno, ni corridas, ni una regla que decida cuándo una serie tiene historia suficiente (FR-FORECAST-005). Tampoco está decidido cómo cabe un segundo runtime (Python) en el host N1 de 2 GB (ADR-0027), con el presupuesto de conexiones fijo (API 22 + worker 34 sobre `max_connections=70`, D249) y sin consumidores nuevos. Este change crea esa base: el servicio, el ACL, las corridas, la preparación de datos y la degradación, con los pronósticos de referencia como primer modelo, para que `add-expense-forecasts` (65) sume los modelos, la explicación y la vista sobre un camino ya probado de punta a punta.

## What Changes

- **Servicio `ml-forecasting`** (Python, FastAPI; imagen `finance-ml`; ADR-0033 propuesto): sin estado, sin base de datos, sin almacenamiento de objetos ni salida a Internet; endpoint interno síncrono `POST /v1/forecasts` autenticado con una credencial de servicio de archivo; una petición a la vez; contrato versionado en `contracts/ml/` (OpenAPI y JSON Schema) verificado en los dos lados. Primer conjunto de modelos: pronósticos de referencia (último periodo, mismo periodo del año anterior, promedio móvil) con intervalos empíricos del 80 % y del 95 %.
- **Contexto `@pf/forecasting`** (ACL, schema `forecasting`): corrida con máquina de estados (`REQUESTED`, `RUNNING`, `COMPLETED`, `INSUFFICIENT_DATA`, `FAILED`, `SUPERSEDED`), una activa por workspace, reemplazo de la vigente, reintentos con espera creciente (5 intentos en 24 h) y falla visible sin afectar el núcleo.
- **Series por periodo financiero** desde contratos públicos (TRANSACTIONS `NominalFlowQuery`, CLASSIFICATION, FX con la valoración del shared-kernel): gasto total, por grupo, por categoría (con «Otras categorías» para las esporádicas) e ingreso total, en la moneda de reporte con la tasa de cada fecha, neto de reembolsos y sin transferencias, conversiones ni capital (criterio de Q3).
- **Preparación de datos por serie** (FR-FORECAST-005): ≥ 6 periodos terminados ⇒ modelos; 3–5 ⇒ estimación simple marcada; < 3 ⇒ sin pronóstico y cuántos periodos faltan; huecos, densidad por categoría y calidad de la clasificación.
- **Minimización**: la petición solo lleva montos por periodo con referencias opacas por corrida; sin ids de workspace, nombres, descripciones ni contrapartes; el servicio no guarda ni registra montos.
- **Validación del resultado** antes de publicar (escala, orden de los intervalos, no negativos, periodos y moneda); una serie inválida se descarta sin tumbar la corrida.
- **Corridas programadas y manuales sin consumidores nuevos**: trabajo diario `forecasting.schedule` (periodo nuevo terminado o pronóstico de más de 7 días) y ejecutor `forecasting.runner` dentro de la reserva de trabajos periódicos del worker; ninguna conexión retenida mientras se espera al servicio. Solicitud manual de OWNER o EDITOR (`POST W/forecasts`, 202 + operación `FORECAST`).
- **API de lectura**: corridas, corrida por id, pronóstico vigente por serie y horizonte (1/3/6/12), estado `NONE`/`DISABLED`/`STALE`.
- **Hecho** `forecast.ForecastGenerated.v1` sin consumidores; recorrido de la corrida en `audit/lifecycle-timeline`; métricas `pf.ml.forecast.*` y alerta de 3 corridas fallidas.
- **Plataforma**: perfil Compose `ml` con el servicio, gate de PR del servicio Python, imagen escaneada y promovida por digest, despliegue opcional en N1 y trazabilidad de los tests de Python.
- **Fuera de alcance:** ETS y selección por backtesting, publicación condicionada a superar al baseline, costos conocidos frente a variables, drivers, nivel de confianza, la vista `/pronosticos` y los avisos de la UI (change 65 `add-expense-forecasts`); la banda de gasto predicho en el calendario, la probabilidad de déficit y el Home (change 66 `add-predicted-cash-flow-band`); la precisión frente al real y el reporte 16 (change 67 `add-forecast-accuracy`); detección de anomalías (FR-FORECAST-010, propuesta para Phase 9 por EPIC-26); categorización por ML (W-13); commodities y valoración de inversiones (D400); Prophet, modelos globales, MLflow y entrenamiento entre workspaces; imágenes multi-arch (NFR-PORT-008).

## Capabilities

### New Capabilities
- `forecast/expense-forecasting`: corrida de pronóstico, preparación de datos, series por periodo financiero, minimización, validación, consulta y degradación (ARCHITECTURE §14 ya la reserva para el contexto `forecast`). 21 requirements ADDED (12 Must, 9 Should).

### Modified Capabilities
- `audit/lifecycle-timeline`: 1 ADDED (Should), recorrido de la corrida de pronóstico.
- `platform/local-environment`: 1 ADDED (Must), servicio de pronósticos en el perfil `ml`.
- `platform/delivery-pipeline`: 3 ADDED (2 Must, 1 Should), gate del servicio Python, imagen por digest y despliegue opcional en el host.
- `quality/test-traceability`: 1 ADDED (Must), tests de Python en la trazabilidad.

## Impact

**Specs impactadas:** `forecast/expense-forecasting` (nueva, 21 ADDED), `audit/lifecycle-timeline` (1 ADDED), `platform/local-environment` (1 ADDED), `platform/delivery-pipeline` (3 ADDED), `quality/test-traceability` (1 ADDED). Lee sin modificar: `transactions/transaction-recording` (flujos nominales), `classification/categories`, `fx/market-rates`, `planning/financial-periods`, `identity/workspace-membership` (roles), `identity/workspace-portability` (sin sección nueva), `platform/event-delivery` (presupuesto de conexiones).

**Componentes/contextos impactados:** contexto nuevo `@pf/forecasting` (domain: `ForecastRun`, `ReadinessGate`, `PeriodSeriesBuilder`, `ForecastResultValidator`, `OpaqueRefAllocator`; application: `RequestForecastRun`, `ScheduleForecastRuns`, `ExecuteForecastRun`, `GetLatestForecast`, `ListForecastRuns`, `GetForecastRun`; infrastructure: repositorios, adapter HTTP `MlForecastingServiceClient`, jobs; interface: controladores; contracts: `LatestForecastQuery`, constantes de jobs). Servicio nuevo `services/ml-forecasting` (Python). `apps/api` (composición, jobs, configuración). `apps/web`: solo el estado mínimo para E2E de degradación (la vista completa es del change 65). TRANSACTIONS, CLASSIFICATION, FX y PLANNING sin cambios (consumo de contratos existentes). `scripts/traceability` (escaneo de tests de Python). `deploy/compose` (perfil `ml`, servicio opcional en el host), `.github/workflows` (`pr.yml`, `main.yml`, `nightly.yml`, `deploy.yml`), `docker/finance-ml.Dockerfile`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): `POST W/forecasts` (`requestForecastRun`, EDITOR, `Idempotency-Key`, 202 + operación `FORECAST`), `GET W/forecasts` (`listForecastRuns`, VIEWER), `GET W/forecasts/{runId}` (`getForecastRun`, VIEWER), `GET W/forecasts/latest` (`getLatestForecast`, VIEWER; `scope`, `scopeRef`, `horizon`). Códigos de error nuevos en `ErrorCode` (`x-extensible-enum`): `FORECAST_RUN_IN_PROGRESS` (409), `FORECASTING_DISABLED` (409). Contrato interno nuevo `contracts/openapi/ml-forecasting.v1.yaml` y `contracts/ml/forecast-request.v1.schema.json`, `forecast-response.v1.schema.json` (no es la API pública; versionado por ruta `/v1`, solo cambios aditivos).

**Tablas impactadas:** nuevas `forecasting.forecast_run`, `forecasting.forecast_series`, `forecasting.forecast_point` (RLS forzada fail-closed, registradas en `platform.workspace_scoped_table`; `forecast_point` solo SELECT/INSERT para la app).

**Eventos impactados:** nuevo `forecast.ForecastGenerated.v1` (`contracts/events/forecast/`), sin consumidores en Phase 8. Ningún evento consumido (no se consume `planning.MonthClosed`, D249).

**Migraciones requeridas:** una migración expand, no destructiva (schema y tres tablas nuevas), timestamp posterior a la última de `main`.

**Test cases:** AÑADIDOS — TC-FORECAST-SERVICE-001..040 (40) y TC-PLATFORM-MLSERVICE-001..009 (9). MODIFICADOS — TC-PLATFORM-THROUGHPUT-009 y TC-SECURITY-RLS-007 no cambian de texto, pero su ejecución debe seguir en verde con el contexto nuevo (mismos 28 consumidores; matriz RLS con las tres tablas). DEPRECADOS — ninguno.

**Impacto de regresión:** ninguno en el camino crítico: sin consumidores ni conexiones nuevas (TC-PLATFORM-THROUGHPUT-009), el núcleo no depende del servicio (TC-FORECAST-SERVICE-001 y TC-PLATFORM-MLSERVICE-001), el perfil `core` arranca igual. El trabajo diario lee la historia completa de cada workspace: medir su costo en el nightly (TC-FORECAST-SERVICE-028). La memoria del host N1 sube con el servicio habilitado (ADR-0033).

**Riesgos introducidos:** RISK-005 (segundo runtime y toolchain para un solo usuario), RISK-014 (pocos datos: la preparación lo hace explícito), riesgo nuevo de memoria del host N1 con el servicio habilitado (disparador N2 de ADR-0027), cadena de suministro Python (numpy, scipy, statsmodels; NFR-SEC-013), privacidad de los montos enviados al servicio interno (NFR-COMP-001; mitigado con referencias opacas y red interna), RISK-017 (multi-moneda: valoración con la tasa de cada fecha, nunca 1:1).

**Invariantes afectadas:** INV-001 y INV-002 (todo monto decimal y con moneda) e INV-020 (HALF_EVEN a la escala de la moneda al materializar los resultados del servicio). El aislamiento por workspace lo dan RLS fail-closed y el registro en `platform.workspace_scoped_table` (ADR-0023). Ninguna escritura en el ledger ni en tablas de otros contextos.
