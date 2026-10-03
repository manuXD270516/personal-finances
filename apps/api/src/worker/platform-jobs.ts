import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ensureAuditPartitions } from '@pf/audit/interface/audit.module';
import { purgeExpiredIdempotencyKeys, runWithRequestContext } from '@pf/platform/api';
import { purgeDeliveredEvents } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { JOB_QUEUE, LOGGER } from '@pf/platform/nest';
import {
  PLATFORM_PING_QUEUE,
  PLATFORM_PROBE_QUEUE,
  type JobQueue,
  type PlatformPingPayload,
  type PlatformProbePayload,
} from '@pf/platform/queue';
import type { Pool } from 'pg';

const WORKER_OPTIONS = Symbol.for('pf.api.WorkerOptions');
const DB_POOL = Symbol.for('pf.api.DbPool');

export interface WorkerModuleDeps {
  readonly queue: JobQueue;
  readonly logger: Logger;
  readonly pool: Pool;
  readonly concurrency: number;
  /** Habilita el job de diagnóstico `platform.probe` (solo local/ci). */
  readonly diagnostics: boolean;
}

/** Duración máxima aceptada para el job de diagnóstico (no debe superar el período de gracia). */
const MAX_PROBE_DURATION_MS = 20_000;

/** Purga de claves de idempotencia vencidas (design §3): cada 15 min; el DELETE es idempotente entre réplicas. */
export const IDEMPOTENCY_PURGE_INTERVAL_MS = 15 * 60_000;

/** Purga de eventos publicados (7 días) e inbox (30 días) cada hora (openspec add-event-outbox, design §7). */
export const EVENT_PURGE_INTERVAL_MS = 60 * 60_000;

/** Particiones de `audit.audit_log` (openspec add-audit-trail, design §5): una vez al día y al arrancar. */
export const AUDIT_PARTITIONS_INTERVAL_MS = 24 * 60 * 60_000;
/** Meses de anticipación con que se crean las particiones mensuales de auditoría. */
export const AUDIT_PARTITIONS_MONTHS_AHEAD = 2;

/** Registra los handlers de jobs de plataforma al arrancar el contexto del worker. */
@Injectable()
export class PlatformJobsRegistrar implements OnApplicationBootstrap, OnApplicationShutdown {
  private purgeTimer: NodeJS.Timeout | undefined;
  private eventPurgeTimer: NodeJS.Timeout | undefined;
  private auditPartitionsTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(WORKER_OPTIONS) private readonly options: { concurrency: number; diagnostics: boolean },
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.start();
    // platform.ping: no-op; existe para verificar cola + correlación de extremo a extremo.
    await this.queue.work<PlatformPingPayload>(
      PLATFORM_PING_QUEUE,
      { concurrency: this.options.concurrency },
      async (job) => {
        this.logger.info({ 'job.queue': job.queue, 'job.id': job.id }, 'platform ping processed');
      },
    );
    const queues = [PLATFORM_PING_QUEUE];
    if (this.options.diagnostics) {
      // platform.probe: trabajo "largo" con un efecto confirmado en la base, idempotente por `key`. El job solo
      // se marca completado después de que el INSERT hizo commit; un reintento no duplica el efecto.
      await this.queue.work<PlatformProbePayload>(
        PLATFORM_PROBE_QUEUE,
        { concurrency: this.options.concurrency },
        async (job) => {
          const duration = Math.min(Math.max(job.payload.durationMs, 0), MAX_PROBE_DURATION_MS);
          await new Promise((r) => setTimeout(r, duration));
          await this.pool.query(
            `INSERT INTO platform.diagnostic_probe (key, job_id) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
            [job.payload.key, job.id],
          );
          this.logger.info({ 'job.queue': job.queue, 'job.id': job.id }, 'platform probe effect committed');
        },
      );
      queues.push(PLATFORM_PROBE_QUEUE);
    }
    this.logger.info({ queues }, 'worker consuming');
    this.purgeTimer = setInterval(() => void this.purgeIdempotencyKeys(), IDEMPOTENCY_PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
    void this.purgeIdempotencyKeys();
    this.eventPurgeTimer = setInterval(() => void this.purgeEvents(), EVENT_PURGE_INTERVAL_MS);
    this.eventPurgeTimer.unref();
    void this.purgeEvents();
    this.auditPartitionsTimer = setInterval(
      () => void this.ensureAuditPartitions(),
      AUDIT_PARTITIONS_INTERVAL_MS,
    );
    this.auditPartitionsTimer.unref();
    void this.ensureAuditPartitions();
  }

  onApplicationShutdown(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    if (this.eventPurgeTimer) clearInterval(this.eventPurgeTimer);
    if (this.auditPartitionsTimer) clearInterval(this.auditPartitionsTimer);
  }

  /**
   * Job `audit.ensure-partitions` (rol pf_worker, función SECURITY DEFINER acotada): crea las particiones del mes
   * actual y los 2 siguientes. Si la partición DEFAULT tiene filas, ALERTA (log `error`, alarma de logs): alguna
   * escritura llegó sin su partición mensual.
   */
  async ensureAuditPartitions(): Promise<{ created: number; defaultRows: number } | undefined> {
    return runWithRequestContext(
      { actor: { type: 'WORKER', process: 'audit.ensure-partitions' }, origin: 'system' },
      async () => {
        try {
          const result = await ensureAuditPartitions(this.pool, AUDIT_PARTITIONS_MONTHS_AHEAD);
          this.logger.info({ created: result.created }, 'audit partitions ensured');
          if (result.defaultRows > 0) {
            this.logger.error(
              { alert: 'audit.default_partition_rows', rows: result.defaultRows },
              'audit rows landed in the DEFAULT partition',
            );
          }
          return result;
        } catch (err) {
          this.logger.warn(
            { err: { type: err instanceof Error ? err.name : typeof err } },
            'audit partition maintenance failed',
          );
          return undefined;
        }
      },
    );
  }

  /** Borra (rol pf_maintenance) eventos publicados e inbox vencidos; nunca pendientes ni dead-letters. */
  async purgeEvents(): Promise<void> {
    try {
      const purged = await purgeDeliveredEvents(this.pool);
      this.logger.info({ purged }, 'delivered events purged');
    } catch (err) {
      this.logger.warn({ err: { type: err instanceof Error ? err.name : typeof err } }, 'event purge failed');
    }
  }

  /** Borra (rol pf_maintenance) las claves con `expires_at` vencido. Nunca registra respuestas almacenadas. */
  async purgeIdempotencyKeys(): Promise<number> {
    try {
      const purged = await purgeExpiredIdempotencyKeys(this.pool);
      this.logger.info({ purged }, 'idempotency keys purged');
      return purged;
    } catch (err) {
      this.logger.warn(
        { err: { type: err instanceof Error ? err.name : typeof err } },
        'idempotency purge failed',
      );
      return 0;
    }
  }
}

/** Composition root del proceso worker (misma imagen que la API, otro comando — ADR-0011). */
@Module({})
export class WorkerModule {
  static register(deps: WorkerModuleDeps): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: JOB_QUEUE, useValue: deps.queue },
        { provide: LOGGER, useValue: deps.logger },
        { provide: DB_POOL, useValue: deps.pool },
        {
          provide: WORKER_OPTIONS,
          useValue: { concurrency: deps.concurrency, diagnostics: deps.diagnostics },
        },
        PlatformJobsRegistrar,
      ],
    };
  }
}
