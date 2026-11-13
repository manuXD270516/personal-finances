# Tareas

> Primer change de Phase 8. No requiere otros changes de Phase 8; usa contratos ya implementados de TRANSACTIONS (`NominalFlowQuery`, changes 58 y 59), CLASSIFICATION, FX (`FlowValuation`, D109), PLANNING e IDENTITY. Bloqueos (docs/65): la pregunta 1 (ADR-0033) bloquea los grupos 4 y 8; la 2 decide si se implementa ahora; las 3 y 4 bloquean el grupo 2 (tareas 2.2–2.3); la 10 bloquea la tarea 8.3. Las demás se implementan con la recomendación si el owner no responde antes del grupo que las usa. Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`, `pnpm contract:breaking`, `pnpm test:integration` (dos veces en verde), `pnpm test:e2e` con `PF_E2E_PROJECT`, y en `services/ml-forecasting`: `uv run ruff check`, `uv run mypy --strict` y `uv run pytest`.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los deltas de `forecast/expense-forecasting`, `audit/lifecycle-timeline`, `platform/local-environment`, `platform/delivery-pipeline` y `quality/test-traceability` y las preguntas 1–15 de docs/65; registrar las decisiones en el doc de decisiones de Phase 8 y ajustar specs y TC; `openspec validate add-ml-forecasting-service --strict`
- [ ] 1.2 Revisar TC-FORECAST-SERVICE-001..040 y TC-PLATFORM-MLSERVICE-001..009 contra los scenarios (cifras: 1200.00 + 50.00 × 6.96 − 100.00 = 1448.00 BOB; 4 periodos ⇒ faltan 2 para el modelo; 2 periodos ⇒ falta 1 para la estimación simple y 4 para el modelo; reintentos a los 5, 15, 45 y 135 min); fechas fijas con `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` tras las decisiones; `pnpm traceability:check` sin errores ni advertencias
- [ ] 1.3 Registrar la aceptación de ADR-0033 por el owner (pregunta 1) y actualizar el estado de ADR-0017

## 2. DOMAIN (TDD, `@pf/forecasting`)

- [ ] 2.1 Crear el contexto `packages/contexts/forecasting` (`domain`, `application`, `infrastructure`, `interface`, `contracts`) con las reglas de `arch:check` (lee solo contratos de TRANSACTIONS, CLASSIFICATION, FX, PLANNING e IDENTITY; ningún ciclo)
- [ ] 2.2 `PeriodSeriesBuilder` puro test-first: periodos por día de inicio del mes financiero en la zona del workspace, solo terminados, máximo configurable, gasto neto y sin transferencias, valoración con la tasa de cada fecha, flujos sin tasa excluidos y contados: TC-FORECAST-SERVICE-011, -012, -013; PBT con timeout explícito (Σ categorías del periodo = total del periodo; el orden de las filas no cambia el resultado) *(preguntas 3, 6 y 15)*
- [ ] 2.3 `ReadinessGate` puro test-first: `MODEL`/`SIMPLE`/`INSUFFICIENT` con periodos faltantes, «Otras categorías», huecos y calidad de la clasificación: TC-FORECAST-SERVICE-014..020 *(preguntas 4 y 5)*
- [ ] 2.4 `OpaqueRefAllocator` y armado de la petición sin datos identificables: TC-FORECAST-SERVICE-021, -022
- [ ] 2.5 `ForecastResultValidator` puro test-first (escala, orden de intervalos, no negativos, periodos y moneda, versión): TC-FORECAST-SERVICE-023, -024; PBT (todo resultado aceptado cumple los CHECK de la tabla)
- [ ] 2.6 Agregado `ForecastRun` con la máquina `FORECAST_RUN_LIFECYCLE` (transiciones, una activa por workspace, reemplazo, reintento con espera creciente, falla a los 5 intentos o a las 24 h, corrida colgada a los 15 min): TC-FORECAST-SERVICE-003, -004, -029, -030, -040

## 3. APPLICATION

- [ ] 3.1 `RequestForecastRun` (EDITOR o superior, idempotencia, cuota de operaciones costosas, `Operation` `FORECAST`, auditoría `FORECAST_RUN_REQUESTED`, `FORECAST_RUN_IN_PROGRESS`, `FORECASTING_DISABLED`): TC-FORECAST-SERVICE-002, -005..007 *(pregunta 13)*
- [ ] 3.2 `ScheduleForecastRuns` (periodo nuevo terminado o vigente de más de 7 días, una por día, retención con el rol de mantenimiento): TC-FORECAST-SERVICE-008, -009, -038 *(preguntas 9 y 11)*
- [ ] 3.3 `ExecuteForecastRun` en pasos (UoW de reclamo, lectura, llamada sin conexión, UoW de publicación con outbox y recorrido): TC-FORECAST-SERVICE-003, -004, -025, -026, -036
- [ ] 3.4 `GetLatestForecast`, `ListForecastRuns` y `GetForecastRun` (horizonte, filtros, `NONE`/`DISABLED`/`stale`, `lastAttempt`) y `LatestForecastQuery` en los contratos: TC-FORECAST-SERVICE-001, -026, -027, -031..033

## 4. SERVICIO `ml-forecasting` (Python) *(bloqueado por la pregunta 1)*

- [ ] 4.1 `services/ml-forecasting`: `pyproject.toml`, `uv.lock`, FastAPI con un proceso, `/health/live`, `/health/ready` y `/v1/models`; configuración por entorno; registros JSON sin montos: TC-FORECAST-SERVICE-035
- [ ] 4.2 Autenticación con credencial de archivo comparada en tiempo constante, límites de cuerpo, series y horizonte, una petición a la vez (`503` con `Retry-After`) y corte a los 240 s: TC-FORECAST-SERVICE-034
- [ ] 4.3 Modelos de referencia (`NAIVE`, `SEASONAL_NAIVE`, `MEAN_LAST_N`) con intervalos empíricos del 80 % y del 95 %, cuantización `Decimal` `ROUND_HALF_EVEN`, truncamiento a 0 y semilla fija; tests con hypothesis (intervalos ordenados, no negativos, determinismo): TC-PLATFORM-MLSERVICE-004
- [ ] 4.4 Contrato: `contracts/ml/forecast-request.v1.schema.json`, `forecast-response.v1.schema.json`, `contracts/openapi/ml-forecasting.v1.yaml` y ejemplos en `contracts/ml/examples/`; test que compara el OpenAPI generado con el publicado: TC-PLATFORM-MLSERVICE-003
- [ ] 4.5 OpenTelemetry (FastAPI) con propagación de `traceparent` y métricas del servicio
- [ ] 4.6 `docker/finance-ml.Dockerfile` multi-stage con `uv`, base fijada por digest, usuario 10001, sin shell innecesaria y compatible con `read_only`
- [ ] 4.7 Perfil `ml` en `deploy/compose/compose.yaml` (red `ml-internal` sin salida, puerto solo en loopback, healthcheck, sin credenciales de base ni de almacenamiento): TC-PLATFORM-MLSERVICE-001, -002
- [ ] 4.8 Medir la memoria en reposo y durante una corrida del conjunto Large con el servicio en contenedor y fijar el límite de `compose.prod.yaml` (estimado 320m); registrar la medición en ADR-0033

## 5. INFRASTRUCTURE (monolito)

- [ ] 5.1 Migración expand `forecasting` (tres tablas, CHECK, índices, RLS forzada fail-closed, grants, registro en `platform.workspace_scoped_table`, matriz TC-SECURITY-RLS-007 ampliada); timestamp posterior a la última de `main`
- [ ] 5.2 Repositorios con tests de integración Testcontainers (aislamiento por workspace, carrera de dos solicitudes simultáneas ⇒ una sola activa, `FOR UPDATE SKIP LOCKED` del ejecutor): TC-FORECAST-SERVICE-006, -033
- [ ] 5.3 Adapter `MlForecastingServiceClient` (fetch con timeout, validación con el JSON Schema, mapeo de errores a motivos) con tests contra un servidor falso y los ejemplos compartidos: TC-FORECAST-SERVICE-023, -029, -030
- [ ] 5.4 Jobs `forecasting.schedule` y `forecasting.runner` (cron por configuración, una corrida por pasada, sin consultas en paralelo sobre el mismo cliente, ninguna conexión tomada durante la llamada al servicio) con test de integración del worker y del presupuesto de conexiones: TC-FORECAST-SERVICE-008..010; TC-PLATFORM-THROUGHPUT-009 en verde (28 + 4 = 32 de 34)
- [ ] 5.5 Outbox `forecast.ForecastGenerated.v1` y su esquema en `contracts/events/forecast/`: TC-FORECAST-SERVICE-036
- [ ] 5.6 Métricas `pf.ml.forecast.*` y alerta `ForecastRunsFailing`; variables nuevas en `docs/config-reference.md` (`pnpm config:docs:check`): TC-FORECAST-SERVICE-037
- [ ] 5.7 Exportación e importación del workspace sin corridas: TC-FORECAST-SERVICE-039 *(pregunta 12)*

## 6. API

- [ ] 6.1 `requestForecastRun`, `listForecastRuns`, `getForecastRun`, `getLatestForecast` y los `ErrorCode` `FORECAST_RUN_IN_PROGRESS` y `FORECASTING_DISABLED` en el contrato (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-FORECAST-SERVICE-005..007, -025..027, -031..033
- [ ] 6.2 Recorrido de la corrida por `GET …/forecasts/{runId}/lifecycle` con el patrón existente: TC-FORECAST-SERVICE-040

## 7. UI

- [ ] 7.1 Indicador en Ajustes → Estado (función habilitada, última corrida, estado y motivo de falla) en es/en/pt; sin la vista `/pronosticos` (change 65): TC-FORECAST-SERVICE-002

## 8. CI, DESPLIEGUE Y AUTOMATED TESTS

- [ ] 8.1 `pr.yml`: job `ml` (ruff, mypy, pytest, verificación del OpenAPI y `osv-scanner` sobre `uv.lock`) que pasa en verde cuando no hay cambios del servicio; tests de contrato TypeScript en `unit`: TC-PLATFORM-MLSERVICE-003, -004
- [ ] 8.2 `main.yml`: build de `finance-ml`, Trivy con el criterio de las demás imágenes, SBOM y publicación por digest: TC-PLATFORM-MLSERVICE-005, -006
- [ ] 8.3 Proponer al owner el job `ml` como check obligatorio de `main` y aplicarlo solo con su confirmación *(pregunta 10)*
- [ ] 8.4 `compose.prod.yaml` (servicio opcional en el perfil `ml`, límites, secreto de archivo, sin puertos), `deploy.yml` y el comando forzado del host con el digest opcional `FINANCE_ML_IMAGE`; runbook de despliegue: TC-PLATFORM-MLSERVICE-006, -007 *(pregunta 1)*
- [ ] 8.5 `scripts/traceability`: escanear `services/**/tests/**/test_*.py` con TC-ids entre corchetes: TC-PLATFORM-MLSERVICE-008, -009
- [ ] 8.6 Test de degradación de punta a punta: stack `core` sin `ml` y con `FORECASTING_ENABLED=true` (registrar un gasto, Home, calendario, reportes y cierre responden; la corrida termina `FAILED` tras los reintentos acortados por configuración; la consulta muestra la vigente con `stale`): TC-FORECAST-SERVICE-001, -029
- [ ] 8.7 Benchmark nightly `forecast.perf.ts` con el conjunto Large y el servicio real (≤ 300 s; fila con timeout explícito; coordinar `nightly.yml` con el change 63): TC-FORECAST-SERVICE-028 *(pregunta 14)*
- [ ] 8.8 Automatizar todos los TC del change con el TC-id en el nombre del test (TypeScript) o en el docstring (Python); actualizar el front matter (`automated_tests`, `automation_status`, `status`)

## 9. DOCUMENTATION

- [ ] 9.1 Aplicar design.md § «Cambios a docs compartidos»
- [ ] 9.2 Actualizar la matriz de trazabilidad; ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
- [ ] 9.3 Al archivar, reemplazar el `## Purpose` de `forecast/expense-forecasting` por un propósito real
