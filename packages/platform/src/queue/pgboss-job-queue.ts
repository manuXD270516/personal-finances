import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { PgBoss, type JobResult, type JobWithMetadata } from 'pg-boss';
import { currentCorrelation, runWithCorrelation, uuidv7, type Logger } from '../logging/index.js';
import {
  isJobEnvelope,
  type BatchJobResult,
  type JobBatchHandler,
  type JobContext,
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
  /**
   * Timekeeper (cron) de pg-boss. Por omisión se deriva del rol como siempre (`consumer` lo enciende). Solo las pruebas
   * lo apagan en un consumidor (`false`): la instancia no dispara NINGÚN schedule de la tabla `pgboss.schedule`, ni
   * los propios ni los que dejó registrados otra instancia. Verificado en pg-boss 12.35.1: `PgBoss.start()` arranca el
   * timekeeper solo si `schedule` es verdadero (`dist/index.js`, `if (this.#config.schedule)`), y `schedule()` solo
   * escribe la fila, sin evaluar el cron.
   */
  readonly schedule?: boolean;
}

/** Schema de pg-boss. Lo crea la migración de bootstrap y lo instala/actualiza `migrate` (rol pf_migrator). */
export const PGBOSS_SCHEMA = 'pgboss';

const tracer = trace.getTracer('@pf/platform/queue');

/** Cada cuánto el consumidor revisa si las estadísticas del planificador quedaron atrás de la tabla de trabajos. */
const STATISTICS_CHECK_INTERVAL_MS = 15_000;
/** Escrituras (altas, estados) desde el último `ANALYZE` a partir de las cuales se refrescan las estadísticas. */
const STATISTICS_STALE_AFTER_MODIFICATIONS = 1_000;

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly queues = new Set<string>();
  private readonly working = new Set<string>();
  private started = false;
  private statisticsTimer: NodeJS.Timeout | undefined;
  private statisticsRefresh: Promise<void> | undefined;

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
      schedule: options.schedule ?? consumer,
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
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? 1));
    const workOptions = {
      localConcurrency: options.concurrency,
      batchSize,
      // Con lotes llenos el worker vuelve a consultar de inmediato (sin esperar el polling): sin esto un worker
      // procesaría a lo sumo un lote por intervalo (improve-event-throughput, design.md decisión 2).
      burstWhenBatchFull: batchSize > 1,
      // Cada trabajo del lote se confirma o falla por separado: el fallo de uno no reintenta a los demás.
      perJobResults: true,
      pollingIntervalSeconds: interval,
      notifyPollingIntervalSeconds: interval,
      includeMetadata: true,
    } as const;
    await this.boss.work<JobEnvelope<P>, unknown, typeof workOptions>(queue, workOptions, async (jobs) => {
      // En serie dentro del lote: la concurrencia de la cola (conexiones del pool) es `localConcurrency`, no
      // `localConcurrency × batchSize`. Un lote trae a lo sumo un trabajo por clave (`key_strict_fifo`).
      const results: JobResult[] = [];
      for (const job of jobs) {
        try {
          await this.runJob(queue, job, handler);
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          results.push({ id: job.id, status: 'failed', output: sanitizeError(err) });
        }
      }
      return results;
    });
    this.working.add(queue);
    this.keepStatisticsFresh();
  }

  async workBatch<P extends object>(
    queue: string,
    options: WorkOptions,
    handler: JobBatchHandler<P>,
  ): Promise<void> {
    await this.ensureQueue(queue);
    const interval = this.options.pollingIntervalSeconds;
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? 1));
    const workOptions = {
      localConcurrency: options.concurrency,
      batchSize,
      burstWhenBatchFull: batchSize > 1,
      perJobResults: true,
      pollingIntervalSeconds: interval,
      notifyPollingIntervalSeconds: interval,
      includeMetadata: true,
    } as const;
    await this.boss.work<JobEnvelope<P>, unknown, typeof workOptions>(queue, workOptions, async (jobs) => {
      const results: JobResult[] = [];
      const contexts: JobContext<P>[] = [];
      for (const job of jobs) {
        const data: unknown = job.data;
        if (!isJobEnvelope(data)) {
          this.options.logger.error(
            { 'job.queue': queue, 'job.id': job.id },
            'job without envelope rejected',
          );
          results.push({
            id: job.id,
            status: 'failed',
            output: sanitizeError(new Error('job without envelope')),
          });
          continue;
        }
        contexts.push({
          id: job.id,
          queue,
          attempt: job.retryCount + 1,
          payload: data.payload as P,
          correlationId: data.correlationId,
          signal: job.signal,
        });
      }
      if (contexts.length === 0) return results;
      const started = Date.now();
      const fields = { 'job.queue': queue, 'job.batch_size': contexts.length };
      this.options.logger.info(fields, 'job batch started');
      let outcomes: readonly BatchJobResult[];
      try {
        outcomes = await handler(contexts);
      } catch (err) {
        outcomes = contexts.map((c) => ({ id: c.id, error: err }));
      }
      const byId = new Map(outcomes.map((o) => [o.id, o]));
      for (const ctx of contexts) {
        const outcome = byId.get(ctx.id);
        if (outcome && outcome.error === undefined) {
          results.push({ id: ctx.id, status: 'completed' });
          continue;
        }
        const error = outcome?.error ?? new Error('batch handler returned no result for the job');
        this.options.logger.error(
          { 'job.queue': queue, 'job.id': ctx.id, 'job.attempt': ctx.attempt, err: sanitizeError(error) },
          'job failed',
        );
        results.push({ id: ctx.id, status: 'failed', output: sanitizeError(error) });
      }
      this.options.logger.info({ ...fields, duration_ms: Date.now() - started }, 'job batch completed');
      return results;
    });
    this.working.add(queue);
    this.keepStatisticsFresh();
  }

  /**
   * Mantiene frescas las estadísticas del planificador sobre las tablas de trabajos de pg-boss (fix-event-drain-variance).
   *
   * La consulta de entrega de una cola `key_strict_fifo` (`strict_fifo_heads` + anti-join por clave) cuesta del orden
   * de trabajos de la cola × cabezas de clave cuando el planificador estima 1 fila (estadísticas anteriores al
   * backlog): medido con 5 000 eventos en 500 agregados, un fetch pasa de ~5 ms a más de 500 ms y el drenado de 5 s a
   * más de 100 s. El autoanalyze llega con retraso (naptime de 60 s y umbral del 10 %), así que un backlog que se
   * encola y se drena en segundos casi siempre lo pierde. Se hace un `ANALYZE` al registrar el primer trabajador y
   * después, cada 15 s, solo si hay escrituras suficientes desde el último. Reutiliza el pool de pg-boss (sin
   * conexiones nuevas) y `ANALYZE` solo toma un lock que no bloquea lecturas ni escrituras.
   */
  private keepStatisticsFresh(): void {
    if (this.statisticsTimer) return;
    void this.refreshStatistics(true);
    this.statisticsTimer = setInterval(
      () => void this.refreshStatistics(false),
      STATISTICS_CHECK_INTERVAL_MS,
    );
    this.statisticsTimer.unref();
  }

  private refreshStatistics(force: boolean): Promise<void> {
    if (this.statisticsRefresh) return this.statisticsRefresh;
    const schema = this.options.schema ?? PGBOSS_SCHEMA;
    const run = async (): Promise<void> => {
      const db = this.boss.getDb();
      if (!force) {
        const { rows } = await db.executeSql(
          `SELECT coalesce(sum(n_mod_since_analyze), 0)::bigint AS n
             FROM pg_stat_user_tables WHERE schemaname = $1 AND relname = 'job_common'`,
          [schema],
        );
        if (Number((rows[0] as { n: string } | undefined)?.n ?? 0) < STATISTICS_STALE_AFTER_MODIFICATIONS)
          return;
      }
      // Los trabajos de las colas sin partición propia (todas las nuestras) viven en `job_common`; un ANALYZE de la
      // tabla padre `job` solo toma estadísticas del conjunto y no actualiza las de la partición.

      await db.executeSql(`ANALYZE "${schema.replaceAll('"', '""')}".job_common`);
    };
    this.statisticsRefresh = run()
      .catch((err: unknown) => {
        this.options.logger.warn({ err: sanitizeError(err) }, 'job queue statistics refresh failed');
      })
      .finally(() => {
        this.statisticsRefresh = undefined;
      });
    return this.statisticsRefresh;
  }

  private stopStatisticsRefresh(): void {
    if (this.statisticsTimer) clearInterval(this.statisticsTimer);
    this.statisticsTimer = undefined;
  }

  private async runJob<P extends object>(
    queue: string,
    job: JobWithMetadata<JobEnvelope<P>>,
    handler: JobHandler<P>,
  ): Promise<void> {
    const data: unknown = job.data;
    if (!isJobEnvelope(data)) {
      this.options.logger.error({ 'job.queue': queue, 'job.id': job.id }, 'job without envelope rejected');
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
    this.stopStatisticsRefresh();
    await Promise.all([...this.working].map((q) => this.boss.offWork(q, { wait: true })));
    this.working.clear();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopStatisticsRefresh();
    await this.statisticsRefresh;
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
