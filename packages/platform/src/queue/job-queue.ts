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

export interface JobQueue {
  start(): Promise<void>;
  /** Crea la cola si no existe (idempotente). */
  ensureQueue(name: string): Promise<void>;
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
