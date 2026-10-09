import type { BatchObservableCallback, Meter, Observable } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
  EVENT_METRICS,
  EventDeliveryMetrics,
  readConsumerBacklog,
  readOutboxBacklog,
  type Queryable,
} from './metrics.js';

/** Meter falso: guarda contadores (con sus atributos) y el callback de los gauges observables. */
function fakeMeter() {
  const adds: { name: string; value: number; attributes?: Record<string, unknown> }[] = [];
  const gauges = new Map<Observable, string>();
  let batch: BatchObservableCallback | undefined;
  const meter = {
    createCounter: (name: string) => ({
      add: (value: number, attributes?: Record<string, unknown>) =>
        adds.push({ name, value, ...(attributes ? { attributes } : {}) }),
    }),
    createHistogram: () => ({ record: () => undefined }),
    createObservableGauge: (name: string) => {
      const g = {} as Observable;
      gauges.set(g, name);
      return g;
    },
    addBatchObservableCallback: (cb: BatchObservableCallback) => {
      batch = cb;
    },
  } as unknown as Meter;
  async function collect(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    await batch?.({ observe: (o: Observable, v: number) => (out[gauges.get(o) as string] = v) } as never);
    return out;
  }
  return { meter, adds, collect };
}

function fakeDb(pending: number, lagSeconds: number, open = 0): Queryable {
  return {
    query: async (text: string) => ({
      rows: [text.includes('dead_letter') ? { open } : { pending, lag_seconds: lagSeconds }],
    }),
  };
}

describe('métricas de entrega de eventos (docs/18 §5.3)', () => {
  it('[TC-PLATFORM-EVENTS-010] outbox_pending y outbox_lag_seconds reflejan los pendientes y vuelven a 0', async () => {
    const backlog = { pending: 3, lag: 42.5 };
    const db: Queryable = {
      query: async (text: string) => ({
        rows: [
          text.includes('dead_letter') ? { open: 1 } : { pending: backlog.pending, lag_seconds: backlog.lag },
        ],
      }),
    };
    const { meter, collect } = fakeMeter();
    new EventDeliveryMetrics(db, meter);
    expect(await collect()).toEqual({
      [EVENT_METRICS.outboxPending]: 3,
      [EVENT_METRICS.outboxLag]: 42.5,
      [EVENT_METRICS.deadLetterOpen]: 1,
    });
    backlog.pending = 0;
    backlog.lag = 0;
    const after = await collect();
    expect(after[EVENT_METRICS.outboxPending]).toBe(0);
    expect(after[EVENT_METRICS.outboxLag]).toBe(0);
  });

  it('[TC-PLATFORM-EVENTS-010] los contadores usan solo labels de baja cardinalidad (tipo de evento o consumidor)', () => {
    const { meter, adds } = fakeMeter();
    const m = new EventDeliveryMetrics(undefined, meter);
    m.published('identity.WorkspaceCreated');
    m.publishFailed();
    m.duplicate('reporting.balances');
    m.deadLettered('reporting.balances');
    expect(adds.map((a) => a.name)).toEqual([
      EVENT_METRICS.outboxPublished,
      EVENT_METRICS.outboxPublishFailures,
      EVENT_METRICS.inboxDuplicates,
      EVENT_METRICS.deadLettered,
    ]);
    for (const a of adds) {
      for (const key of Object.keys(a.attributes ?? {})) expect(['event_type', 'consumer']).toContain(key);
    }
  });

  it('readOutboxBacklog nunca reporta retraso negativo', async () => {
    expect(await readOutboxBacklog(fakeDb(0, -0.2))).toEqual({ pending: 0, lagSeconds: 0 });
  });

  it('[TC-PLATFORM-EVENTS-017] readConsumerBacklog reporta 0 para los consumidores sin pendientes', async () => {
    const db: Queryable = {
      query: async (_text: string, values?: unknown[]) => {
        expect(values).toEqual([['events.a.x', 'events.b.y']]);
        return { rows: [{ name: 'events.a.x', pending: 7 }] };
      },
    };
    const backlog = await readConsumerBacklog(db, ['a.x', 'b.y'], (c) => `events.${c}`);
    expect([...backlog]).toEqual([
      ['a.x', 7],
      ['b.y', 0],
    ]);
  });

  it('[TC-PLATFORM-EVENTS-017] event_consumer_duration_seconds usa solo el label consumer', () => {
    const records: { name: string; value: number; attributes: Record<string, unknown> }[] = [];
    const meter = {
      createCounter: () => ({ add: () => undefined }),
      createHistogram: (name: string) => ({
        record: (value: number, attributes: Record<string, unknown>) =>
          records.push({ name, value, attributes }),
      }),
    } as unknown as Meter;
    new EventDeliveryMetrics(undefined, meter).consumed('planning.budget-thresholds', 0.04);
    expect(records).toEqual([
      {
        name: EVENT_METRICS.consumerDuration,
        value: 0.04,
        attributes: { consumer: 'planning.budget-thresholds' },
      },
    ]);
  });
});
