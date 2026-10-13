import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import { anomalyRetainedPayload, EPISODE_ID, feedStalePayload, FX_RATE_ID, WS } from '../domain/fixtures.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotificationIntake } from './notification-intake.js';
import { EDITOR, NotificationsTestEnv, OWNER } from './testing/in-memory.js';

// Emails de las alertas de tasas de extremo a extremo con dobles (add-rate-feed-alerts; FR-NOTIFY-006): NOTIFY crea la
// notificación y la entrega, y el despachador envía el email renderizado; sin opt-in no lleva valores, monedas ni providers.
const anomalyFact = {
  workspaceId: WS,
  type: 'FX_RATE_ANOMALY_RETAINED',
  factKey: FX_RATE_ID,
  sourceEventId: '01928c4e-7a3b-7c11-8f00-000000000901',
  occurredAt: '2026-10-13T14:02:10.000Z',
  payload: anomalyRetainedPayload(),
} as unknown as NotificationIntakeFact;
const staleFact = {
  workspaceId: WS,
  type: 'FX_RATE_FEED_STALE',
  factKey: EPISODE_ID,
  sourceEventId: '01928c4e-7a3b-7c11-8f00-000000000902',
  occurredAt: '2026-10-13T14:15:00.000Z',
  payload: feedStalePayload(),
} as unknown as NotificationIntakeFact;

async function setup(facts: NotificationIntakeFact[]) {
  const env = new NotificationsTestEnv();
  env.clock.set(Instant.parse('2026-10-13T14:15:00Z'));
  const intake = new NotificationIntake(env.notifyDeps());
  for (const fact of facts) await intake.notify(fact);
  const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
  const deliveryOf = (userId: string, type: string) => {
    const n = [...env.notifications.rows.values()].find((r) => r.userId === userId && r.type === type);
    return env.deliveries.byNotification(n?.id ?? '');
  };
  return { env, dispatch, deliveryOf };
}

const withoutUrls = (value: string): string => value.replace(/https?:\/\/\S+/g, '');
const SECRETS = [
  '72000',
  '72.000',
  '72,000',
  '65000',
  '65.000',
  '10.77',
  '10,77',
  'BTC',
  'USDT',
  'BOB',
  'CRYPTO_EXAMPLE',
];

describe('Email de las alertas de tasas', () => {
  it('[TC-NOTIFICATIONS-FX-005] sin opt-in el email de la muestra retenida no contiene valores, variación, monedas ni provider y enlaza a la app autenticada', async () => {
    const { env, dispatch, deliveryOf } = await setup([anomalyFact, staleFact]);
    for (const [type, userId] of [
      ['FX_RATE_ANOMALY_RETAINED', OWNER],
      ['FX_RATE_FEED_STALE', OWNER],
      ['FX_RATE_ANOMALY_RETAINED', EDITOR],
    ] as const) {
      const delivery = deliveryOf(userId, type);
      expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery?.id ?? '' })).toBe('sent');
    }
    expect(env.sender.sent).toHaveLength(3);
    for (const mail of env.sender.sent) {
      const content = withoutUrls(`${mail.subject}\n${mail.text}\n${mail.html}`);
      for (const secret of SECRETS) expect(content, `${mail.to} ${secret}`).not.toContain(secret);
      expect(mail.text).toMatch(/https:\/\/app\.pfos\.test\/notificaciones\/[0-9a-f-]{36}/);
    }
    // Locale del destinatario: OWNER es-BO en español, EDITOR pt-BR en portugués.
    const owner = env.sender.sent.find((m) => m.to === 'owner@pfos.test');
    const editor = env.sender.sent.find((m) => m.to === 'editor@pfos.test');
    expect(owner?.subject).toBe('Tienes una tasa retenida por revisar');
    expect(editor?.subject).toBe('Você tem uma taxa retida para revisar');
  });

  it('[TC-NOTIFICATIONS-FX-005] con opt-in de detalles el email incluye el par y los valores', async () => {
    const { env, dispatch, deliveryOf } = await setup([anomalyFact]);
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: null, includeDetailsInEmail: true });
    await env.preferences.save(owner);
    const delivery = deliveryOf(OWNER, 'FX_RATE_ANOMALY_RETAINED');
    expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery?.id ?? '' })).toBe('sent');
    const [mail] = env.sender.sent;
    expect(mail?.text).toContain('BTC/USDT');
    expect(mail?.text).toContain('72.000,00');
    expect(mail?.text).toContain('65.000,00');
    expect(mail?.text).toContain('+10,77');
  });

  it('[TC-NOTIFICATIONS-FX-007] el EDITOR sin email del tipo obsoleto recibe la in-app y ninguna entrega', async () => {
    const env = new NotificationsTestEnv();
    env.clock.set(Instant.parse('2026-10-13T14:15:00Z'));
    const editor = await env.preferences.load(WS, EDITOR);
    editor.update({
      types: [{ type: 'FX_RATE_FEED_STALE', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(editor);
    await new NotificationIntake(env.notifyDeps()).notify(staleFact);
    const mine = [...env.notifications.rows.values()].filter((n) => n.userId === EDITOR);
    expect(mine).toHaveLength(1);
    expect(env.deliveries.byNotification(mine[0]?.id ?? '')).toBeUndefined();
  });
});
