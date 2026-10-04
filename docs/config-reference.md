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
| `api` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `API_PORT`, `API_BIND_ADDRESS`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `API_PROBLEM_TYPE_BASE`, `IDEMPOTENCY_RETENTION`, `CURSOR_SIGNING_KEY`, `AUDIT_IP_HMAC_KEY`, `RATE_LIMIT_STORE`, `RATE_LIMIT_READS_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, `OIDC_ISSUER_URL`, `OIDC_JWKS_URI`, `OIDC_API_AUDIENCE`, `OIDC_REQUIRED_SCOPE`, `OIDC_CLOCK_SKEW_SECONDS`, `DEMO_DATA_ENABLED`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED` |
| `worker` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `WORKER_DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `WORKER_CONCURRENCY`, `WORKER_HEALTH_PORT`, `WORKER_HEALTH_BIND_ADDRESS`, `LEDGER_INTEGRITY_CRON`, `LEDGER_INTEGRITY_CRON_TZ`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`, `FX_PROVIDER_PARALELO_BO_URL`, `FX_PROVIDER_DOLARAPI_BO_URL`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` |
| `migrate` | `PFOS_ENV`, `LOG_LEVEL`, `DATABASE_MIGRATOR_URL`, `DATABASE_URL`, `BFF_DATABASE_URL`, `WORKER_DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_ENSURE_BUCKET`, `OBJECT_STORAGE_CORS_ORIGINS` |
| `seed` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OIDC_ISSUER_URL`, `DEMO_DATA_ENABLED` |
| `web` | `PFOS_ENV`, `LOG_LEVEL`, `WEB_PUBLIC_URL`, `FINANCE_API_URL`, `OIDC_ISSUER_URL`, `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `BFF_DATABASE_URL`, `BFF_SESSION_ENC_KEY`, `SESSION_IDLE_TIMEOUT`, `SESSION_ABSOLUTE_TIMEOUT` |

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
| `DEMO_DATA_ENABLED` | no | — | no | `api`, `seed` | Habilita la acción "Cargar datos de demostración" (workspace demo dedicado, purgable). Sin valor: `true` con `PFOS_ENV=local\|ci` y `false` con `staging\|production` (decisión del owner D41). La limpieza de workspaces demo existentes sigue disponible aunque esté deshabilitada. | `true` |

## PostgreSQL

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | **sí** | — | sí | `api`, `migrate`, `seed` | Conexión de la aplicación (rol `pf_app`, sin BYPASSRLS ni DDL). Contiene credenciales. | `postgres://pf_app:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `DATABASE_MIGRATOR_URL` | **sí** | — | sí | `migrate` | Conexión del rol propietario de migraciones (`pf_migrator`). Solo la usa el comando `migrate`. | `postgres://pf_migrator:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `WORKER_DATABASE_URL` | si finance-worker (`worker`) | — | sí | `worker`, `migrate` | Conexión del worker (rol `pf_worker`: grants de `pf_app` + relay del outbox, inbox y dead-letter; sin BYPASSRLS ni DDL). `migrate` alinea la contraseña del rol con esta URL. | `postgres://pf_worker:<PF_DEV_DB_WORKER_PASSWORD>@127.0.0.1:25432/pfos` |
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

## Auditoría

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `AUDIT_IP_HMAC_KEY` | si `PFOS_ENV=staging|production` | — | sí | `api` | Claves HMAC-SHA256 con las que se guarda la IP del cliente en `audit.audit_log` (`kid:secreto`, separadas por coma; la primera es la vigente: rotación por `kid`). La IP nunca se persiste en claro. Obligatoria en staging/production; en local/ci, si falta, se genera una efímera. | — |

## Identidad (OIDC)

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OIDC_ISSUER_URL` | si `PFOS_ENV=staging|production` (api) y siempre en finance-web | — | no | `api`, `seed`, `web` | Emisor (`iss`) exacto de los access tokens (realm de Keycloak, URL que ve el navegador). En finance-api, sin ella en local/ci las rutas de identidad no se montan; obligatoria en staging/production y siempre en finance-web (discovery del BFF). | `https://auth.example.test/realms/pfos` |
| `OIDC_JWKS_URI` | no | — | no | `api` | URL del JWKS del emisor (back-channel). Si falta se usa `${OIDC_ISSUER_URL}/protocol/openid-connect/certs`. Caché de 10 min con refetch limitado por `kid` desconocido. | — |
| `OIDC_API_AUDIENCE` | no | `finance-api` | no | `api` | Audiencia (`aud`) exigida en los access tokens de finance-api. | — |
| `OIDC_REQUIRED_SCOPE` | no | `pfos.api` | no | `api` | Scope que todo access token debe incluir. | — |
| `OIDC_CLOCK_SKEW_SECONDS` | no | `30` | no | `api` | Tolerancia de reloj en segundos para `exp`/`nbf`. | — |

## BFF (finance-web)

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `WEB_PUBLIC_URL` | **sí** | — | no | `web` | Origen público de finance-web tal como lo ve el navegador (sin ruta). Se usa para el chequeo `Origin` anti-CSRF, el `redirect_uri` (`<origen>/api/bff/auth/callback`) y el retorno tras el logout. | `http://localhost:23000` |
| `FINANCE_API_URL` | **sí** | — | no | `web` | URL interna de finance-api (back-channel del BFF; `http://finance-api:8080` en Compose). El navegador nunca la usa. | `http://127.0.0.1:28080` |
| `OIDC_DISCOVERY_URL` | no | — | no | `web` | URL base alternativa (back-channel) para el discovery OIDC del BFF cuando el emisor público no es alcanzable desde el contenedor (`http://keycloak:8080/realms/pfos` en Compose). El `issuer` del documento debe coincidir con `OIDC_ISSUER_URL`. Si falta se usa `OIDC_ISSUER_URL`. | — |
| `OIDC_CLIENT_ID` | no | `pfos-web` | no | `web` | Client id confidencial del BFF en el IdP (Authorization Code + PKCE S256). | — |
| `OIDC_CLIENT_SECRET` | **sí** | — | sí | `web` | Secreto del client confidencial del BFF. | — |
| `OIDC_SCOPES` | no | `openid profile email pfos.api` | no | `web` | Scopes pedidos en el login (deben incluir `openid` y el scope de la API). | — |
| `BFF_DATABASE_URL` | si finance-web (`web`) | — | sí | `migrate`, `web` | Conexión del BFF al almacén de sesiones `iam.bff_session` (rol `pf_bff`, grants solo sobre esa tabla). `migrate` alinea la contraseña del rol con esta URL. | `postgres://pf_bff:<PF_DEV_DB_BFF_PASSWORD>@127.0.0.1:25432/pfos` |
| `BFF_SESSION_ENC_KEY` | **sí** | — | sí | `web` | Claves de cifrado de las sesiones del BFF (`kid:secreto`, separadas por coma; la primera cifra, todas descifran: rotación por `kid`; un secreto sin `kid` usa el kid `k0`). De cada secreto se deriva una clave AES-256-GCM con HKDF-SHA256. En cloud viene del secrets manager. | — |
| `SESSION_IDLE_TIMEOUT` | no | `30m` | no | `web` | Expiración de la sesión por inactividad (`30m`, `1h`…). Se desliza como máximo una vez por minuto. | — |
| `SESSION_ABSOLUTE_TIMEOUT` | no | `12h` | no | `web` | Duración máxima de la sesión desde el login, haya o no actividad (`12h`…). | — |

## Worker

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `WORKER_CONCURRENCY` | no | `4` | no | `worker` | Jobs procesados en paralelo por cola en cada proceso worker. | — |
| `WORKER_HEALTH_PORT` | no | `8082` | no | `worker` | Puerto de los probes `/health/live` y `/health/ready` del worker (8082 en el contenedor, no publicado; 28082 en modo A). | — |
| `WORKER_HEALTH_BIND_ADDRESS` | no | `0.0.0.0` | no | `worker` | Dirección de escucha de los probes del worker. | — |
| `LEDGER_INTEGRITY_CRON` | no | `0 4 * * *` | no | `worker` | Cron (5 campos) del job diario del ledger: verificador de invariantes (`VerifyLedgerIntegrity`) y reconstrucción de snapshots de saldo al día anterior (`RebuildBalanceSnapshots`). `off` lo desactiva. | — |
| `LEDGER_INTEGRITY_CRON_TZ` | no | `UTC` | no | `worker` | Zona horaria IANA en la que se evalúa `LEDGER_INTEGRITY_CRON`. | — |

## FX (tasas de mercado)

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `FX_PROVIDER_PRIMARY` | no | `paralelo_bo` | no | `api`, `worker` | Provider principal de la tasa `PARALLEL` USD/BOB y USDT/BOB: `paralelo_bo`, `dolarapi_bo` o `none` (deshabilitado). | — |
| `FX_PROVIDER_FALLBACK` | no | `dolarapi_bo` | no | `api`, `worker` | Provider de respaldo de la tasa `PARALLEL` (distinto del principal): `dolarapi_bo`, `paralelo_bo` o `none`. | — |
| `FX_PROVIDER_OFFICIAL` | no | `dolarapi_bo` | no | `api`, `worker` | Provider de la tasa `OFFICIAL` USD/BOB: `dolarapi_bo` o `none`. | — |
| `FX_POLL_INTERVAL` | no | `15m` | no | `api`, `worker` | Intervalo de consulta de los providers (cron pg-boss del worker): minutos u horas que dividan la hora o el día (`15m`, `30m`, `1h`); mínimo `1m` (60 s). | — |
| `FX_STALE_AFTER_PARALLEL` | no | `60m` | no | `api`, `worker` | Antigüedad a partir de la cual una tasa `PARALLEL` de provider se considera obsoleta (`60m`). | — |
| `FX_STALE_AFTER_OFFICIAL` | no | `48h` | no | `api`, `worker` | Antigüedad a partir de la cual una tasa `OFFICIAL` de provider se considera obsoleta (`48h`). | — |
| `FX_STALE_AFTER_FALLBACK` | no | `180m` | no | `api`, `worker` | Umbral de obsolescencia propio del provider de respaldo de la tasa `PARALLEL` (`180m`): bo.dolarapi.com publica su `fechaActualizacion` con ~2 h de retraso. El principal sigue usando `FX_STALE_AFTER_PARALLEL`. | — |
| `FX_MANUAL_FALLBACK_MAX_AGE` | no | `24h` | no | `api`, `worker` | Antigüedad máxima (`24h`) de una tasa manual de OTRO tipo (p. ej. `P2P`) que la valoración acepta como último recurso cuando no hay tasa vigente de provider (docs/31 D34); además su desvío respecto de la última tasa de provider del par no puede superar `FX_ANOMALY_THRESHOLD_PCT`. | — |
| `FX_ANOMALY_THRESHOLD_PCT` | no | `5` | no | `api`, `worker` | Variación porcentual (decimal > 0) respecto de la tasa aceptada anterior a partir de la cual una muestra queda retenida como anómala hasta que un editor la confirme. | — |
| `FX_PROVIDER_TIMEOUT` | no | `10s` | no | `api`, `worker` | Timeout de cada solicitud a un provider (`10s`; máximo `30s`). | — |
| `FX_BACKFILL_ENABLED` | no | `true` | no | `api`, `worker` | Carga inicial del histórico diario de la tasa paralela al crear un workspace y relleno diario de días faltantes (`true`/`false`). | — |
| `FX_PROVIDER_PARALELO_BO_URL` | no | — | no | `worker` | Solo local/CI: origen alternativo de paralelo.bo para el worker (servidor HTTP local que simula al provider en las pruebas E2E; nunca la red real). Sin definir se usa https://paralelo.bo. Rechazado con PFOS_ENV=staging\|production. | — |
| `FX_PROVIDER_DOLARAPI_BO_URL` | no | — | no | `worker` | Solo local/CI: origen alternativo de bo.dolarapi.com para el worker (servidor HTTP local que simula al provider en las pruebas E2E). Sin definir se usa https://bo.dolarapi.com. Rechazado con PFOS_ENV=staging\|production. | — |

## OpenTelemetry

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OTEL_ENABLED` | no | `false` | no | `api`, `worker` | Activa el SDK de OpenTelemetry (cargado con `node --import @pf/platform/otel/register`). El resto de `OTEL_*` estándar lo lee el SDK. | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | no | `api`, `worker` | Endpoint OTLP (p. ej. otel-lgtm con el perfil `observability`). | `http://127.0.0.1:24318` |
| `OTEL_NODE_RESOURCE_DETECTORS` | no | `env,os,serviceinstance` | no | `api`, `worker` | Detectores de recurso OTel. Obligatoriamente sin `host`/`process` (PII, SPIKE-10). | — |
