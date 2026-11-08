import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import { SHORTFALL_EPISODE_2_ID, SHORTFALL_EPISODE_ID, shortfallPayload, WS } from '../domain/fixtures.js';
import { NotificationIntake } from './notification-intake.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const SOURCE_EVENT = '01928c4e-7a3b-7c11-8f00-000000000a01';

const fact = (
  episodeId = SHORTFALL_EPISODE_ID,
  payload: Record<string, unknown> = {},
  sourceEventId = SOURCE_EVENT,
): NotificationIntakeFact =>
  ({
    workspaceId: WS,
    type: 'CASH_FLOW_SHORTFALL_RISK',
    factKey: episodeId,
    sourceEventId,
    occurredAt: '2026-10-20T12:25:00.000Z',
    payload: shortfallPayload({ episodeId, ...payload }),
  }) as unknown as NotificationIntakeFact;

const setup = () => {
  const env = new NotificationsTestEnv();
  env.clock.set(Instant.parse('2026-10-20T12:25:00Z'));
  return { env, intake: new NotificationIntake(env.notifyDeps()) };
};
const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

describe('NotificationIntake: riesgo de déficit del calendario de flujo de caja', () => {
  it('[TC-NOTIFICATIONS-SHORTFALL-001] OWNER y EDITOR reciben el riesgo crítico con la fecha y el enlace al calendario; el VIEWER no', async () => {
    const { env, intake } = setup();
    expect(await intake.notify(fact())).toEqual({ created: 2, refreshed: 0, deliveries: 2 });
    for (const userId of [OWNER, EDITOR]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'CASH_FLOW_SHORTFALL_RISK',
        status: 'UNREAD',
        severity: 'CRITICAL',
        dedupeKey: `CASH_FLOW_SHORTFALL_RISK:${SHORTFALL_EPISODE_ID}`,
        sourceEventId: SOURCE_EVENT,
        params: { currency: 'BOB', firstShortfallDate: '2026-11-01', belowZero: true },
        link: { kind: 'CASH_FLOW_CALENDAR', currency: 'BOB', horizonDays: 30, periodLabel: '2026-10' },
      });
    }
    expect(forUser(env, VIEWER)).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-001] un mínimo de 621.00 BOB sobre la reserva de 1500.00 BOB (sin ser negativo) es advertencia', async () => {
    const { env, intake } = setup();
    await intake.notify(
      fact(SHORTFALL_EPISODE_2_ID, {
        lowest: { amount: '621.00', currency: 'BOB' },
        belowZero: false,
      }),
    );
    expect(forUser(env, OWNER)[0]).toMatchObject({ severity: 'WARNING', params: { belowZero: false } });
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-002] el mismo episodio entregado dos veces, también a la vez, deja una sola notificación por destinatario', async () => {
    const { env, intake } = setup();
    await intake.notify(fact());
    const again = await intake.notify(fact(SHORTFALL_EPISODE_ID, {}, '01928c4e-7a3b-7c11-8f00-000000000a02'));
    expect(again).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    await Promise.all([intake.notify(fact()), intake.notify(fact())]);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(forUser(env, EDITOR)).toHaveLength(1);
    expect(env.deliveries.rows.size).toBe(2);
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-002] el cierre del episodio no notifica y un episodio nuevo genera una notificación nueva', async () => {
    const { env, intake } = setup();
    await intake.notify(fact());
    // El cierre (`reporting.CashFlowShortfallRiskCleared.v1`) no llega a NOTIFY: no existe un tipo de intake para él (D380).
    expect(() =>
      intake.notify({ ...fact(), type: 'CASH_FLOW_SHORTFALL_CLEARED' } as unknown as NotificationIntakeFact),
    ).toThrow(/unknown intake/);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(await intake.notify(fact(SHORTFALL_EPISODE_2_ID))).toEqual({
      created: 2,
      refreshed: 0,
      deliveries: 2,
    });
    expect(forUser(env, OWNER)).toHaveLength(2);
  });

  it('respeta la preferencia por tipo y canal y el horario de silencio del destinatario', async () => {
    const { env, intake } = setup();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'CASH_FLOW_SHORTFALL_RISK', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(owner);
    const outcome = await intake.notify(fact());
    expect(outcome).toEqual({ created: 2, refreshed: 0, deliveries: 1 });
    expect(env.deliveries.byNotification(forUser(env, OWNER)[0]!.id)).toBeUndefined();
  });

  it('un hecho mal formado se rechaza sin crear nada', async () => {
    const { env, intake } = setup();
    await expect(intake.notify(fact(SHORTFALL_EPISODE_ID, { belowZero: 'si' }))).rejects.toThrow(/belowZero/);
    await expect(
      intake.notify(fact(SHORTFALL_EPISODE_ID, { threshold: { amount: '1500.00', currency: 'USD' } })),
    ).rejects.toThrow(/currency/);
    expect(env.notifications.rows.size).toBe(0);
  });
});
