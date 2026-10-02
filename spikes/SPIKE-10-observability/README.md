# SPIKE-10 — Observabilidad local (OpenTelemetry + pino + otel-lgtm)

> Código **descartable**. Evidencia para ADR-0020 (sigue en *Propuesto*). Fecha: 2026-10-01/02. Máquina: Windows 11, Docker Desktop, Node 22.23.1, pnpm 12.4.2.

## Pregunta

¿Puede el stack propuesto en ADR-0020 (OTel SDK para Node + pino JSON + `grafana/otel-lgtm` local) cubrir lo siguiente sin cambios de código entre backends?

1. Un trace que recorre api → worker propagando W3C `traceparent` **dentro de los datos del job** (el patrón outbox/BullMQ).
2. Logs consultables por `trace_id` y `correlation_id`.
3. Métricas RED, un contador de negocio y el gauge de lag del outbox.
4. Redacción de `Authorization` y de datos financieros.
5. Un overhead aceptable y un costo local razonable.

## Setup

| Pieza | Versión | Notas |
|---|---|---|
| `grafana/otel-lgtm` | **0.34.0** (fijada) | Grafana 13.2.2, Tempo 3.0.3, Loki 3.7.8, Prometheus 3.14.0, OTel Collector 0.161.0, Pyroscope 2.3.1 |
| NestJS | **12.1.2** (Express 5.2.1) | **ESM puro** (`"type":"module"`) |
| `@opentelemetry/sdk-node` | 0.222.0 (SDK 2.11.0, API 1.9.1) | exporters OTLP http/protobuf para traces, métricas y logs |
| `@opentelemetry/auto-instrumentations-node` | 0.80.0 | http, undici, pg, pino (fs/dns/net/express/router apagados) |
| `@opentelemetry/instrumentation-pino` | 0.68.0 | inyecta `trace_id`/`span_id` y reenvía cada log como OTel LogRecord |
| pino / nestjs-pino / pino-http | 10.3.1 / 5.2.1 / 11.0.0 | `redact` con `censor: '[REDACTED]'` |
| TypeScript | 7.0.2 | decorators + `emitDecoratorMetadata` compilan bien |
| autocannon | 8.0.0 | |

Puertos de host (solo 127.0.0.1): Grafana **61930**, OTLP gRPC **61917**, OTLP HTTP **61918**, API Nest **61980**, worker **61981**. Proyecto Compose `pf-spike-10`.

```
compose.yaml           otel-lgtm fijado
src/otel.ts            bootstrap del SDK (se carga con --import antes que Nest)
src/logger.ts          opciones pino: redact, mixin correlation_id (AsyncLocalStorage)
src/api/main.ts        Nest: POST /transactions (span manual usecase.RecordTransaction, contador,
                       outbox en memoria + gauges), POST /internal/ack, GET /ping, interceptor http.route
src/worker/main.ts     Node plano: POST /jobs -> 202 y procesa async extrayendo traceparent de job.traceContext
scripts/env.sh         variables OTEL_* (único punto a cambiar para otro backend)
scripts/start.sh       arranca worker + api (MODE=nosdk para desactivar el SDK)
scripts/verify.mjs     verificación programática vía APIs de Grafana (Tempo, Loki, Prometheus)
scripts/bench.mjs      autocannon con y sin SDK
results/               evidencia JSON (verify.json, bench-*.json, outbox-lag.txt)
```

### Flujo

```
curl/autocannon -> finance-api  POST /transactions        [span http server]
                     └ usecase.RecordTransaction           [span manual]
                         ├ log "transaction recorded"      (trace_id, span_id, correlation_id)
                         ├ pf.transactions.recorded +1
                         ├ outbox.set(eventId, now)        -> pf.outbox.lag / pf.outbox.pending
                         └ fetch POST worker/jobs          [span undici] body = { ..., traceContext: {traceparent} }
finance-worker  POST /jobs -> 202 (fuera del request:)
                 context = propagation.extract(job.traceContext)
                 └ job.process transactions.TransactionPosted.v1   [span CONSUMER, hijo del use case]
                     └ fetch POST api/internal/ack -> finance-api POST /internal/ack (outbox.delete)
```

El worker procesa el job en un `setTimeout` con `ROOT_CONTEXT`. Así el span del job cuelga del contexto que viaja **en los datos** y no del request HTTP, tal como pasaría con `job.data` en BullMQ.

## Comandos

```bash
cd spikes/SPIKE-10-observability
pnpm install --ignore-workspace            # protobufjs pide approve-builds; no es necesario
npx tsc -p tsconfig.json
docker compose -p pf-spike-10 up -d --wait
bash scripts/start.sh &                    # api + worker con SDK (MODE=nosdk sin SDK)
node scripts/verify.mjs                    # exit 0 si todos los checks pasan
BENCH_ROUNDS=4 BENCH_DURATION=10 BENCH_OUT=results/bench-saturation.json node scripts/bench.mjs
BENCH_ROUNDS=2 BENCH_DURATION=10 BENCH_RATE=100 BENCH_OUT=results/bench-100rps.json node scripts/bench.mjs
docker compose -p pf-spike-10 down -v
```

Grafana: http://127.0.0.1:61930 (admin/admin). Datasource uids: `tempo`, `loki`, `prometheus`, `pyroscope`.

## Resultados (verificación programática, `results/verify.json`)

Todos los checks de `verify.mjs` pasaron: 12/12 en la última corrida, sobre un backend recién recreado.

| Check | API / query | Resultado |
|---|---|---|
| Trace api→worker | Tempo `GET /api/v2/traces/{traceId}` | **7 spans, 2 servicios.** En `finance-api`: `POST /transactions`, `usecase.RecordTransaction`, `POST` (undici) y `POST /internal/ack`. En `finance-worker`: `POST` (http server /jobs), `job.process transactions.TransactionPosted.v1` y `POST` (undici ack). Visible en Tempo unos 6 s después del request. |
| Búsqueda TraceQL | `{ resource.service.name = "finance-worker" && name =~ "job.process.*" }` | El trace canario aparece en el resultado |
| Logs por trace_id | Loki `{service_name=~"finance-.*"} \| trace_id="<id>"` | **6 líneas de los 2 servicios**: `record transaction requested`, `transaction recorded`, `request completed` ×2 (api) y `job processing`, `job completed` (worker) |
| Logs por correlation_id | `{service_name=~"finance-.*"} \| correlation_id="<x-request-id>"` | 4 líneas (api + worker). El `correlation_id` viaja en el envelope del job. |
| RED HTTP | `sum by (service_name, http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count[5m]))` | Series por ruta plantilla: `/transactions` 201, `/internal/ack` 204, `/ping` 200 y, en la prueba del worker caído, `/transactions` 500 |
| p95 | `histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{service_name="finance-api"}[5m])))` | `/transactions` ≈ 24 ms, `/internal/ack` ≈ 5 ms |
| Contador negocio | `sum by (kind) (pf_transactions_recorded_total)` | expense/income con valores > 0 |
| Gauge outbox | `pf_outbox_lag_seconds`, `pf_outbox_pending` | Normal: 0. **Con el worker detenido: lag 23.5 s y pending 1 a los ~25 s** (`results/outbox-lag.txt`) |
| Job duration | `sum by (outcome) (pf_queue_job_duration_seconds_count)` | `completed` > 0 (desde el worker) |
| Redacción en Loki | Escaneo de las 194–402 streams `finance-*` (body + structured metadata) | 0 apariciones de `CANARY-SECRET-7731` (token Bearer), `CANARY-7731.42` (monto) y `CANARY-DESC-9911` (descripción). `req_headers_authorization="[REDACTED]"` e `input_amount="[REDACTED]"` presentes. |
| Redacción en stdout | grep de `logs/api.log` y `logs/worker.log` | 0 apariciones |

Nombres OTel → Prometheus: `pf.transactions.recorded` → `pf_transactions_recorded_total`; `pf.outbox.lag` (unit `s`) → `pf_outbox_lag_seconds`; `http.server.request.duration` → `http_server_request_duration_seconds_*`. Los nombres con punto del catálogo de docs/18 §5 funcionan tal cual.

### Hallazgos técnicos (importantes para la implementación)

1. **Nest 12 es ESM puro.** El SDK tiene que registrar el hook de `import-in-the-middle` (`module.register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)`) dentro del archivo que se carga con `node --import ./otel.js`. Sin ese hook no se parchea nada de lo que se importa como ESM.
2. **`@opentelemetry/instrumentation-nestjs-core` no soporta Nest 12** (`supportedVersions: ['>=4.0.0 <12']`). Por eso no hay spans de controller/handler de Nest.
3. **Express 5 + `router` auto-instrumentados generan unos 30 spans de middleware por request** (`middleware - jsonParser`, `request handler - {/*splat}`…), que es puro ruido. Los desactivé (`SPIKE_EXPRESS_SPANS=true` los vuelve a encender). Para que el span y la métrica tengan `http.route`, agregué un **interceptor global de Nest** de ~10 líneas que fija `rpcMetadata.route` (`@opentelemetry/core`) y renombra el span a `POST /transactions`. Este interceptor va en `@pf/platform/observability`.
4. **`instrumentation-pino` sirve para correlación y para envío.** Inyecta `trace_id`/`span_id`/`trace_flags` en stdout y manda el log **ya redactado** como LogRecord OTLP. Loki guarda `msg` como body y el resto de los campos pino como *structured metadata*, así que se consulta con `| trace_id="…"` o `| correlation_id="…"`, sin crear labels de alta cardinalidad. No hace falta `pino-opentelemetry-transport`.
5. **Fuga de PII por resource detectors.** Por defecto el SDK agrega `process.owner` (el nombre de usuario de Windows, que aquí es el nombre real del owner), `host.name`, `process.command_args` y rutas locales a **cada** log, métrica y span. Lo apagué con `OTEL_NODE_RESOURCE_DETECTORS=env,os,serviceinstance`, y `verify.mjs` lo comprueba (`piiResourceAttrsPresent: []`). Esto tiene que ser el default del proyecto.
6. `OTEL_SEMCONV_STABILITY_OPT_IN=http` hace que la métrica salga como `http.server.request.duration` (segundos, semconv estable), que es el nombre que usa docs/18 §5.1.
7. `BatchLogRecordProcessor` cambió de firma en sdk-logs 0.222: ahora es `new BatchLogRecordProcessor({ exporter })`.
8. Hacer que pino-http loguee los headers completos del request es demasiado permisivo aunque `authorization` quede redactado (`user-agent`, `remoteAddress` y otros llegan a Loki como metadata). En la implementación conviene un **serializer allow-list** (docs/18 §3.2 punto 2).

## Overhead

Medido con `scripts/bench.mjs`: mismo binario, con y sin `--import ./dist/otel.js`, modos alternados y exportando a otel-lgtm local. En la laptop la varianza entre rondas es alta (±40 % en el modo sin SDK), así que los números son orientativos.

| Escenario | Métrica | Sin SDK | Con SDK | Δ |
|---|---|---|---|---|
| **Saturación** (4 rondas × 10 s; `/ping` 50 conexiones, `POST /transactions` 20 conexiones) | `/ping` req/s | 2706 | 1690 | **−37 %** |
| | `POST /transactions` req/s (api+worker+ack) | 687 | 425 | **−38 %** |
| | p50 `/ping` / `/transactions` | 16 / 29 ms | 29 / 49 ms | |
| **Carga realista** (100 req/s fijos, 2 rondas) | p50 `/ping` / `/transactions` | 5 / 13 ms | 8 / 16 ms | **+3 ms** |
| | p99 `/ping` / `/transactions` | 19 / 55 ms | 34 / 64 ms | +9–15 ms |
| Memoria API (RSS) | idle | 92 MiB | 160 MiB | **+70 MiB** |
| | después de carga | 213–272 MiB | 290–342 MiB | +70–80 MiB |

La capacidad máxima de un endpoint trivial baja de forma notable (~35–40 %), lo esperable cuando todo es overhead y casi no hay trabajo. A la carga de un sistema personal (≪ 100 req/s) el costo es **unos milisegundos por request y unos 70 MiB de RSS por proceso**, aceptable. Con sampling al 10 % en prod el costo de spans baja; el de métricas y logs no.

**otel-lgtm 0.34.0:** imagen de **3.66 GB** en disco. Contenedor creado en 1 s. Prometheus/Tempo/Collector/Loki listos en **2–3 s** y Grafana sano (`/api/health`) a los **12.9 s**. RAM: **408 MiB** recién arrancado y **≈1.1 GiB** después de los benchmarks (~6000 requests con trazas al 100 %), con CPU en reposo de 3–5 %.

## Cambiar de backend solo por variables de entorno

El código emite únicamente OTLP. Para cambiar el destino se tocan las variables `OTEL_*` estándar (`scripts/env.sh`):

| Destino | Variables |
|---|---|
| Local (otel-lgtm) | `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| **AWS CloudWatch/X-Ray vía ADOT** | `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (sidecar ADOT Collector en la task ECS). La ruta a X-Ray (`awsxray`), CloudWatch Metrics (`awsemf`) y Logs (`awscloudwatchlogs`) se define en la **config del collector** con IAM de la task y sin secretos en la app. Alternativa: `OTEL_LOGS_EXPORTER=none` y logs por stdout → awslogs/FireLens (pino ya es JSON con `trace_id`). |
| **Grafana Cloud** | `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zona>.grafana.net/otlp`, `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceId:token)>` (secreto). Lo ideal es pasar por un collector propio para añadir tail sampling y filtrado. |
| Desactivado | `OTEL_SDK_DISABLED=true` (el bootstrap no inicializa nada; pino sigue saliendo a stdout) |
| Sampling prod | `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1` |

Nota: en el spike los exporters se instancian en `otel.ts`, que respeta endpoint, headers y protocolo por env. Si en el producto se quiere elegir también el **tipo** de exporter por env (`OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` = `otlp|console|none`), no hay que pasar `traceExporter`/`metricReaders`/`logRecordProcessors` a `NodeSDK` y hay que dejar que los lea del entorno (sdk-node 0.222 lo soporta).

## Recomendación para el profile `observability`

```yaml
otel-lgtm:
  image: grafana/otel-lgtm:0.34.0          # fijar; actualizar con Renovate
  profiles: [observability]
  ports: ["127.0.0.1:3001:3000", "127.0.0.1:4317:4317", "127.0.0.1:4318:4318"]
  mem_limit: 1536m                          # crece a ~1.1 GiB con uso moderado
  healthcheck: { test: ["CMD-SHELL", "curl -sf http://localhost:3000/api/health"], interval: 5s, retries: 60 }
finance-api / finance-worker:
  command: node --import ./dist/otel.js dist/main.js
  environment:
    OTEL_SDK_DISABLED: ${OTEL_SDK_DISABLED:-true}
    OTEL_SERVICE_NAME: finance-api           # finance-worker
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-lgtm:4318
    OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
    OTEL_RESOURCE_ATTRIBUTES: deployment.environment.name=local,service.version=${GIT_SHA:-dev}
    OTEL_NODE_RESOURCE_DETECTORS: env,os,serviceinstance   # evita process.owner / host.name (PII)
    OTEL_SEMCONV_STABILITY_OPT_IN: http
    OTEL_METRIC_EXPORT_INTERVAL: "10000"
```

- Auto-instrumentaciones habilitadas: http, undici, pg (`enhancedDatabaseReporting:false`), ioredis/bullmq (a validar en la implementación), pino. Deshabilitadas: fs, dns, net, express, router y nestjs-core (esta última no soporta Nest 12).
- Interceptor `http.route` + wrapper de use cases en `@pf/platform/observability`.
- Envelope del outbox con `traceContext` (`propagation.inject`); el worker usa `propagation.extract` y crea un span CONSUMER hijo, o un **link** si el job es tardío (docs/18 §3.3).
- pino: `redact` con las rutas de docs/18 §3.2 más serializer allow-list para req/res; `correlation_id` mediante AsyncLocalStorage en el `mixin`.
- Test canario (`TC-PLATFORM-OBS-001`): adaptar `verify.mjs` usando exporters en memoria para CI.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Ecosistema OTel retrasado respecto de Nest 12 (sin `instrumentation-nestjs-core`) | Interceptor propio. Revisar soporte en cada upgrade. |
| ESM + hooks de carga (`import-in-the-middle`): frágil ante cambios de Node/loader | Fijar versiones `@opentelemetry/*` en un único lugar y mantener un test de humo que verifique que hay spans HTTP |
| PII vía resource detectors (`process.owner`, `host.name`, args) | `OTEL_NODE_RESOURCE_DETECTORS` explícito y test que lo verifique |
| pino-http loguea headers completos | Serializer allow-list; `redact` sigue como red de seguridad |
| Overhead de ~35 % en throughput máximo y +70 MiB RSS | Irrelevante a volumen personal. En prod: sampling 10 %, intervalo de métricas 30–60 s y sin spans de express |
| otel-lgtm pesado (3.7 GB de imagen, ~1 GiB RAM) | Profile opcional, apagado por defecto. No es para producción. |
| Puertos 619xx dentro del rango efímero de Windows (49152–65535): un puerto puede estar ocupado por una conexión saliente al azar | En el stack real usar puertos fuera del rango efímero (3001/4317/4318 de docs/18 ya lo están) |
| Bench con varianza alta en laptop | Repetir en CI o en un host dedicado si el overhead pasa a ser una decisión |

## Impacto en ADRs/docs

- ADR-0020: se agrega la sección "Resultado del spike" (sigue en Propuesto).
- docs/18 §2 / §9.1: añadir `OTEL_NODE_RESOURCE_DETECTORS`, `OTEL_SEMCONV_STABILITY_OPT_IN=http`, la nota ESM/`module.register`, el interceptor `http.route` y la falta de soporte de nestjs-core para Nest 12.
