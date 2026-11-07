import type { HomeDigestSourcePort } from '../contracts/index.js';
import {
  buildDigestParams,
  createNotification,
  currentDigestWindow,
  digestDedupeKey,
  HOME_DIGEST_MESSAGE_KEY,
  type DigestCalendar,
  type DigestWindow,
  type NotificationPlan,
} from '../domain/index.js';
import type { NotifyDeps } from './ports/index.js';

export interface DigestDeps extends Omit<NotifyDeps, 'notifications' | 'deliveries' | 'preferences'> {
  readonly notifications: Pick<NotifyDeps['notifications'], 'insertIfAbsent' | 'usersWithDedupeKey'>;
  readonly deliveries: NotifyDeps['deliveries'];
  readonly preferences: Pick<NotifyDeps['preferences'], 'loadMany' | 'digestSubscribers'>;
  /** Zona horaria y día de inicio del mes financiero del workspace (IDENTITY, rol de directorio). */
  readonly calendar: { calendarOf(workspaceId: string): Promise<DigestCalendar> };
  /** Contenido del Home de un workspace (REPORTING, `HomeDigestQuery`; puerto estructural). */
  readonly source: HomeDigestSourcePort;
}

export interface DigestOutcome {
  /** Digests nuevos (una fila `ARCHIVED` por destinatario sin el digest de su ventana). */
  readonly created: number;
  /** Entregas por email programadas. */
  readonly deliveries: number;
}

/**
 * `SendHomeDigests` (job `notifications.digest`, openspec add-cash-flow-forecast, design decisión 15; D385, D386):
 * para un workspace, a cada miembro activo que eligió el digest le crea —una sola vez por ventana— la notificación
 * `HOME_DIGEST` con estado `ARCHIVED` desde su creación (no aparece en el centro ni en el contador) y su entrega `EMAIL`,
 * que reutiliza el despacho existente (lease, reintentos, horario de silencio y supresión por entorno).
 *
 *  - Ventana: semana ISO (desde el lunes 08:00) o periodo financiero (desde su primer día 08:00) en la zona del workspace;
 *    una ejecución tardía dentro de la misma ventana lo envía y pasada la ventana no se envía atrasado.
 *  - Idempotente: la clave `HOME_DIGEST:<frecuencia>:<ventana>` es única por (workspace, usuario); el job corre cada hora.
 *  - Una composición por workspace, y solo si falta el digest de algún destinatario (se pide FUERA de la transacción: la
 *    consulta de REPORTING abre la suya).
 *  - Los parámetros guardados contienen solo cantidades, porcentajes, estados y fechas; los montos únicamente si el
 *    destinatario activó los detalles (FR-NOTIFY-006).
 * No audita (no es dato financiero ni de configuración, docs/33 D92).
 */
export class SendHomeDigests {
  constructor(private readonly deps: DigestDeps) {}

  async run(workspaceId: string): Promise<DigestOutcome> {
    const { deps } = this;
    const subscribers = await deps.uow.run(workspaceId, () =>
      deps.preferences.digestSubscribers(workspaceId),
    );
    if (subscribers.length === 0) return { created: 0, deliveries: 0 };

    const calendar = await deps.calendar.calendarOf(workspaceId);
    const now = deps.clock.now();
    const windows = new Map<'WEEKLY' | 'MONTHLY', DigestWindow | null>([
      ['WEEKLY', currentDigestWindow('WEEKLY', now.toDate(), calendar)],
      ['MONTHLY', currentDigestWindow('MONTHLY', now.toDate(), calendar)],
    ]);

    const pending = await deps.uow.run(workspaceId, async () => {
      const members = new Map(
        (await deps.recipients.activeMembers(workspaceId)).map((m) => [m.userId, m] as const),
      );
      const out: { userId: string; window: DigestWindow; timeZone: string }[] = [];
      for (const frequency of ['WEEKLY', 'MONTHLY'] as const) {
        const window = windows.get(frequency);
        if (!window) continue;
        const wanted = subscribers.filter((s) => s.frequency === frequency && members.has(s.userId));
        const done = await deps.notifications.usersWithDedupeKey(
          workspaceId,
          wanted.map((s) => s.userId),
          digestDedupeKey(window),
        );
        for (const s of wanted) {
          if (!done.has(s.userId)) {
            out.push({
              userId: s.userId,
              window,
              timeZone: members.get(s.userId)?.timeZone ?? calendar.timeZone,
            });
          }
        }
      }
      return out;
    });
    if (pending.length === 0) return { created: 0, deliveries: 0 };

    // Una sola composición por workspace, fuera de la transacción de NOTIFY.
    const digest = await deps.source.compose({ workspaceId });

    return deps.uow.run(workspaceId, async () => {
      const prefs = await deps.preferences.loadMany(
        workspaceId,
        pending.map((p) => p.userId),
      );
      let created = 0;
      let deliveries = 0;
      for (const target of pending) {
        const preferences = prefs.get(target.userId);
        const includeDetails = preferences?.includeDetailsInEmail ?? false;
        const plan: NotificationPlan = {
          type: 'HOME_DIGEST',
          dedupeKey: digestDedupeKey(target.window),
          severity: 'INFO',
          messageKey: HOME_DIGEST_MESSAGE_KEY,
          params: buildDigestParams({ digest, window: target.window, includeDetails }),
          link: { kind: 'HOME_DIGEST', periodId: workspaceId, periodLabel: digest.today.slice(0, 7) },
        };
        const notification = {
          ...createNotification({
            id: deps.ids.next(),
            workspaceId,
            userId: target.userId,
            sourceEventId: deps.ids.next(),
            createdAt: now.toString(),
            plan,
          }),
          status: 'ARCHIVED' as const,
          archivedAt: now.toString(),
        };
        if (!(await deps.notifications.insertIfAbsent(notification))) continue;
        created += 1;
        deps.metrics.created('HOME_DIGEST');
        if (preferences && !preferences.isEnabled('HOME_DIGEST', 'EMAIL')) continue;
        const quiet = preferences?.quietHours ?? null;
        const notBefore = quiet ? quiet.nextAllowed(now, target.timeZone) : now;
        const deliveryId = deps.ids.next();
        await deps.deliveries.insert({
          id: deliveryId,
          workspaceId,
          notificationId: notification.id,
          notBefore: notBefore.toString(),
          now: now.toString(),
        });
        await deps.scheduler.schedule({
          deliveryId,
          workspaceId,
          startAfter: notBefore.isBefore(now) || notBefore.equals(now) ? null : notBefore.toDate(),
          first: true,
        });
        deliveries += 1;
      }
      return { created, deliveries };
    });
  }
}
