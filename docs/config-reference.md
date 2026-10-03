# Referencia de configuración (runtime)

<!-- GENERADO por `pnpm config:docs` desde packages/platform/src/config/variables.ts. NO EDITAR A MANO. -->
<!-- CI ejecuta `pnpm config:docs:check` y falla si este archivo está desactualizado. -->

> Contrato único de configuración (docs/19 §0.3). Cada proceso valida al arrancar SOLO las variables que usa;
> si falta o es inválida alguna, termina con código 78 (`EX_CONFIG`) listando todas las variables con problemas
> (nunca sus valores). Las variables `PF_*` (puertos y plataforma local) las leen solo Compose y `scripts/*.ts`
> y no forman parte de esta referencia. Las `OTEL_*` estándar no listadas aquí las lee directamente el SDK de
> OpenTelemetry.

## Variables por proceso

| Proceso | Variables |
|---|---|
| `api` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `API_PORT`, `API_BIND_ADDRESS`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `API_PROBLEM_TYPE_BASE`, `IDEMPOTENCY_RETENTION`, `CURSOR_SIGNING_KEY`, `RATE_LIMIT_STORE`, `RATE_LIMIT_READS_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN` |
| `worker` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT`, `WORKER_HEALTH_BIND_ADDRESS`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` |
| `migrate` | `PFOS_ENV`, `LOG_LEVEL`, `DATABASE_MIGRATOR_URL`, `DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_ENSURE_BUCKET`, `OBJECT_STORAGE_CORS_ORIGINS` |
| `seed` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `DATABASE_URL`, `DATABASE_POOL_MAX` |
| `web` | `PFOS_ENV`, `LOG_LEVEL` |

## General

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `PFOS_ENV` | **sí** | — | no | `api`, `worker`, `migrate`, `seed`, `web` | Entorno de ejecución. Comportamientos solo de desarrollo (seeds, buckets automáticos) se rechazan en staging/production. | `local` |
| `LOG_LEVEL` | no | `info` | no | `api`, `worker`, `migrate`, `seed`, `web` | Nivel mínimo de log (pino). `info` en producción; `debug` solo en local. | — |

## Producto

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `APP_DEFAULT_LOCALE` | no | `es-BO` | no | `api`, `worker`, `seed` | Locale por defecto del producto (formatos de número/fecha del backend). | — |
| `APP_REPORTING_CURRENCY` | no | `BOB` | no | `api`, `worker`, `seed` | Moneda de reporte por defecto de un workspace nuevo. | — |
| `APP_TIMEZONE` | no | `America/La_Paz` | no | `api`, `worker`, `seed` | Zona horaria IANA por defecto de un workspace nuevo. | — |

## PostgreSQL

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | **sí** | — | sí | `api`, `worker`, `migrate`, `seed` | Conexión de la aplicación (rol `pf_app`, sin BYPASSRLS ni DDL). Contiene credenciales. | `postgres://pf_app:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `DATABASE_MIGRATOR_URL` | **sí** | — | sí | `migrate` | Conexión del rol propietario de migraciones (`pf_migrator`). Solo la usa el comando `migrate`. | `postgres://pf_migrator:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `DATABASE_POOL_MAX` | no | `10` | no | `api`, `worker`, `seed` | Tamaño máximo del pool de conexiones por proceso. | — |

## Object storage

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` | **sí** | — | no | `api`, `worker`, `migrate` | Endpoint S3 interno (SeaweedFS en local, S3 en cloud). | `http://127.0.0.1:29000` |
| `OBJECT_STORAGE_REGION` | no | `us-east-1` | no | `api`, `worker`, `migrate` | Región S3. | — |
| `OBJECT_STORAGE_BUCKET` | **sí** | — | no | `api`, `worker`, `migrate` | Bucket de documentos. La readiness verifica que exista y sea accesible. | `pfos-local-documents` |
| `OBJECT_STORAGE_ACCESS_KEY` | **sí** | — | sí | `api`, `worker`, `migrate` | Access key S3. | — |
| `OBJECT_STORAGE_SECRET_KEY` | **sí** | — | sí | `api`, `worker`, `migrate` | Secret key S3. | — |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | no | `true` | no | `api`, `worker`, `migrate` | Direccionamiento path-style (obligatorio con SeaweedFS). | — |
| `OBJECT_STORAGE_ENSURE_BUCKET` | no | `false` | no | `migrate` | Solo local/CI: `migrate` crea el bucket (idempotente) con CORS y versioning. Rechazado en staging/production (allí lo crea la IaC). | — |
| `OBJECT_STORAGE_CORS_ORIGINS` | no | — | no | `migrate` | Orígenes del navegador permitidos por la regla CORS del bucket (subida directa con URL presignada). Solo lo usa `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true`. | `http://localhost:23000` |

## Cola y sesiones

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `JOB_QUEUE_DRIVER` | no | `pgboss` | no | `api`, `worker` | Adapter de la cola de jobs (ADR-0008). `bullmq` exige Valkey (`VALKEY_URL`). | — |
| `JOB_QUEUE_POLLING_INTERVAL_SECONDS` | no | `0.5` | no | `api`, `worker` | Intervalo de polling de pg-boss (y de su respaldo de LISTEN/NOTIFY). Explícito: los defaults de pg-boss (30 s) atascan la cola (SPIKE-05). | — |
| `SESSION_STORE` | no | `postgres` | no | `api`, `worker` | Almacén de sesiones del BFF. `valkey` exige `VALKEY_URL`. | — |
| `VALKEY_URL` | si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey` | — | sí | `api`, `worker` | Conexión a Valkey/Redis. Solo se usa (y la readiness solo la verifica) si está habilitado. | `redis://127.0.0.1:26379/0` |

## API HTTP

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `API_PORT` | no | `8080` | no | `api` | Puerto en el que escucha finance-api (8080 dentro del contenedor; `PF_API_PORT` en modo A). | — |
| `API_BIND_ADDRESS` | no | `0.0.0.0` | no | `api` | Dirección de escucha de finance-api. | — |
| `HEALTH_CHECK_TIMEOUT_MS` | no | `2000` | no | `api`, `worker` | Tiempo máximo por chequeo de dependencia en `/health/ready`. | — |
| `SHUTDOWN_TIMEOUT_MS` | no | `25000` | no | `api`, `worker` | Tiempo máximo de apagado ordenado tras SIGTERM antes de forzar la salida (menor que `stop_grace_period`). | — |

## Convenciones de API

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `API_PROBLEM_TYPE_BASE` | no | `https://pfos.dev/problems/` | no | `api` | Base del `type` de los errores RFC 9457 (`<base><code-en-kebab>`). Dominio placeholder hasta confirmarlo (docs/10 §18.3). | — |
| `IDEMPOTENCY_RETENTION` | no | `24h` | no | `api` | Retención de las claves `Idempotency-Key` y sus respuestas (mínimo 24h, máximo 7d). Pasada, la clave se trata como nueva. | — |
| `CURSOR_SIGNING_KEY` | si `PFOS_ENV=staging|production` | — | sí | `api` | Claves HMAC de los cursores de paginación (`kid:secreto`, separadas por coma; la primera firma, todas verifican: rotación por `kid`). Obligatoria en staging/production; en local/ci, si falta, se genera una efímera. | — |
| `RATE_LIMIT_STORE` | no | `memory` | no | `api` | Almacén del límite de tasa. `memory` es válido con una réplica de API (Phase 1); `valkey` aún no tiene adapter (falla al arrancar). | — |
| `RATE_LIMIT_READS_PER_MIN` | no | `600` | no | `api` | Lecturas (GET) por minuto por usuario y por workspace (docs/10 §10). | — |
| `RATE_LIMIT_WRITES_PER_MIN` | no | `120` | no | `api` | Escrituras por minuto por usuario y por workspace (docs/10 §10). | — |

## Worker

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `WORKER_CONCURRENCY` | no | `4` | no | `worker` | Jobs procesados en paralelo por cola en cada proceso worker. | — |
| `WORKER_HEALTH_PORT` | no | `8082` | no | `worker` | Puerto de los probes `/health/live` y `/health/ready` del worker (8082 en el contenedor, no publicado; 28082 en modo A). | — |
| `WORKER_HEALTH_BIND_ADDRESS` | no | `0.0.0.0` | no | `worker` | Dirección de escucha de los probes del worker. | — |

## OpenTelemetry

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OTEL_ENABLED` | no | `false` | no | `api`, `worker` | Activa el SDK de OpenTelemetry (cargado con `node --import @pf/platform/otel/register`). El resto de `OTEL_*` estándar lo lee el SDK. | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | no | `api`, `worker` | Endpoint OTLP (p. ej. otel-lgtm con el perfil `observability`). | `http://127.0.0.1:24318` |
| `OTEL_NODE_RESOURCE_DETECTORS` | no | `env,os,serviceinstance` | no | `api`, `worker` | Detectores de recurso OTel. Obligatoriamente sin `host`/`process` (PII, SPIKE-10). | — |
