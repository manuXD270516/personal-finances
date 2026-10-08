import type { Clock } from '@pf/shared-kernel';
import type { NotificationRepository, UnitOfWork } from './ports/index.js';

export interface PurgeDeps {
  readonly uow: UnitOfWork;
  readonly notifications: Pick<NotificationRepository, 'deleteCreatedBefore'>;
  readonly clock: Clock;
  /** `NOTIFY_RETENTION` en meses (12, docs/33 D93): todas las notificaciones, archivadas incluidas. */
  readonly retentionMonths: number;
}

/** Fecha de corte: `now` menos `months` meses calendario en UTC. */
export function retentionCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/**
 * `PurgeExpiredNotifications` (job diario `notifications.purge`, design decisión 11): borra las notificaciones con
 * más de `NOTIFY_RETENTION` de antigüedad junto con sus entregas. Las tablas de notificaciones no son append-only
 * (no son hechos financieros). No es un `*.service.ts`: es mantenimiento sin dato de negocio ni auditoría.
 */
export class PurgeExpiredNotifications {
  constructor(private readonly deps: PurgeDeps) {}

  /** Devuelve cuántas notificaciones borró en el workspace. */
  purgeWorkspace(workspaceId: string): Promise<number> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const cutoff = retentionCutoff(deps.clock.now().toDate(), deps.retentionMonths);
      return deps.notifications.deleteCreatedBefore(workspaceId, cutoff.toISOString());
    });
  }
}
