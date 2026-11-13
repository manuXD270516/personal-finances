# Diseño

## Contexto

Phase 8 (docs/24 §5.8) agrega pronósticos explicables de gasto, ingreso y saldo. La arquitectura de referencia está en docs/15 (propuesta del 2026-10-01) y ADR-0017 (propuesto): servicio Python separado, ACL `@pf/forecasting` en el monolito, el servicio sin acceso a la base, nunca en el camino crítico. Este change es el primero de los cuatro de Phase 8 (docs/03 §7): crea la base sobre la que `add-expense-forecasts` (65), `add-predicted-cash-flow-band` (66) y `add-forecast-accuracy` (67) agregan comportamiento.

Lo que ya existe y se reutiliza:

- **Flujos nominales** (`@pf/transactions/contracts` `NominalFlowQuery.summarizeNominalFlows`): filas diarias por categoría, naturaleza (`INCOME`/`EXPENSE`) y moneda, netas de reembolsos y sin transferencias, conversiones ni capital (el criterio de Q3), con `groupBy` `ACCOUNT`/`COUNTERPARTY`/`ORIGIN` (changes 58 y 59).
- **Valoración de flujos** con la tasa de su fecha y la ventana de Reporting (`FlowValuation` del shared-kernel, D29/D34/D53/D109): permite convertir a la moneda de reporte sin depender de `@pf/reporting`.
- **Catálogo de categorías** (`CategoryCatalogQuery`: jerarquía grupo → categoría, archivadas) y **periodos financieros** (día de inicio del mes financiero del workspace).
- **Operaciones asíncronas** (docs/10 §8: 202 + `Operation`, `kind` abierto que ya prevé `FORECAST`), **cuota de operaciones costosas** (10/min), **auditoría** y **recorrido** (D37) en la misma unidad de trabajo, **outbox** con envelope v1.
- **Presupuesto de conexiones del worker:** 28 consumidores de concurrencia 1 + 4 reservadas (relay, readiness, dead-letter y trabajos periódicos) = 32 de 34; plantilla del host API 22 + worker 34 = 56 sobre `max_connections=70` (TC-PLATFORM-THROUGHPUT-009, D249). Los trabajos periódicos (`reporting.cash-flow-watch`, `notifications.digest`, …) comparten la reserva.
- **Host N1** (ADR-0027): Lightsail 2 GB + 2 GiB de swap, límites por contenedor que ya suman 2400 MiB (Caddy 64, Postgres 384, object storage 192, Keycloak 704, API 320, worker 448, web 288; la suma de límites excede la RAM porque no todos llegan al tope a la vez) y uso medido en reposo de 1.3–1.6 GiB.

Restricciones que se respetan: D249 (sin consumidores ni conexiones nuevas), D400 (commodities e inversiones al backlog), W-13 (categorización por ML solo después de Phase 8 y si aporta), ARCHITECTURE §2 (los contextos se hablan solo por `contracts`; `pnpm arch:check` prohíbe ciclos), D298 (forma vigente de las políticas RLS), contratos aditivos (oasdiff), Decimal con HALF_EVEN, CLAUDE.md (repositorio público: ningún dato real del owner en fixtures).

## Objetivos / No objetivos

**Objetivos**
- Servicio `ml-forecasting` y ACL `@pf/forecasting` con contrato versionado y verificado en ambos lados.
- Corrida de pronóstico trazable (máquina de estados, recorrido, auditoría de la solicitud manual), una activa por workspace, con reintentos y falla visible.
- Historia por periodo financiero y preparación de datos por serie (FR-FORECAST-005), con los pronósticos de referencia como primer modelo.
- Degradación probada: el núcleo responde igual con el servicio apagado o deshabilitado (FR-FORECAST-006, NFR-REL-010).
- Cero consumidores y cero conexiones nuevas; ninguna conexión retenida durante la llamada al servicio.
- Despliegue opcional en N1 sin romper el presupuesto de memoria cuando está deshabilitado.

**No objetivos**
- ETS, selección por backtesting, regla de publicación, costos conocidos frente a variables, drivers, confianza, vista `/pronosticos` (change 65).
- Banda en el calendario, probabilidad de déficit, Home (change 66). Precisión frente al real y reporte 16 (change 67).
- Anomalías (FR-FORECAST-010; EPIC-26 la ubica en Phase 9, pregunta 33 de docs/65), auto-clasificación (W-13), insights predictivos (Phase 9).
- Prophet, modelos globales entre series o workspaces, MLflow, almacenamiento de artefactos de modelo, GPU, imágenes multi-arch.

## Decisiones

1. **Capabilities.** El comportamiento del pronóstico vive en `forecast/expense-forecasting` (ARCHITECTURE §14 ya la reserva para el contexto `forecast`); los cuatro changes de Phase 8 le agregan requirements ADDED con nombres distintos y se archivan en orden (64 la crea). Lo operativo va a las capabilities transversales existentes: `platform/local-environment` (perfil `ml`), `platform/delivery-pipeline` (gate, imagen, despliegue), `quality/test-traceability` (tests de Python) y `audit/lifecycle-timeline` (recorrido). *Alternativa descartada:* una capability `forecast/forecasting-service` aparte: partiría la misma regla de negocio (cuándo y cómo se pronostica) en dos specs y obligaría a enmendar §14.

2. **Servicio Python separado (ADR-0033, propuesto; pregunta 1).** `services/ml-forecasting`: Python (3.14 si numpy, scipy y statsmodels publican wheels estables para esa versión al implementar; si no, 3.13), FastAPI + uvicorn con **un** proceso, dependencias con `uv` y `uv.lock`, **numpy, scipy, pandas (dependencia de statsmodels) y statsmodels**; sin Prophet, Polars, scikit-learn ni MLflow en Phase 8 (pregunta 16). El servicio atiende **una petición a la vez** (un semáforo; la segunda recibe `503` con `Retry-After`) y fija `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1` y `MKL_NUM_THREADS=1` para no competir por la CPU del host. *Alternativas:* en el worker con TypeScript (sin runtime nuevo, pero sin ETS confiable ni backtesting estándar y con cómputo en el event loop), proceso efímero lanzado por el host (el worker no puede lanzar contenedores sin el socket de Docker), ML gestionado (costo y envío de datos a terceros). El análisis completo está en ADR-0033.

3. **Contrato interno síncrono, sin almacenamiento de objetos (preguntas 1 y 7).** docs/15 §2–§3 proponía un snapshot en Object Storage y un job asíncrono con polling dentro del servicio. Se simplifica: el worker envía el conjunto de datos **en el cuerpo** de `POST /v1/forecasts` y recibe los resultados en la respuesta (el conjunto de un workspace personal pesa decenas de KB: 60 periodos × ~60 series). El servicio no guarda estado entre peticiones (un job asíncrono interno obligaría a guardar estado que se pierde al reiniciar) ni necesita credenciales de almacenamiento. La asincronía la da la corrida en el worker (estado en `forecasting.forecast_run`, reintentos del ejecutor). Límites: cuerpo ≤ 2 MiB, ≤ 400 series, ≤ 120 periodos por serie, horizonte ≤ 12; el servicio corta su cómputo a los 240 s y el cliente espera hasta `FORECASTING_SERVICE_TIMEOUT_MS` (300 000). `datasetSnapshotId` = `sha256:` + hash del JSON canónico de la petición (claves ordenadas, sin espacios); **el conjunto no se guarda**: la reproducibilidad es hash + versión del modelo + semilla, y el conjunto puede reconstruirse desde el ledger mientras la historia no se edite.

4. **Minimización y seudónimos por corrida.** El ACL asigna a cada serie una referencia opaca `s1..sN` **por corrida** (`OpaqueRefAllocator`, puro) y guarda el mapeo solo en `forecasting.forecast_series`; la petición no lleva el id del workspace (docs/15 §11 proponía `HMAC(workspaceId)`: innecesario, el servicio no necesita correlacionar corridas), ni nombres, ni descripciones, ni contrapartes, ni ids de transacciones. Lleva montos por periodo (string decimal), cantidad de transacciones por periodo (densidad) y la moneda. El servicio registra solo tamaños, duración, versión y resultado.

5. **Autenticación del servicio (pregunta 8).** Credencial de servicio aleatoria de 32 bytes en un archivo (`ML_SERVICE_TOKEN_FILE` en el servicio, `FORECASTING_SERVICE_TOKEN_FILE` en el worker), enviada como `Authorization: Bearer` y comparada en tiempo constante (`hmac.compare_digest`). Red Compose `ml-internal` con `internal: true` (sin salida a Internet) compartida solo por el worker y el servicio; la API no la alcanza. *Alternativas:* mTLS (gestión de certificados para un solo cliente) y client credentials de Keycloak (dependencia en el arranque y tokens de corta vida para un salto interno).

6. **Fuentes de datos sin ciclos.** `@pf/forecasting` lee TRANSACTIONS (`NominalFlowQuery`), CLASSIFICATION (`CategoryCatalogQuery`), FX (tasas por fecha para `FlowValuation`), PLANNING (día de inicio del mes financiero y periodos) e IDENTITY (moneda de reporte, zona horaria). **No** lee `@pf/reporting` (docs/15 lo proponía): REPORTING leerá FORECAST en el change 66 y `arch:check` prohíbe el ciclo. El criterio de "gasto" es el de Q3 porque ambos parten de los mismos flujos nominales.

7. **Grano por periodo financiero (pregunta 3).** Los periodos se calculan con el día de inicio del mes financiero vigente del workspace (función pura sobre la fecha local de la zona del workspace), como los reportes por omisión (D363); un cambio del día de inicio recalcula toda la historia en la corrida siguiente. Solo entran periodos **terminados** (pregunta 4, como D391): un periodo cerrado o no cuenta igual; el estado de cierre se informa en la calidad de datos. El primer periodo pronosticado es el **en curso** (pregunta 15).

8. **Preparación de datos (`ReadinessGate`, dominio puro, TDD; pregunta 5).** Por serie: `MODEL` (≥ `FORECASTING_MIN_PERIODS_MODEL` = 6), `SIMPLE` (≥ `FORECASTING_MIN_PERIODS_SIMPLE` = 3) o `INSUFFICIENT` (< 3), con `missingPeriods` hacia cada umbral. Huecos: un periodo sin ninguna transacción del workspace es hueco; > 1 consecutivo trunca todas las series. Densidad: categoría con < 3 transacciones en > 25 % de sus periodos y < 30 en total ⇒ se suma a «Otras categorías» de su grupo. Clasificación: si en > 20 % de los periodos el gasto sin categoría supera el 10 %, las series por categoría y grupo quedan `INSUFFICIENT` con motivo `LOW_CATEGORIZATION`. Las categorías archivadas conservan su historia; las fusiones usan el mapeo de CLASSIFICATION si existe y, si no, la serie empieza en la fusión (docs/15 §4). Todos los umbrales son configuración por entorno.

9. **Moneda (pregunta 6).** Todas las series de este change están en la **moneda de reporte**, con cada flujo convertido con la tasa de su fecha (`FlowValuation`); un flujo sin tasa se excluye y se cuenta (`unvaluedCount` por periodo), nunca 1:1 (RISK-017). Las series por moneda nativa para el flujo de caja son del change 66.

10. **Primer modelo: pronósticos de referencia.** El servicio implementa en este change `NAIVE` (último periodo), `SEASONAL_NAIVE` (mismo periodo del año anterior; ≥ 13 periodos) y `MEAN_LAST_N` (N = 3, 6 o 12 según la historia). Para `MODEL` y `SIMPLE` publica `MEAN_LAST_6` (o la media de los disponibles si son menos) como valor esperado y como referencia; intervalos empíricos del 80 % y 95 % con los cuantiles de los errores fuera de muestra a 1 paso del mismo método (escalados por √h para h > 1) y, con menos de 6 errores, media ± z·desvío marcada `SIMPLE`. Los resultados se cuantizan con `Decimal` y `ROUND_HALF_EVEN` a la escala de la moneda; los negativos se truncan a 0 en el servicio. El change 65 agrega ETS y la selección.

11. **Validación del resultado (`ForecastResultValidator`, dominio puro, TDD).** Por serie: periodos y moneda iguales a los pedidos, decimales en la escala de la moneda, sin `NaN`/`Infinity`, `lower80 ≤ prediction ≤ upper80`, `lower95 ≤ lower80` y `upper80 ≤ upper95`, no negativos, `modelVersion` no vacío. Una serie inválida se descarta (`INVALID_OUTPUT`, métrica) y la corrida sigue; sin series válidas ⇒ `FAILED`. La respuesta se valida además con el JSON Schema compartido.

12. **Corrida (`ForecastRun`, agregado con máquina `FORECAST_RUN_LIFECYCLE`, D37).** Estados `REQUESTED → RUNNING → COMPLETED | INSUFFICIENT_DATA | FAILED`, `RUNNING → REQUESTED` (reintento), `COMPLETED → SUPERSEDED`. Índice único parcial «una activa por workspace». Pasos del ejecutor y sus unidades de trabajo:
    1. UoW 1: reclamar la corrida `REQUESTED` más antigua con `next_attempt_at ≤ now` (`FOR UPDATE SKIP LOCKED`), pasarla a `RUNNING`, registrar la transición.
    2. Lectura (transacción de solo lectura): construir las series por periodo.
    3. Sin conexión: evaluar la preparación, armar la petición, llamar al servicio, validar.
    4. UoW 2: guardar series y puntos, `COMPLETED` (o `INSUFFICIENT_DATA`), reemplazar la vigente, outbox `forecast.ForecastGenerated.v1`, recorrido. Ante un error de transporte: `REQUESTED` con `attempts + 1` y `next_attempt_at` = ahora + 5 min × 3^(intentos − 1) (5, 15, 45, 135 min); al quinto fallo o pasadas 24 h desde la solicitud, `FAILED`.
    Una corrida `RUNNING` sin progreso en 15 min (caída del worker) vuelve a `REQUESTED` en la siguiente pasada del ejecutor.

13. **Trabajos del worker, sin consumidores (pregunta 9).** `forecasting.schedule` (cron `FORECASTING_SCHEDULE_CRON`, por omisión `15 5 * * *` UTC = 01:15 en La Paz; `off` lo apaga): por cada workspace con la función habilitada crea una corrida `SCHEDULED` si su último periodo terminado es posterior al `as_of_period` de la vigente o si la vigente tiene más de `FORECASTING_MAX_AGE_DAYS` (7) días, y como máximo una por día; purga según la retención (rol de mantenimiento). `forecasting.runner` (cron `FORECASTING_RUNNER_CRON`, por omisión `* * * * *`): procesa **una** corrida por pasada. Ambos usan la reserva de trabajos periódicos, sin consultas en paralelo sobre el mismo cliente; la llamada al servicio ocurre sin conexión tomada, así que una corrida de minutos no bloquea a los demás trabajos. **No se consume `planning.MonthClosed`** (docs/05 y docs/11 lo preveían): sumaría un consumidor (D249) y el trabajo diario detecta el periodo nuevo igual. TC-PLATFORM-THROUGHPUT-009 sigue en 28 + 4 = 32 de 34.

14. **Solicitud manual.** `POST W/forecasts` (EDITOR o superior, `Idempotency-Key`, cuota de operaciones costosas) crea la corrida `MANUAL` y la `Operation` `FORECAST` con el mismo id; responde 202 con `Location`. La operación refleja el estado de la corrida (`PENDING` ⇐ `REQUESTED`, `RUNNING`, `SUCCEEDED` ⇐ `COMPLETED`/`INSUFFICIENT_DATA`, `FAILED`). Auditoría `FORECAST_RUN_REQUESTED` en la misma unidad de trabajo (pregunta 13). Las corridas programadas no se auditan (las hace el sistema; quedan en el recorrido).

15. **Persistencia (schema `forecasting`).** Ver «Plan de migración». `forecast_point` es de solo inserción para la app (como `forecasting.forecast_point` en docs/08 §5.17, WS-RO). docs/08 proponía `forecast_metric` y estados `QUEUED/RUNNING/SUCCEEDED/FAILED/STALE`: se reemplazan por los de este diseño (docs/08 se actualiza al implementar); las métricas de backtesting son del change 65.

16. **Retención (pregunta 11).** Se conservan la vigente y, por cada uno de los últimos 24 periodos terminados, la última corrida completada antes del inicio del periodo (la que evaluará el change 67); las demás `SUPERSEDED` se purgan a los 30 días y las `FAILED`/`INSUFFICIENT_DATA` a los 90, en `forecasting.schedule` con el rol de mantenimiento.

17. **Portabilidad (pregunta 12).** Las corridas no viajan en la exportación del workspace (son derivadas y se recalculan); `identity/workspace-portability` no cambia. Un workspace importado empieza sin corridas.

18. **Lectura.** `GET W/forecasts/latest` lee la corrida `COMPLETED` vigente en la transacción de la petición (sin caché): series filtradas por `scope`/`scopeRef`, puntos hasta `horizon` (1, 3, 6 o 12; otro ⇒ `INVALID_FILTER`) y `status`: `AVAILABLE`, `NONE`, `DISABLED`; `stale = true` si `generatedAt` tiene más de 35 días o si la última corrida posterior falló (`lastAttempt {status, at, reason}`). Expone en `@pf/forecasting/contracts` `LatestForecastQuery` para el change 66.

19. **Observabilidad.** Métricas de docs/18: `pf.ml.forecast.duration` (histograma, `outcome`), `pf.ml.forecast.failures.total` (`reason`: `unavailable`, `rejected`, `timeout`, `invalid_output`), `pf.ml.forecast.insufficient_data.total`; alerta `ForecastRunsFailing` con 3 corridas seguidas fallidas. El servicio se instrumenta con OpenTelemetry (FastAPI) y propaga `traceparent` desde el worker; registros JSON sin montos. NFR-OBS-009.

20. **Rendimiento (pregunta 14).** NFR-PERF-012 se mide en el nightly con el conjunto Large (5 años) y el servicio real (`nightly.yml` levanta el perfil `ml` con la imagen construida en la misma corrida): fila `forecast.perf.ts` «corrida completa ≤ 300 s», bloqueante desde el inicio (umbral holgado; como D369). El change 65 vuelve a medir con ETS y backtesting.

21. **Perfil `ml` y despliegue en N1 (ADR-0033).** `compose.yaml`: servicio `ml-forecasting` (imagen `finance-ml`, puerto 8090, publicado solo en `127.0.0.1:${PF_ML_PORT:-28090}`, `read_only`, `tmpfs /tmp`, `cap_drop: [ALL]`, `no-new-privileges`, usuario 10001, healthcheck a `/health/ready`, red `ml-internal`). `compose.prod.yaml`: el mismo servicio en el perfil `ml`, sin puertos, límite `cpus: '1', memory: 320m` (a medir en la tarea 4.8; la estimación con statsmodels cargado es 150–200 MiB en reposo), credencial montada desde `/etc/pfos/ml-service-token` (0400). El host lo habilita con `COMPOSE_PROFILES=ml` y `FORECASTING_ENABLED=true`; deshabilitado no consume memoria. `deploy.yml` y el comando forzado del host aceptan el digest `FINANCE_ML_IMAGE` (opcional). Disparador: con el servicio habilitado, memoria del host > 85 % sostenida ⇒ N2 (ADR-0027).

22. **CI (pregunta 10).** `pr.yml`: job `ml` (filtro de rutas `services/ml-forecasting/**`, `contracts/ml/**`, `contracts/openapi/ml-forecasting.v1.yaml`; con un paso que pasa en verde cuando no hay cambios para poder ser obligatorio): `ruff check`, `ruff format --check`, `mypy --strict`, `pytest` (con hypothesis), verificación de que el OpenAPI que genera FastAPI coincide con `contracts/openapi/ml-forecasting.v1.yaml`, y `osv-scanner` sobre `uv.lock`. Los tests de contrato del lado TypeScript corren en `unit` con los ejemplos de `contracts/ml/examples/`. `main.yml`: build de `finance-ml`, Trivy (mismo criterio que las demás imágenes), SBOM y publicación por digest. Agregar el job `ml` a los checks obligatorios de `main` requiere la confirmación del owner (CLAUDE.md).

23. **Trazabilidad de los tests de Python.** `scripts/traceability` agrega `services` a las raíces y `^test_.*\.py$` a los archivos de test; el TC-id va entre corchetes en el docstring del test (`"""[TC-FORECAST-SERVICE-011] …"""`). Renovate gestiona `pyproject.toml`/`uv.lock` con el gestor `pep621` (agrupado como las demás dependencias).

24. **Interfaz.** Este change no crea la vista `/pronosticos` (change 65); solo deja el contrato y un indicador mínimo en Ajustes → Estado (función habilitada, última corrida y su estado) para el E2E de degradación. i18n es/en/pt.

## Contratos

Cambios requeridos (este change de planificación no edita `contracts/`; se consolidan al implementar, aditivos, oasdiff limpio, Spectral y Redocly sin errores).

**`contracts/openapi/finance-api.v1.yaml` (aditivo):**
- `POST /workspaces/{workspaceId}/forecasts` — `operationId: requestForecastRun`, tag `Forecasting`, `x-openspec-capability: [forecast/expense-forecasting]`, `x-required-role: EDITOR`. Cabecera `Idempotency-Key` requerida; cuerpo vacío u objeto vacío. Respuestas `202` (`Operation` con `kind: FORECAST`, `resource {type: forecast-run, id}`; `Location`, `Retry-After: 30`), `401`, `403` (`INSUFFICIENT_ROLE`), `409` (`FORECAST_RUN_IN_PROGRESS`, `FORECASTING_DISABLED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`), `422` (`IDEMPOTENCY_KEY_REUSED`), `429`, `500`, `503`.
- `GET /workspaces/{workspaceId}/forecasts` — `listForecastRuns`, VIEWER; `cursor`, `limit` (1–50, 20), `status` (opcional, repetible). `200` `ForecastRunPage {items: ForecastRunSummary[], nextCursor}`.
- `GET /workspaces/{workspaceId}/forecasts/{runId}` — `getForecastRun`, VIEWER; `200` `ForecastRun`, `404` `RESOURCE_NOT_FOUND`.
- `GET /workspaces/{workspaceId}/forecasts/latest` — `getLatestForecast`, VIEWER; parámetros `scope` (`TOTAL_EXPENSE|CATEGORY_GROUP|CATEGORY|OTHER_CATEGORIES|TOTAL_INCOME`, repetible, opcional), `scopeRef` (Uuid, opcional, con `CATEGORY`/`CATEGORY_GROUP`/`OTHER_CATEGORIES`), `horizon` (integer, `default: 12`; 1, 3, 6 o 12, otro ⇒ `400 INVALID_FILTER`), `IfNoneMatch`. `200` `LatestForecast` con `ETag`, `304`.
- Schemas:
  - `ForecastRunSummary {id, trigger: MANUAL|SCHEDULED, status: REQUESTED|RUNNING|COMPLETED|INSUFFICIENT_DATA|FAILED|SUPERSEDED, requestedAt, requestedBy: Uuid|null, completedAt|null, asOfPeriod: PeriodLabel, attempts, failureReason: SERVICE_UNAVAILABLE|SERVICE_REJECTED|TIMEOUT|INVALID_OUTPUT|null, seriesCount {published, insufficient, invalid}}` (`status` y `failureReason` como `x-extensible-enum`).
  - `ForecastRun`: `ForecastRunSummary` + `{datasetSnapshotId, serviceVersion, reportingCurrency, series: ForecastSeriesSummary[]}`.
  - `ForecastSeriesSummary {scope, scopeRef: Uuid|null, name, readiness: MODEL|SIMPLE|INSUFFICIENT, readinessReasons[{code: TOO_FEW_PERIODS|LOW_CATEGORIZATION|GAP_TRUNCATED|INVALID_OUTPUT, missingForSimple|null, missingForModel|null}], historyFrom|null, historyTo|null, historyPeriods, groupedCategoryIds: Uuid[]}`.
  - `LatestForecast {status: AVAILABLE|NONE|DISABLED, stale, lastAttempt {status, at, failureReason}|null, run: ForecastRunSummary|null, reportingCurrency, generatedAt|null, series: ForecastSeries[], disclaimerKey}`.
  - `ForecastSeries`: `ForecastSeriesSummary` + `{currency, model {name, version}, points: ForecastPoint[]}`.
  - `ForecastPoint {period: PeriodLabel, periodStart: LocalDate, periodEnd: LocalDate, monthsAhead, prediction: Money, interval80 {lower: Money, upper: Money}, interval95 {lower: Money, upper: Money}, baseline {method: NAIVE|SEASONAL_NAIVE|MEAN_LAST_N, n|null, value: Money}}`.
- `ErrorCode` (`x-extensible-enum`): `FORECAST_RUN_IN_PROGRESS` (409: el workspace ya tiene una corrida solicitada o en curso), `FORECASTING_DISABLED` (409: la función no está habilitada en la instalación). docs/10 §9.1 los agrega al catálogo.

**`contracts/openapi/ml-forecasting.v1.yaml` y `contracts/ml/` (contrato interno, nuevo):**
- `POST /v1/forecasts` (`Authorization: Bearer`, `Content-Type: application/json`, cuerpo ≤ 2 MiB). Request `ForecastRequestV1` (`contracts/ml/forecast-request.v1.schema.json`): `{schemaVersion: "1", requestId (uuid aleatorio por intento), seed (int), policy {modelSet: "baseline-v1", horizonMax: 12, intervalLevels: [0.8, 0.95]}, series: [{ref: "s1", kind: EXPENSE|INCOME, currency, scale, readiness: MODEL|SIMPLE, horizon: 1..12, points: [{period: "YYYY-MM", value: "1448.00", txCount: 37}]}]}`.
- Respuesta `200` `ForecastResponseV1` (`forecast-response.v1.schema.json`): `{schemaVersion: "1", requestId, serviceVersion, results: [{ref, status: OK|ERROR, error|null, model {name, version, selectedBy}, baseline {method, n|null}, points: [{period, monthsAhead, prediction, lower80, upper80, lower95, upper95, baselineValue}]}], durationMs}`. Montos como string decimal en la escala pedida.
- Errores: `400` (cuerpo inválido; `{code: INVALID_REQUEST, detail}` sin montos), `401` (sin credencial o inválida), `413` (cuerpo grande), `503` (ocupado, con `Retry-After`), `504` (corte interno de 240 s). `GET /health/live`, `GET /health/ready` (sin autenticación, solo red interna) y `GET /v1/models` (autenticado: familias, versiones y la del servicio).
- Ejemplos compartidos en `contracts/ml/examples/` (válidos e inválidos) usados por los tests de contrato de Python y TypeScript. Versionado: solo cambios aditivos dentro de `/v1`; un cambio incompatible exige `/v2` y convivencia.

**`contracts/events/forecast/ForecastGenerated.v1.schema.json` (nuevo, envelope v1, productor FORECAST, agregado `ForecastRun`):** `{forecastRunId, trigger, asOfPeriod, generatedAt, reportingCurrency, seriesPublished, seriesInsufficient, modelVersions: string[]}` sin montos. Idempotencia: un evento por corrida (versión del agregado al completar). Sin consumidores en Phase 8 (docs/11).

**Contratos entre módulos:**
- `@pf/forecasting/contracts`: `LatestForecastQuery.getLatest({workspaceId, scopes?, horizon?}) → LatestForecastDto` (para el change 66) y las constantes `FORECAST_SCHEDULE_JOB`, `FORECAST_RUNNER_JOB`, `FORECAST_GENERATED_EVENT`.
- Sin cambios en los contratos de TRANSACTIONS, CLASSIFICATION, FX, PLANNING ni IDENTITY (uso de lo existente). Si `CategoryCatalogQuery` no expone el mapeo de fusiones, la serie de la categoría fusionada empieza en la fusión (sin pedido nuevo).

## Dependencias con otros changes

| # | Necesidad | Estado | Qué hace este change |
|---|---|---|---|
| S1 | `NominalFlowQuery` con filtros y `groupBy` | Implementado (58, 59) | Lo usa sin cambios |
| S2 | `FlowValuation` en el shared-kernel | Implementado (D109) | Lo usa para valorar con la tasa de cada fecha |
| S3 | `stabilize-import-persist-perf` (63, en curso) | Edita `platform/delivery-pipeline` con requirements ADDED de otros nombres y `nightly.yml` | Sin choque de requirements; coordinar la edición de `nightly.yml` (este change agrega la fila `forecast.perf.ts` y el perfil `ml` en el job de rendimiento) y el orden de archivo |
| S4 | `add-expense-forecasts` (65) | Este diseño | Agrega a la misma capability; se archiva después de este |
| S5 | ADR-0033 | Propuesto | Bloquea los grupos 4 (infraestructura del servicio) y 8 (despliegue) |

## Riesgos / Trade-offs

- [Memoria del host N1 con el servicio habilitado] → opt-in por perfil, un proceso, hilos BLAS en 1, límite 320m medido en la tarea 4.8; si la memoria del host supera el 85 % sostenido, N2 (ADR-0027). Deshabilitado no cuesta nada.
- [Segundo runtime y toolchain (RISK-005)] → dependencias mínimas, un solo servicio sin estado, `uv.lock`, Renovate, un job de CI; el núcleo no lo necesita.
- [Pocos datos del owner (RISK-014)] → la preparación lo dice serie por serie; con < 3 periodos no hay pronóstico; el criterio de salida con datos reales queda en manos del owner (pregunta 2).
- [Montos enviados al servicio interno (NFR-COMP-001)] → red interna sin salida, referencias opacas por corrida, sin nombres ni ids, el servicio no guarda ni registra montos.
- [Supply chain Python (NFR-SEC-013)] → lockfile con hashes, `osv-scanner`, Trivy en la imagen, versiones fijadas, sin dependencias nativas fuera de wheels manylinux.
- [Determinismo del cómputo numérico] → semilla fija por corrida, un hilo BLAS, versiones fijadas; los resultados se cuantizan a la escala de la moneda antes de compararse en tests (tolerancia 0 en la escala).
- [Corrida larga con la reserva de trabajos periódicos] → la llamada al servicio ocurre sin conexión; el ejecutor procesa una corrida por pasada; la reserva no crece.
- [Historia editada después de una corrida] → el pronóstico vigente puede quedar desactualizado hasta 7 días (o hasta una solicitud manual); se muestra `generatedAt`.
- [Contrato interno que deriva] → verificación del OpenAPI generado contra el publicado y ejemplos compartidos en ambos lados.

## Plan de migración

Una migración expand `YYYYMMDDHHMMSS_forecasting_schema.sql` (timestamp posterior a la última de `main`):

- `CREATE SCHEMA forecasting`.
- `forecasting.forecast_run (id uuid PK, workspace_id uuid NOT NULL → iam.workspace, trigger text NOT NULL CHECK (trigger IN ('MANUAL','SCHEDULED')), status text NOT NULL CHECK (status IN ('REQUESTED','RUNNING','COMPLETED','INSUFFICIENT_DATA','FAILED','SUPERSEDED')), requested_by uuid NULL, requested_at timestamptz NOT NULL, started_at timestamptz NULL, completed_at timestamptz NULL, as_of_period text NULL, reporting_currency text NOT NULL, attempts smallint NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL, failure_reason text NULL, dataset_snapshot_id text NULL, service_version text NULL, superseded_by uuid NULL, series_published smallint NOT NULL DEFAULT 0, series_insufficient smallint NOT NULL DEFAULT 0, series_invalid smallint NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1)`; `UNIQUE (workspace_id) WHERE status IN ('REQUESTED','RUNNING')`; índices `(workspace_id, completed_at DESC) WHERE status = 'COMPLETED'` y `(status, next_attempt_at) WHERE status = 'REQUESTED'`.
- `forecasting.forecast_series (id uuid PK, workspace_id uuid NOT NULL, run_id uuid NOT NULL → forecast_run ON DELETE CASCADE, opaque_ref text NOT NULL, scope text NOT NULL, scope_ref uuid NULL, currency text NOT NULL, readiness text NOT NULL, readiness_reasons jsonb NOT NULL DEFAULT '[]', history_from text NULL, history_to text NULL, history_periods smallint NOT NULL, grouped_category_ids uuid[] NOT NULL DEFAULT '{}', model_name text NULL, model_version text NULL, baseline_method text NULL, baseline_n smallint NULL, status text NOT NULL CHECK (status IN ('PUBLISHED','INSUFFICIENT','INVALID')))`; `UNIQUE (run_id, scope, scope_ref)` con `NULLS NOT DISTINCT`; `UNIQUE (run_id, opaque_ref)`.
- `forecasting.forecast_point (series_id uuid → forecast_series ON DELETE CASCADE, workspace_id uuid NOT NULL, period text NOT NULL, months_ahead smallint NOT NULL CHECK (months_ahead BETWEEN 1 AND 12), prediction numeric NOT NULL, lower_80 numeric NOT NULL, upper_80 numeric NOT NULL, lower_95 numeric NOT NULL, upper_95 numeric NOT NULL, baseline_value numeric NOT NULL, PRIMARY KEY (series_id, period))`; `CHECK (lower_95 <= lower_80 AND lower_80 <= prediction AND prediction <= upper_80 AND upper_80 <= upper_95 AND lower_95 >= 0)`.
- RLS `ENABLE` + `FORCE` en las tres, políticas fail-closed con `platform.current_workspace_id()` en la forma vigente (D298), grants: `pf_app` SELECT en las tres (y INSERT/UPDATE en `forecast_run` para la solicitud manual); `pf_worker` SELECT/INSERT/UPDATE en `forecast_run` y `forecast_series`, SELECT/INSERT en `forecast_point`; `pf_maintenance` DELETE para la retención. Registro en `platform.workspace_scoped_table`; matriz TC-SECURITY-RLS-007 ampliada.
- Sin backfill. No destructiva; reversible por un contract posterior.

Configuración nueva (`docs/config-reference.md`, `pnpm config:docs:check`): `FORECASTING_ENABLED` (api, worker; `false`), `FORECASTING_SERVICE_URL` (worker; `http://ml-forecasting:8090`), `FORECASTING_SERVICE_TOKEN_FILE` (worker), `FORECASTING_SERVICE_TIMEOUT_MS` (worker; `300000`), `FORECASTING_SCHEDULE_CRON` (worker; `15 5 * * *`, `off`), `FORECASTING_RUNNER_CRON` (worker; `* * * * *`, `off`), `FORECASTING_MAX_AGE_DAYS` (worker; `7`), `FORECASTING_MAX_ATTEMPTS` (worker; `5`), `FORECASTING_HISTORY_MAX_PERIODS` (worker; `60`), `FORECASTING_MIN_PERIODS_MODEL` (worker; `6`), `FORECASTING_MIN_PERIODS_SIMPLE` (worker; `3`), `FORECASTING_STALE_DAYS` (api; `35`). Del servicio: `ML_SERVICE_TOKEN_FILE`, `ML_MAX_BODY_BYTES` (`2097152`), `ML_MAX_SERIES` (`400`), `ML_COMPUTE_DEADLINE_S` (`240`), `ML_LOG_LEVEL`.

Despliegue: sin cambios para quien no habilita el perfil `ml`. Para habilitarlo en N1: generar la credencial (`openssl rand -hex 32` en el host, archivo 0400), definir `COMPOSE_PROFILES=ml`, `FORECASTING_ENABLED=true` y el digest de `finance-ml` en el despliegue (runbook `docs/runbooks/deploy-and-restore.md`).

## Preguntas abiertas

Consolidadas con opciones y recomendación en [docs/65](../../../docs/65-phase-8-consolidation-questions.md): 1 **[B]** (ADR-0033: servicio Python en N1), 2 **[B]** (momento de Phase 8 sin historia real), 3 **[B]** (grano por periodo financiero), 4 **[B]** (periodos terminados o cerrados), 5 (umbrales de preparación), 6 (moneda de las series), 7 (conjunto de datos en la petición y sin guardar), 8 (credencial de servicio), 9 (disparadores sin consumir `planning.MonthClosed`), 10 **[B]** (checks obligatorios nuevos en `main`), 11 (retención), 12 (portabilidad), 13 (quién solicita corridas), 14 (fila nightly de NFR-PERF-012), 15 (periodo en curso como primer pronosticado).

## Cambios a docs compartidos

No se editan en este change de planificación (salvo docs/03, docs/15, docs/24, docs/25, docs/38 y el índice de ADR, ya actualizados en la consolidación); los aplica el implementador (tarea 9.1):

- **docs/01:** notas as-built en FR-FORECAST-001/002/005/006.
- **docs/05 §2.15 y docs/06 §4.3:** FORECAST lee TRANSACTIONS/CLASSIFICATION/FX/PLANNING (no REPORTING); no consume `planning.MonthClosed`; contrato síncrono.
- **docs/07:** contenedor `ml-forecasting` en N1 (opcional, red interna); QAS-11 con el test de degradación.
- **docs/08 §5.17:** tablas de este diseño (reemplazan `forecast_metric` y los estados propuestos).
- **docs/10:** endpoints `forecasts`, `ErrorCode` nuevos.
- **docs/11:** `forecast.ForecastGenerated.v1` sin consumidores; `planning.MonthClosed` sin consumidor FORECAST.
- **docs/12:** threat model del servicio (credencial de archivo, red interna sin salida, referencias opacas).
- **docs/15:** §2–§3 as-built (petición síncrona, sin Object Storage, sin HMAC del workspace), §4 umbrales vigentes, §13 API.
- **docs/18:** métricas y alerta `ForecastRunsFailing`.
- **docs/19 y docs/20:** perfil `ml` as-built y `docker/finance-ml.Dockerfile` real.
- **docs/21, docs/22 y runbook de despliegue:** servicio opcional en N1, credencial y perfil.
- **docs/23:** job `ml` del PR y build de `finance-ml` en `main.yml`.
- **docs/26:** riesgo de memoria del host con el servicio habilitado.
- **docs/config-reference.md:** variables nuevas.
- **docs/17:** matriz con TC-FORECAST-SERVICE-* y TC-PLATFORM-MLSERVICE-*.
- **docs/38:** estado del change.
- **CLAUDE.md:** el presupuesto de conexiones no cambia; agregar que el servicio `ml-forecasting` solo se levanta con el perfil `ml` y `PF_E2E_PROJECT`.
