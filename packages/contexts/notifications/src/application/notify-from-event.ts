import { Instant } from '@pf/shared-kernel';
import {
  createNotification,
  type NotificationPlan,
  type NotificationTypeDefinition,
} from '../domain/index.js';
import type { NotifyDeps, SourceEvent } from './ports/index.js';

/** Lo que la entrega necesita de un tipo: destinatarios y plan (los consumidores de eventos y la entrega directa). */
export type DeliveryDefinition = Pick<NotificationTypeDefinition, 'recipients' | 'plan' | 'suppressed'> & {
  /** `true`: un hecho posterior con la misma clave actualiza el aviso existente en lugar de ignorarse (`insertOrRefresh`). */
  readonly refreshable?: boolean;
};

export interface NotifyOutcome {
  /** Notificaciones in-app nuevas (una por destinatario sin notificación previa de ese hecho). */
  readonly created: number;
  /** Notificaciones existentes actualizadas con una foto más nueva (tipos actualizables; sin email nuevo). */
  readonly refreshed: number;
  /** Entregas por email programadas (solo para las notificaciones nuevas). */
  readonly deliveries: number;
}

/**
 * `NotifyFromEvent` (openspec add-alerts, design decisiones 1, 2, 7 y 10): traduce un hecho publicado por otro
 * contexto en una notificación por destinatario. NOTIFY no decide la regla de alerta: solo resuelve destinatarios,
 * aplica preferencias y registra.
 *
 * Idempotencia en dos capas (INV-028): el consumidor ya registró `(consumer, eventId)` en `platform.inbox` en su
 * transacción; además `notification` tiene UNIQUE `(workspace_id, user_id, dedupe_key)` y se inserta con
 * `ON CONFLICT DO NOTHING`, de modo que un segundo evento del mismo hecho (otro `eventId`) o un worker concurrente no
 * duplican (los tipos `refreshable` usan `insertOrRefresh`: crean o actualizan el aviso, sin otro email). La entrega por email se crea SOLO si la notificación se insertó, y su trabajo se encola en la misma
 * transacción. Debe ejecutarse dentro de la unidad de trabajo del consumidor (reutiliza su transacción).
 *
 * No es un `*.service.ts`: no audita (no es dato financiero ni de configuración, docs/33 D92).
 */
export class NotifyFromEvent {
  constructor(private readonly deps: NotifyDeps) {}

  async handle(event: SourceEvent, definition: DeliveryDefinition): Promise<NotifyOutcome> {
    const { deps } = this;
    // Lanza ante un payload mal formado: el consumidor reintenta y termina en dead-letter (observable).
    const plan = definition.plan(event.payload, { aggregateVersion: event.aggregateVersion });
    // Hecho que otro contexto avisa por su cuenta (D119): se consume (inbox) sin crear notificaciones.
    if (definition.suppressed?.(event.payload)) return { created: 0, refreshed: 0, deliveries: 0 };
    return deps.uow.run(event.workspaceId, async () => {
      const now = deps.clock.now();
      const members = (await deps.recipients.activeMembers(event.workspaceId)).filter((m) =>
        definition.recipients.includes(m.role),
      );
      const preferences = await deps.preferences.loadMany(
        event.workspaceId,
        members.map((m) => m.userId),
      );
      let created = 0;
      let refreshed = 0;
      let deliveries = 0;
      for (const member of members) {
        const prefs = preferences.get(member.userId);
        // Sin fila de preferencias = valores por defecto (ambos canales activos).
        const inApp = prefs ? prefs.isEnabled(plan.type, 'IN_APP') : true;
        if (!inApp) continue;
        const notification = createNotification({
          id: deps.ids.next(),
          workspaceId: event.workspaceId,
          userId: member.userId,
          sourceEventId: event.eventId,
          createdAt: now.toString(),
          plan,
        });
        if (definition.refreshable) {
          // Crear o actualizar (aviso agrupado): actualizar nunca programa otro email ni cambia la lectura.
          const result = await deps.notifications.insertOrRefresh(notification);
          if (result === 'REFRESHED') {
            refreshed += 1;
            deps.metrics.refreshed(plan.type);
          }
          if (result !== 'CREATED') continue;
        } else if (!(await deps.notifications.insertIfAbsent(notification))) {
          continue;
        }
        created += 1;
        deps.metrics.created(plan.type);
        const emailOn = prefs ? prefs.isEnabled(plan.type, 'EMAIL') : true;
        if (!emailOn) continue;
        const quiet = prefs?.quietHours ?? null;
        const notBefore = quiet ? quiet.nextAllowed(now, member.timeZone) : now;
        const deliveryId = deps.ids.next();
        await deps.deliveries.insert({
          id: deliveryId,
          workspaceId: event.workspaceId,
          notificationId: notification.id,
          notBefore: notBefore.toString(),
          now: now.toString(),
        });
        await deps.scheduler.schedule({
          deliveryId,
          workspaceId: event.workspaceId,
          startAfter: notBefore.isBefore(now) || notBefore.equals(now) ? null : notBefore.toDate(),
          first: true,
        });
        deliveries += 1;
      }
      deps.metrics.lagSeconds(plan.type, lagSeconds(event.occurredAt, now));
      return { created, refreshed, deliveries };
    });
  }
}

function lagSeconds(occurredAt: string, now: Instant): number {
  try {
    return Math.max(0, (now.epochMillis - Instant.parse(occurredAt).epochMillis) / 1000);
  } catch {
    return 0;
  }
}

export type { NotificationPlan };
