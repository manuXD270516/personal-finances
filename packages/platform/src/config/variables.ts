import { z } from 'zod';

/**
 * Registro ÚNICO de variables de entorno de runtime (docs/19 §0.3).
 *
 * - Cada variable se declara una sola vez: esquema zod + documentación.
 * - Los `default` se expresan como el valor textual que tendría la variable en el entorno, de modo que la
 *   referencia generada (`docs/config-reference.md`) muestre exactamente lo que se escribiría en `.env`.
 * - Las variables `PF_*` (puertos/plataforma local) NO están aquí: las leen solo Compose y `scripts/*.ts`.
 */

export type AppName = 'api' | 'worker' | 'migrate' | 'seed' | 'web';

export interface VariableDoc {
  /** Descripción en español (aparece en docs/config-reference.md). */
  readonly description: string;
  /** Agrupación para la referencia generada. */
  readonly group: string;
  /** Valor por defecto, como texto de variable de entorno. Si existe, la variable no es obligatoria. */
  readonly default?: string;
  /** Variable opcional sin default (o requerida solo bajo condición, ver `requiredWhen`). */
  readonly optional?: boolean;
  /** Condición textual cuando la variable es obligatoria solo en ciertos casos. */
  readonly requiredWhen?: string;
  /** Secreto: nunca se imprime ni se loguea; en cloud viene del secrets manager. */
  readonly secret?: boolean;
  /** Ejemplo para modo A (host). Nunca un secreto real. */
  readonly example?: string;
}

export interface VariableSpec<S extends z.ZodType = z.ZodType> {
  readonly schema: S;
  readonly doc: VariableDoc;
}

const variable = <S extends z.ZodType>(schema: S, doc: VariableDoc): VariableSpec<S> => ({ schema, doc });

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\/.+/, 'debe ser una URL postgres:// o postgresql://');
const httpUrl = z.string().regex(/^https?:\/\/[^\s]+$/, 'debe ser una URL http:// o https://');
const redisUrl = z.string().regex(/^rediss?:\/\/[^\s]+$/, 'debe ser una URL redis:// o rediss://');
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const bool = z.stringbool();
const httpOrigin = z
  .string()
  .regex(/^https?:\/\/[^\s/]+$/, 'debe ser un origen http(s)://host[:puerto] sin ruta');
/** Duración en minutos (`30m`) u horas (`12h`), en milisegundos. */
const duration = z
  .string()
  .regex(/^\d+[mh]$/, 'duración en minutos (`30m`) u horas (`12h`)')
  .transform((v) => Number(v.slice(0, -1)) * (v.endsWith('h') ? 3_600_000 : 60_000))
  .refine((ms) => ms > 0, 'debe ser mayor que cero');

/** Duración en segundos (`30s`), minutos (`5m`), horas (`1h`) o días (`30d`), en milisegundos. */
const shortDuration = z
  .string()
  .regex(/^\d+[smhd]$/, 'duración en segundos (`30s`), minutos (`5m`), horas (`1h`) o días (`30d`)')
  .transform((v) => {
    const unit = v.slice(-1);
    const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return Number(v.slice(0, -1)) * factor;
  })
  .refine((ms) => ms > 0, 'debe ser mayor que cero');
const bucketName = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'nombre de bucket S3 inválido');
const cronOrOff = z
  .string()
  .regex(/^(off|(\S+\s+){4}\S+)$/, 'debe ser una expresión cron de 5 campos (p. ej. `*/10 * * * *`) u `off`');
const keyring = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,32}:([A-Za-z0-9_-]{43}|[0-9a-f]{64})(,[A-Za-z0-9_-]{1,32}:([A-Za-z0-9_-]{43}|[0-9a-f]{64}))*$/,
    'formato kid:clave[,kid:clave…] con claves de 32 bytes en base64url (43 caracteres) o hexadecimal (64)',
  );

/** Detectores de recurso OTel que filtran PII (usuario de SO, hostname, argumentos) — SPIKE-10 hallazgo 5. */
const FORBIDDEN_RESOURCE_DETECTORS = ['all', 'host', 'process'];

export const VARIABLES = {
  // ── General ──
  PFOS_ENV: variable(z.enum(['local', 'ci', 'staging', 'production']), {
    group: 'General',
    description:
      'Entorno de ejecución. Comportamientos solo de desarrollo (seeds, buckets automáticos) se rechazan en staging/production.',
    example: 'local',
  }),
  LOG_LEVEL: variable(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']), {
    group: 'General',
    description: 'Nivel mínimo de log (pino). `info` en producción; `debug` solo en local.',
    default: 'info',
  }),
  APP_DEFAULT_LOCALE: variable(
    z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'debe ser un locale BCP 47 (p. ej. es-BO)'),
    {
      group: 'Producto',
      description: 'Locale por defecto del producto (formatos de número/fecha del backend).',
      default: 'es-BO',
    },
  ),
  APP_REPORTING_CURRENCY: variable(
    z.string().regex(/^[A-Z]{3,5}$/, 'debe ser un código de moneda (p. ej. BOB)'),
    {
      group: 'Producto',
      description: 'Moneda de reporte por defecto de un workspace nuevo.',
      default: 'BOB',
    },
  ),
  APP_TIMEZONE: variable(z.string().min(1), {
    group: 'Producto',
    description: 'Zona horaria IANA por defecto de un workspace nuevo.',
    default: 'America/La_Paz',
  }),

  // ── PostgreSQL ──
  DATABASE_URL: variable(postgresUrl, {
    group: 'PostgreSQL',
    description: 'Conexión de la aplicación (rol `pf_app`, sin BYPASSRLS ni DDL). Contiene credenciales.',
    secret: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'postgres://pf_app:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos',
  }),
  DATABASE_MIGRATOR_URL: variable(postgresUrl, {
    group: 'PostgreSQL',
    description:
      'Conexión del rol propietario de migraciones (`pf_migrator`). Solo la usa el comando `migrate`.',
    secret: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'postgres://pf_migrator:<PF_DEV_DB_PASSWORD>@127.0.0.1:25432/pfos',
  }),
  WORKER_DATABASE_URL: variable(postgresUrl, {
    group: 'PostgreSQL',
    description:
      'Conexión del worker (rol `pf_worker`: grants de `pf_app` + relay del outbox, inbox y dead-letter; sin BYPASSRLS ni DDL). `migrate` alinea la contraseña del rol con esta URL.',
    optional: true,
    requiredWhen: 'finance-worker (`worker`)',
    secret: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'postgres://pf_worker:<PF_DEV_DB_WORKER_PASSWORD>@127.0.0.1:25432/pfos',
  }),
  DATABASE_POOL_MAX: variable(positiveInt, {
    group: 'PostgreSQL',
    description:
      'Tamaño máximo del pool de conexiones por proceso. En el worker debe cubrir la concurrencia sumada de los consumidores de eventos (`EVENT_CONSUMER_CONCURRENCY`) más 4 conexiones reservadas; las conexiones se abren bajo demanda.',
    default: '52',
  }),

  // ── Object storage (API S3) ──
  OBJECT_STORAGE_ENDPOINT: variable(httpUrl, {
    group: 'Object storage',
    description: 'Endpoint S3 interno (SeaweedFS en local, S3 en cloud).',
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://127.0.0.1:29000',
  }),
  OBJECT_STORAGE_REGION: variable(z.string().min(1), {
    group: 'Object storage',
    description: 'Región S3.',
    default: 'us-east-1',
  }),
  OBJECT_STORAGE_BUCKET: variable(
    z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'nombre de bucket S3 inválido'),
    {
      group: 'Object storage',
      description: 'Bucket de documentos. La readiness verifica que exista y sea accesible.',
      example: 'pfos-local-documents',
    },
  ),
  OBJECT_STORAGE_ACCESS_KEY: variable(z.string().min(1), {
    group: 'Object storage',
    description: 'Access key S3.',
    secret: true,
  }),
  OBJECT_STORAGE_SECRET_KEY: variable(z.string().min(1), {
    group: 'Object storage',
    description: 'Secret key S3.',
    secret: true,
  }),
  OBJECT_STORAGE_FORCE_PATH_STYLE: variable(bool, {
    group: 'Object storage',
    description: 'Direccionamiento path-style (obligatorio con SeaweedFS).',
    default: 'true',
  }),
  OBJECT_STORAGE_ENSURE_BUCKET: variable(bool, {
    group: 'Object storage',
    description:
      'Solo local/CI: `migrate` crea el bucket (idempotente) con CORS y versioning. Rechazado en staging/production (allí lo crea la IaC).',
    default: 'false',
  }),
  OBJECT_STORAGE_CORS_ORIGINS: variable(
    z
      .string()
      .min(1)
      .refine(
        (v) => v.split(',').every((o) => /^https?:\/\/[^\s/]+$/.test(o.trim())),
        'lista separada por comas de orígenes http(s)://host[:puerto] sin ruta',
      ),
    {
      group: 'Object storage',
      description:
        'Orígenes del navegador permitidos por la regla CORS del bucket (subida directa con URL presignada). Solo lo usa `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true`.',
      optional: true,
      // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
      example: 'http://localhost:23000',
    },
  ),

  // ── Exportación / importación del workspace (openspec add-workspace-export, docs/33 D98–D102) ──
  OBJECT_STORAGE_EXPORTS_BUCKET: variable(
    z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'nombre de bucket S3 inválido'),
    {
      group: 'Exportación del workspace',
      description:
        'Bucket de los archivos de export cifrados y de los archivos de import en tránsito (sin versioning: al expirar se elimina el objeto de verdad; lifecycle de 8 días como red de seguridad en la IaC). Distinto del bucket de documentos. En local/CI lo crea `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true`.',
      default: 'pfos-exports',
      example: 'pfos-local-exports',
    },
  ),
  EXPORT_ENCRYPTION_KEYS: variable(
    z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,32}:([A-Za-z0-9_-]{43}|[0-9a-f]{64})(,[A-Za-z0-9_-]{1,32}:([A-Za-z0-9_-]{43}|[0-9a-f]{64}))*$/,
        'formato kid:clave[,kid:clave…] con claves de 32 bytes en base64url (43 caracteres) o hexadecimal (64)',
      ),
    {
      group: 'Exportación del workspace',
      description:
        'Llavero de CLAVES MAESTRAS que envuelven la clave de datos de cada archivo de export (cifrado de sobre AES-256-GCM): `kid:clave` separadas por coma, con la clave de 32 bytes en base64url (43 caracteres) o hexadecimal (64; `openssl rand -hex 32`). La vigente es `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`; las anteriores siguen en el llavero hasta que expiren sus exports (rotación). Nunca en el repositorio; en cloud viene del secrets manager o de KMS. Sin ella la exportación e importación están deshabilitadas (503); obligatoria en staging/production.',
      optional: true,
      requiredWhen: '`PFOS_ENV=staging|production`',
      secret: true,
    },
  ),
  EXPORT_ENCRYPTION_ACTIVE_KEY_ID: variable(
    z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'identificador de clave inválido'),
    {
      group: 'Exportación del workspace',
      description:
        'Identificador (`kid`) de la clave maestra vigente de `EXPORT_ENCRYPTION_KEYS` con la que se envuelven los exports NUEVOS. Sin valor: la primera del llavero.',
      optional: true,
      example: 'k1',
    },
  ),
  EXPORT_RETENTION: variable(
    z
      .string()
      .regex(/^\d+[hd]$/, 'duración en horas (`24h`) o días (`7d`)')
      .transform((v) => Number(v.slice(0, -1)) * (v.endsWith('d') ? 24 : 1) * 3_600_000)
      .refine((ms) => ms >= 3_600_000 && ms <= 30 * 24 * 3_600_000, 'entre 1h y 30d'),
    {
      group: 'Exportación del workspace',
      description:
        'Retención del archivo de export desde que termina (docs/33 D102): pasada, la descarga responde 410 `EXPORT_EXPIRED` y el job horario `identity.export-retention` elimina el objeto del bucket (el registro con fechas, tamaño y suma se conserva).',
      default: '7d',
    },
  ),
  REAUTH_MAX_AGE: variable(duration, {
    group: 'Exportación del workspace',
    description:
      'Antigüedad máxima de la autenticación (claim `auth_time` del access token) para exportar, descargar un export e importar (docs/12 §4): pasada, 403 `REAUTHENTICATION_REQUIRED` y el BFF reinicia el login con `prompt=login`.',
    default: '10m',
  }),
  WORKSPACE_IMPORT_MAX_BYTES: variable(positiveInt, {
    group: 'Exportación del workspace',
    description:
      'Tamaño máximo en bytes del archivo de export que se puede importar (docs/33 D100, 200 MB): mayor ⇒ 413 `UPLOAD_TOO_LARGE` sin crear nada.',
    default: '209715200',
  }),

  // ── Cola y sesiones ──
  JOB_QUEUE_DRIVER: variable(z.enum(['pgboss', 'bullmq']), {
    group: 'Cola y sesiones',
    description: 'Adapter de la cola de jobs (ADR-0008). `bullmq` exige Valkey (`VALKEY_URL`).',
    default: 'pgboss',
  }),
  JOB_QUEUE_POLLING_INTERVAL_SECONDS: variable(z.coerce.number().min(0.5).max(30), {
    group: 'Cola y sesiones',
    description:
      'Intervalo de polling de pg-boss (y de su respaldo de LISTEN/NOTIFY). Explícito: los defaults de pg-boss (30 s) atascan la cola (SPIKE-05).',
    default: '0.5',
  }),
  SESSION_STORE: variable(z.enum(['postgres', 'valkey']), {
    group: 'Cola y sesiones',
    description: 'Almacén de sesiones del BFF. `valkey` exige `VALKEY_URL`.',
    default: 'postgres',
  }),
  VALKEY_URL: variable(redisUrl, {
    group: 'Cola y sesiones',
    description: 'Conexión a Valkey/Redis. Solo se usa (y la readiness solo la verifica) si está habilitado.',
    optional: true,
    requiredWhen: '`JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`',
    secret: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'redis://127.0.0.1:26379/0',
  }),

  // ── API HTTP ──
  API_PORT: variable(port, {
    group: 'API HTTP',
    description:
      'Puerto en el que escucha finance-api (8080 dentro del contenedor; `PF_API_PORT` en modo A).',
    default: '8080',
  }),
  API_BIND_ADDRESS: variable(z.string().min(1), {
    group: 'API HTTP',
    description: 'Dirección de escucha de finance-api.',
    default: '0.0.0.0',
  }),
  HEALTH_CHECK_TIMEOUT_MS: variable(positiveInt, {
    group: 'API HTTP',
    description: 'Tiempo máximo por chequeo de dependencia en `/health/ready`.',
    default: '2000',
  }),
  SHUTDOWN_TIMEOUT_MS: variable(positiveInt, {
    group: 'API HTTP',
    description:
      'Tiempo máximo de apagado ordenado tras SIGTERM antes de forzar la salida (menor que `stop_grace_period`).',
    default: '25000',
  }),

  // ── Convenciones de API (add-api-conventions) ──
  API_PROBLEM_TYPE_BASE: variable(
    z.string().regex(/^https:\/\/[^\s?#]+\/$/, 'debe ser una URL https:// terminada en /'),
    {
      group: 'Convenciones de API',
      description:
        'Base del `type` de los errores RFC 9457 (`<base><code-en-kebab>`). Dominio placeholder hasta confirmarlo (docs/10 §18.3).',
      default: 'https://pfos.dev/problems/',
    },
  ),
  IDEMPOTENCY_RETENTION: variable(
    z
      .string()
      .regex(/^\d+[hd]$/, 'duración en horas (`24h`) o días (`7d`)')
      .transform((v) => Number(v.slice(0, -1)) * (v.endsWith('d') ? 24 : 1) * 3_600_000)
      .refine((ms) => ms >= 24 * 3_600_000 && ms <= 7 * 24 * 3_600_000, 'entre 24h y 7d'),
    {
      group: 'Convenciones de API',
      description:
        'Retención de las claves `Idempotency-Key` y sus respuestas (mínimo 24h, máximo 7d). Pasada, la clave se trata como nueva.',
      default: '24h',
    },
  ),
  CURSOR_SIGNING_KEY: variable(
    z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,32}:[^,\s]{32,}(,[A-Za-z0-9_-]{1,32}:[^,\s]{32,})*$/,
        'formato kid:secreto[,kid:secreto…] con secretos de ≥ 32 caracteres',
      ),
    {
      group: 'Convenciones de API',
      description:
        'Claves HMAC de los cursores de paginación (`kid:secreto`, separadas por coma; la primera firma, todas verifican: rotación por `kid`). Obligatoria en staging/production; en local/ci, si falta, se genera una efímera.',
      optional: true,
      requiredWhen: '`PFOS_ENV=staging|production`',
      secret: true,
    },
  ),
  // ── Auditoría (openspec add-audit-trail) ──
  AUDIT_IP_HMAC_KEY: variable(
    z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{1,32}:[^,\s]{32,}(,[A-Za-z0-9_-]{1,32}:[^,\s]{32,})*$/,
        'formato kid:secreto[,kid:secreto…] con secretos de ≥ 32 caracteres',
      ),
    {
      group: 'Auditoría',
      description:
        'Claves HMAC-SHA256 con las que se guarda la IP del cliente en `audit.audit_log` (`kid:secreto`, separadas por coma; la primera es la vigente: rotación por `kid`). La IP nunca se persiste en claro. Obligatoria en staging/production; en local/ci, si falta, se genera una efímera.',
      optional: true,
      requiredWhen: '`PFOS_ENV=staging|production`',
      secret: true,
    },
  ),
  // ── Identidad (OIDC, finance-api como resource server) ──
  OIDC_ISSUER_URL: variable(httpUrl, {
    group: 'Identidad (OIDC)',
    description:
      'Emisor (`iss`) exacto de los access tokens (realm de Keycloak, URL que ve el navegador). En finance-api, sin ella en local/ci las rutas de identidad no se montan; obligatoria en staging/production y siempre en finance-web (discovery del BFF).',
    optional: true,
    requiredWhen: '`PFOS_ENV=staging|production` (api) y siempre en finance-web',
    example: 'https://auth.example.test/realms/pfos',
  }),
  OIDC_JWKS_URI: variable(httpUrl, {
    group: 'Identidad (OIDC)',
    description:
      'URL del JWKS del emisor (back-channel). Si falta se usa `${OIDC_ISSUER_URL}/protocol/openid-connect/certs`. Caché de 10 min con refetch limitado por `kid` desconocido.',
    optional: true,
  }),
  OIDC_API_AUDIENCE: variable(z.string().min(1), {
    group: 'Identidad (OIDC)',
    description: 'Audiencia (`aud`) exigida en los access tokens de finance-api.',
    default: 'finance-api',
  }),
  OIDC_REQUIRED_SCOPE: variable(z.string().min(1), {
    group: 'Identidad (OIDC)',
    description: 'Scope que todo access token debe incluir.',
    default: 'pfos.api',
  }),
  OIDC_CLOCK_SKEW_SECONDS: variable(z.coerce.number().int().min(0).max(120), {
    group: 'Identidad (OIDC)',
    description: 'Tolerancia de reloj en segundos para `exp`/`nbf`.',
    default: '30',
  }),
  OIDC_PROFILE: variable(z.enum(['keycloak', 'cognito']), {
    group: 'Identidad (OIDC)',
    description:
      'Perfil del IdP para validar access tokens. `keycloak`: `aud` contiene `OIDC_API_AUDIENCE` y `azp` (si `OIDC_AUTHORIZED_PARTIES` está definida). `cognito`: sin `aud`; exige `token_use=access` y `client_id` en `OIDC_AUTHORIZED_PARTIES`.',
    default: 'keycloak',
  }),
  OIDC_AUTHORIZED_PARTIES: variable(
    z
      .string()
      .min(1)
      .refine(
        (v) => v.split(',').every((c) => c.trim().length > 0),
        'lista separada por comas de client ids',
      ),
    {
      group: 'Identidad (OIDC)',
      description:
        'Client ids autorizados, separados por comas (`azp` en Keycloak, `client_id` en Cognito). Sin ella no se restringe el cliente (perfil `keycloak`); obligatoria con `OIDC_PROFILE=cognito`.',
      optional: true,
      requiredWhen: '`OIDC_PROFILE=cognito`',
      example: 'pfos-web',
    },
  ),
  OIDC_JWKS_FALLBACK_MAX_AGE: variable(duration, {
    group: 'Identidad (OIDC)',
    description:
      'Antigüedad máxima del último JWKS obtenido con éxito que se sigue usando si el IdP no responde (log `warn` y métrica `pf.auth.jwks_fallback`). Pasado ese plazo los tokens se rechazan con 401.',
    default: '24h',
  }),
  // ── BFF (finance-web): login OIDC, sesiones y proxy hacia finance-api (ADR-0010 enmienda, ADR-0019) ──
  WEB_PUBLIC_URL: variable(httpOrigin, {
    group: 'BFF (finance-web)',
    description:
      'Origen público de finance-web tal como lo ve el navegador (sin ruta). Se usa para el chequeo `Origin` anti-CSRF, el `redirect_uri` (`<origen>/api/bff/auth/callback`) y el retorno tras el logout.',
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://localhost:23000',
  }),
  FINANCE_API_URL: variable(httpOrigin, {
    group: 'BFF (finance-web)',
    description:
      'URL interna de finance-api (back-channel del BFF; `http://finance-api:8080` en Compose). El navegador nunca la usa.',
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://127.0.0.1:28080',
  }),
  OIDC_DISCOVERY_URL: variable(httpUrl, {
    group: 'BFF (finance-web)',
    description:
      'URL base alternativa (back-channel) para el discovery OIDC del BFF cuando el emisor público no es alcanzable desde el contenedor (`http://keycloak:8080/realms/pfos` en Compose). El `issuer` del documento debe coincidir con `OIDC_ISSUER_URL`. Si falta se usa `OIDC_ISSUER_URL`.',
    optional: true,
  }),
  OIDC_CLIENT_ID: variable(z.string().min(1), {
    group: 'BFF (finance-web)',
    description: 'Client id confidencial del BFF en el IdP (Authorization Code + PKCE S256).',
    default: 'pfos-web',
  }),
  OIDC_CLIENT_SECRET: variable(z.string().min(16), {
    group: 'BFF (finance-web)',
    description: 'Secreto del client confidencial del BFF.',
    secret: true,
  }),
  OIDC_SCOPES: variable(z.string().regex(/(^|\s)openid(\s|$)/, 'debe incluir el scope openid'), {
    group: 'BFF (finance-web)',
    description: 'Scopes pedidos en el login (deben incluir `openid` y el scope de la API).',
    default: 'openid profile email pfos.api',
  }),
  BFF_DATABASE_URL: variable(postgresUrl, {
    group: 'BFF (finance-web)',
    description:
      'Conexión del BFF al almacén de sesiones `iam.bff_session` (rol `pf_bff`, grants solo sobre esa tabla). `migrate` alinea la contraseña del rol con esta URL.',
    optional: true,
    requiredWhen: 'finance-web (`web`)',
    secret: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'postgres://pf_bff:<PF_DEV_DB_BFF_PASSWORD>@127.0.0.1:25432/pfos',
  }),
  BFF_SESSION_ENC_KEY: variable(
    z
      .string()
      .regex(
        /^([A-Za-z0-9_-]{1,32}:)?[^,:\s]{32,}(,[A-Za-z0-9_-]{1,32}:[^,:\s]{32,})*$/,
        'formato [kid:]secreto[,kid:secreto…] con secretos de ≥ 32 caracteres',
      ),
    {
      group: 'BFF (finance-web)',
      description:
        'Claves de cifrado de las sesiones del BFF (`kid:secreto`, separadas por coma; la primera cifra, todas descifran: rotación por `kid`; un secreto sin `kid` usa el kid `k0`). De cada secreto se deriva una clave AES-256-GCM con HKDF-SHA256. En cloud viene del secrets manager.',
      secret: true,
    },
  ),
  SESSION_IDLE_TIMEOUT: variable(duration, {
    group: 'BFF (finance-web)',
    description:
      'Expiración de la sesión por inactividad (`30m`, `1h`…). Se desliza como máximo una vez por minuto.',
    default: '30m',
  }),
  SESSION_ABSOLUTE_TIMEOUT: variable(duration, {
    group: 'BFF (finance-web)',
    description: 'Duración máxima de la sesión desde el login, haya o no actividad (`12h`…).',
    default: '12h',
  }),
  RATE_LIMIT_STORE: variable(z.enum(['memory', 'valkey']), {
    group: 'Convenciones de API',
    description:
      'Almacén del límite de tasa. `memory` es válido con una réplica de API (Phase 1); `valkey` aún no tiene adapter (falla al arrancar).',
    default: 'memory',
  }),
  RATE_LIMIT_READS_PER_MIN: variable(positiveInt, {
    group: 'Convenciones de API',
    description: 'Lecturas (GET) por minuto por usuario y por workspace (docs/10 §10).',
    default: '600',
  }),
  RATE_LIMIT_WRITES_PER_MIN: variable(positiveInt, {
    group: 'Convenciones de API',
    description: 'Escrituras por minuto por usuario y por workspace (docs/10 §10).',
    default: '120',
  }),
  RATE_LIMIT_COSTLY_PER_MIN: variable(positiveInt, {
    group: 'Convenciones de API',
    description:
      'Operaciones costosas (edición masiva, export/import de workspace, export CSV de auditoría) por minuto por usuario y por workspace; se suma a la cuota de escrituras (docs/10 §10).',
    default: '10',
  }),

  // ── Worker ──
  WORKER_CONCURRENCY: variable(positiveInt, {
    group: 'Worker',
    description: 'Jobs procesados en paralelo por cola en cada proceso worker.',
    default: '4',
  }),
  EVENT_CONSUMER_CONCURRENCY: variable(positiveInt, {
    group: 'Worker',
    description:
      'Eventos de agregados distintos que cada consumidor de eventos procesa en paralelo (el orden por agregado se conserva). Cada consumidor puede fijar la suya. La suma de todos los consumidores más 4 conexiones reservadas no puede exceder `DATABASE_POOL_MAX`: si la excede, el worker no arranca.',
    default: '4',
  }),
  EVENT_CONSUMER_BATCH_SIZE: variable(positiveInt, {
    group: 'Worker',
    description:
      'Eventos que cada consumidor trae por consulta a la cola; cada uno se confirma o falla por separado. Con 1 vuelve al ritmo previo (~2 eventos/s por worker).',
    default: '10',
  }),
  EVENT_CONSUMER_GROUP_BATCH_SIZE: variable(z.coerce.number().int().min(1).max(500), {
    group: 'Worker',
    description:
      'Eventos que cada consumidor de entrega agrupada (opt-in, optimize-consumer-throughput) trae por consulta a la cola y aplica en una sola transacción por workspace (1–500). Un consumidor puede fijar el suyo. No agrega conexiones: la concurrencia no cambia.',
    default: '100',
  }),
  WORKER_HEALTH_PORT: variable(port, {
    group: 'Worker',
    description:
      'Puerto de los probes `/health/live` y `/health/ready` del worker (8082 en el contenedor, no publicado; 28082 en modo A).',
    default: '8082',
  }),
  WORKER_HEALTH_BIND_ADDRESS: variable(z.string().min(1), {
    group: 'Worker',
    description: 'Dirección de escucha de los probes del worker.',
    default: '0.0.0.0',
  }),
  // ── Datos de demostración (openspec add-demo-data, ADR-0026, docs/31 D41) ──
  DEMO_DATA_ENABLED: variable(bool, {
    group: 'Producto',
    description:
      'Habilita la acción "Cargar datos de demostración" (workspace demo dedicado, purgable). Sin valor: `true` con `PFOS_ENV=local|ci` y `false` con `staging|production` (decisión del owner D41). La limpieza de workspaces demo existentes sigue disponible aunque esté deshabilitada.',
    optional: true,
    example: 'true',
  }),
  LEDGER_INTEGRITY_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `0 4 * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos) del job diario del ledger: verificador de invariantes (`VerifyLedgerIntegrity`) y reconstrucción de snapshots de saldo al día anterior (`RebuildBalanceSnapshots`). `off` lo desactiva.',
      default: '0 4 * * *',
    },
  ),
  LEDGER_INTEGRITY_CRON_TZ: variable(z.string().min(1).max(64), {
    group: 'Worker',
    description: 'Zona horaria IANA en la que se evalúa `LEDGER_INTEGRITY_CRON`.',
    default: 'UTC',
  }),

  // ── FX: providers de tasas de mercado (openspec add-market-rate-providers, design.md decisión 5; ADR-0025) ──
  // Sintaxis laxa a propósito: la semántica (mínimos, combinaciones) la valida FX al arrancar y un error NO detiene el
  // proceso: los providers no se inician, el estado informa `FX_PROVIDER_CONFIG_INVALID` y el resto sigue (degradación).
  FX_PROVIDER_PRIMARY: variable(z.string().min(1).max(32), {
    group: 'FX (tasas de mercado)',
    description:
      'Provider principal de la tasa `PARALLEL` USD/BOB y USDT/BOB: `paralelo_bo`, `dolarapi_bo` o `none` (deshabilitado).',
    default: 'paralelo_bo',
  }),
  FX_PROVIDER_FALLBACK: variable(z.string().min(1).max(32), {
    group: 'FX (tasas de mercado)',
    description:
      'Provider de respaldo de la tasa `PARALLEL` (distinto del principal): `dolarapi_bo`, `paralelo_bo` o `none`.',
    default: 'dolarapi_bo',
  }),
  FX_PROVIDER_OFFICIAL: variable(z.string().min(1).max(32), {
    group: 'FX (tasas de mercado)',
    description: 'Provider de la tasa `OFFICIAL` USD/BOB: `dolarapi_bo` o `none`.',
    default: 'dolarapi_bo',
  }),
  FX_POLL_INTERVAL: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Intervalo de consulta de los providers (cron pg-boss del worker): minutos u horas que dividan la hora o el día (`15m`, `30m`, `1h`); mínimo `1m` (60 s).',
    default: '15m',
  }),
  FX_STALE_AFTER_PARALLEL: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Antigüedad a partir de la cual una tasa `PARALLEL` de provider se considera obsoleta (`60m`).',
    default: '60m',
  }),
  FX_STALE_AFTER_OFFICIAL: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Antigüedad a partir de la cual una tasa `OFFICIAL` de provider se considera obsoleta (`48h`).',
    default: '48h',
  }),
  FX_STALE_AFTER_FALLBACK: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Umbral de obsolescencia propio del provider de respaldo de la tasa `PARALLEL` (`180m`): bo.dolarapi.com publica su `fechaActualizacion` con ~2 h de retraso. El principal sigue usando `FX_STALE_AFTER_PARALLEL`.',
    default: '180m',
  }),
  FX_MANUAL_FALLBACK_MAX_AGE: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Antigüedad máxima (`24h`) de una tasa manual de OTRO tipo (p. ej. `P2P`) que la valoración acepta como último recurso cuando no hay tasa vigente de provider (docs/31 D34); además su desvío respecto de la última tasa de provider del par no puede superar `FX_ANOMALY_THRESHOLD_PCT`.',
    default: '24h',
  }),
  FX_ANOMALY_THRESHOLD_PCT: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Variación porcentual (decimal > 0) respecto de la tasa aceptada anterior a partir de la cual una muestra queda retenida como anómala hasta que un editor la confirme.',
    default: '5',
  }),
  FX_PROVIDER_TIMEOUT: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description: 'Timeout de cada solicitud a un provider (`10s`; máximo `30s`).',
    default: '10s',
  }),
  FX_BACKFILL_ENABLED: variable(z.string().min(1).max(8), {
    group: 'FX (tasas de mercado)',
    description:
      'Carga inicial del histórico diario de la tasa paralela al crear un workspace y relleno diario de días faltantes (`true`/`false`).',
    default: 'true',
  }),

  // ── FX: providers de precios cripto (openspec add-crypto-rate-providers, D225–D229) ──
  // Ninguna fuente cripto se habilita sin la verificación de sus términos de uso y licencia registrada en un ADR
  // (NFR-COMP-007, RISK-023; ADR-0029): un id sin verificación deja SOLO a los providers cripto deshabilitados.
  FX_PROVIDER_CRYPTO_PRIMARY: variable(z.string().min(1).max(40), {
    group: 'FX (tasas de mercado)',
    description:
      'Provider principal de precios de criptomonedas (`MARKET`, cada cripto frente a USDT): el id de un provider con términos de uso verificados (ADR-0029) o `none` (deshabilitado). Una fuente sin verificación registrada se rechaza: los providers cripto quedan deshabilitados con `FX_PROVIDER_CONFIG_INVALID` y los de tasa paralela siguen funcionando. Por defecto `none` hasta que exista un provider verificado.',
    default: 'none',
  }),
  FX_PROVIDER_CRYPTO_FALLBACK: variable(z.string().min(1).max(40), {
    group: 'FX (tasas de mercado)',
    description:
      'Provider de respaldo de precios de criptomonedas, de otro operador que el principal (distinto de él): un id verificado o `none`. Por defecto `none`.',
    default: 'none',
  }),
  FX_STALE_AFTER_MARKET: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Antigüedad a partir de la cual una tasa `MARKET` del provider cripto principal se considera obsoleta (`60m`, D228).',
    default: '60m',
  }),
  FX_STALE_AFTER_MARKET_FALLBACK: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Umbral de obsolescencia propio del provider cripto de respaldo para `MARKET` (`60m`, D228).',
    default: '60m',
  }),
  FX_FEED_STALE_ALERT_AFTER: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Horas sin tasa aceptada de ningún provider (`6h`, D233) a partir de las cuales un par configurado con cobertura automática abre un episodio de obsolescencia y avisa al OWNER y a los EDITOR (una vez por episodio; aviso de recuperación al volver la tasa). No puede ser menor que `FX_POLL_INTERVAL` ni que los umbrales de obsolescencia `FX_STALE_AFTER_*` de `PARALLEL` y `MARKET`; un valor inválido deshabilita los providers con `FX_PROVIDER_CONFIG_INVALID`.',
    default: '6h',
  }),
  FX_ANOMALY_THRESHOLD_VOLATILE_PCT: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Variación porcentual (decimal > 0) a partir de la cual una muestra de una criptomoneda volátil queda retenida como anómala (`10`, D228); fiat y estables usan `FX_ANOMALY_THRESHOLD_PCT`.',
    default: '10',
  }),
  FX_STABLECOIN_CODES: variable(z.string().min(1).max(200), {
    group: 'FX (tasas de mercado)',
    description:
      'Códigos de las criptomonedas estables, separados por comas (`USDT`): se tratan como fiat para el umbral de anomalía (`FX_ANOMALY_THRESHOLD_PCT`) y como moneda pivote natural de los pares cripto.',
    default: 'USDT',
  }),
  FX_CRYPTO_HISTORY_FROM: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Primer día (`AAAA-MM-DD`, UTC) del histórico de cierres diarios cripto que la instalación pide a los providers (`2020-01-01`, D229): un rango fijo de la instalación, nunca la fecha de un workspace (FR-FX-015). Los workspaces copian de ahí los cierres desde su primera fecha con saldo.',
    default: '2020-01-01',
  }),

  // ── FX: tasas por institución (openspec add-exchange-house-rate-providers, design.md decisión 11) ──
  // Ninguna fuente por institución se habilita sin la verificación de sus términos de uso y licencia registrada en un
  // ADR (NFR-COMP-007, RISK-023): un id sin verificación deja SOLO a ese provider deshabilitado, sin enviar solicitudes.
  FX_PROVIDER_INSTITUTION_RATES: variable(z.string().min(1).max(40), {
    group: 'FX (tasas de mercado)',
    description:
      'Provider de tasas por institución (`BANK_BUY` / `BANK_SELL`, la compra y la venta que publica cada entidad): el id (`INSTRATE_<NOMBRE>`) de un provider con términos de uso verificados y registrados en un ADR, o `none` (deshabilitado). Una fuente sin verificación registrada se rechaza: el provider queda deshabilitado con `FX_PROVIDER_CONFIG_INVALID`, no envía ninguna solicitud y los providers de tasa paralela, oficial y cripto siguen funcionando. Por defecto `none` hasta que exista una fuente verificada; CI y tests usan `none` (sin red).',
    default: 'none',
  }),
  FX_INSTITUTION_RATES_INTERVAL: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Cada cuánto se consulta el provider de tasas por institución (`60m`; mínimo `60s`): la fuente publica una vez por día hábil. El ciclo de `fx.poll-market-rates` corre con `FX_POLL_INTERVAL`; el provider se consulta en el primer ciclo en que pasó al menos este tiempo desde su último intento (nunca con más frecuencia que el ciclo).',
    default: '60m',
  }),
  FX_STALE_AFTER_INSTITUTION: variable(z.string().min(1).max(16), {
    group: 'FX (tasas de mercado)',
    description:
      'Antigüedad a partir de la cual una tasa por institución se considera obsoleta (`72h`, para cubrir los fines de semana). No puede ser menor que `FX_POLL_INTERVAL` ni que `FX_INSTITUTION_RATES_INTERVAL`; un valor inválido deshabilita solo al provider por institución con `FX_PROVIDER_CONFIG_INVALID`.',
    default: '72h',
  }),

  // ── ACCOUNTS: catálogo de referencia de instituciones (openspec add-exchange-house-rate-providers) ──
  ACCOUNTS_INSTITUTION_CATALOG_DIR: variable(z.string().min(1).max(500), {
    group: 'Producto',
    description:
      'Directorio con un archivo `<PAÍS>.json` por país del catálogo de referencia de instituciones (dato versionado de la instalación, sin datos de usuarios). Una ruta relativa se resuelve contra el directorio del paquete de la API (`/app` en la imagen). Sin valor: `reference/institutions` (catálogo real; sin archivo, el catálogo del país no está disponible y `GET /institution-catalog` responde 404). El catálogo FICTICIO de pruebas está en `reference/institutions/demo` (solo desarrollo y CI; nunca con `PFOS_ENV=staging|production`).',
    optional: true,
    example: 'reference/institutions/demo',
  }),

  FX_PROVIDER_PARALELO_BO_URL: variable(httpOrigin, {
    group: 'FX (tasas de mercado)',
    description:
      'Solo local/CI: origen alternativo de paralelo.bo para el worker (servidor HTTP local que simula al provider en las pruebas E2E; nunca la red real). Sin definir se usa https://paralelo.bo. Rechazado con PFOS_ENV=staging|production.',
    optional: true,
  }),
  FX_PROVIDER_DOLARAPI_BO_URL: variable(httpOrigin, {
    group: 'FX (tasas de mercado)',
    description:
      'Solo local/CI: origen alternativo de bo.dolarapi.com para el worker (servidor HTTP local que simula al provider en las pruebas E2E). Sin definir se usa https://bo.dolarapi.com. Rechazado con PFOS_ENV=staging|production.',
    optional: true,
  }),

  // ── REPORTING (docs/31 D53: la ventana de vigencia es un ajuste de Reporting, no de FX) ──
  REPORTING_RATE_VALIDITY_WINDOW: variable(
    z
      .string()
      .regex(/^\d+d$/, 'duración en días (`7d`)')
      .transform((v) => Number(v.slice(0, -1)))
      .refine((days) => days >= 1 && days <= 90, 'entre 1d y 90d'),
    {
      group: 'Reporting',
      description:
        'Ventana de vigencia (días, `1d`–`90d`) de las tasas de valoración y de referencia: una tasa más antigua que el instante valorado menos esta ventana no se usa (el monto queda sin convertir, nunca 1:1). La define Reporting (docs/31 D53) y la composición de la API la entrega a FX, que resuelve con ella la valoración del Home, el equivalente de cuentas y la tasa de referencia de las conversiones; se informa en `meta.rateWindowDays` del resumen. También la lee el worker (add-budgets): el consumidor de umbrales valora el gastado de los presupuestos con la misma ventana que el Home y la API (presupuesto vs real, `meta.rateWindowDays` del plan).',
      default: '7d',
    },
  ),

  // ── Planning: periodos financieros (openspec add-financial-periods, design.md decisiones 5 y 6; docs/33 D63) ──
  PLANNING_PERIOD_LOOKAHEAD: variable(
    positiveInt.refine((n) => n <= 24, 'entre 1 y 24 periodos'),
    {
      group: 'Planning',
      description:
        'Periodos financieros futuros (en `DRAFT`) que la creación automática mantiene después del periodo que contiene hoy en la zona horaria del workspace (mínimo 1, máximo 24; docs/33 D63). Por entorno, no por workspace.',
      default: '3',
    },
  ),
  PLANNING_CLOSE_PENDING_DELAY_DAYS: variable(
    positiveInt.refine((n) => n <= 30, 'entre 1 y 30 días'),
    {
      group: 'Planning',
      description:
        'Días después del fin de un periodo `active` o `reopened` sin cerrar en que se publica una sola vez `planning.MonthClosePending.v1` (zona horaria del workspace; openspec add-month-closing decisión 16). Lo evalúa el job `planning.ensure-periods` del worker.',
      default: '3',
    },
  ),
  PLANNING_PERIODS_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `5 * * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) del job `planning.ensure-periods`: activa los periodos `DRAFT` cuya fecha de inicio llegó en la zona horaria de cada workspace, recalcula los `DRAFT` tras un cambio del día de inicio y crea los periodos que falten. También corre al arrancar el worker. `off` desactiva el cron.',
      default: '5 * * * *',
    },
  ),

  // ── Commitments: motor de recurrencia (openspec add-recurrence-engine, design.md decisión 7; docs/35 D125) ──
  COMMITMENTS_HORIZON_DAYS: variable(
    positiveInt.refine((n) => n >= 14 && n <= 366, 'entre 14 y 366 días'),
    {
      group: 'Commitments',
      description:
        'Horizonte (días, 14–366) hasta el que el motor de recurrencia genera ocurrencias a partir de hoy en la zona horaria del workspace (docs/35 D125). Por entorno, no por workspace; lo leen la API (generación síncrona al crear, revisar o reanudar una definición) y el worker (job `commitments.generate-occurrences`).',
      default: '90',
    },
  ),
  COMMITMENTS_SUBSCRIPTIONS_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `20 * * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) del job `commitments.subscription-daily`: pasa a activa la suscripción cuyo trial terminó, ejecuta las cancelaciones programadas vencidas y emite los recordatorios de renovación y de fin de trial (a lo sumo uno por suscripción y fecha). Evalúa con "hoy" en la zona horaria de cada workspace. También corre al arrancar el worker. `off` desactiva el cron.',
      default: '20 * * * *',
    },
  ),
  DEBT_CARDS_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `30 * * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) del job `debt.card-daily` (add-credit-cards): emite una sola vez el estado de cuenta de cada ciclo cerrado de las tarjetas, publica los recordatorios de vencimiento (uno por cuenta y cierre) y es la red de seguridad del monto esperado del plan de pago y de los umbrales de utilización de límites compartidos. Evalúa con "hoy" en la zona horaria de cada workspace. También corre al arrancar el worker. `off` desactiva el cron.',
      default: '30 * * * *',
    },
  ),
  GOALS_DAILY_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `40 * * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) del job `goals.daily-evaluation` (add-savings-goals): reevalúa las metas con fondos en otra moneda (pueden alcanzarse por el tipo de cambio, nunca se reabren por él) y barre la sobre-asignación de las cuentas con reservas como red de seguridad de eventos perdidos. Evalúa con "hoy" en la zona horaria de cada workspace; es idempotente. También corre al arrancar el worker. `off` desactiva el cron.',
      default: '40 * * * *',
    },
  ),
  COMMITMENTS_SCHEDULER_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `10 * * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) del job `commitments.generate-occurrences`: extiende la generación de ocurrencias hasta el horizonte, pasa a `DUE`/`OVERDUE` las que corresponden por fecha y materializa las de modo `AUTO_CREATE` vencidas. También corre al arrancar el worker. `off` desactiva el cron.',
      default: '10 * * * *',
    },
  ),

  // ── Imports: importación CSV básica (openspec add-basic-csv-import, design.md § Contratos; docs/35 D122, D151) ──
  IMPORT_CSV_MAX_BYTES: variable(
    positiveInt.refine((n) => n <= 20_971_520, 'hasta 20971520 bytes (20 MiB)'),
    {
      group: 'Imports',
      description:
        'Tamaño máximo en bytes del CSV que se puede subir para importar (docs/35 D151, 2 MiB): el servidor deja de leer al superarlo y responde 413 `UPLOAD_TOO_LARGE` sin crear la importación.',
      default: '2097152',
    },
  ),
  IMPORT_CSV_MAX_ROWS: variable(
    positiveInt.refine((n) => n <= 100_000, 'hasta 100000 filas'),
    {
      group: 'Imports',
      description:
        'Máximo de filas de datos de un CSV importado (docs/35 D151, 5000): más ⇒ 422 `IMPORT_TOO_MANY_ROWS`. El mapeo y la clasificación son síncronos, así que el tope acota el tiempo hasta la vista previa.',
      default: '5000',
    },
  ),
  IMPORT_MAX_ROWS: variable(
    positiveInt.refine((n) => n <= 100_000, 'hasta 100000 filas'),
    {
      group: 'Imports',
      description:
        'Máximo de filas de datos de un import (docs/57 D329, 5000; add-import-pipeline): la lectura se corta al excederlo y el import falla con `IMPORT_TOO_MANY_ROWS`. Si no se define, rige `IMPORT_CSV_MAX_ROWS` (alias de compatibilidad, 5000 por defecto). Subir el tope exige medir de nuevo la vista previa y la ráfaga de eventos.',
      optional: true,
    },
  ),
  IMPORT_PROCESSING_TIMEOUT: variable(
    z
      .string()
      .regex(/^PT\d+[MS]$/, 'duración ISO 8601 en minutos o segundos (`PT10M`)')
      .transform((v) => Number(v.slice(2, -1)) * (v.endsWith('M') ? 60_000 : 1000))
      .refine((ms) => ms >= 10_000 && ms <= 3_600_000, 'entre PT10S y PT60M'),
    {
      group: 'Imports',
      description:
        'Tiempo máximo del procesamiento de un import hasta la vista previa (`PT10M`): al superarlo el job pasa a `PARSE_FAILED` con `IMPORT_PARSE_FAILED`.',
      default: 'PT10M',
    },
  ),
  IMPORT_DUPLICATE_HIGH_SCORE: variable(z.coerce.number().min(0.5).max(1), {
    group: 'Imports',
    description:
      'Puntaje desde el cual un posible duplicado es de confianza alta (0.90): un único candidato en o sobre este valor se preselecciona como «omitir» (siempre editable; la decisión sigue siendo obligatoria).',
    default: '0.90',
  }),
  IMPORT_DUPLICATE_LOW_SCORE: variable(z.coerce.number().min(0).max(1), {
    group: 'Imports',
    description:
      'Puntaje bajo el cual un posible duplicado se rotula «confianza baja» (0.60): sigue exigiendo decisión (docs/57 D325); solo cambia el rótulo.',
    default: '0.60',
  }),
  // ── Imports: lectura de extractos PDF (openspec add-pdf-statement-parser decisión 3, D351) ──
  IMPORT_PDF_EXTRACTION_TIMEOUT: variable(
    z
      .string()
      .regex(/^PT\d+[MS]$/, 'duración ISO 8601 en minutos o segundos (`PT30S`)')
      .transform((v) => Number(v.slice(2, -1)) * (v.endsWith('M') ? 60_000 : 1000))
      .refine((ms) => ms >= 1000 && ms <= 120_000, 'entre PT1S y PT2M'),
    {
      group: 'Imports',
      description:
        'Tiempo máximo de la extracción de texto de un PDF (`PT30S`): vencido, el hilo aislado se termina y la importación falla con `IMPORT_PDF_EXTRACTION_FAILED` (motivo `TIMEOUT`).',
      default: 'PT30S',
    },
  ),
  IMPORT_PDF_MAX_PAGES: variable(
    positiveInt.refine((n) => n <= 1000, 'hasta 1000 páginas'),
    {
      group: 'Imports',
      description:
        'Máximo de páginas de un extracto PDF (200, D351): más ⇒ `IMPORT_PDF_EXTRACTION_FAILED` (`PAGE_LIMIT`) sin leer el contenido de ninguna página. Un extracto mensual real tiene de 1 a 6.',
      default: '200',
    },
  ),
  IMPORT_PDF_MAX_TEXT_ITEMS: variable(
    positiveInt.refine((n) => n <= 5_000_000, 'hasta 5000000 fragmentos'),
    {
      group: 'Imports',
      description:
        'Máximo de fragmentos de texto que la extracción de un PDF acumula (300000): más ⇒ `IMPORT_PDF_EXTRACTION_FAILED` (`TEXT_LIMIT`).',
      default: '300000',
    },
  ),
  IMPORT_PDF_MAX_TEXT_CHARS: variable(
    positiveInt.refine((n) => n <= 67_108_864, 'hasta 67108864 caracteres (64 MiB)'),
    {
      group: 'Imports',
      description:
        'Máximo de caracteres de texto que la extracción de un PDF acumula (4194304, 4 MiB): más ⇒ `IMPORT_PDF_EXTRACTION_FAILED` (`TEXT_LIMIT`).',
      default: '4194304',
    },
  ),
  IMPORT_PDF_WORKER_MAX_OLD_MB: variable(
    positiveInt.refine((n) => n >= 64 && n <= 512, 'entre 64 y 512 MiB'),
    {
      group: 'Imports',
      description:
        'Tope de memoria (heap de V8, MiB) del hilo aislado que lee un PDF (192): superarlo termina solo ese hilo y la importación falla con `IMPORT_PDF_EXTRACTION_FAILED` (`MEMORY`). Se suma al presupuesto de memoria del worker (una extracción a la vez).',
      default: '192',
    },
  ),
  IMPORT_PDF_MIN_PAGE_TEXT_CHARS: variable(
    positiveInt.refine((n) => n <= 1000, 'hasta 1000 caracteres'),
    {
      group: 'Imports',
      description:
        'Caracteres no blancos mínimos de una página de un extracto PDF (20, D351): una página con menos (y que no sea una página en blanco declarada) es «sin texto» y el PDF se rechaza con `IMPORT_PDF_NO_TEXT` (sin OCR).',
      default: '20',
    },
  ),
  IMPORT_CSV_MAX_COLUMNS: variable(
    positiveInt.refine((n) => n <= 200, 'hasta 200 columnas'),
    {
      group: 'Imports',
      description: 'Máximo de columnas de un CSV importado (50): más ⇒ 422 `IMPORT_UNSUPPORTED_FORMAT`.',
      default: '50',
    },
  ),
  RULES_MAX_PER_WORKSPACE: variable(
    positiveInt.refine((n) => n <= 5000, 'hasta 5000 reglas'),
    {
      group: 'Rules',
      description:
        'Máximo de reglas no archivadas por workspace (docs/57 D339, 500): más ⇒ 422 `RULE_LIMIT_EXCEEDED`. Archivar libera un cupo.',
      default: '500',
    },
  ),
  RULES_DRY_RUN_MAX_DAYS: variable(
    positiveInt.refine((n) => n <= 3660, 'hasta 3660 días'),
    {
      group: 'Rules',
      description:
        'Rango máximo en días de un dry-run de reglas (366): más ⇒ 422 `VALIDATION_FAILED`. Acota el tiempo de la evaluación retroactiva.',
      default: '366',
    },
  ),
  RULES_DRY_RUN_MAX_TRANSACTIONS: variable(
    positiveInt.refine((n) => n <= 20_000, 'hasta 20000 transacciones'),
    {
      group: 'Rules',
      description:
        'Máximo de transacciones que evalúa un dry-run (5000): si el rango tiene más, la respuesta se marca `truncated`.',
      default: '5000',
    },
  ),
  RULES_APPLY_MAX_ITEMS: variable(
    positiveInt.refine((n) => n <= 500, 'hasta 500 transacciones'),
    {
      group: 'Rules',
      description:
        'Transacciones máximas por aplicación de un dry-run (500, igual que la edición masiva): la interfaz aplica por páginas.',
      default: '500',
    },
  ),
  IMPORT_PERSIST_BATCH_SIZE: variable(
    positiveInt.refine((n) => n <= 1000, 'hasta 1000 filas por lote'),
    {
      group: 'Imports',
      description:
        'Filas por lote de la persistencia de una importación aprobada (200): un lote es una transacción de base de datos con su asiento por fila. Lotes cortos mantienen breves los bloqueos del ledger.',
      default: '200',
    },
  ),
  IMPORT_REVIEW_TTL: variable(
    z
      .string()
      .regex(/^P\d+D$/, 'duración ISO 8601 en días (`P30D`)')
      .transform((v) => Number(v.slice(1, -1)) * 86_400_000)
      .refine((ms) => ms >= 86_400_000 && ms <= 365 * 86_400_000, 'entre P1D y P365D'),
    {
      group: 'Imports',
      description:
        'Cuánto espera una importación sin aprobar (esperando mapeo o revisión) antes de expirar (`P30D`): el job diario `imports.expire-reviews` la cancela (actor `SYSTEM`, auditado) y descarta sus celdas crudas.',
      default: 'P30D',
    },
  ),
  IMPORT_STAGING_RETENTION: variable(
    z
      .string()
      .regex(/^P\d+D$/, 'duración ISO 8601 en días (`P90D`)')
      .transform((v) => Number(v.slice(1, -1)) * 86_400_000)
      .refine((ms) => ms >= 86_400_000 && ms <= 3650 * 86_400_000, 'entre P1D y P3650D'),
    {
      group: 'Imports',
      description:
        'Retención de las celdas crudas del archivo (staging) desde que la importación termina (`P90D`): el job diario `imports.purge-staging` las borra; se conservan la importación, sus conteos y los vínculos de idempotencia por fila.',
      default: 'P90D',
    },
  ),
  IMPORT_FUTURE_DATE_TOLERANCE_DAYS: variable(z.coerce.number().int().min(0).max(30), {
    group: 'Imports',
    description:
      'Días de tolerancia hacia el futuro de la fecha de una fila importada, en la zona horaria del workspace (3): una fecha posterior a hoy + tolerancia es inválida (`IMPORT_FUTURE_DATE`).',
    default: '3',
  }),
  IMPORT_MAINTENANCE_CRON: variable(
    z
      .string()
      .regex(
        /^(off|(\S+\s+){4}\S+)$/,
        'debe ser una expresión cron de 5 campos (p. ej. `40 3 * * *`) u `off`',
      ),
    {
      group: 'Worker',
      description:
        'Cron (5 campos, UTC) de los jobs diarios `imports.expire-reviews` e `imports.purge-staging`. También corren al arrancar el worker. `off` desactiva el cron.',
      default: '40 3 * * *',
    },
  ),

  // ── Notificaciones (openspec add-alerts, design decisiones 6, 7, 9 y 11; docs/33 D87–D93) ──
  EMAIL_DRIVER: variable(z.enum(['smtp', 'none']), {
    group: 'Notificaciones',
    description:
      'Adaptador del canal email de las notificaciones. `smtp` envía por SMTP (Mailpit en local/CI; cualquier relay SMTP después); `none` suprime las entregas por email (`SUPPRESSED`/`CHANNEL_DISABLED`, sin error ni reintentos) y deja solo el in-app. Sin valor: `smtp` en local/ci cuando `SMTP_HOST` está definido (Mailpit) y `none` en cualquier otro caso, en particular en staging/production hasta elegir el proveedor de producción (docs/33 D87).',
    optional: true,
    example: 'smtp',
  }),
  SMTP_HOST: variable(z.string().min(1).max(253), {
    group: 'Notificaciones',
    description:
      'Servidor SMTP del canal email. En local y CI es Mailpit (`PF_MAILPIT_SMTP_PORT` en el host; `mailpit:1025` dentro de Compose).',
    optional: true,
    requiredWhen: 'EMAIL_DRIVER=smtp',
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: '127.0.0.1',
  }),
  SMTP_PORT: variable(port, {
    group: 'Notificaciones',
    description: 'Puerto del servidor SMTP.',
    default: '1025',
  }),
  SMTP_SECURE: variable(bool, {
    group: 'Notificaciones',
    description:
      'TLS implícito desde el inicio de la conexión (puerto 465). Con `false` se usa STARTTLS si el servidor lo ofrece.',
    default: 'false',
  }),
  SMTP_USER: variable(z.string().min(1).max(320), {
    group: 'Notificaciones',
    description: 'Usuario SMTP. Mailpit de desarrollo no autentica.',
    optional: true,
  }),
  SMTP_PASSWORD: variable(z.string().min(1).max(1000), {
    group: 'Notificaciones',
    description:
      'Contraseña SMTP. Secreto: en cloud viene del secrets manager; nunca se imprime ni se loguea.',
    optional: true,
    secret: true,
  }),
  EMAIL_FROM: variable(
    z
      .string()
      .max(320)
      .regex(
        /^(?:[^<>]*<)?[^\s<>@]+@[^\s<>@.]+(?:\.[^\s<>@.]+)+>?$/,
        'debe ser una dirección o `Nombre <dirección>`',
      ),
    {
      group: 'Notificaciones',
      description:
        'Remitente de los emails de notificación. El dominio de esta dirección forma el `Message-ID` determinista de cada entrega (`<deliveryId@dominio>`).',
      default: 'PFOS <notificaciones@pfos.local>',
    },
  ),
  APP_PUBLIC_URL: variable(httpOrigin, {
    group: 'Notificaciones',
    description:
      'Origen público de la app (el de `WEB_PUBLIC_URL`): base de los enlaces de los emails (`/notificaciones/{id}` y `/preferencias`). Solo ruta e identificador opaco: sin tokens ni datos financieros.',
    optional: true,
    requiredWhen: 'EMAIL_DRIVER=smtp',
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://localhost:23000',
  }),
  NOTIFY_EMAIL_MAX_ATTEMPTS: variable(
    positiveInt.refine((n) => n <= 10, 'entre 1 y 10 intentos'),
    {
      group: 'Notificaciones',
      description:
        'Intentos de envío por entrega de email (backoff exponencial 1 min, 5 min, 25 min, 2 h) antes de marcarla `FAILED` y contar `notifications_email_deliveries_total{status="failed"}`. La notificación in-app no depende del resultado.',
      default: '5',
    },
  ),
  NOTIFY_RETENTION: variable(
    z
      .string()
      .regex(/^\d+mo$/, 'duración en meses (`12mo`)')
      .transform((v) => Number(v.slice(0, -2)))
      .refine((months) => months >= 1 && months <= 120, 'entre 1mo y 120mo'),
    {
      group: 'Notificaciones',
      description:
        'Retención de las notificaciones (todas, archivadas incluidas) y sus entregas, en meses (`12mo`, docs/33 D93). El job diario `notifications.purge` borra las más antiguas.',
      default: '12mo',
    },
  ),

  // ── OpenTelemetry ──
  OTEL_ENABLED: variable(bool, {
    group: 'OpenTelemetry',
    description:
      'Activa el SDK de OpenTelemetry (cargado con `node --import @pf/platform/otel/register`). El resto de `OTEL_*` estándar lo lee el SDK.',
    default: 'false',
  }),
  OTEL_EXPORTER_OTLP_ENDPOINT: variable(httpUrl, {
    group: 'OpenTelemetry',
    description: 'Endpoint OTLP (p. ej. otel-lgtm con el perfil `observability`).',
    optional: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://127.0.0.1:24318',
  }),
  OTEL_NODE_RESOURCE_DETECTORS: variable(
    z
      .string()
      .min(1)
      .refine(
        (v) => !v.split(',').some((d) => FORBIDDEN_RESOURCE_DETECTORS.includes(d.trim())),
        'no puede incluir all/host/process (filtran usuario de SO, hostname y argumentos — SPIKE-10)',
      ),
    {
      group: 'OpenTelemetry',
      description: 'Detectores de recurso OTel. Obligatoriamente sin `host`/`process` (PII, SPIKE-10).',
      default: 'env,os,serviceinstance',
    },
  ),

  // ── Documentos adjuntos (openspec add-document-attachments, docs/57 D313–D323) ──
  OBJECT_STORAGE_QUARANTINE_BUCKET: variable(bucketName, {
    group: 'Documentos adjuntos',
    description:
      'Bucket de CUARENTENA de las subidas directas (sin versioning, sin lectura pública: un DELETE borra el texto plano de verdad). El objeto se verifica y se mueve cifrado al bucket de documentos; ninguno permanece más de 24 h. En local/CI lo crea `migrate` con `OBJECT_STORAGE_ENSURE_BUCKET=true` (con CORS para la subida).',
    default: 'pfos-quarantine',
    example: 'pfos-local-quarantine',
  }),
  OBJECT_STORAGE_PUBLIC_ENDPOINT: variable(httpUrl, {
    group: 'Documentos adjuntos',
    description:
      'Endpoint S3 PÚBLICO con el que se firman las URL de subida (el host forma parte de la firma y debe ser alcanzable por el navegador). Sin valor: el mismo `OBJECT_STORAGE_ENDPOINT`. En producción es el hostname `PF_DOMAIN_FILES` de Caddy, limitado a `PUT` firmados sobre el bucket de cuarentena.',
    optional: true,
    // pf-allow-loopback: ejemplo de documentación (valor del modo A en .env), no una dirección en código
    example: 'http://127.0.0.1:29000',
  }),
  DOCUMENT_MAX_BYTES: variable(positiveInt.max(26_214_400), {
    group: 'Documentos adjuntos',
    description:
      'Tamaño máximo de un documento (15 MiB por defecto, D317). Tope duro 26214400 (25 MiB): la configuración no puede superarlo.',
    default: '15728640',
  }),
  DOCUMENT_IMPORT_SOURCE_MAX_BYTES: variable(positiveInt.max(26_214_400), {
    group: 'Documentos adjuntos',
    description:
      'Tamaño máximo de un extracto a importar (propósito `IMPORT_SOURCE`, 20 MiB por defecto, docs/13 §11). Tope duro 26214400.',
    default: '20971520',
  }),
  DOCUMENT_WORKSPACE_QUOTA_BYTES: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description:
      'Cuota de almacenamiento de documentos por workspace (suma de pendientes, disponibles y archivados; 5 GiB por defecto, D317).',
    default: '5368709120',
  }),
  DOCUMENT_MAX_PENDING_UPLOADS: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description: 'Subidas pendientes simultáneas por workspace (20 por defecto).',
    default: '20',
  }),
  DOCUMENT_MAX_LINKS_PER_TARGET: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description: 'Adjuntos máximos por elemento (transacción, préstamo, cuenta…; 20 por defecto).',
    default: '20',
  }),
  DOCUMENT_UPLOAD_URL_TTL: variable(
    shortDuration.refine((ms) => ms <= 600_000, 'máximo 10m (NFR-SEC-012)'),
    {
      group: 'Documentos adjuntos',
      description: 'Vigencia de la URL de subida presignada (5m por defecto; nunca más de 10m).',
      default: '5m',
    },
  ),
  DOCUMENT_UPLOAD_GRACE: variable(shortDuration, {
    group: 'Documentos adjuntos',
    description:
      'Gracia tras vencer la URL de subida antes de que `ExpirePendingUploads` rechace el documento por subida no completada y libere la reserva de cuota.',
    default: '1h',
  }),
  DOCUMENT_UNLINKED_RETENTION: variable(shortDuration, {
    group: 'Documentos adjuntos',
    description:
      'Plazo tras el cual se eliminan (actor sistema) los documentos disponibles, sin vínculos y no archivados (30d por defecto, D318). Archivar los conserva.',
    default: '30d',
  }),
  DOCUMENT_VERIFY_MAX_CONCURRENCY: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description:
      'Verificaciones de confirmación simultáneas por proceso de API (2 por defecto): acota la memoria (hasta 25 MiB por archivo). Si está lleno, la confirmación responde 503 con `Retry-After`.',
    default: '2',
  }),
  DOCUMENT_INSPECTION_TIMEOUT: variable(shortDuration, {
    group: 'Documentos adjuntos',
    description:
      'Plazo de la inspección de PDF y XLSX en un `worker_thread` con límites de memoria (10s por defecto); vencido ⇒ rechazo `MALFORMED_CONTENT` (falla cerrada).',
    default: '10s',
  }),
  DOCUMENT_XLSX_MAX_ENTRIES: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description: 'Entradas máximas del libro XLSX (1000 por defecto).',
    default: '1000',
  }),
  DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description:
      'Suma máxima de tamaños descomprimidos de un XLSX (100 MiB por defecto); se aplica sobre el directorio central y sobre el inflado real.',
    default: '104857600',
  }),
  DOCUMENT_ARCHIVE_MAX_RATIO: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description: 'Razón de compresión máxima por entrada de un XLSX (100:1 por defecto).',
    default: '100',
  }),
  DOCUMENT_JSON_MAX_DEPTH: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description: 'Profundidad máxima de anidamiento de un JSON subido (64 por defecto).',
    default: '64',
  }),
  DOCUMENT_ENCRYPTION_KEYS: variable(keyring, {
    group: 'Documentos adjuntos',
    description:
      'Llavero de CLAVES MAESTRAS que envuelven la clave de datos de cada documento (cifrado de sobre AES-256-GCM): `kid:clave` separadas por coma, con la clave de 32 bytes en base64url (43 caracteres) o hexadecimal (64; `openssl rand -hex 32`). Llavero SEPARADO del de exports (los documentos viven años). La vigente es `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID`; las anteriores permanecen mientras queden documentos envueltos con ellas (el arranque falla nombrando la clave faltante). Perder el llavero implica perder todos los documentos: respáldalo FUERA del host. Nunca en el repositorio. Sin ella los documentos están deshabilitados (503); obligatoria en staging/production.',
    optional: true,
    requiredWhen: '`PFOS_ENV=staging|production`',
    secret: true,
  }),
  DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID: variable(
    z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'identificador de clave inválido'),
    {
      group: 'Documentos adjuntos',
      description:
        'Identificador (`kid`) de la clave maestra vigente de `DOCUMENT_ENCRYPTION_KEYS` con la que se envuelven los documentos NUEVOS y a la que el mantenimiento diario re-envuelve los existentes. Sin valor: la primera del llavero.',
      optional: true,
      example: 'k1',
    },
  ),
  DOCUMENT_MALWARE_SCANNER: variable(z.enum(['none', 'clamav']), {
    group: 'Documentos adjuntos',
    description:
      'Escáner antimalware de los documentos: `none` (defecto; apagado en producción por el host de 2 GB, D314: allí rigen la lista de tipos, la inspección estructural y la entrega solo como adjunto) o `clamav` (clamd por TCP; lo enciende la suite del nightly). Con `clamav`, un escáner caído hace fallar la confirmación con 503 (falla cerrada).',
    default: 'none',
  }),
  CLAMAV_HOST: variable(z.string().min(1), {
    group: 'Documentos adjuntos',
    description: 'Host de clamd (solo con `DOCUMENT_MALWARE_SCANNER=clamav`).',
    optional: true,
    requiredWhen: '`DOCUMENT_MALWARE_SCANNER=clamav`',
    example: 'clamav',
  }),
  CLAMAV_PORT: variable(port, {
    group: 'Documentos adjuntos',
    description: 'Puerto TCP de clamd.',
    default: '3310',
  }),
  DOCUMENT_MALWARE_SCAN_TIMEOUT: variable(shortDuration, {
    group: 'Documentos adjuntos',
    description: 'Plazo del escaneo de un archivo (30s por defecto); vencido ⇒ escáner no disponible (503).',
    default: '30s',
  }),
  DOCUMENT_MAINTENANCE_CRON: variable(cronOrOff, {
    group: 'Documentos adjuntos',
    description:
      'Cron del mantenimiento de documentos del worker (cada 10 minutos por defecto): expira subidas no completadas, reintenta verificaciones atascadas, barre la cuarentena (> 24 h) y los objetos huérfanos, purga documentos sin vínculo y re-envuelve claves. `off` lo apaga (solo pruebas). No agrega consumidores ni conexiones (job secuencial).',
    default: '*/10 * * * *',
  }),
  DOCUMENT_CONTENTS_RESTORE_MAX_BYTES: variable(positiveInt, {
    group: 'Documentos adjuntos',
    description:
      'Tamaño máximo del archivo de contenidos de documentos que se restaura sobre un workspace importado (por defecto la cuota de un workspace, 5 GiB; D315).',
    default: '5368709120',
  }),
} as const satisfies Record<string, VariableSpec>;

export type VariableName = keyof typeof VARIABLES;

const GENERAL = ['PFOS_ENV', 'LOG_LEVEL'] as const;
const PRODUCT = ['APP_DEFAULT_LOCALE', 'APP_REPORTING_CURRENCY', 'APP_TIMEZONE'] as const;
const OTEL = ['OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_NODE_RESOURCE_DETECTORS'] as const;
const DATABASE = ['DATABASE_URL', 'DATABASE_POOL_MAX'] as const;
const OBJECT_STORAGE = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
  'OBJECT_STORAGE_FORCE_PATH_STYLE',
] as const;
const EXPORT_PORTABILITY = [
  'OBJECT_STORAGE_EXPORTS_BUCKET',
  'EXPORT_ENCRYPTION_KEYS',
  'EXPORT_ENCRYPTION_ACTIVE_KEY_ID',
  'EXPORT_RETENTION',
] as const;
const DOCUMENTS = [
  'DOCUMENT_MAX_BYTES',
  'DOCUMENT_IMPORT_SOURCE_MAX_BYTES',
  'DOCUMENT_WORKSPACE_QUOTA_BYTES',
  'DOCUMENT_MAX_PENDING_UPLOADS',
  'DOCUMENT_MAX_LINKS_PER_TARGET',
  'DOCUMENT_UPLOAD_URL_TTL',
  'DOCUMENT_UPLOAD_GRACE',
  'DOCUMENT_UNLINKED_RETENTION',
  'DOCUMENT_VERIFY_MAX_CONCURRENCY',
  'DOCUMENT_INSPECTION_TIMEOUT',
  'DOCUMENT_XLSX_MAX_ENTRIES',
  'DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES',
  'DOCUMENT_ARCHIVE_MAX_RATIO',
  'DOCUMENT_JSON_MAX_DEPTH',
  'DOCUMENT_ENCRYPTION_KEYS',
  'DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID',
  'DOCUMENT_MALWARE_SCANNER',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'DOCUMENT_MALWARE_SCAN_TIMEOUT',
  'OBJECT_STORAGE_QUARANTINE_BUCKET',
] as const;
const FX_PROVIDERS = [
  'FX_PROVIDER_PRIMARY',
  'FX_PROVIDER_FALLBACK',
  'FX_PROVIDER_OFFICIAL',
  'FX_POLL_INTERVAL',
  'FX_STALE_AFTER_PARALLEL',
  'FX_STALE_AFTER_OFFICIAL',
  'FX_STALE_AFTER_FALLBACK',
  'FX_MANUAL_FALLBACK_MAX_AGE',
  'FX_ANOMALY_THRESHOLD_PCT',
  'FX_PROVIDER_TIMEOUT',
  'FX_BACKFILL_ENABLED',
  'FX_PROVIDER_CRYPTO_PRIMARY',
  'FX_PROVIDER_CRYPTO_FALLBACK',
  'FX_STALE_AFTER_MARKET',
  'FX_STALE_AFTER_MARKET_FALLBACK',
  'FX_FEED_STALE_ALERT_AFTER',
  'FX_ANOMALY_THRESHOLD_VOLATILE_PCT',
  'FX_STABLECOIN_CODES',
  'FX_CRYPTO_HISTORY_FROM',
  'FX_PROVIDER_INSTITUTION_RATES',
  'FX_INSTITUTION_RATES_INTERVAL',
  'FX_STALE_AFTER_INSTITUTION',
] as const;
const QUEUE = [
  'JOB_QUEUE_DRIVER',
  'JOB_QUEUE_POLLING_INTERVAL_SECONDS',
  'SESSION_STORE',
  'VALKEY_URL',
] as const;

/** Qué variables lee cada proceso. Una variable fuera de esta lista es invisible para la app. */
export const APP_VARIABLES = {
  api: [
    ...GENERAL,
    ...PRODUCT,
    ...OTEL,
    ...DATABASE,
    ...OBJECT_STORAGE,
    ...QUEUE,
    'API_PORT',
    'API_BIND_ADDRESS',
    'HEALTH_CHECK_TIMEOUT_MS',
    'SHUTDOWN_TIMEOUT_MS',
    'API_PROBLEM_TYPE_BASE',
    'IDEMPOTENCY_RETENTION',
    'CURSOR_SIGNING_KEY',
    'AUDIT_IP_HMAC_KEY',
    'RATE_LIMIT_STORE',
    'RATE_LIMIT_READS_PER_MIN',
    'RATE_LIMIT_WRITES_PER_MIN',
    'RATE_LIMIT_COSTLY_PER_MIN',
    'OIDC_ISSUER_URL',
    'OIDC_JWKS_URI',
    'OIDC_API_AUDIENCE',
    'OIDC_REQUIRED_SCOPE',
    'OIDC_CLOCK_SKEW_SECONDS',
    'OIDC_PROFILE',
    'OIDC_AUTHORIZED_PARTIES',
    'OIDC_JWKS_FALLBACK_MAX_AGE',
    'DEMO_DATA_ENABLED',
    'ACCOUNTS_INSTITUTION_CATALOG_DIR',
    ...FX_PROVIDERS,
    'REPORTING_RATE_VALIDITY_WINDOW',
    'PLANNING_PERIOD_LOOKAHEAD',
    'COMMITMENTS_HORIZON_DAYS',
    // add-basic-csv-import: la API lee, valida y deja en staging el CSV, y reparte los lotes al aprobar.
    'IMPORT_CSV_MAX_BYTES',
    'IMPORT_CSV_MAX_ROWS',
    'IMPORT_CSV_MAX_COLUMNS',
    // add-import-pipeline: topes y umbrales del pipeline (la API crea el job; el worker lo procesa).
    'IMPORT_MAX_ROWS',
    'IMPORT_PROCESSING_TIMEOUT',
    'IMPORT_DUPLICATE_HIGH_SCORE',
    'IMPORT_DUPLICATE_LOW_SCORE',
    // add-pdf-statement-parser: límites del lector de extractos PDF.
    'IMPORT_PDF_EXTRACTION_TIMEOUT',
    'IMPORT_PDF_MAX_PAGES',
    'IMPORT_PDF_MAX_TEXT_ITEMS',
    'IMPORT_PDF_MAX_TEXT_CHARS',
    'IMPORT_PDF_WORKER_MAX_OLD_MB',
    'IMPORT_PDF_MIN_PAGE_TEXT_CHARS',
    'IMPORT_PERSIST_BATCH_SIZE',
    'IMPORT_REVIEW_TTL',
    'IMPORT_FUTURE_DATE_TOLERANCE_DAYS',
    // add-rule-engine: límites de reglas, dry-run y aplicación (la API los aplica; el worker no evalúa reglas aún).
    'RULES_MAX_PER_WORKSPACE',
    'RULES_DRY_RUN_MAX_DAYS',
    'RULES_DRY_RUN_MAX_TRANSACTIONS',
    'RULES_APPLY_MAX_ITEMS',
    // add-workspace-export: la API solicita, descarga (descifra en streaming) e importa.
    ...EXPORT_PORTABILITY,
    'REAUTH_MAX_AGE',
    'WORKSPACE_IMPORT_MAX_BYTES',
    // add-document-attachments: la API firma las subidas, verifica la confirmación y descarga descifrando.
    ...DOCUMENTS,
    'OBJECT_STORAGE_PUBLIC_ENDPOINT',
    'DOCUMENT_CONTENTS_RESTORE_MAX_BYTES',
  ],
  // El worker se conecta como pf_worker (relay del outbox entre workspaces, add-event-outbox design §4).
  worker: [
    ...GENERAL,
    ...PRODUCT,
    ...OTEL,
    'WORKER_DATABASE_URL',
    'DATABASE_POOL_MAX',
    ...OBJECT_STORAGE,
    ...QUEUE,
    'WORKER_CONCURRENCY',
    'EVENT_CONSUMER_CONCURRENCY',
    'EVENT_CONSUMER_BATCH_SIZE',
    'EVENT_CONSUMER_GROUP_BATCH_SIZE',
    'WORKER_HEALTH_PORT',
    'WORKER_HEALTH_BIND_ADDRESS',
    'LEDGER_INTEGRITY_CRON',
    'LEDGER_INTEGRITY_CRON_TZ',
    'PLANNING_PERIOD_LOOKAHEAD',
    'PLANNING_CLOSE_PENDING_DELAY_DAYS',
    'PLANNING_PERIODS_CRON',
    'COMMITMENTS_HORIZON_DAYS',
    'COMMITMENTS_SCHEDULER_CRON',
    'COMMITMENTS_SUBSCRIPTIONS_CRON',
    'DEBT_CARDS_CRON',
    'GOALS_DAILY_CRON',
    // add-basic-csv-import: jobs diarios de expiración y purga del staging.
    'IMPORT_STAGING_RETENTION',
    'IMPORT_MAINTENANCE_CRON',
    // add-import-pipeline: las etapas corren en el consumidor `imports.persist` del worker.
    'IMPORT_CSV_MAX_ROWS',
    'IMPORT_CSV_MAX_COLUMNS',
    'IMPORT_MAX_ROWS',
    'IMPORT_PROCESSING_TIMEOUT',
    'IMPORT_DUPLICATE_HIGH_SCORE',
    'IMPORT_DUPLICATE_LOW_SCORE',
    // add-pdf-statement-parser: el hilo aislado de extracción corre en el consumidor `imports.persist`.
    'IMPORT_PDF_EXTRACTION_TIMEOUT',
    'IMPORT_PDF_MAX_PAGES',
    'IMPORT_PDF_MAX_TEXT_ITEMS',
    'IMPORT_PDF_MAX_TEXT_CHARS',
    'IMPORT_PDF_WORKER_MAX_OLD_MB',
    'IMPORT_PDF_MIN_PAGE_TEXT_CHARS',
    // add-budgets: el consumidor de umbrales valora el gastado con la MISMA ventana que el Home (docs/33 D109).
    'REPORTING_RATE_VALIDITY_WINDOW',
    // add-alerts: el canal email y la retención de notificaciones viven en el worker (la API solo guarda el in-app).
    'EMAIL_DRIVER',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'EMAIL_FROM',
    'APP_PUBLIC_URL',
    'NOTIFY_EMAIL_MAX_ATTEMPTS',
    'NOTIFY_RETENTION',
    // add-workspace-export: el worker genera el export, importa y expira los archivos vencidos.
    ...EXPORT_PORTABILITY,
    // add-document-attachments: mantenimiento de documentos (expiración, cuarentena, huérfanos, purga y rotación).
    ...DOCUMENTS,
    'DOCUMENT_MAINTENANCE_CRON',
    'DOCUMENT_CONTENTS_RESTORE_MAX_BYTES',
    ...FX_PROVIDERS,
    'FX_PROVIDER_PARALELO_BO_URL',
    'FX_PROVIDER_DOLARAPI_BO_URL',
    'HEALTH_CHECK_TIMEOUT_MS',
    'SHUTDOWN_TIMEOUT_MS',
  ],
  // `migrate` también lee DATABASE_URL (y BFF_DATABASE_URL/WORKER_DATABASE_URL si existen): alinea las contraseñas
  // de `pf_app`/`pf_bff`/`pf_worker`.
  migrate: [
    ...GENERAL,
    'DATABASE_MIGRATOR_URL',
    'DATABASE_URL',
    'BFF_DATABASE_URL',
    'WORKER_DATABASE_URL',
    ...OBJECT_STORAGE,
    'OBJECT_STORAGE_ENSURE_BUCKET',
    'OBJECT_STORAGE_CORS_ORIGINS',
    'OBJECT_STORAGE_EXPORTS_BUCKET',
    'OBJECT_STORAGE_QUARANTINE_BUCKET',
  ],
  // `seed` lee OIDC_ISSUER_URL para sembrar las identidades de la Minimal Seed (usuarios del realm de desarrollo).
  seed: [...GENERAL, ...PRODUCT, ...DATABASE, 'OIDC_ISSUER_URL', 'DEMO_DATA_ENABLED'],
  web: [
    ...GENERAL,
    'WEB_PUBLIC_URL',
    'FINANCE_API_URL',
    'OIDC_ISSUER_URL',
    'OIDC_DISCOVERY_URL',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_SCOPES',
    'BFF_DATABASE_URL',
    'BFF_SESSION_ENC_KEY',
    'SESSION_IDLE_TIMEOUT',
    'SESSION_ABSOLUTE_TIMEOUT',
  ],
} as const satisfies Record<AppName, readonly VariableName[]>;
