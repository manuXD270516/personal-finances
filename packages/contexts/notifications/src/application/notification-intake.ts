import type {
  NotificationIntakeFact,
  NotificationIntakeOutcome,
  NotificationIntakePort,
} from '../contracts/index.js';
import { intakeDefinitionOf } from '../domain/index.js';
import { NotifyFromEvent } from './notify-from-event.js';
import type { NotifyDeps } from './ports/index.js';

/**
 * `NotificationIntakePort` (openspec add-rate-feed-alerts, design decisión 5; D249): entrega directa de las alertas de
 * tasas que FX publica desde su job de providers. Es el mismo camino que usan los consumidores de eventos de NOTIFY
 * (`NotifyFromEvent`: destinatarios activos, preferencias por tipo y canal, horario de silencio, entrega por email en la
 * cola existente y deduplicación `(workspace, usuario, dedupe_key)` con `ON CONFLICT DO NOTHING`), sin la capa de inbox de
 * consumidor porque el hecho llega dentro de la transacción del llamador, que ya es idempotente por episodio y por tasa.
 *
 * Debe ejecutarse dentro de la unidad de trabajo del workspace del llamador: la transacción se reutiliza, de modo que un
 * fallo aquí (hecho mal formado, NOTIFY caído) revierte también el episodio y el evento de FX. No audita (no es dato
 * financiero ni de configuración, docs/33 D92).
 */
export class NotificationIntake implements NotificationIntakePort {
  private readonly delivery: NotifyFromEvent;

  constructor(deps: NotifyDeps) {
    this.delivery = new NotifyFromEvent(deps);
  }

  notify(fact: NotificationIntakeFact): Promise<NotificationIntakeOutcome> {
    const definition = intakeDefinitionOf(fact.type);
    return this.delivery.handle(
      {
        eventId: fact.sourceEventId,
        workspaceId: fact.workspaceId,
        occurredAt: fact.occurredAt,
        payload: fact.payload,
      },
      {
        recipients: definition.recipients,
        refreshable: definition.refreshable === true,
        plan: (payload) => definition.plan(payload, fact.factKey),
      },
    );
  }
}
