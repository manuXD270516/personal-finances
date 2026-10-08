import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { PgBoss } from 'pg-boss';
import { currentCorrelation, runWithCorrelation, uuidv7, type Logger } from '../logging/index.js';
import {
  isJobEnvelope,
  type JobEnvelope,
  type JobHandler,
  type JobQueue,
  type QueueOptions,
  type QueueSqlExecutor,
  type TransactionalJob,
  type WorkOptions,
} from './job-queue.js';

export interface PgBossJobQueueOptions {
  readonly connectionString: string;
  readonly logger: Logger;
  /**
   * Intervalo de polling en segundos (>= 0.5). Se fija explícitamente para `pollingIntervalSeconds` y
   * `notifyPollingIntervalSeconds`: con los defaults (2 s / 30 s) la cola "se atasca" (SPIKE-05 hallazgo 4).
   */
  readonly pollingIntervalSeconds: number;
  /** `producer` (API): sin supervisión ni mantenimiento. `consumer` (worker): supervisa la cola. */
  readonly role: 'producer' | 'consumer';
  readonly poolMax?: number;
  readonly schema?: string;
}

/** Schema de pg-boss. Lo crea la migración de bootstrap y lo instala/actualiza `migrate` (rol pf_migrator). */
export const PGBOSS_SCHEMA = 'pgboss';

const tracer = trace.getTracer('@pf/platform/queue');

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly queues = new Set<string>();
  private readonly working = new Set<string>();
  private started = false;

  constructor(private readonly options: PgBossJobQueueOptions) {
    const consumer = options.role === 'consumer';
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.schema ?? PGBOSS_SCHEMA,
      application_name: `pfos-${options.role}`,
      max: options.poolMax ?? 4,
      // La app (rol pf_app, sin DDL) nunca instala ni migra el schema: lo hace el comando `migrate`
      // (installPgBossSchema). Si falta o está desactualizado, start() falla en vez de intentar DDL.
      migrate: false,
      supervise: consumer,
      // Timekeeper (cron) solo en el worker: los jobs periódicos del ledger (add-ledger-core 5.6).
      schedule: consumer,
      useListenNotify: consumer,
    });
    this.boss.on('error', (err: unknown) =>
      options.logger.error({ err: sanitizeError(err) }, 'job queue error'),
    );
    this.boss.on('warning', (w: { message?: string }) =>
      options.logger.warn({ warning: w.message }, 'job queue warning'),
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  async ensureQueue(name: string, options: QueueOptions = {}): Promise<void> {
    if (this.queues.has(name)) return;
    await this.boss.createQueue(name, {
      notify: true,
      policy: options.orderedByKey ? 'key_strict_fifo' : 'standard',
      retryLimit: options.retryLimit ?? 3,
      retryDelay: options.retryDelaySeconds ?? 1,
      retryBackoff: true,
      ...(options.retryDelayMaxSeconds !== undefined ? { retryDelayMax: options.retryDelayMaxSeconds } : {}),
      ...(options.deadLetter ? { deadLetter: options.deadLetter } : {}),
      expireInSeconds: options.expireInSeconds ?? 300,
    });
    this.queues.add(name);
  }

  async enqueueInTransaction<P extends object>(
    queue: string,
    jobs: readonly TransactionalJob<P>[],
    tx: QueueSqlExecutor,
  ): Promise<void> {
    if (jobs.length === 0) return;
    await this.boss.insert(
      queue,
      jobs.map((job) => {
        const data: JobEnvelope<P> = {
          v: 1,
          correlationId: job.correlationId,
          traceContext: job.traceContext,
          payload: job.payload,
        };
        return {
          id: job.id,
          data,
          ...(job.key ? { singletonKey: job.key } : {}),
          ...(job.startAfter ? { startAfter: job.startAfter } : {}),
        };
      }),
      { db: { executeSql: (text: string, values?: unknown[]) => tx.query(text, values) } },
    );
  }

  async send<P extends object>(queue: string, payload: P): Promise<string> {
    await this.ensureQueue(queue);
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);
    const envelope: JobEnvelope<P> = {
      v: 1,
      correlationId: currentCorrelation()?.correlationId ?? uuidv7(),
      traceContext,
      payload,
    };
    const id = await this.boss.send(queue, envelope);
    if (!id) throw new Error(`pg-boss did not accept the job for queue ${queue}`);
    this.options.logger.info({ 'job.queue': queue, 'job.id': id }, 'job enqueued');
    return id;
  }

  async work<P extends object>(queue: string, options: WorkOptions, handler: JobHandler<P>): Promise<void> {
    await this.ensureQueue(queue);
    const interval = this.options.pollingIntervalSeconds;
    await this.boss.work<JobEnvelope<P>>(
      queue,
      {
        localConcurrency: options.concurrency,
        batchSize: 1,
        pollingIntervalSeconds: interval,
        notifyPollingIntervalSeconds: interval,
        includeMetadata: true,
      },
      async ([job]) => {
        if (!job) return;
        const data: unknown = job.data;
        if (!isJobEnvelope(data)) {
          this.options.logger.error(
            { 'job.queue': queue, 'job.id': job.id },
            'job without envelope rejected',
          );
          throw new Error('job without envelope');
        }
        const parent = propagation.extract(ROOT_CONTEXT, data.traceContext);
        await runWithCorrelation({ correlationId: data.correlationId }, () =>
          context.with(parent, () =>
            tracer.startActiveSpan(`job.process ${queue}`, { kind: SpanKind.CONSUMER }, async (span) => {
              const fields = { 'job.queue': queue, 'job.id': job.id, 'job.attempt': job.retryCount + 1 };
              const started = Date.now();
              this.options.logger.info(fields, 'job started');
              try {
                await handler({
                  id: job.id,
                  queue,
                  attempt: job.retryCount + 1,
                  payload: data.payload as P,
                  correlationId: data.correlationId,
                  signal: job.signal,
                });
                this.options.logger.info({ ...fields, duration_ms: Date.now() - started }, 'job completed');
              } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                this.options.logger.error(
                  { ...fields, duration_ms: Date.now() - started, err: sanitizeError(err) },
                  'job failed',
                );
                throw err;
              } finally {
                span.end();
              }
            }),
          ),
        );
      },
    );
    this.working.add(queue);
  }

  async schedule<P extends object>(
    queue: string,
    cron: string,
    payload: P,
    options: { readonly tz?: string } = {},
  ): Promise<void> {
    await this.ensureQueue(queue);
    // Los envíos del cron no pasan por `send`: el envelope se fija al programar (correlación propia de la
    // programación; cada ejecución tiene además su `job.id`).
    const envelope: JobEnvelope<P> = { v: 1, correlationId: uuidv7(), traceContext: {}, payload };
    await this.boss.schedule(queue, cron, envelope, { tz: options.tz ?? 'UTC' });
    this.options.logger.info({ 'job.queue': queue, cron, tz: options.tz ?? 'UTC' }, 'job scheduled');
  }

  async unschedule(queue: string): Promise<void> {
    await this.boss.unschedule(queue);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.working].map((q) => this.boss.offWork(q, { wait: true })));
    this.working.clear();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, close: true, timeout: 10_000 });
    this.started = false;
  }
}

/**
 * Instala o actualiza el schema de pg-boss (DDL). Solo lo llama el comando `migrate` con el rol propietario
 * (`pf_migrator`); los permisos de `pf_app` sobre el schema los fijan la migración de bootstrap
 * (default privileges) y `grantPgBossToApp`.
 */
export async function installPgBossSchema(connectionString: string, schema = PGBOSS_SCHEMA): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    schema,
    application_name: 'pfos-migrate',
    max: 2,
    migrate: true,
    supervise: false,
    schedule: false,
    useListenNotify: false,
  });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.stop({ graceful: false, close: true });
}

/** Solo nombre/código/mensaje: los errores de `pg` pueden traer detalles del servidor, nunca parámetros. */
function sanitizeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { type: err.name, message: err.message, ...(typeof code === 'string' ? { code } : {}) };
  }
  return { type: typeof err };
}
