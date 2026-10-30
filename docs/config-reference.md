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
| `api` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `API_PORT`, `API_BIND_ADDRESS`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `API_PROBLEM_TYPE_BASE`, `IDEMPOTENCY_RETENTION`, `CURSOR_SIGNING_KEY`, `AUDIT_IP_HMAC_KEY`, `RATE_LIMIT_STORE`, `RATE_LIMIT_READS_PER_MIN`, `RATE_LIMIT_WRITES_PER_MIN`, `RATE_LIMIT_COSTLY_PER_MIN`, `OIDC_ISSUER_URL`, `OIDC_JWKS_URI`, `OIDC_API_AUDIENCE`, `OIDC_REQUIRED_SCOPE`, `OIDC_CLOCK_SKEW_SECONDS`, `OIDC_PROFILE`, `OIDC_AUTHORIZED_PARTIES`, `OIDC_JWKS_FALLBACK_MAX_AGE`, `DEMO_DATA_ENABLED`, `ACCOUNTS_INSTITUTION_CATALOG_DIR`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`, `FX_PROVIDER_CRYPTO_PRIMARY`, `FX_PROVIDER_CRYPTO_FALLBACK`, `FX_STALE_AFTER_MARKET`, `FX_STALE_AFTER_MARKET_FALLBACK`, `FX_FEED_STALE_ALERT_AFTER`, `FX_ANOMALY_THRESHOLD_VOLATILE_PCT`, `FX_STABLECOIN_CODES`, `FX_CRYPTO_HISTORY_FROM`, `FX_PROVIDER_INSTITUTION_RATES`, `FX_INSTITUTION_RATES_INTERVAL`, `FX_STALE_AFTER_INSTITUTION`, `REPORTING_RATE_VALIDITY_WINDOW`, `PLANNING_PERIOD_LOOKAHEAD`, `COMMITMENTS_HORIZON_DAYS`, `IMPORT_CSV_MAX_BYTES`, `IMPORT_CSV_MAX_ROWS`, `IMPORT_CSV_MAX_COLUMNS`, `IMPORT_PERSIST_BATCH_SIZE`, `IMPORT_REVIEW_TTL`, `IMPORT_FUTURE_DATE_TOLERANCE_DAYS`, `OBJECT_STORAGE_EXPORTS_BUCKET`, `EXPORT_ENCRYPTION_KEYS`, `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`, `EXPORT_RETENTION`, `REAUTH_MAX_AGE`, `WORKSPACE_IMPORT_MAX_BYTES`, `DOCUMENT_MAX_BYTES`, `DOCUMENT_IMPORT_SOURCE_MAX_BYTES`, `DOCUMENT_WORKSPACE_QUOTA_BYTES`, `DOCUMENT_MAX_PENDING_UPLOADS`, `DOCUMENT_MAX_LINKS_PER_TARGET`, `DOCUMENT_UPLOAD_URL_TTL`, `DOCUMENT_UPLOAD_GRACE`, `DOCUMENT_UNLINKED_RETENTION`, `DOCUMENT_VERIFY_MAX_CONCURRENCY`, `DOCUMENT_INSPECTION_TIMEOUT`, `DOCUMENT_XLSX_MAX_ENTRIES`, `DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES`, `DOCUMENT_ARCHIVE_MAX_RATIO`, `DOCUMENT_JSON_MAX_DEPTH`, `DOCUMENT_ENCRYPTION_KEYS`, `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID`, `DOCUMENT_MALWARE_SCANNER`, `CLAMAV_HOST`, `CLAMAV_PORT`, `DOCUMENT_MALWARE_SCAN_TIMEOUT`, `OBJECT_STORAGE_QUARANTINE_BUCKET`, `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `DOCUMENT_CONTENTS_RESTORE_MAX_BYTES` |
| `worker` | `PFOS_ENV`, `LOG_LEVEL`, `APP_DEFAULT_LOCALE`, `APP_REPORTING_CURRENCY`, `APP_TIMEZONE`, `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_NODE_RESOURCE_DETECTORS`, `WORKER_DATABASE_URL`, `DATABASE_POOL_MAX`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `JOB_QUEUE_DRIVER`, `JOB_QUEUE_POLLING_INTERVAL_SECONDS`, `SESSION_STORE`, `VALKEY_URL`, `WORKER_CONCURRENCY`, `EVENT_CONSUMER_CONCURRENCY`, `EVENT_CONSUMER_BATCH_SIZE`, `EVENT_CONSUMER_GROUP_BATCH_SIZE`, `WORKER_HEALTH_PORT`, `WORKER_HEALTH_BIND_ADDRESS`, `LEDGER_INTEGRITY_CRON`, `LEDGER_INTEGRITY_CRON_TZ`, `PLANNING_PERIOD_LOOKAHEAD`, `PLANNING_CLOSE_PENDING_DELAY_DAYS`, `PLANNING_PERIODS_CRON`, `COMMITMENTS_HORIZON_DAYS`, `COMMITMENTS_SCHEDULER_CRON`, `COMMITMENTS_SUBSCRIPTIONS_CRON`, `DEBT_CARDS_CRON`, `GOALS_DAILY_CRON`, `IMPORT_STAGING_RETENTION`, `IMPORT_MAINTENANCE_CRON`, `REPORTING_RATE_VALIDITY_WINDOW`, `EMAIL_DRIVER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_EMAIL_MAX_ATTEMPTS`, `NOTIFY_RETENTION`, `OBJECT_STORAGE_EXPORTS_BUCKET`, `EXPORT_ENCRYPTION_KEYS`, `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`, `EXPORT_RETENTION`, `DOCUMENT_MAX_BYTES`, `DOCUMENT_IMPORT_SOURCE_MAX_BYTES`, `DOCUMENT_WORKSPACE_QUOTA_BYTES`, `DOCUMENT_MAX_PENDING_UPLOADS`, `DOCUMENT_MAX_LINKS_PER_TARGET`, `DOCUMENT_UPLOAD_URL_TTL`, `DOCUMENT_UPLOAD_GRACE`, `DOCUMENT_UNLINKED_RETENTION`, `DOCUMENT_VERIFY_MAX_CONCURRENCY`, `DOCUMENT_INSPECTION_TIMEOUT`, `DOCUMENT_XLSX_MAX_ENTRIES`, `DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES`, `DOCUMENT_ARCHIVE_MAX_RATIO`, `DOCUMENT_JSON_MAX_DEPTH`, `DOCUMENT_ENCRYPTION_KEYS`, `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID`, `DOCUMENT_MALWARE_SCANNER`, `CLAMAV_HOST`, `CLAMAV_PORT`, `DOCUMENT_MALWARE_SCAN_TIMEOUT`, `OBJECT_STORAGE_QUARANTINE_BUCKET`, `DOCUMENT_MAINTENANCE_CRON`, `DOCUMENT_CONTENTS_RESTORE_MAX_BYTES`, `FX_PROVIDER_PRIMARY`, `FX_PROVIDER_FALLBACK`, `FX_PROVIDER_OFFICIAL`, `FX_POLL_INTERVAL`, `FX_STALE_AFTER_PARALLEL`, `FX_STALE_AFTER_OFFICIAL`, `FX_STALE_AFTER_FALLBACK`, `FX_MANUAL_FALLBACK_MAX_AGE`, `FX_ANOMALY_THRESHOLD_PCT`, `FX_PROVIDER_TIMEOUT`, `FX_BACKFILL_ENABLED`, `FX_PROVIDER_CRYPTO_PRIMARY`, `FX_PROVIDER_CRYPTO_FALLBACK`, `FX_STALE_AFTER_MARKET`, `FX_STALE_AFTER_MARKET_FALLBACK`, `FX_FEED_STALE_ALERT_AFTER`, `FX_ANOMALY_THRESHOLD_VOLATILE_PCT`, `FX_STABLECOIN_CODES`, `FX_CRYPTO_HISTORY_FROM`, `FX_PROVIDER_INSTITUTION_RATES`, `FX_INSTITUTION_RATES_INTERVAL`, `FX_STALE_AFTER_INSTITUTION`, `FX_PROVIDER_PARALELO_BO_URL`, `FX_PROVIDER_DOLARAPI_BO_URL`, `HEALTH_CHECK_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` |
| `migrate` | `PFOS_ENV`, `LOG_LEVEL`, `DATABASE_MIGRATOR_URL`, `DATABASE_URL`, `BFF_DATABASE_URL`, `WORKER_DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_ENSURE_BUCKET`, `OBJECT_STORAGE_CORS_ORIGINS`, `OBJECT_STORAGE_EXPORTS_BUCKET`, `OBJECT_STORAGE_QUARANTINE_BUCKET` |
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
| `ACCOUNTS_INSTITUTION_CATALOG_DIR` | no | — | no | `api` | Directorio con un archivo `<PAÍS>.json` por país del catálogo de referencia de instituciones (dato versionado de la instalación, sin datos de usuarios). Una ruta relativa se resuelve contra el directorio del paquete de la API (`/app` en la imagen). Sin valor: `reference/institutions` (catálogo real; sin archivo, el catálogo del país no está disponible y `GET /institution-catalog` responde 404). El catálogo FICTICIO de pruebas está en `reference/institutions/demo` (solo desarrollo y CI; nunca con `PFOS_ENV=staging\|production`). | `reference/institutions/demo` |

## PostgreSQL

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | **sí** | — | sí | `api`, `migrate`, `seed` | Conexión de la aplicación (rol `pf_app`, sin BYPASSRLS ni DDL). Contiene credenciales. | `postgres://pf_app:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `DATABASE_MIGRATOR_URL` | **sí** | — | sí | `migrate` | Conexión del rol propietario de migraciones (`pf_migrator`). Solo la usa el comando `migrate`. | `postgres://pf_migrator:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos` |
| `WORKER_DATABASE_URL` | si finance-worker (`worker`) | — | sí | `worker`, `migrate` | Conexión del worker (rol `pf_worker`: grants de `pf_app` + relay del outbox, inbox y dead-letter; sin BYPASSRLS ni DDL). `migrate` alinea la contraseña del rol con esta URL. | `postgres://pf_worker:<PF_DEV_DB_WORKER_PASSWORD>@127.0.0.1:25432/pfos` |
| `DATABASE_POOL_MAX` | no | `52` | no | `api`, `worker`, `seed` | Tamaño máximo del pool de conexiones por proceso. En el worker debe cubrir la concurrencia sumada de los consumidores de eventos (`EVENT_CONSUMER_CONCURRENCY`) más 4 conexiones reservadas; las conexiones se abren bajo demanda. | — |

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
| `RATE_LIMIT_COSTLY_PER_MIN` | no | `10` | no | `api` | Operaciones costosas (edición masiva, export/import de workspace, export CSV de auditoría) por minuto por usuario y por workspace; se suma a la cuota de escrituras (docs/10 §10). | — |

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
| `EVENT_CONSUMER_GROUP_BATCH_SIZE` | no | `100` | no | `worker` | Eventos que cada consumidor de entrega agrupada (opt-in, optimize-consumer-throughput) trae por consulta a la cola y aplica en una sola transacción por workspace (1–500). Un consumidor puede fijar el suyo. No agrega conexiones: la concurrencia no cambia. | — |
| `WORKER_HEALTH_PORT` | no | `8082` | no | `worker` | Puerto de los probes `/health/live` y `/health/ready` del worker (8082 en el contenedor, no publicado; 28082 en modo A). | — |
| `WORKER_HEALTH_BIND_ADDRESS` | no | `0.0.0.0` | no | `worker` | Dirección de escucha de los probes del worker. | — |
| `LEDGER_INTEGRITY_CRON` | no | `0 4 * * *` | no | `worker` | Cron (5 campos) del job diario del ledger: verificador de invariantes (`VerifyLedgerIntegrity`) y reconstrucción de snapshots de saldo al día anterior (`RebuildBalanceSnapshots`). `off` lo desactiva. | — |
| `LEDGER_INTEGRITY_CRON_TZ` | no | `UTC` | no | `worker` | Zona horaria IANA en la que se evalúa `LEDGER_INTEGRITY_CRON`. | — |
| `PLANNING_PERIODS_CRON` | no | `5 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `planning.ensure-periods`: activa los periodos `DRAFT` cuya fecha de inicio llegó en la zona horaria de cada workspace, recalcula los `DRAFT` tras un cambio del día de inicio y crea los periodos que falten. También corre al arrancar el worker. `off` desactiva el cron. | — |
| `COMMITMENTS_SUBSCRIPTIONS_CRON` | no | `20 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `commitments.subscription-daily`: pasa a activa la suscripción cuyo trial terminó, ejecuta las cancelaciones programadas vencidas y emite los recordatorios de renovación y de fin de trial (a lo sumo uno por suscripción y fecha). Evalúa con "hoy" en la zona horaria de cada workspace. También corre al arrancar el worker. `off` desactiva el cron. | — |
| `DEBT_CARDS_CRON` | no | `30 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `debt.card-daily` (add-credit-cards): emite una sola vez el estado de cuenta de cada ciclo cerrado de las tarjetas, publica los recordatorios de vencimiento (uno por cuenta y cierre) y es la red de seguridad del monto esperado del plan de pago y de los umbrales de utilización de límites compartidos. Evalúa con "hoy" en la zona horaria de cada workspace. También corre al arrancar el worker. `off` desactiva el cron. | — |
| `GOALS_DAILY_CRON` | no | `40 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `goals.daily-evaluation` (add-savings-goals): reevalúa las metas con fondos en otra moneda (pueden alcanzarse por el tipo de cambio, nunca se reabren por él) y barre la sobre-asignación de las cuentas con reservas como red de seguridad de eventos perdidos. Evalúa con "hoy" en la zona horaria de cada workspace; es idempotente. También corre al arrancar el worker. `off` desactiva el cron. | — |
| `COMMITMENTS_SCHEDULER_CRON` | no | `10 * * * *` | no | `worker` | Cron (5 campos, UTC) del job `commitments.generate-occurrences`: extiende la generación de ocurrencias hasta el horizonte, pasa a `DUE`/`OVERDUE` las que corresponden por fecha y materializa las de modo `AUTO_CREATE` vencidas. También corre al arrancar el worker. `off` desactiva el cron. | — |
| `IMPORT_MAINTENANCE_CRON` | no | `40 3 * * *` | no | `worker` | Cron (5 campos, UTC) de los jobs diarios `imports.expire-reviews` e `imports.purge-staging`. También corren al arrancar el worker. `off` desactiva el cron. | — |

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
| `FX_PROVIDER_CRYPTO_PRIMARY` | no | `none` | no | `api`, `worker` | Provider principal de precios de criptomonedas (`MARKET`, cada cripto frente a USDT): el id de un provider con términos de uso verificados (ADR-0029) o `none` (deshabilitado). Una fuente sin verificación registrada se rechaza: los providers cripto quedan deshabilitados con `FX_PROVIDER_CONFIG_INVALID` y los de tasa paralela siguen funcionando. Por defecto `none` hasta que exista un provider verificado. | — |
| `FX_PROVIDER_CRYPTO_FALLBACK` | no | `none` | no | `api`, `worker` | Provider de respaldo de precios de criptomonedas, de otro operador que el principal (distinto de él): un id verificado o `none`. Por defecto `none`. | — |
| `FX_STALE_AFTER_MARKET` | no | `60m` | no | `api`, `worker` | Antigüedad a partir de la cual una tasa `MARKET` del provider cripto principal se considera obsoleta (`60m`, D228). | — |
| `FX_STALE_AFTER_MARKET_FALLBACK` | no | `60m` | no | `api`, `worker` | Umbral de obsolescencia propio del provider cripto de respaldo para `MARKET` (`60m`, D228). | — |
| `FX_FEED_STALE_ALERT_AFTER` | no | `6h` | no | `api`, `worker` | Horas sin tasa aceptada de ningún provider (`6h`, D233) a partir de las cuales un par configurado con cobertura automática abre un episodio de obsolescencia y avisa al OWNER y a los EDITOR (una vez por episodio; aviso de recuperación al volver la tasa). No puede ser menor que `FX_POLL_INTERVAL` ni que los umbrales de obsolescencia `FX_STALE_AFTER_*` de `PARALLEL` y `MARKET`; un valor inválido deshabilita los providers con `FX_PROVIDER_CONFIG_INVALID`. | — |
| `FX_ANOMALY_THRESHOLD_VOLATILE_PCT` | no | `10` | no | `api`, `worker` | Variación porcentual (decimal > 0) a partir de la cual una muestra de una criptomoneda volátil queda retenida como anómala (`10`, D228); fiat y estables usan `FX_ANOMALY_THRESHOLD_PCT`. | — |
| `FX_STABLECOIN_CODES` | no | `USDT` | no | `api`, `worker` | Códigos de las criptomonedas estables, separados por comas (`USDT`): se tratan como fiat para el umbral de anomalía (`FX_ANOMALY_THRESHOLD_PCT`) y como moneda pivote natural de los pares cripto. | — |
| `FX_CRYPTO_HISTORY_FROM` | no | `2020-01-01` | no | `api`, `worker` | Primer día (`AAAA-MM-DD`, UTC) del histórico de cierres diarios cripto que la instalación pide a los providers (`2020-01-01`, D229): un rango fijo de la instalación, nunca la fecha de un workspace (FR-FX-015). Los workspaces copian de ahí los cierres desde su primera fecha con saldo. | — |
| `FX_PROVIDER_INSTITUTION_RATES` | no | `none` | no | `api`, `worker` | Provider de tasas por institución (`BANK_BUY` / `BANK_SELL`, la compra y la venta que publica cada entidad): el id (`INSTRATE_<NOMBRE>`) de un provider con términos de uso verificados y registrados en un ADR, o `none` (deshabilitado). Una fuente sin verificación registrada se rechaza: el provider queda deshabilitado con `FX_PROVIDER_CONFIG_INVALID`, no envía ninguna solicitud y los providers de tasa paralela, oficial y cripto siguen funcionando. Por defecto `none` hasta que exista una fuente verificada; CI y tests usan `none` (sin red). | — |
| `FX_INSTITUTION_RATES_INTERVAL` | no | `60m` | no | `api`, `worker` | Cada cuánto se consulta el provider de tasas por institución (`60m`; mínimo `60s`): la fuente publica una vez por día hábil. El ciclo de `fx.poll-market-rates` corre con `FX_POLL_INTERVAL`; el provider se consulta en el primer ciclo en que pasó al menos este tiempo desde su último intento (nunca con más frecuencia que el ciclo). | — |
| `FX_STALE_AFTER_INSTITUTION` | no | `72h` | no | `api`, `worker` | Antigüedad a partir de la cual una tasa por institución se considera obsoleta (`72h`, para cubrir los fines de semana). No puede ser menor que `FX_POLL_INTERVAL` ni que `FX_INSTITUTION_RATES_INTERVAL`; un valor inválido deshabilita solo al provider por institución con `FX_PROVIDER_CONFIG_INVALID`. | — |
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

## Commitments

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `COMMITMENTS_HORIZON_DAYS` | no | `90` | no | `api`, `worker` | Horizonte (días, 14–366) hasta el que el motor de recurrencia genera ocurrencias a partir de hoy en la zona horaria del workspace (docs/35 D125). Por entorno, no por workspace; lo leen la API (generación síncrona al crear, revisar o reanudar una definición) y el worker (job `commitments.generate-occurrences`). | — |

## Imports

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `IMPORT_CSV_MAX_BYTES` | no | `2097152` | no | `api` | Tamaño máximo en bytes del CSV que se puede subir para importar (docs/35 D151, 2 MiB): el servidor deja de leer al superarlo y responde 413 `UPLOAD_TOO_LARGE` sin crear la importación. | — |
| `IMPORT_CSV_MAX_ROWS` | no | `5000` | no | `api` | Máximo de filas de datos de un CSV importado (docs/35 D151, 5000): más ⇒ 422 `IMPORT_TOO_MANY_ROWS`. El mapeo y la clasificación son síncronos, así que el tope acota el tiempo hasta la vista previa. | — |
| `IMPORT_CSV_MAX_COLUMNS` | no | `50` | no | `api` | Máximo de columnas de un CSV importado (50): más ⇒ 422 `IMPORT_UNSUPPORTED_FORMAT`. | — |
| `IMPORT_PERSIST_BATCH_SIZE` | no | `200` | no | `api` | Filas por lote de la persistencia de una importación aprobada (200): un lote es una transacción de base de datos con su asiento por fila. Lotes cortos mantienen breves los bloqueos del ledger. | — |
| `IMPORT_REVIEW_TTL` | no | `P30D` | no | `api` | Cuánto espera una importación sin aprobar (esperando mapeo o revisión) antes de expirar (`P30D`): el job diario `imports.expire-reviews` la cancela (actor `SYSTEM`, auditado) y descarta sus celdas crudas. | — |
| `IMPORT_STAGING_RETENTION` | no | `P90D` | no | `worker` | Retención de las celdas crudas del archivo (staging) desde que la importación termina (`P90D`): el job diario `imports.purge-staging` las borra; se conservan la importación, sus conteos y los vínculos de idempotencia por fila. | — |
| `IMPORT_FUTURE_DATE_TOLERANCE_DAYS` | no | `3` | no | `api` | Días de tolerancia hacia el futuro de la fecha de una fila importada, en la zona horaria del workspace (3): una fecha posterior a hoy + tolerancia es inválida (`IMPORT_FUTURE_DATE`). | — |

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

## Documentos adjuntos

| Variable | Obligatoria | Default | Secreto | Procesos | Descripción | Ejemplo (modo A) |
|---|---|---|---|---|---|---|
| `OBJECT_STORAGE_QUARANTINE_BUCKET` | no | `pfos-quarantine` | no | `api`, `worker`, `migrate` | Bucket de CUARENTENA de las subidas directas (sin versioning, sin lectura pública: un DELETE borra el texto plano de verdad). El objeto se verifica y se mueve cifrado al bucket de documentos; ninguno permanece más de 24 h. En local/CI lo crea `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true` (con CORS para la subida). | `pfos-local-quarantine` |
| `OBJECT_STORAGE_PUBLIC_ENDPOINT` | no | — | no | `api` | Endpoint S3 PÚBLICO con el que se firman las URL de subida (el host forma parte de la firma y debe ser alcanzable por el navegador). Sin valor: el mismo `OBJECT_STORAGE_ENDPOINT`. En producción es el hostname `PF_DOMAIN_FILES` de Caddy, limitado a `PUT` firmados sobre el bucket de cuarentena. | `http://127.0.0.1:29000` |
| `DOCUMENT_MAX_BYTES` | no | `15728640` | no | `api`, `worker` | Tamaño máximo de un documento (15 MiB por defecto, D317). Tope duro 26214400 (25 MiB): la configuración no puede superarlo. | — |
| `DOCUMENT_IMPORT_SOURCE_MAX_BYTES` | no | `20971520` | no | `api`, `worker` | Tamaño máximo de un extracto a importar (propósito `IMPORT_SOURCE`, 20 MiB por defecto, docs/13 §11). Tope duro 26214400. | — |
| `DOCUMENT_WORKSPACE_QUOTA_BYTES` | no | `5368709120` | no | `api`, `worker` | Cuota de almacenamiento de documentos por workspace (suma de pendientes, disponibles y archivados; 5 GiB por defecto, D317). | — |
| `DOCUMENT_MAX_PENDING_UPLOADS` | no | `20` | no | `api`, `worker` | Subidas pendientes simultáneas por workspace (20 por defecto). | — |
| `DOCUMENT_MAX_LINKS_PER_TARGET` | no | `20` | no | `api`, `worker` | Adjuntos máximos por elemento (transacción, préstamo, cuenta…; 20 por defecto). | — |
| `DOCUMENT_UPLOAD_URL_TTL` | no | `5m` | no | `api`, `worker` | Vigencia de la URL de subida presignada (5m por defecto; nunca más de 10m). | — |
| `DOCUMENT_UPLOAD_GRACE` | no | `1h` | no | `api`, `worker` | Gracia tras vencer la URL de subida antes de que `ExpirePendingUploads` rechace el documento por subida no completada y libere la reserva de cuota. | — |
| `DOCUMENT_UNLINKED_RETENTION` | no | `30d` | no | `api`, `worker` | Plazo tras el cual se eliminan (actor sistema) los documentos disponibles, sin vínculos y no archivados (30d por defecto, D318). Archivar los conserva. | — |
| `DOCUMENT_VERIFY_MAX_CONCURRENCY` | no | `2` | no | `api`, `worker` | Verificaciones de confirmación simultáneas por proceso de API (2 por defecto): acota la memoria (hasta 25 MiB por archivo). Si está lleno, la confirmación responde 503 con `Retry-After`. | — |
| `DOCUMENT_INSPECTION_TIMEOUT` | no | `10s` | no | `api`, `worker` | Plazo de la inspección de PDF y XLSX en un `worker_thread` con límites de memoria (10s por defecto); vencido ⇒ rechazo `MALFORMED_CONTENT` (falla cerrada). | — |
| `DOCUMENT_XLSX_MAX_ENTRIES` | no | `1000` | no | `api`, `worker` | Entradas máximas del libro XLSX (1000 por defecto). | — |
| `DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES` | no | `104857600` | no | `api`, `worker` | Suma máxima de tamaños descomprimidos de un XLSX (100 MiB por defecto); se aplica sobre el directorio central y sobre el inflado real. | — |
| `DOCUMENT_ARCHIVE_MAX_RATIO` | no | `100` | no | `api`, `worker` | Razón de compresión máxima por entrada de un XLSX (100:1 por defecto). | — |
| `DOCUMENT_JSON_MAX_DEPTH` | no | `64` | no | `api`, `worker` | Profundidad máxima de anidamiento de un JSON subido (64 por defecto). | — |
| `DOCUMENT_ENCRYPTION_KEYS` | si `PFOS_ENV=staging|production` | — | sí | `api`, `worker` | Llavero de CLAVES MAESTRAS que envuelven la clave de datos de cada documento (cifrado de sobre AES-256-GCM): `kid:clave` separadas por coma, con la clave de 32 bytes en base64url (43 caracteres) o hexadecimal (64; `openssl rand -hex 32`). Llavero SEPARADO del de exports (los documentos viven años). La vigente es `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID`; las anteriores permanecen mientras queden documentos envueltos con ellas (el arranque falla nombrando la clave faltante). Perder el llavero implica perder todos los documentos: respáldalo FUERA del host. Nunca en el repositorio. Sin ella los documentos están deshabilitados (503); obligatoria en staging/production. | — |
| `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID` | no | — | no | `api`, `worker` | Identificador (`kid`) de la clave maestra vigente de `DOCUMENT_ENCRYPTION_KEYS` con la que se envuelven los documentos NUEVOS y a la que el mantenimiento diario re-envuelve los existentes. Sin valor: la primera del llavero. | `k1` |
| `DOCUMENT_MALWARE_SCANNER` | no | `none` | no | `api`, `worker` | Escáner antimalware de los documentos: `none` (defecto; apagado en producción por el host de 2 GB, D314: allí rigen la lista de tipos, la inspección estructural y la entrega solo como adjunto) o `clamav` (clamd por TCP; lo enciende la suite del nightly). Con `clamav`, un escáner caído hace fallar la confirmación con 503 (falla cerrada). | — |
| `CLAMAV_HOST` | si `DOCUMENT_MALWARE_SCANNER=clamav` | — | no | `api`, `worker` | Host de clamd (solo con `DOCUMENT_MALWARE_SCANNER=clamav`). | `clamav` |
| `CLAMAV_PORT` | no | `3310` | no | `api`, `worker` | Puerto TCP de clamd. | — |
| `DOCUMENT_MALWARE_SCAN_TIMEOUT` | no | `30s` | no | `api`, `worker` | Plazo del escaneo de un archivo (30s por defecto); vencido ⇒ escáner no disponible (503). | — |
| `DOCUMENT_MAINTENANCE_CRON` | no | `*/10 * * * *` | no | `worker` | Cron del mantenimiento de documentos del worker (cada 10 minutos por defecto): expira subidas no completadas, reintenta verificaciones atascadas, barre la cuarentena (> 24 h) y los objetos huérfanos, purga documentos sin vínculo y re-envuelve claves. `off` lo apaga (solo pruebas). No agrega consumidores ni conexiones (job secuencial). | — |
| `DOCUMENT_CONTENTS_RESTORE_MAX_BYTES` | no | `5368709120` | no | `api`, `worker` | Tamaño máximo del archivo de contenidos de documentos que se restaura sobre un workspace importado (por defecto la cuota de un workspace, 5 GiB; D315). | — |
