# ADR-0020: Observabilidad — OpenTelemetry (traces, metrics, logs) + pino JSON; LGTM local, CloudWatch/ADOT o Grafana Cloud en cloud

- Estado: Aceptado (2026-10-02, tras SPIKE-10; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §7, §10; docs/18-observability.md; ADR-0008, ADR-0011, ADR-0012, ADR-0013, ADR-0019; OpenSpec capability `platform/observability`; SPIKE-10

## Contexto y problema

Con un único operador, los incidentes deben diagnosticarse rápido: "¿por qué esta transacción no aparece en el dashboard?" requiere seguir una petición desde el navegador → BFF → API → outbox → worker → proyección. Además, los datos son sensibles: los logs no pueden contener montos detallados con descripciones, tokens ni PII innecesaria. Hay que decidir la instrumentación (vendor-neutral), el formato de logs, las métricas clave y los backends local y cloud.

## Drivers de decisión

- Correlación extremo a extremo (trace ↔ logs ↔ eventos outbox).
- Vendor-neutral (cambiar backend sin reinstrumentar).
- Costo bajo en cloud.
- Simplicidad local (un contenedor).
- Privacidad (redacción de datos sensibles).

## Opciones consideradas

**Instrumentación:** 1. **OpenTelemetry SDK** (elegida) · 2. SDKs propietarios (Datadog, New Relic, Sentry APM) · 3. Solo logs.

**Logs:** **pino** JSON (elegida) vs winston vs logger de Nest por defecto.

**Backend local:** **`grafana/otel-lgtm`** (Loki, Grafana, Tempo, Mimir/Prometheus en un contenedor) vs Jaeger + Prometheus separados vs nada.

**Backend cloud:** A. **CloudWatch + X-Ray vía ADOT** · B. **Grafana Cloud** (free tier) · C. Datadog/New Relic · D. Stack LGTM self-hosted.

## Decisión

- **OpenTelemetry SDK** para Node (Nest y Next.js) y Python (ML): auto-instrumentación HTTP, `pg`, ioredis/BullMQ, AWS SDK; spans manuales en casos de uso relevantes (`txn.record`, `ledger.post`, `outbox.relay`, `import.process`).
- **Propagación W3C Trace Context** navegador/BFF → API; el `traceparent` se guarda en el envelope del evento outbox (`correlationId`/`causationId` + contexto de trace) para **continuar el trace en el worker**.
- **Logs:** pino JSON a stdout con `trace_id`, `span_id`, `correlation_id`, `workspace_id` (no PII), `service`, `env`, `version`; **redacción** obligatoria (paths de pino `redact`) de `authorization`, cookies, tokens, `description`, `notes`, emails. Montos no se loguean salvo en debug local.
- **Métricas** (OTel metrics): RED por endpoint (rate, errors, duration), `outbox_pending_count`, `outbox_lag_seconds`, `queue_jobs_failed_total`, `queue_job_duration`, `ledger_unbalanced_rejections_total`, `rls_denied_total` (si medible), `db_pool_*`, métricas de negocio no sensibles (transacciones registradas/día).
- **Health:** `/health/live` y `/health/ready` (no instrumentados como traces para no generar ruido).
- **Local:** profile Compose `observability` con `grafana/otel-lgtm` (Grafana en 3001, OTLP 4317/4318). Desactivado por defecto; el SDK exporta a OTLP si `OTEL_EXPORTER_OTLP_ENDPOINT` está definido.
- **Cloud:** exportación OTLP a un **collector** (ADOT sidecar o servicio) hacia **CloudWatch Logs/Metrics + X-Ray** (opción por defecto con ECS) **o Grafana Cloud** si su tier gratuito cubre el volumen; la elección se hace por costo en SPIKE-09/10 sin cambiar el código (solo config del collector).
- Sampling: 100% en local/staging; en prod parent-based con ratio configurable + siempre muestrear errores (tail sampling en collector si se usa).
- Alertas mínimas: 5xx rate, p95 latencia, `outbox_lag_seconds`, jobs fallidos, uso de BD/almacenamiento, presupuesto cloud.

## Análisis de opciones

### Instrumentación
- **OpenTelemetry (elegida):** *Pros:* estándar CNCF, vendor-neutral, auto-instrumentación amplia para Node/Python. *Contras:* SDK de Node con configuración no trivial (orden de carga, ESM hooks); logs OTel en Node aún menos maduros que traces → se usa pino + correlación. *Costo:* 0. *Complejidad:* media.
- **SDKs propietarios:** setup rápido y UX excelente, pero lock-in y costo por host/GB que escala. *Complejidad:* baja.
- **Solo logs:** insuficiente para flujos asíncronos api→worker.

### Logs
- **pino:** el más rápido en Node, JSON nativo, redacción integrada, integración `nestjs-pino`. winston más lento; logger de Nest no estructurado por defecto.

### Backend local
- **otel-lgtm:** un contenedor, todo integrado; ideal para dev. Contra: no apto para producción (sin persistencia robusta). Jaeger+Prometheus: más piezas.

### Backend cloud
| Opción | Pros | Contras | Costo | Complejidad |
|---|---|---|---|---|
| CloudWatch + X-Ray (ADOT) | Nativo AWS, IAM, sin cuentas extra, alarmas integradas | UX de consulta inferior; costo por GB de logs ingeridos | Bajo a volumen personal | Media |
| Grafana Cloud | UX Grafana igual que local; tier gratuito generoso | Cuenta externa con telemetría (cuidar PII); límites del free tier | 0 dentro de límites | Baja |
| Datadog/New Relic | UX y APM de primer nivel | Caro por host/GB; lock-in | Medio-alto | Baja |
| LGTM self-hosted | Control total | Operar Loki/Tempo/Mimir = otro sistema | Medio | Alta |

## Consecuencias

**Positivas**
- Un trace sigue el ciclo completo incluyendo el salto asíncrono vía outbox.
- Cambio de backend sin tocar código.
- Paridad visual local (Grafana) con Grafana Cloud si se elige.

**Negativas**
- Overhead de configuración del SDK OTel en Nest/Next (orden de inicialización).
- Costos de ingesta de logs a vigilar.

**Riesgos**
- PII o datos financieros en logs/trazas. *Mitigación:* redacción por defecto, atributos de span en allow-list, test que verifica que un log de request con `Authorization` sale redactado.
- Ruido/costo por sampling al 100%. *Mitigación:* sampling configurable y retención corta (7–14 días) en prod.

## Validación

- **SPIKE-10 (1 d):** OTel en Nest + Next con `otel-lgtm`; una petición `POST /transactions` produce un trace con spans BFF → API → PG → outbox, y el trace continúa en el worker al procesar el evento; los logs en Loki se enlazan por `trace_id`.
- Test automatizado de redacción de logs.
- Métrica: MTTR de incidentes simulados (game day en staging) < 30 min.

## Notas

- Versiones de `@opentelemetry/*`, estado de la instrumentación de BullMQ y de los logs OTel en Node: a verificar en SPIKE-10.
- Límites del free tier de Grafana Cloud y precios de CloudWatch: a verificar en SPIKE-09/10.

## Resultado del spike (SPIKE-10, 2026-10-01)

Evidencia completa en [spikes/SPIKE-10-observability/README.md](../../spikes/SPIKE-10-observability/README.md) (`results/verify.json` y `results/bench-*.json`). Estado: **sigue en Propuesto**; la decisión de aceptarlo es del owner.

Versiones probadas: `grafana/otel-lgtm:0.34.0`, NestJS 12.1.2 (ESM, Express 5), `@opentelemetry/sdk-node` 0.222.0 (SDK 2.11.0), auto-instrumentations-node 0.80.0, `instrumentation-pino` 0.68.0, pino 10.3.1 / nestjs-pino 5.2.1, Node 22.23.1.

**Validado programáticamente vía las APIs de Grafana (Tempo, Loki, Prometheus), 12/12 checks:**
- Un trace con 7 spans de `finance-api` y `finance-worker`. El `traceparent` viaja **en los datos del job** (`propagation.inject`/`extract`) y el worker crea un span CONSUMER hijo de `usecase.RecordTransaction`, que es el mismo patrón que se usará con outbox → BullMQ.
- Logs en Loki consultables por `trace_id` y `correlation_id` (structured metadata, sin labels de alta cardinalidad). `instrumentation-pino` inyecta la correlación y exporta el log **ya redactado**.
- Métricas: `http_server_request_duration_seconds` (RED por `http_route` plantilla), `pf_transactions_recorded_total`, `pf_outbox_lag_seconds` (llegó a 23.5 s con el worker detenido), `pf_outbox_pending` y `pf_queue_job_duration_seconds`.
- Redacción: un token `Authorization` canario, un monto y una descripción no aparecen ni en stdout ni en Loki; en su lugar se ve `[REDACTED]`.

**Ajustes a esta decisión que surgen del spike:**
1. Con Nest 12 (ESM puro), `otel.js` debe llamar a `module.register('@opentelemetry/instrumentation/hook.mjs')` y cargarse con `node --import`.
2. `instrumentation-nestjs-core` **no soporta Nest 12** (`<12`), y express/router generan ~30 spans de ruido por request. Hay que desactivarlos y usar un **interceptor propio** que fije `http.route` (en `@pf/platform/observability`).
3. Hay que fijar **`OTEL_NODE_RESOURCE_DETECTORS=env,os,serviceinstance`**: los detectores por defecto exportan `process.owner` (nombre del usuario), `host.name` y los argumentos del proceso en toda la telemetría, lo que es una fuga de PII.
4. `OTEL_SEMCONV_STABILITY_OPT_IN=http` para emitir `http.server.request.duration` según el catálogo de docs/18.
5. pino-http necesita un serializer allow-list; con `redact` solo, los headers no sensibles salen completos.
6. No hace falta `pino-opentelemetry-transport`: `instrumentation-pino` cubre correlación y envío.

**Costo medido:** −37/−38 % de throughput máximo en endpoints triviales (saturación), +3 ms en p50 y +9–15 ms en p99 a 100 req/s fijos, y unos +70 MiB de RSS por proceso. Es aceptable a volumen personal. otel-lgtm: imagen de 3.66 GB, backends listos en 2–3 s, Grafana sano en ~13 s, 408 MiB de RAM al arrancar y ~1.1 GiB tras la carga (recomendado `mem_limit: 1536m`; profile apagado por defecto).

**Backend intercambiable:** confirmado que el código solo emite OTLP y que endpoint, headers, protocolo, sampler y resource salen de variables `OTEL_*`. ADOT/CloudWatch se configura apuntando al sidecar collector (`http://localhost:4318`) y Grafana Cloud con el endpoint `otlp-gateway` más `OTEL_EXPORTER_OTLP_HEADERS`. Para elegir también el tipo de exporter por env (`OTEL_*_EXPORTER`), no hay que instanciar los exporters en código. **Pendiente:** ADOT y Grafana Cloud reales (requieren cuentas, SPIKE-09), instrumentación de BullMQ/ioredis y Next.js BFF.
