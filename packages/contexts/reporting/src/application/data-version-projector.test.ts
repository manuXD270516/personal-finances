import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DataVersionProjector, type DataVersionEvent } from './data-version-projector.js';
import type { DataVersionStore } from './ports/index.js';

/** Almacén en memoria con la semántica de `reporting.workspace_data_version` (contador + máximo instante). */
class MemoryVersions implements DataVersionStore {
  readonly rows = new Map<string, { version: number; updatedAt: number }>();
  statements = 0;

  async versionOf(workspaceId: string): Promise<string> {
    return String(this.rows.get(workspaceId)?.version ?? 0);
  }

  async bump(workspaceId: string, at: string): Promise<void> {
    await this.bumpBy(workspaceId, 1, at);
  }

  async bumpBy(workspaceId: string, count: number, at: string): Promise<void> {
    this.statements += 1;
    const current = this.rows.get(workspaceId);
    this.rows.set(workspaceId, {
      version: (current?.version ?? 0) + count,
      updatedAt: Math.max(current?.updatedAt ?? Number.NEGATIVE_INFINITY, Date.parse(at)),
    });
  }
}

const W = '0192a000-0000-7000-8000-000000000001';

const eventsArb = fc.array(
  fc.record({
    eventId: fc.uuid(),
    workspaceId: fc.constant(W),
    occurredAt: fc
      .date({
        min: new Date('2026-01-01T00:00:00Z'),
        max: new Date('2026-12-31T00:00:00Z'),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString()),
  }),
  { minLength: 1, maxLength: 60 },
);

describe('DataVersionProjector: entrega agrupada (optimize-consumer-throughput)', () => {
  it('[TC-PLATFORM-THROUGHPUT-007] el mismo conjunto de eventos de a uno o agrupado (en cualquier orden y partición) deja la misma versión y el mismo instante', async () => {
    await fc.assert(
      fc.asyncProperty(eventsArb, fc.infiniteStream(fc.nat(10)), async (events, cuts) => {
        const single = new MemoryVersions();
        const one = new DataVersionProjector(single);
        for (const e of events) await one.on(e);

        // Orden al azar y partición en grupos de tamaño aleatorio.
        const shuffled = [...events].sort((a, b) => a.eventId.localeCompare(b.eventId) * -1);
        const grouped = new MemoryVersions();
        const many = new DataVersionProjector(grouped);
        const it = cuts[Symbol.iterator]();
        for (let i = 0; i < shuffled.length;) {
          const size = Math.max(1, it.next().value as number);
          await many.onGroup(shuffled.slice(i, i + size) as DataVersionEvent[]);
          i += size;
        }
        expect(grouped.rows.get(W)).toEqual(single.rows.get(W));
      }),
      { numRuns: 200 },
    );
  }, 60_000);

  it('[TC-PLATFORM-THROUGHPUT-001] un grupo de 100 eventos incrementa la versión en 100 con una sola sentencia', async () => {
    const store = new MemoryVersions();
    const projector = new DataVersionProjector(store);
    const events: DataVersionEvent[] = Array.from({ length: 100 }, (_, i) => ({
      eventId: `e${String(i)}`,
      workspaceId: W,
      occurredAt: `2026-10-01T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));
    await projector.onGroup(events);
    expect(await store.versionOf(W)).toBe('100');
    expect(store.statements).toBe(1);
  });

  it('un grupo vacío no toca la versión', async () => {
    const store = new MemoryVersions();
    await new DataVersionProjector(store).onGroup([]);
    expect(store.statements).toBe(0);
  });
});
