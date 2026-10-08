import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { definitionOf } from '../domain/index.js';
import { thresholdPayload, WS } from '../domain/fixtures.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { PurgeExpiredNotifications, retentionCutoff } from './purge-expired.js';
import { NotificationsTestEnv } from './testing/in-memory.js';

describe('PurgeExpiredNotifications (retención de 12 meses, docs/33 D93)', () => {
  it('el corte es "ahora" menos N meses calendario', () => {
    expect(retentionCutoff(new Date('2027-11-12T10:00:00Z'), 12).toISOString()).toBe(
      '2026-11-12T10:00:00.000Z',
    );
    expect(retentionCutoff(new Date('2026-03-31T00:00:00Z'), 1).getUTCMonth()).toBe(2);
  });

  it('borra las notificaciones con más de 12 meses —archivadas incluidas— junto con sus entregas; conserva las recientes', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const definition = definitionOf('BUDGET_THRESHOLD');
    env.clock.set(Instant.parse('2026-01-10T10:00:00Z'));
    await notify.handle(
      {
        eventId: '01928c4e-7a3b-7c11-8f00-000000000401',
        workspaceId: WS,
        occurredAt: '2026-01-10T10:00:00.000Z',
        payload: thresholdPayload({ threshold: '50', alsoCrossed: [] }),
      },
      definition,
    );
    for (const n of env.notifications.rows.values())
      env.notifications.rows.set(n.id, { ...n, status: 'ARCHIVED', archivedAt: '2026-01-11T00:00:00.000Z' });
    env.clock.set(Instant.parse('2027-01-09T10:00:00Z'));
    await notify.handle(
      {
        eventId: '01928c4e-7a3b-7c11-8f00-000000000402',
        workspaceId: WS,
        occurredAt: '2027-01-09T10:00:00.000Z',
        payload: thresholdPayload({ threshold: '75', alsoCrossed: [] }),
      },
      definition,
    );
    expect(env.notifications.rows.size).toBe(6);
    expect(env.deliveries.rows.size).toBe(6);

    env.clock.set(Instant.parse('2027-01-11T10:00:00Z'));
    const purge = new PurgeExpiredNotifications({
      uow: env.uow,
      notifications: env.notifications,
      clock: env.clock,
      retentionMonths: 12,
    });
    expect(await purge.purgeWorkspace(WS)).toBe(3);
    expect([...env.notifications.rows.values()].every((n) => n.createdAt.startsWith('2027-01-09'))).toBe(
      true,
    );
    expect(env.deliveries.rows.size).toBe(3);
  });
});
