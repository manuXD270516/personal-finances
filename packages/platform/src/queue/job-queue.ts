/**
 * Puerto de cola de jobs (ADR-0008). El adapter por defecto es pg-boss; BullMQ/Valkey es opcional.
 *
 * Todo job viaja en un envelope que transporta el contexto de correlación y el `traceparent` W3C
 * **en los datos del job** (docs/18 §3.3, SPIKE-10): el worker restaura ambos antes de ejecutar el handler,
 * así que las líneas de log de la API y del worker comparten `correlation_id`.
 */
export interface JobEnvelope<P extends object = object> {
  readonly v: 1;
  readonly correlationId: string;
  readonly traceContext: Readonly<Record<string, string>>;
  readonly payload: P;
}

export interface JobContext<P extends object> {
  readonly id: string;
  readonly queue: string;
  readonly attempt: number;
  readonly payload: P;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export type JobHandler<P extends object> = (job: JobContext<P>) => Promise<void>;

export interface WorkOptions {
  readonly concurrency: number;
}

/**
 * Opciones de una cola. Se aplican al crearla (la creación es idempotente: una cola existente conserva las suyas).
 * Sin opciones: cola estándar con 3 reintentos con backoff y expiración de 5 min.
 */
export interface QueueOptions {
  /**
   * Orden FIFO estricto por `key` (pg-boss `key_strict_fifo`): un job activo, en reintento o fallido retiene a los
   * siguientes de la misma clave; las demás claves siguen. Todo job de la cola debe traer `key`.
   */
  readonly orderedByKey?: boolean;
  /** Reintentos tras el primer intento (por defecto 3). */
  readonly retryLimit?: number;
  /** Retardo base del backoff exponencial, en segundos (por defecto 1). */
  readonly retryDelaySeconds?: number;
  /** Tope del backoff, en segundos (por defecto sin tope). */
  readonly retryDelayMaxSeconds?: number;
  /** Cola a la que se copia el job al agotar sus reintentos. Debe existir antes. */
  readonly deadLetter?: string;
  /** Segundos que un job puede seguir activo antes de considerarse abandonado (por defecto 300). */
  readonly expireInSeconds?: number;
}

/** Job encolado dentro de una transacción ajena (relay del outbox). */
export interface TransactionalJob<P extends object = object> {
  /** Id del job; un id repetido en la misma cola se ignora (deduplicación). */
  readonly id: string;
  /** Clave de orden (obligatoria en colas `orderedByKey`). */
  readonly key?: string;
  readonly payload: P;
  readonly correlationId: string;
  /** Contexto de traza W3C capturado al originarse el trabajo (p. ej. al escribir el evento en el outbox). */
  readonly traceContext: Readonly<Record<string, string>>;
}

/** Conexión de una transacción en curso (`pg.PoolClient` o equivalente). */
export interface QueueSqlExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface JobQueue {
  start(): Promise<void>;
  /** Crea la cola si no existe (idempotente). */
  ensureQueue(name: string, options?: QueueOptions): Promise<void>;
  /**
   * Encola `jobs` usando la conexión `tx`: los jobs existen solo si esa transacción confirma (publicación atómica
   * del relay del outbox, ADR-0008). La cola debe existir.
   */
  enqueueInTransaction<P extends object>(
    queue: string,
    jobs: readonly TransactionalJob<P>[],
    tx: QueueSqlExecutor,
  ): Promise<void>;
  /** Encola con el `correlationId` del contexto actual (o uno nuevo si no hay). Devuelve el id del job. */
  send<P extends object>(queue: string, payload: P): Promise<string>;
  work<P extends object>(queue: string, options: WorkOptions, handler: JobHandler<P>): Promise<void>;
  /** Deja de tomar jobs nuevos y espera a que terminen los activos. */
  drain(): Promise<void>;
  stop(): Promise<void>;
}

/** Job de plataforma sin efecto: prueba de extremo a extremo de cola + correlación API → worker. */
export const PLATFORM_PING_QUEUE = 'platform.ping';

export interface PlatformPingPayload {
  readonly requestedAt: string;
}

/**
 * Job de diagnóstico (solo PFOS_ENV=local|ci): tarda `durationMs` y luego confirma un efecto idempotente
 * (`platform.diagnostic_probe`, una fila por `key`). Lo usa el test de apagado ordenado (TC-PLATFORM-STACK-006).
 */
export const PLATFORM_PROBE_QUEUE = 'platform.probe';

export interface PlatformProbePayload {
  readonly key: string;
  readonly durationMs: number;
}

export function isJobEnvelope(value: unknown): value is JobEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<JobEnvelope>;
  return (
    v.v === 1 &&
    typeof v.correlationId === 'string' &&
    typeof v.traceContext === 'object' &&
    typeof v.payload === 'object'
  );
}
