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
  DATABASE_POOL_MAX: variable(positiveInt, {
    group: 'PostgreSQL',
    description: 'Tamaño máximo del pool de conexiones por proceso.',
    default: '10',
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

  // ── Worker ──
  WORKER_CONCURRENCY: variable(positiveInt, {
    group: 'Worker',
    description: 'Jobs procesados en paralelo por cola en cada proceso worker.',
    default: '4',
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
    'RATE_LIMIT_STORE',
    'RATE_LIMIT_READS_PER_MIN',
    'RATE_LIMIT_WRITES_PER_MIN',
  ],
  worker: [
    ...GENERAL,
    ...PRODUCT,
    ...OTEL,
    ...DATABASE,
    ...OBJECT_STORAGE,
    ...QUEUE,
    'WORKER_CONCURRENCY',
    'WORKER_HEALTH_PORT',
    'WORKER_HEALTH_BIND_ADDRESS',
    'HEALTH_CHECK_TIMEOUT_MS',
    'SHUTDOWN_TIMEOUT_MS',
  ],
  // `migrate` también lee DATABASE_URL: asegura que el rol de la app (`pf_app`) tenga esa credencial.
  migrate: [
    ...GENERAL,
    'DATABASE_MIGRATOR_URL',
    'DATABASE_URL',
    ...OBJECT_STORAGE,
    'OBJECT_STORAGE_ENSURE_BUCKET',
    'OBJECT_STORAGE_CORS_ORIGINS',
  ],
  seed: [...GENERAL, ...PRODUCT, ...DATABASE],
  web: [...GENERAL],
} as const satisfies Record<AppName, readonly VariableName[]>;
