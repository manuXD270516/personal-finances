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
| `api` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `API_PORT`, `API_BIND_ADDRESS`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `API_PROBLEM_TYPE_BASE`, `IDEMPOTENCY_RETENTION`, `CURSOR_SIGNING_KEY`, `AUDIT_IP_HMAC_KEY`, `RATE_LIMIT_STORE`, `RATE_LIMIT_READS_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, `OIDC_ISSUER_URL`, `OIDC_JWKS_URI`, `OIDC_API_AUDIENCE`, `OIDC_REQUIRED_SCOPE`, `OIDC_CLOCK_SKEW_SECONDS`, `OIDC_PROFILE`, `OIDC_AUTHORIZED_PARTIES`, `OIDC_JWKS_FALLBACK_MAX_AGE`, `DEMO_DATA_ENABLED`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`, `REPORTING_RATE_VALIDITY_WINDOW`, `PLANNING_PERIOD_LOOKAHEAD`, `OBJECT_STORAGE_EXPORTS_BUCKET`, `EXPORT_ENCRYPTION_KEYS`, `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`, `EXPORT_RETENTION`, `REAUTH_MAX_AGE`, `WORKSPACE_IMPORT_MAX_BYTES` |
| `worker` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `WORKER_DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `WORKER_CONCURRENCY`, `EVENT_CONSUMER_CONCURRENCY`, `EVENT_CONSUMER_BATCH_SIZE`, `WORKER_HEALTH_PORT`, `WORKER_HEALTH_BIND_ADDRESS`, `LEDGER_INTEGRITY_CRON`, `LEDGER_INTEGRITY_CRON_TZ`, `PLANNING_PERIOD_LOOKAHEAD`, `PLANNING_CLOSE_PENDING_DELAY_DAYS`, `PLANNING_PERIODS_CRON`, `REPORTING_RATE_VALIDITY_WINDOW`, `EMAIL_DRIVER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_EMAIL_MAX_ATTEMPTS`, `NOTIFY_RETENTION`, `OBJECT_STORAGE_EXPORTS_BUCKET`, `EXPORT_ENCRYPTION_KEYS`, `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`, `EXPORT_RETENTION`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`, `FX_PROVIDER_PARALELO_BO_URL`, `FX_PROVIDER_DOLARAPI_BO_URL`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` |
| `migrate` | `PFOS_ENV`, `LOG_LEVEL`, `DATABASE_MIGRATOR_URL`, `DATABASE_URL`, `BFF_DATABASE_URL`, `WORKER_DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_ENSURE_BUCKET`, `OBJECT_STORAGE_CORS_ORIGINS`, `OBJECT_STORAGE_EXPORTS_BUCKET` |
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
| `DATABASE_POOL_MAX` | no | `30` | no | `api`, `worker`, `seed` | Tamaño máximo del pool de conexiones por proceso. En el worker debe cubrir la concurrencia sumada de los consumidores de eventos (`EVENT_CONSUMER_CONCURRENCY`) más 4 conexiones reservadas; las conexiones se abren bajo demanda. | — |

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

## Exportación del workspace

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OBJECT_STORAGE_EXPORTS_BUCKET` | no | `pfos-exports` | no | `api`, `worker`, `migrate` | Bucket de los archivos de export cifrados y de los archivos de import en tránsito (sin versioning: al expirar se elimina el objeto de verdad; lifecycle de 8 días como red de seguridad en la IaC). Distinto del bucket de documentos. En local/CI lo crea `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true`. | `pfos-local-exports` |
| `EXPORT_ENCRYPTION_KEYS` | si `PFOS_ENV=staging|production` | — | sí | `api`, `worker` | Llavero de CLAVES MAESTRAS que envuelven la clave de datos de cada archivo de export (cifrado de sobre AES-256-GCM): `kid:clave` separadas por coma, con la clave de 32 bytes en base64url (43 caracteres) o hexadecimal (64; `openssl rand -hex 32`). La vigente es `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`; las anteriores siguen en el llavero hasta que expiren sus exports (rotación). Nunca en el repositorio; en cloud viene del secrets manager o de KMS. Sin ella la exportación e importación están deshabilitadas (503); obligatoria en staging/production. | — |
| `EXPORT_ENCRYPTION_ACTIVE_KEY_ID` | no | — | no | `api`, `worker` | Identificador (`kid`) de la clave maestra vigente de `EXPORT_ENCRYPTION_KEYS` con la que se envuelven los exports NUEVOS. Sin valor: la primera del llavero. | `k1` |
| `EXPORT_RETENTION` | no | `7d` | no | `api`, `worker` | Retención del archivo de export desde que termina (docs/33 D102): pasada, la descarga responde 410 `EXPORT_EXPIRED` y el job horario `identity.export-retention` elimina el objeto del bucket (el registro con fechas, tamaño y suma se conserva). | — |
| `REAUTH_MAX_AGE` | no | `10m` | no | `api` | Antigüedad máxima de la autenticación (claim `auth_time` del access token) para exportar, descargar un export e importar (docs/12 §4): pasada, 403 `REAUTHENTICATION_REQUIRED` y el BFF reinicia el login con `prompt=login`. | — |
| `WORKSPACE_IMPORT_MAX_BYTES` | no | `209715200` | no | `api` | Tamaño máximo en bytes del archivo de export que se puede importar (docs/33 D100, 200 MB): mayor ⇒ 413 `UPLOAD_TOO_LARGE` sin crear nada. | — |

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
| `OIDC_PROFILE` | no | `keycloak` | no | `api` | Perfil del IdP para validar access tokens. `keycloak`: `aud` contiene `OIDC_API_AUDIENCE` y `azp` (si `OIDC_AUTHORIZED_PARTIES` está definida). `cognito`: sin `aud`; exige `token_use=access` y `client_id` en `OIDC_AUTHORIZED_PARTIES`. | — |
| `OIDC_AUTHORIZED_PARTIES` | si `OIDC_PROFILE=cognito` | — | no | `api` | Client ids autorizados, separados por comas (`azp` en Keycloak, `client_id` en Cognito). Sin ella no se restringe el cliente (perfil `keycloak`); obligatoria con `OIDC_PROFILE=cognito`. | `pfos-web` |
| `OIDC_JWKS_FALLBACK_MAX_AGE` | no | `24h` | no | `api` | Antigüedad máxima del último JWKS obtenido con éxito que se sigue usando si el IdP no responde (log `warn` y métrica `pf.auth.jwks_fallback`). Pasado ese plazo los tokens se rechazan con 401. | — |

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
| `EVENT_CONSUMER_CONCURRENCY` | no | `4` | no | `worker` | Eventos de agregados distintos que cada consumidor de eventos procesa en paralelo (el orden por agregado se conserva). Cada consumidor puede fijar la suya. La suma de todos los consumidores más 4 conexiones reservadas no puede exceder `DATABASE_POOL_MAX`: si la excede, el worker no arranca. | — |
| `EVENT_CONSUMER_BATCH_SIZE` | no | `10` | no | `worker` | Eventos que cada consumidor trae por consulta a la cola; cada uno se confirma o falla por separado. Con 1 vuelve al ritmo previo (~2 eventos/s por worker). | — |
| `WORKER_HEALTH_PORT` | no | `8082` | no | `worker` | Puerto de los probes `/health/live` y `/health/ready` del worker (8082 en el contenedor, no publicado; 28082 en modo A). | — |
| `WORKER_HEALTH_BIND_ADDRESS` | no | `0.0.0.0` | no | `worker` | Dirección de escucha de los probes del worker. | — |
| `LEDGER_INTEGRITY_CRON` | no | `0 4 * * *` | no | `worker` | Cron (5 campos) del job diario del ledger: verificador de invariantes (`VerifyLedgerIntegrity`) y reconstrucción de snapshots de saldo al día anterior (`RebuildBalanceSnapshots`). `off` lo desactiva. | — |
| `LEDGER_INTEGRITY_CRON_TZ` | no | `UTC` | no | `worker` | Zona horaria IANA en la que se evalúa `LEDGER_INTEGRITY_CRON`. | — |
| `PLANNING_PERIODS_CRON` | no | `5 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `planning.ensure-periods`: activa los periodos `DRAFT` cuya fecha de inicio llegó en la zona horaria de cada workspace, recalcula los `DRAFT` tras un cambio del día de inicio y crea los periodos que falten. También corre al arrancar el worker. `off` desactiva el cron. | — |

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

## Reporting

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `REPORTING_RATE_VALIDITY_WINDOW` | no | `7d` | no | `api`, `worker` | Ventana de vigencia (días, `1d`–`90d`) de las tasas de valoración y de referencia: una tasa más antigua que el instante valorado menos esta ventana no se usa (el monto queda sin convertir, nunca 1:1). La define Reporting (docs/31 D53) y la composición de la API la entrega a FX, que resuelve con ella la valoración del Home, el equivalente de cuentas y la tasa de referencia de las conversiones; se informa en `meta.rateWindowDays` del resumen. También la lee el worker (add-budgets): el consumidor de umbrales valora el gastado de los presupuestos con la misma ventana que el Home y la API (presupuesto vs real, `meta.rateWindowDays` del plan). | — |

## Planning

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `PLANNING_PERIOD_LOOKAHEAD` | no | `3` | no | `api`, `worker` | Periodos financieros futuros (en `DRAFT`) que la creación automática mantiene después del periodo que contiene hoy en la zona horaria del workspace (mínimo 1, máximo 24; docs/33 D63). Por entorno, no por workspace. | — |
| `PLANNING_CLOSE_PENDING_DELAY_DAYS` | no | `3` | no | `worker` | Días después del fin de un periodo `active` o `reopened` sin cerrar en que se publica una sola vez `planning.MonthClosePending.v1` (zona horaria del workspace; openspec add-month-closing decisión 16). Lo evalúa el job `planning.ensure-periods` del worker. | — |

## Notificaciones

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `EMAIL_DRIVER` | no | — | no | `worker` | Adaptador del canal email de las notificaciones. `smtp` envía por SMTP (Mailpit en local/CI; cualquier relay SMTP después); `none` suprime las entregas por email (`SUPPRESSED`/`CHANNEL_DISABLED`, sin error ni reintentos) y deja solo el in-app. Sin valor: `smtp` en local/ci cuando `SMTP_HOST` está definido (Mailpit) y `none` en cualquier otro caso, en particular en staging/production hasta elegir el proveedor de producción (docs/33 D87). | `smtp` |
| `SMTP_HOST` | si EMAIL_DRIVER=smtp | — | no | `worker` | Servidor SMTP del canal email. En local y CI es Mailpit (`PF_MAILPIT_SMTP_PORT` en el host; `mailpit:1025` dentro de Compose). | `127.0.0.1` |
| `SMTP_PORT` | no | `1025` | no | `worker` | Puerto del servidor SMTP. | — |
| `SMTP_SECURE` | no | `false` | no | `worker` | TLS implícito desde el inicio de la conexión (puerto 465). Con `false` se usa STARTTLS si el servidor lo ofrece. | — |
| `SMTP_USER` | no | — | no | `worker` | Usuario SMTP. Mailpit de desarrollo no autentica. | — |
| `SMTP_PASSWORD` | no | — | sí | `worker` | Contraseña SMTP. Secreto: en cloud viene del secrets manager; nunca se imprime ni se loguea. | — |
| `EMAIL_FROM` | no | `PFOS <notificaciones@pfos.local>` | no | `worker` | Remitente de los emails de notificación. El dominio de esta dirección forma el `Message-ID` determinista de cada entrega (`<deliveryId@dominio>`). | — |
| `APP_PUBLIC_URL` | si EMAIL_DRIVER=smtp | — | no | `worker` | Origen público de la app (el de `WEB_PUBLIC_URL`): base de los enlaces de los emails (`/notificaciones/{id}` y `/preferencias`). Solo ruta e identificador opaco: sin tokens ni datos financieros. | `http://localhost:23000` |
| `NOTIFY_EMAIL_MAX_ATTEMPTS` | no | `5` | no | `worker` | Intentos de envío por entrega de email (backoff exponencial 1 min, 5 min, 25 min, 2 h) antes de marcarla `FAILED` y contar `notifications_email_deliveries_total{status="failed"}`. La notificación in-app no depende del resultado. | — |
| `NOTIFY_RETENTION` | no | `12mo` | no | `worker` | Retención de las notificaciones (todas, archivadas incluidas) y sus entregas, en meses (`12mo`, docs/33 D93). El job diario `notifications.purge` borra las más antiguas. | — |

## OpenTelemetry

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OTEL_ENABLED` | no | `false` | no | `api`, `worker` | Activa el SDK de OpenTelemetry (cargado con `node --import @pf/platform/otel/register`). El resto de `OTEL_*` estándar lo lee el SDK. | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | no | `api`, `worker` | Endpoint OTLP (p. ej. otel-lgtm con el perfil `observability`). | `http://127.0.0.1:24318` |
| `OTEL_NODE_RESOURCE_DETECTORS` | no | `env,os,serviceinstance` | no | `api`, `worker` | Detectores de recurso OTel. Obligatoriamente sin `host`/`process` (PII, SPIKE-10). | — |
