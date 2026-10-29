import type { DataVersionStore } from './ports/index.js';

/** Evento mínimo que consume el proyector (envelope de contracts/events). */
export interface DataVersionEvent {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
}

/**
 * Consumidor `DataVersionProjector` (design.md decisión 7): ante cada evento que cambia el resumen (asiento,
 * transacción posteada/anulada/categorizada, cuenta abierta/archivada, tasa registrada) incrementa la versión
 * derivada del workspace. La idempotencia la da `platform.inbox` (misma transacción): un duplicado no incrementa.
 * Como el resumen se lee de la fuente de verdad, un consumidor atrasado nunca vuelve obsoleta una respuesta.
 */
export class DataVersionProjector {
  constructor(private readonly versions: DataVersionStore) {}

  async on(event: DataVersionEvent): Promise<void> {
    await this.versions.bump(event.workspaceId, event.occurredAt);
  }

  /**
   * Entrega agrupada (optimize-consumer-throughput): los eventos NUEVOS de UN workspace incrementan la versión en tantas
   * unidades como eventos con una sola sentencia; el instante es el mayor del grupo. Equivale a `on` por cada evento en
   * cualquier orden (la versión es un contador y `updated_at` toma el máximo).
   */
  async onGroup(events: readonly DataVersionEvent[]): Promise<void> {
    const first = events[0];
    if (!first) return;
    const latest = events.reduce(
      (max, e) => (Date.parse(e.occurredAt) > Date.parse(max) ? e.occurredAt : max),
      first.occurredAt,
    );
    await this.versions.bumpBy(first.workspaceId, events.length, latest);
  }
}
