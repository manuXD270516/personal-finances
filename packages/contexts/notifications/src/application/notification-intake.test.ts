import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import {
  anomalyRetainedPayload,
  EPISODE_ID,
  feedRecoveredPayload,
  feedStalePayload,
  FX_RATE_ID,
  WS,
} from '../domain/fixtures.js';
import { NotificationIntake } from './notification-intake.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const SOURCE_EVENT = '01928c4e-7a3b-7c11-8f00-000000000901';

const stale = (overrides: Partial<NotificationIntakeFact> = {}): NotificationIntakeFact =>
  ({
    workspaceId: WS,
    type: 'FX_RATE_FEED_STALE',
    factKey: EPISODE_ID,
    sourceEventId: SOURCE_EVENT,
    occurredAt: '2026-10-13T14:15:00.000Z',
    payload: feedStalePayload(),
    ...overrides,
  }) as unknown as NotificationIntakeFact;

const setup = () => {
  const env = new NotificationsTestEnv();
  env.clock.set(Instant.parse('2026-10-13T14:15:00Z'));
  return { env, intake: new NotificationIntake(env.notifyDeps()) };
};
const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

describe('NotificationIntake: alertas de tasas entregadas por el puerto de FX', () => {
  it('[TC-NOTIFICATIONS-FX-001] OWNER y EDITOR reciben la obsolescencia no leída con enlace al estado de tasas; el VIEWER no', async () => {
    const { env, intake } = setup();
    const outcome = await intake.notify(stale());
    expect(outcome).toEqual({ created: 2, deliveries: 2 });
    for (const userId of [OWNER, EDITOR]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'FX_RATE_FEED_STALE',
        status: 'UNREAD',
        severity: 'WARNING',
        sourceEventId: SOURCE_EVENT,
        link: { kind: 'FX_FEED_STATUS' },
      });
    }
    expect(forUser(env, VIEWER)).toHaveLength(0);
    expect(env.metrics.created_).toEqual(['FX_RATE_FEED_STALE', 'FX_RATE_FEED_STALE']);
  });

  it('[TC-NOTIFICATIONS-FX-002] el mismo hecho entregado dos veces, también a la vez, deja una sola notificación y una sola entrega por destinatario', async () => {
    const { env, intake } = setup();
    await intake.notify(stale());
    const second = await intake.notify(stale({ sourceEventId: '01928c4e-7a3b-7c11-8f00-000000000902' }));
    expect(second).toEqual({ created: 0, deliveries: 0 });
    await Promise.all([intake.notify(stale()), intake.notify(stale())]);
    expect(env.notifications.rows.size).toBe(2);
    expect(env.deliveries.rows.size).toBe(2);
    expect(env.scheduler.jobs).toHaveLength(2);
  });

  it('[TC-NOTIFICATIONS-FX-003] la recuperación es INFO, una sola vez por episodio', async () => {
    const { env, intake } = setup();
    const fact = {
      workspaceId: WS,
      type: 'FX_RATE_FEED_RECOVERED',
      factKey: EPISODE_ID,
      sourceEventId: SOURCE_EVENT,
      occurredAt: '2026-10-13T16:00:00.000Z',
      payload: feedRecoveredPayload(),
    } as unknown as NotificationIntakeFact;
    await intake.notify(fact);
    expect(await intake.notify(fact)).toEqual({ created: 0, deliveries: 0 });
    const [n] = forUser(env, OWNER);
    expect(n).toMatchObject({ type: 'FX_RATE_FEED_RECOVERED', severity: 'INFO' });
    expect(env.notifications.rows.size).toBe(2);
  });

  it('[TC-NOTIFICATIONS-FX-004] la muestra retenida notifica a OWNER y EDITOR y se deduplica por tasa', async () => {
    const { env, intake } = setup();
    const fact = {
      workspaceId: WS,
      type: 'FX_RATE_ANOMALY_RETAINED',
      factKey: FX_RATE_ID,
      sourceEventId: SOURCE_EVENT,
      occurredAt: '2026-10-13T14:02:10.000Z',
      payload: anomalyRetainedPayload(),
    } as unknown as NotificationIntakeFact;
    await intake.notify(fact);
    await intake.notify(fact);
    expect(env.notifications.rows.size).toBe(2);
    expect(forUser(env, EDITOR)[0]).toMatchObject({
      type: 'FX_RATE_ANOMALY_RETAINED',
      severity: 'WARNING',
      link: { kind: 'FX_RATE', fxRateId: FX_RATE_ID },
      params: { value: '72000.00', baselineValue: '65000.00', variationPct: '10.7692' },
    });
  });

  it('[TC-NOTIFICATIONS-FX-007] sin email del tipo el EDITOR solo recibe la in-app; el silencio del OWNER difiere su email', async () => {
    const { env, intake } = setup();
    // 2026-10-13 23:15 en La Paz = 2026-10-14T03:15Z.
    env.clock.set(Instant.parse('2026-10-14T03:15:00Z'));
    const editor = await env.preferences.load(WS, EDITOR);
    editor.update({
      types: [{ type: 'FX_RATE_FEED_STALE', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(editor);
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: { start: '22:00', end: '07:00' }, includeDetailsInEmail: false });
    await env.preferences.save(owner);

    await intake.notify(stale({ occurredAt: '2026-10-14T03:15:00.000Z' }));

    const [editorNotification] = forUser(env, EDITOR);
    expect(editorNotification).toBeDefined();
    expect(env.deliveries.byNotification(editorNotification?.id ?? '')).toBeUndefined();
    const [ownerNotification] = forUser(env, OWNER);
    expect(ownerNotification?.createdAt).toBe('2026-10-14T03:15:00.000Z');
    expect(env.deliveries.byNotification(ownerNotification?.id ?? '')).toMatchObject({
      status: 'PENDING',
      notBefore: '2026-10-14T11:00:00.000Z',
    });
  });

  it('[TC-NOTIFICATIONS-FX-007] el miembro que desactivó el tipo in-app no recibe nada', async () => {
    const { env, intake } = setup();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'FX_RATE_FEED_STALE', inApp: false, email: true }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(owner);
    await intake.notify(stale());
    expect(forUser(env, OWNER)).toHaveLength(0);
    expect(forUser(env, EDITOR)).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-FX-009] un hecho mal formado lanza sin crear nada: la transacción de FX se revierte', async () => {
    const { env, intake } = setup();
    await expect(intake.notify(stale({ factKey: 'no-uuid' }))).rejects.toThrow(/factKey/);
    await expect(
      intake.notify(stale({ payload: feedStalePayload({ detectedAt: 'ayer' }) as never })),
    ).rejects.toThrow(/detectedAt/);
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
  });
});
