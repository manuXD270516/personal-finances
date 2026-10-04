import type { Pool } from 'pg';
import type { SqlExecutor } from '../api/idempotency/store.js';
import { runWithRequestContext } from '../api/context/request-context.js';
import { PgUnitOfWork, requireSqlExecutor } from '../api/db/command-transaction.js';
import { currentCorrelation, runWithCorrelation, type Logger } from '../logging/index.js';
import type { JobContext, JobQueue, QueueOptions } from '../queue/job-queue.js';
import { fullEventName, isEventEnvelope, type EventEnvelope } from './envelope.js';
import type { EventDeliveryMetrics } from './metrics.js';
import type { EventRoute, EventRoutes } from './relay.js';

export interface EventHandlerContext {
  readonly consumer: string;
  /** Intento actual (1 = primera entrega). */
  readonly attempt: number;
  /** Conexión de la transacción del consumidor (contexto RLS = workspace del evento; inbox incluido). */
  readonly tx: SqlExecutor;
  readonly signal: AbortSignal;
}

export type EventHandler = (event: EventEnvelope, ctx: EventHandlerContext) => Promise<void>;

/** Suscripción declarativa de un consumidor (openspec add-event-outbox, design §6). */
export interface EventConsumerDefinition {
  /** Nombre estable (`<contexto>.<propósito>`, minúsculas): clave del inbox y nombre de la cola. */
  readonly consumer: string;
  readonly events: readonly { readonly type: string; readonly version: number }[];
  readonly handler: EventHandler;
  /** Jobs en paralelo de este consumidor (distintos agregados; el orden por agregado lo da la cola). */
  readonly concurrency?: number;
  /** Reintentos tras el primer intento (por defecto 5, NFR-REL-012). */
  readonly retryLimit?: number;
  /** Retardo base del backoff exponencial (s, por defecto 1). */
  readonly retryDelaySeconds?: number;
  /** Tope del backoff (s, por defecto 3600). */
  readonly retryDelayMaxSeconds?: number;
}

const CONSUMER_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const MAX_ERROR_LENGTH = 1000;
export const DEFAULT_EVENT_RETRY_LIMIT = 5;

export const eventQueueName = (consumer: string): string => `events.${consumer}`;
export const deadLetterQueueName = (consumer: string): string => `events.${consumer}.dlq`;

export type DeliveryOutcome = 'applied' | 'duplicate' | 'skipped';

function queueOptions(def: EventConsumerDefinition): QueueOptions {
  return {
    orderedByKey: true,
    retryLimit: def.retryLimit ?? DEFAULT_EVENT_RETRY_LIMIT,
    retryDelaySeconds: def.retryDelaySeconds ?? 1,
    retryDelayMaxSeconds: def.retryDelayMaxSeconds ?? 3600,
    deadLetter: deadLetterQueueName(def.consumer),
  };
}

function describeError(err: unknown): string {
  return (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, MAX_ERROR_LENGTH);
}

/** Registro de consumidores: rutas para el relay y definiciones para el runtime. */
export class EventSubscriptions implements EventRoutes {
  private readonly defs = new Map<string, EventConsumerDefinition>();

  constructor(definitions: readonly EventConsumerDefinition[] = []) {
    for (const def of definitions) this.add(def);
  }

  add(def: EventConsumerDefinition): this {
    if (!CONSUMER_NAME.test(def.consumer)) throw new Error(`nombre de consumidor inválido: ${def.consumer}`);
    if (this.defs.has(def.consumer)) throw new Error(`consumidor duplicado: ${def.consumer}`);
    this.defs.set(def.consumer, def);
    return this;
  }

  definitions(): readonly EventConsumerDefinition[] {
    return [...this.defs.values()];
  }

  routesFor(eventType: string, eventVersion: number): readonly EventRoute[] {
    return this.definitions()
      .filter((d) => d.events.some((e) => e.type === eventType && e.version === eventVersion))
      .map((d) => ({ queue: eventQueueName(d.consumer), options: queueOptions(d) }));
  }
}

export interface EventConsumerRuntimeOptions {
  /** Pool con el rol `pf_worker` (inbox, dead-letter y efectos con RLS del workspace del evento). */
  readonly pool: Pool;
  readonly queue: JobQueue;
  readonly subscriptions: EventSubscriptions;
  readonly logger: Logger;
  readonly metrics?: EventDeliveryMetrics;
}

/**
 * Consumidores idempotentes (openspec add-event-outbox, design §6). Por cada consumidor: cola `events.<consumer>`
 * (`key_strict_fifo` por agregado, backoff exponencial, dead-letter `events.<consumer>.dlq`). Cada entrega corre en
 * UNA transacción con el contexto RLS del workspace del evento: `INSERT` en `platform.inbox` + efecto del handler;
 * si el evento ya estaba, es un duplicado (no-op). El adapter de la cola restaura `correlationId` y `traceparent`.
 */
export class EventConsumerRuntime {
  private readonly uow: PgUnitOfWork;
  private started = false;

  constructor(private readonly options: EventConsumerRuntimeOptions) {
    this.uow = new PgUnitOfWork(options.pool);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const def of this.options.subscriptions.definitions()) {
      const dlq = deadLetterQueueName(def.consumer);
      await this.options.queue.ensureQueue(dlq);
      await this.options.queue.ensureQueue(eventQueueName(def.consumer), queueOptions(def));
      await this.options.queue.work<EventEnvelope>(
        eventQueueName(def.consumer),
        { concurrency: def.concurrency ?? 1 },
        (job) => this.process(def, job),
      );
      await this.options.queue.work<EventEnvelope>(dlq, { concurrency: 1 }, (job) =>
        this.onDeadLetterJob(def, job),
      );
    }
    this.options.logger.info(
      { consumers: this.options.subscriptions.definitions().map((d) => d.consumer) },
      'event consumers started',
    );
  }

  private async process(def: EventConsumerDefinition, job: JobContext<EventEnvelope>): Promise<void> {
    const event = job.payload;
    const retryLimit = def.retryLimit ?? DEFAULT_EVENT_RETRY_LIMIT;
    try {
      await this.deliver(def, event, { attempt: job.attempt, signal: job.signal });
    } catch (err) {
      if (job.attempt > retryLimit && isEventEnvelope(event)) {
        await this.recordDeadLetter(def.consumer, event, describeError(err), job.attempt);
      }
      throw err;
    }
  }

  /**
   * Entrega un evento a un consumidor (inbox + efecto en una transacción). La usa el worker de la cola; los tests la
   * invocan directamente para simular re-entregas.
   */
  async deliver(
    def: EventConsumerDefinition,
    event: unknown,
    meta: { attempt?: number; signal?: AbortSignal } = {},
  ): Promise<DeliveryOutcome> {
    if (!isEventEnvelope(event)) throw new Error(`entrega sin envelope válido para ${def.consumer}`);
    // Atribución (openspec add-audit-trail, design §4): lo que el consumidor audite o publique lo hace el proceso
    // `<consumer>` (actor WORKER, origen system), con la correlación del evento y el evento como causa.
    const correlationId = typeof event.correlationId === 'string' ? event.correlationId : undefined;
    const attribution = {
      actor: { type: 'WORKER' as const, process: def.consumer },
      origin: 'system' as const,
    };
    const run = () =>
      runWithRequestContext({ ...attribution, causationId: event.eventId }, () =>
        this.apply(def, event, meta),
      );
    const ambient = currentCorrelation();
    const outcome =
      correlationId && ambient?.correlationId !== correlationId
        ? await runWithCorrelation({ correlationId }, run)
        : await run();
    if (outcome === 'skipped') {
      this.options.logger.info(
        { consumer: def.consumer, event: fullEventName(event), event_id: event.eventId },
        'event for a retired demo workspace skipped',
      );
    }
    if (outcome === 'duplicate') {
      this.options.metrics?.duplicate(def.consumer);
      this.options.logger.info(
        { consumer: def.consumer, event: fullEventName(event), event_id: event.eventId },
        'duplicate event skipped',
      );
    }
    return outcome;
  }

  private apply(
    def: EventConsumerDefinition,
    event: EventEnvelope,
    meta: { attempt?: number; signal?: AbortSignal },
  ): Promise<DeliveryOutcome> {
    return this.uow.run({ userId: null, workspaceId: event.workspaceId }, async () => {
      const tx = requireSqlExecutor();
      // add-demo-data (ADR-0026): un workspace demo archivado o purgado ya no recibe efectos (no-op idempotente y SIN
      // fila de inbox: la purga no debe dejar rastro del workspace).
      const retired = await tx.query('SELECT platform.workspace_is_retired($1) AS retired', [
        event.workspaceId,
      ]);
      if ((retired.rows[0] as { retired?: boolean } | undefined)?.retired === true) return 'skipped' as const;
      const inserted = await tx.query(
        `INSERT INTO platform.inbox (consumer, event_id, workspace_id) VALUES ($1, $2, $3)
         ON CONFLICT (consumer, event_id) DO NOTHING RETURNING 1`,
        [def.consumer, event.eventId, event.workspaceId],
      );
      if (inserted.rows.length === 0) return 'duplicate' as const;
      await def.handler(event, {
        consumer: def.consumer,
        attempt: meta.attempt ?? 1,
        tx,
        signal: meta.signal ?? new AbortController().signal,
      });
      return 'applied' as const;
    });
  }

  /** pg-boss copió el job a la DLQ (incluye la caída del proceso en el último intento). */
  private async onDeadLetterJob(def: EventConsumerDefinition, job: JobContext<EventEnvelope>): Promise<void> {
    if (!isEventEnvelope(job.payload)) {
      this.options.logger.error(
        { consumer: def.consumer, 'job.id': job.id },
        'dead-letter job without envelope',
      );
      return;
    }
    await this.recordDeadLetter(
      def.consumer,
      job.payload,
      'reintentos agotados',
      (def.retryLimit ?? DEFAULT_EVENT_RETRY_LIMIT) + 1,
    );
  }

  private async recordDeadLetter(
    consumer: string,
    event: EventEnvelope,
    error: string,
    attempts: number,
  ): Promise<void> {
    const { rowCount } = await this.options.pool.query(
      `INSERT INTO platform.dead_letter (consumer, event_id, workspace_id, event_type, envelope, error, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (consumer, event_id) DO NOTHING`,
      [
        consumer,
        event.eventId,
        event.workspaceId,
        fullEventName(event),
        JSON.stringify(event),
        error,
        attempts,
      ],
    );
    if ((rowCount ?? 0) > 0) {
      this.options.metrics?.deadLettered(consumer);
      this.options.logger.error(
        { consumer, event: fullEventName(event), event_id: event.eventId, attempts },
        'event dead-lettered',
      );
    }
  }
}
