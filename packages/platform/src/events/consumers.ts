import type { Pool } from 'pg';
import type { SqlExecutor } from '../api/idempotency/store.js';
import { runWithRequestContext } from '../api/context/request-context.js';
import { PgUnitOfWork, requireSqlExecutor } from '../api/db/command-transaction.js';
import { currentCorrelation, runWithCorrelation, type Logger } from '../logging/index.js';
import type { BatchJobResult, JobContext, JobQueue, QueueOptions } from '../queue/job-queue.js';
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

/**
 * Efecto por conjunto de un consumidor agrupado (optimize-consumer-throughput): recibe los eventos NUEVOS (no
 * registrados aún en el inbox) de un mismo workspace de un lote, de agregados distintos, dentro de una sola transacción
 * con el contexto RLS de ese workspace. Debe equivaler a aplicar `handler` a cada evento de a uno, en cualquier orden.
 */
export type EventGroupHandler = (events: readonly EventEnvelope[], ctx: EventHandlerContext) => Promise<void>;

/** Suscripción declarativa de un consumidor (openspec add-event-outbox, design §6). */
export interface EventConsumerDefinition {
  /** Nombre estable (`<contexto>.<propósito>`, minúsculas): clave del inbox y nombre de la cola. */
  readonly consumer: string;
  readonly events: readonly { readonly type: string; readonly version: number }[];
  readonly handler: EventHandler;
  /**
   * Entrega agrupada, opt-in (optimize-consumer-throughput, design.md decisión 2): solo para consumidores cuyo efecto
   * sobre un conjunto de eventos de agregados distintos es el mismo en cualquier orden y equivale a aplicarlos de a
   * uno (decisión 3). Exige `groupHandler`; `handler` sigue siendo el respaldo evento por evento si el grupo falla.
   * `maxBatch`: trabajos por lote (por defecto `EVENT_CONSUMER_GROUP_BATCH_SIZE` = 100; 1–500).
   */
  readonly grouping?: { readonly maxBatch?: number };
  readonly groupHandler?: EventGroupHandler;
  /**
   * Jobs en paralelo de este consumidor (distintos agregados; el orden por agregado lo da la cola). Por defecto,
   * `EVENT_CONSUMER_CONCURRENCY`. Cada unidad de concurrencia puede ocupar una conexión del pool mientras entrega.
   */
  readonly concurrency?: number;
  /** Eventos por consulta a la cola (por defecto `EVENT_CONSUMER_BATCH_SIZE`); cada uno se confirma o falla aparte. */
  readonly batchSize?: number;
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
/** Defaults de `EVENT_CONSUMER_CONCURRENCY` / `EVENT_CONSUMER_BATCH_SIZE` (improve-event-throughput, design.md decisiones 1 y 2). */
export const DEFAULT_EVENT_CONSUMER_CONCURRENCY = 4;
export const DEFAULT_EVENT_CONSUMER_BATCH_SIZE = 10;
/** Lote de un consumidor agrupado (`EVENT_CONSUMER_GROUP_BATCH_SIZE`, optimize-consumer-throughput) y su tope. */
export const DEFAULT_EVENT_CONSUMER_GROUP_BATCH_SIZE = 100;
export const MAX_EVENT_CONSUMER_GROUP_BATCH_SIZE = 500;
/**
 * Conexiones del pool del worker que NO son entregas de consumidores: el lote del relay, el readiness, la
 * dead-letter y los jobs periódicos. Se descuentan del pool antes de repartir la concurrencia (TC-PLATFORM-EVENTS-018).
 */
export const RESERVED_WORKER_CONNECTIONS = 4;

export interface ConsumerDefaults {
  readonly concurrency?: number;
  readonly batchSize?: number;
}

/** Concurrencia y tamaño de lote efectivos de un consumidor (su definición manda sobre los defaults). */
export function consumerWorkOptions(
  def: Pick<EventConsumerDefinition, 'concurrency' | 'batchSize'>,
  defaults: ConsumerDefaults = {},
): { concurrency: number; batchSize: number } {
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
  return {
    concurrency: positive(
      def.concurrency,
      positive(defaults.concurrency, DEFAULT_EVENT_CONSUMER_CONCURRENCY),
    ),
    batchSize: positive(def.batchSize, positive(defaults.batchSize, DEFAULT_EVENT_CONSUMER_BATCH_SIZE)),
  };
}

/** Σ de la concurrencia efectiva de todos los consumidores. */
export function totalConsumerConcurrency(
  defs: readonly Pick<EventConsumerDefinition, 'concurrency' | 'batchSize'>[],
  defaults: ConsumerDefaults = {},
): number {
  return defs.reduce((sum, def) => sum + consumerWorkOptions(def, defaults).concurrency, 0);
}

/**
 * Presupuesto de conexiones (improve-event-throughput, design.md decisión 3): la concurrencia sumada de los
 * consumidores más las conexiones reservadas no puede exceder el pool del worker. Falla con un mensaje que indica la
 * concurrencia total y el tamaño del pool.
 */
export function assertConsumerConnectionBudget(options: {
  readonly consumers: readonly Pick<EventConsumerDefinition, 'consumer' | 'concurrency' | 'batchSize'>[];
  readonly defaults?: ConsumerDefaults;
  readonly poolMax: number;
  readonly reserved?: number;
}): void {
  const reserved = options.reserved ?? RESERVED_WORKER_CONNECTIONS;
  const total = totalConsumerConcurrency(options.consumers, options.defaults);
  if (total + reserved <= options.poolMax) return;
  throw new Error(
    `Configuración de consumidores inválida: la concurrencia total de ${options.consumers.length} consumidores ` +
      `de eventos es ${total} (+ ${reserved} conexiones reservadas) y excede el pool de conexiones del worker ` +
      `(DATABASE_POOL_MAX=${options.poolMax}). Reduce EVENT_CONSUMER_CONCURRENCY o sube DATABASE_POOL_MAX.`,
  );
}

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
    if (def.grouping && !def.groupHandler) {
      throw new Error(`el consumidor ${def.consumer} declara grouping sin groupHandler`);
    }
    if (def.groupHandler && !def.grouping) {
      throw new Error(`el consumidor ${def.consumer} define groupHandler sin declarar grouping`);
    }
    const maxBatch = def.grouping?.maxBatch;
    if (
      maxBatch !== undefined &&
      (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_EVENT_CONSUMER_GROUP_BATCH_SIZE)
    ) {
      throw new Error(
        `el consumidor ${def.consumer} declara un maxBatch inválido (${String(maxBatch)}): debe ser un entero de 1 a ${String(MAX_EVENT_CONSUMER_GROUP_BATCH_SIZE)}`,
      );
    }
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
  /** Concurrencia por defecto de los consumidores sin `concurrency` propia (`EVENT_CONSUMER_CONCURRENCY`). */
  readonly concurrency?: number;
  /** Tamaño de lote por defecto de los consumidores sin `batchSize` propio (`EVENT_CONSUMER_BATCH_SIZE`). */
  readonly batchSize?: number;
  /** Lote de los consumidores agrupados sin `maxBatch` propio (`EVENT_CONSUMER_GROUP_BATCH_SIZE`; por defecto 100). */
  readonly groupBatchSize?: number;
  /**
   * Solo pruebas y benchmarks (optimize-consumer-throughput): filtro de los consumidores que se ponen a trabajar. Por
   * defecto, todos; los demás conservan su cola (el relay sigue publicando en ella) sin consumirla.
   */
  readonly only?: (def: EventConsumerDefinition) => boolean;
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
    options.metrics?.trackConsumers(
      options.subscriptions.definitions().map((d) => d.consumer),
      eventQueueName,
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const only = this.options.only;
    for (const def of this.options.subscriptions.definitions()) {
      const dlq = deadLetterQueueName(def.consumer);
      await this.options.queue.ensureQueue(dlq);
      await this.options.queue.ensureQueue(eventQueueName(def.consumer), queueOptions(def));
      if (only && !only(def)) continue;
      if (def.grouping) {
        const { concurrency } = consumerWorkOptions(def, this.options);
        const groupBatch = def.grouping.maxBatch ?? this.options.groupBatchSize;
        await this.options.queue.workBatch<EventEnvelope>(
          eventQueueName(def.consumer),
          {
            concurrency,
            batchSize:
              groupBatch !== undefined && Number.isInteger(groupBatch) && groupBatch >= 1
                ? Math.min(groupBatch, MAX_EVENT_CONSUMER_GROUP_BATCH_SIZE)
                : DEFAULT_EVENT_CONSUMER_GROUP_BATCH_SIZE,
          },
          (jobs) => this.processGroup(def, jobs),
        );
      } else {
        await this.options.queue.work<EventEnvelope>(
          eventQueueName(def.consumer),
          consumerWorkOptions(def, this.options),
          (job) => this.process(def, job),
        );
      }
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
   * Entrega agrupada (optimize-consumer-throughput, decisión 2): agrupa el lote por workspace y aplica cada grupo en UNA
   * transacción (inbox multi-fila + una invocación de `groupHandler` con los eventos nuevos). Si la transacción del
   * grupo falla, la revierte y entrega cada evento del grupo con el camino individual (`process`), de modo que solo el
   * que falla queda en reintento con su backoff y su dead-letter.
   */
  private async processGroup(
    def: EventConsumerDefinition,
    jobs: readonly JobContext<EventEnvelope>[],
  ): Promise<readonly BatchJobResult[]> {
    const results = new Map<string, BatchJobResult>();
    const groups = new Map<string, JobContext<EventEnvelope>[]>();
    for (const job of jobs) {
      if (!isEventEnvelope(job.payload)) {
        results.set(job.id, {
          id: job.id,
          error: new Error(`entrega sin envelope válido para ${def.consumer}`),
        });
        continue;
      }
      const group = groups.get(job.payload.workspaceId);
      if (group) group.push(job);
      else groups.set(job.payload.workspaceId, [job]);
    }
    for (const group of groups.values()) {
      try {
        await this.deliverGroup(def, group);
        for (const job of group) results.set(job.id, { id: job.id });
      } catch (err) {
        this.options.metrics?.groupFallback(def.consumer);
        this.options.logger.warn(
          { consumer: def.consumer, group_size: group.length, err: describeError(err) },
          'event group failed, retrying one by one',
        );
        for (const job of group) {
          try {
            await this.process(def, job);
            results.set(job.id, { id: job.id });
          } catch (jobErr) {
            results.set(job.id, { id: job.id, error: jobErr });
          }
        }
      }
    }
    return jobs.map((job) => results.get(job.id) ?? { id: job.id });
  }

  /** Un grupo de eventos de UN workspace: inbox multi-fila + `groupHandler` en una transacción. */
  private async deliverGroup(
    def: EventConsumerDefinition,
    jobs: readonly JobContext<EventEnvelope>[],
  ): Promise<void> {
    const first = jobs[0]!.payload;
    const correlationId = typeof first.correlationId === 'string' ? first.correlationId : undefined;
    // Atribución como en `deliver`; la causa del grupo es su primer evento.
    const run = () =>
      runWithRequestContext(
        {
          actor: { type: 'WORKER' as const, process: def.consumer },
          origin: 'system' as const,
          causationId: first.eventId,
        },
        () => this.applyGroup(def, jobs),
      );
    const ambient = currentCorrelation();
    const started = performance.now();
    let applied = 0;
    try {
      applied =
        correlationId && ambient?.correlationId !== correlationId
          ? await runWithCorrelation({ correlationId }, run)
          : await run();
    } finally {
      // La duración del grupo se reparte en partes iguales entre sus eventos (serie comparable con la individual).
      const perEvent = (performance.now() - started) / 1000 / jobs.length;
      for (let i = 0; i < jobs.length; i += 1) this.options.metrics?.consumed(def.consumer, perEvent);
    }
    if (applied > 0) this.options.metrics?.groupApplied(def.consumer, applied);
  }

  /** Devuelve la cantidad de eventos aplicados (nuevos) por la invocación del efecto. */
  private applyGroup(
    def: EventConsumerDefinition,
    jobs: readonly JobContext<EventEnvelope>[],
  ): Promise<number> {
    const events = jobs.map((j) => j.payload);
    const workspaceId = events[0]!.workspaceId;
    return this.uow.run({ userId: null, workspaceId }, async () => {
      const tx = requireSqlExecutor();
      const retired = await tx.query('SELECT platform.workspace_is_retired($1) AS retired', [workspaceId]);
      if ((retired.rows[0] as { retired?: boolean } | undefined)?.retired === true) return 0;
      const inserted = await tx.query(
        `INSERT INTO platform.inbox (consumer, event_id, workspace_id)
         SELECT $1, t.event_id, $2 FROM unnest($3::uuid[]) AS t(event_id)
         ON CONFLICT (consumer, event_id) DO NOTHING RETURNING event_id`,
        [def.consumer, workspaceId, events.map((e) => e.eventId)],
      );
      const fresh = new Set((inserted.rows as { event_id: string }[]).map((r) => r.event_id));
      const duplicates = events.length - fresh.size;
      for (let i = 0; i < duplicates; i += 1) this.options.metrics?.duplicate(def.consumer);
      if (duplicates > 0) {
        this.options.logger.info(
          { consumer: def.consumer, duplicates, workspace_id: workspaceId },
          'duplicate events skipped in group',
        );
      }
      if (fresh.size === 0) return 0;
      const newEvents = events.filter((e) => fresh.has(e.eventId));
      await def.groupHandler!(newEvents, {
        consumer: def.consumer,
        attempt: Math.max(...jobs.map((j) => j.attempt)),
        tx,
        signal: jobs[0]!.signal,
      });
      return newEvents.length;
    });
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
    const started = performance.now();
    let outcome: DeliveryOutcome;
    try {
      outcome =
        correlationId && ambient?.correlationId !== correlationId
          ? await runWithCorrelation({ correlationId }, run)
          : await run();
    } finally {
      this.options.metrics?.consumed(def.consumer, (performance.now() - started) / 1000);
    }
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
