import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import {
  anomalyGroupPayload,
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
    expect(outcome).toEqual({ created: 2, refreshed: 0, deliveries: 2 });
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
    expect(second).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
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
    expect(await intake.notify(fact)).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    const [n] = forUser(env, OWNER);
    expect(n).toMatchObject({ type: 'FX_RATE_FEED_RECOVERED', severity: 'INFO' });
    expect(env.notifications.rows.size).toBe(2);
  });

  const group = (over: Record<string, unknown> = {}, id = SOURCE_EVENT): NotificationIntakeFact =>
    ({
      workspaceId: WS,
      type: 'FX_RATE_ANOMALY_RETAINED',
      factKey: FX_RATE_ID,
      sourceEventId: id,
      occurredAt: '2026-10-13T14:02:10.000Z',
      payload: anomalyGroupPayload(over),
    }) as unknown as NotificationIntakeFact;

  it('[TC-NOTIFICATIONS-FX-004] el grupo de muestras retenidas notifica a OWNER y EDITOR con 1 muestra pendiente y enlace a su revisión', async () => {
    const { env, intake } = setup();
    expect(await intake.notify(group())).toEqual({ created: 2, refreshed: 0, deliveries: 2 });
    expect(env.notifications.rows.size).toBe(2);
    expect(forUser(env, EDITOR)[0]).toMatchObject({
      type: 'FX_RATE_ANOMALY_RETAINED',
      severity: 'WARNING',
      messageKey: 'notifications.fx_rate_anomaly_retained.v2',
      link: { kind: 'FX_RATE', fxRateId: FX_RATE_ID },
      params: {
        pendingCount: 1,
        peak: { value: '72000.00', baselineValue: '65000.00', variationPct: '10.7692' },
      },
    });
    expect(forUser(env, VIEWER)).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-FX-011] [TC-NOTIFICATIONS-FX-017] la foto siguiente del grupo actualiza el aviso sin crear otro, sin otro email y sin volverlo a no leído', async () => {
    const { env, intake } = setup();
    await intake.notify(group());
    const [editorBefore] = forUser(env, EDITOR);
    await env.notifications.markRead(WS, EDITOR, editorBefore?.id ?? '', '2026-10-13T14:03:00.000Z');
    const later = '2026-10-13T14:15:00.000Z';
    const outcome = await intake.notify(
      group(
        {
          pendingCount: 5,
          retainedCount: 5,
          lastRetainedAt: later,
          providers: ['DOLARAPI_BO', 'PARALELO_BO'],
        },
        '01928c4e-7a3b-7c11-8f00-000000000903',
      ),
    );
    expect(outcome).toEqual({ created: 0, refreshed: 2, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(2);
    expect(env.deliveries.rows.size).toBe(2);
    expect(env.metrics.refreshed_).toEqual(['FX_RATE_ANOMALY_RETAINED', 'FX_RATE_ANOMALY_RETAINED']);
    // Aviso ya leído (TC-NOTIFICATIONS-FX-017): muestra la cantidad nueva y sigue leído, con su fecha de creación.
    const [editorAfter] = forUser(env, EDITOR);
    expect(editorAfter).toMatchObject({
      id: editorBefore?.id,
      status: 'READ',
      createdAt: editorBefore?.createdAt,
      sourceEventId: SOURCE_EVENT,
      params: { pendingCount: 5, providers: ['DOLARAPI_BO', 'PARALELO_BO'] },
    });
    expect(forUser(env, OWNER)[0]?.status).toBe('UNREAD');
  });

  it('[TC-NOTIFICATIONS-FX-016] el mismo grupo entregado otra vez no cambia nada y una foto más vieja no retrocede la cantidad', async () => {
    const { env, intake } = setup();
    await intake.notify(
      group({ pendingCount: 4, retainedCount: 4, lastRetainedAt: '2026-10-13T14:10:00.000Z' }),
    );
    const snapshot = JSON.stringify([...env.notifications.rows.values()]);
    await intake.notify(
      group({ pendingCount: 4, retainedCount: 4, lastRetainedAt: '2026-10-13T14:10:00.000Z' }),
    );
    expect(JSON.stringify([...env.notifications.rows.values()])).toBe(snapshot);
    const stale = await intake.notify(
      group({ pendingCount: 2, retainedCount: 2, lastRetainedAt: '2026-10-13T14:05:00.000Z' }),
    );
    expect(stale).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    expect(forUser(env, OWNER)[0]?.params).toMatchObject({ pendingCount: 4 });
  });

  it('[TC-NOTIFICATIONS-FX-015] grupos de pares distintos (anclas distintas) crean avisos distintos', async () => {
    const { env, intake } = setup();
    await intake.notify(group());
    const other = '01928c4e-0000-7000-8000-0000000fa099';
    await intake.notify({
      ...group(
        { anchorRateId: other, base: 'USDT', quote: 'BOB', reviewRateId: other },
        '01928c4e-7a3b-7c11-8f00-000000000904',
      ),
      factKey: other,
    } as NotificationIntakeFact);
    expect(forUser(env, OWNER)).toHaveLength(2);
    expect(env.notifications.rows.size).toBe(4);
  });

  it('[TC-NOTIFICATIONS-FX-018] la notificación v1 del ancla pasa a ser el aviso del grupo con el mensaje v2 y sin email nuevo', async () => {
    const { env, intake } = setup();
    await intake.notify(group());
    const [owner] = forUser(env, OWNER);
    // Simula el aviso por muestra anterior a la agrupación: mensaje v1 y sin `lastRetainedAt`.
    env.notifications.rows.set(owner?.id ?? '', {
      ...(owner as NonNullable<typeof owner>),
      messageKey: 'notifications.fx_rate_anomaly_retained.v1',
      params: { rateId: FX_RATE_ID },
    });
    const outcome = await intake.notify(
      group(
        { pendingCount: 4, retainedCount: 4, lastRetainedAt: '2026-10-13T14:20:00.000Z' },
        '01928c4e-7a3b-7c11-8f00-000000000905',
      ),
    );
    expect(outcome).toEqual({ created: 0, refreshed: 2, deliveries: 0 });
    expect(forUser(env, OWNER)[0]).toMatchObject({
      id: owner?.id,
      messageKey: 'notifications.fx_rate_anomaly_retained.v2',
      params: { pendingCount: 4 },
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
