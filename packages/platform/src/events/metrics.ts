import { metrics, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import { PGBOSS_SCHEMA } from '../queue/pgboss-job-queue.js';

/** Ejecutor mínimo de consultas (`pg.Pool`, `pg.Client` o la conexión de una transacción). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface OutboxBacklog {
  /** Eventos pendientes de publicación. */
  readonly pending: number;
  /** Segundos desde que se registró el pendiente más antiguo (0 sin pendientes). */
  readonly lagSeconds: number;
}

/**
 * Pendientes y retraso del outbox leídos de PostgreSQL (índice parcial `outbox_pending_idx`), no de las estadísticas
 * cacheadas de pg-boss (SPIKE-05 hallazgo 5). `asOf` fija el "ahora" (tests); por defecto, el reloj de la base.
 */
export async function readOutboxBacklog(db: Queryable, asOf?: Date): Promise<OutboxBacklog> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS pending,
            coalesce(extract(epoch FROM (coalesce($1::timestamptz, clock_timestamp()) - min(created_at))), 0)::float8
              AS lag_seconds
       FROM platform.outbox
      WHERE published_at IS NULL`,
    [asOf ?? null],
  );
  const row = rows[0] as { pending: number; lag_seconds: number } | undefined;
  return { pending: row?.pending ?? 0, lagSeconds: Math.max(0, row?.lag_seconds ?? 0) };
}

/** Dead-letters abiertos (todos los consumidores). */
export async function countOpenDeadLetters(db: Queryable): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS open FROM platform.dead_letter WHERE status = 'OPEN'`,
  );
  return (rows[0] as { open: number } | undefined)?.open ?? 0;
}

/**
 * Trabajos pendientes por cola de consumidor, leídos de PostgreSQL (`pgboss.job`): publicados y aún sin procesar
 * (`created`), en reintento (`retry`) o en curso (`active`). Los consumidores sin pendientes reportan 0. Los
 * agotados (`failed`, ya copiados a la dead-letter) no cuentan: tienen su propia métrica (`pf.queue.dead_letter`).
 * `queueOf` mapea el nombre del consumidor al de su cola.
 */
export async function readConsumerBacklog(
  db: Queryable,
  consumers: readonly string[],
  queueOf: (consumer: string) => string,
  schema = PGBOSS_SCHEMA,
): Promise<ReadonlyMap<string, number>> {
  const result = new Map<string, number>(consumers.map((c) => [c, 0]));
  if (consumers.length === 0) return result;
  const byQueue = new Map(consumers.map((c) => [queueOf(c), c]));
  const { rows } = await db.query(
    `SELECT name, count(*)::int AS pending
       FROM ${quoteIdentifier(schema)}.job
      WHERE name = ANY($1::text[]) AND state IN ('created', 'retry', 'active')
      GROUP BY name`,
    [[...byQueue.keys()]],
  );
  for (const row of rows as { name: string; pending: number }[]) {
    const consumer = byQueue.get(row.name);
    if (consumer) result.set(consumer, row.pending);
  }
  return result;
}

const quoteIdentifier = (id: string): string => `"${id.replace(/"/g, '""')}"`;

/** Nombres de los instrumentos (docs/18 §5.3; el exportador Prometheus agrega unidad y `_total`). */
export const EVENT_METRICS = {
  outboxPending: 'pf.outbox.pending',
  outboxLag: 'pf.outbox.lag',
  outboxPublished: 'pf.outbox.published',
  outboxPublishFailures: 'pf.outbox.publish_failures',
  inboxDuplicates: 'pf.inbox.duplicates',
  deadLettered: 'pf.events.dead_lettered',
  deadLetterOpen: 'pf.queue.dead_letter',
  /** NFR-OBS-004 `event_consumer_backlog` (Prometheus: `pf_events_consumer_backlog`). */
  consumerBacklog: 'pf.events.consumer.backlog',
  /** NFR-OBS-004 `event_consumer_duration_seconds` (Prometheus: `pf_events_consumer_duration_seconds`). */
  consumerDuration: 'pf.events.consumer.duration',
} as const;

/**
 * Métricas de la entrega de eventos (openspec add-event-outbox, design §8). Labels de baja cardinalidad: tipo de
 * evento o consumidor; nunca workspace, usuario ni agregado (docs/18 §5).
 */
export class EventDeliveryMetrics {
  private readonly publishedCounter: Counter;
  private readonly failuresCounter: Counter;
  private readonly duplicatesCounter: Counter;
  private readonly deadLetteredCounter: Counter;
  private readonly durationHistogram: Histogram;
  private consumers:
    { readonly names: readonly string[]; readonly queueOf: (c: string) => string } | undefined;

  constructor(
    private readonly db: Queryable | undefined,
    meter: Meter = metrics.getMeter('@pf/platform/events'),
  ) {
    this.publishedCounter = meter.createCounter(EVENT_METRICS.outboxPublished, {
      description: 'Eventos del outbox publicados en la cola',
    });
    this.failuresCounter = meter.createCounter(EVENT_METRICS.outboxPublishFailures, {
      description: 'Lotes del relay que fallaron al publicar',
    });
    this.duplicatesCounter = meter.createCounter(EVENT_METRICS.inboxDuplicates, {
      description: 'Entregas repetidas descartadas por el inbox',
    });
    this.deadLetteredCounter = meter.createCounter(EVENT_METRICS.deadLettered, {
      description: 'Eventos que agotaron sus reintentos y quedaron en dead-letter',
    });
    this.durationHistogram = meter.createHistogram(EVENT_METRICS.consumerDuration, {
      description:
        'Duración del procesamiento de un evento por un consumidor (transacción con inbox y efecto)',
      unit: 's',
    });
    if (db) {
      const backlogGauge = meter.createObservableGauge(EVENT_METRICS.consumerBacklog, {
        description: 'Eventos pendientes de procesar por consumidor (publicados, en reintento o en curso)',
      });
      const pending = meter.createObservableGauge(EVENT_METRICS.outboxPending, {
        description: 'Eventos del outbox pendientes de publicación',
      });
      const lag = meter.createObservableGauge(EVENT_METRICS.outboxLag, {
        description: 'Antigüedad del evento pendiente más antiguo',
        unit: 's',
      });
      const open = meter.createObservableGauge(EVENT_METRICS.deadLetterOpen, {
        description: 'Dead-letters abiertos',
      });
      meter.addBatchObservableCallback(
        async (result) => {
          try {
            const [backlog, openCount] = await Promise.all([readOutboxBacklog(db), countOpenDeadLetters(db)]);
            result.observe(pending, backlog.pending);
            result.observe(lag, backlog.lagSeconds);
            result.observe(open, openCount);
          } catch {
            // Sin base de datos no se reporta valor (el gauge queda sin muestra); readiness ya lo señala.
          }
          const tracked = this.consumers;
          if (!tracked) return;
          try {
            const perConsumer = await readConsumerBacklog(db, tracked.names, tracked.queueOf);
            for (const [consumer, count] of perConsumer) result.observe(backlogGauge, count, { consumer });
          } catch {
            // Igual que arriba: sin muestra si la base no responde.
          }
        },
        [pending, lag, open, backlogGauge],
      );
    }
  }

  /**
   * Registra los consumidores cuyo backlog se reporta (`consumer` = nombre estable, baja cardinalidad). Lo llama el
   * runtime de consumidores al arrancar; sin base de datos no hace nada.
   */
  trackConsumers(names: readonly string[], queueOf: (consumer: string) => string): void {
    this.consumers = { names, queueOf };
  }

  /** Duración (s) del procesamiento de un evento por un consumidor, con cualquier resultado. */
  consumed(consumer: string, seconds: number): void {
    this.durationHistogram.record(seconds, { consumer });
  }

  published(eventType: string): void {
    this.publishedCounter.add(1, { event_type: eventType });
  }

  publishFailed(): void {
    this.failuresCounter.add(1);
  }

  duplicate(consumer: string): void {
    this.duplicatesCounter.add(1, { consumer });
  }

  deadLettered(consumer: string): void {
    this.deadLetteredCounter.add(1, { consumer });
  }
}
