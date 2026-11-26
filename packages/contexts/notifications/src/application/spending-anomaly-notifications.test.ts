import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import { WS } from '../domain/fixtures.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotificationIntake } from './notification-intake.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const ANOMALY_ID = '01928c4e-0000-7000-8000-0000000a0001';
const SOURCE_EVENT = '01928c4e-7a3b-7c11-8f00-000000000b01';

const fact = (
  passDate = '2026-11-13',
  overrides: Record<string, unknown> = {},
  sourceEventId = SOURCE_EVENT,
): NotificationIntakeFact =>
  ({
    workspaceId: WS,
    type: 'SPENDING_ANOMALY',
    factKey: `spending-anomalies:${passDate}`,
    sourceEventId,
    occurredAt: `${passDate}T05:15:00.000Z`,
    payload: {
      workspaceId: WS,
      passDate,
      count: 2,
      top: {
        anomalyId: ANOMALY_ID,
        transactionDate: '2026-11-12',
        reportingAmount: { amount: '304.00', currency: 'BOB' },
        reasons: ['CATEGORY_OUTLIER'],
      },
      timeZone: 'America/La_Paz',
      ...overrides,
    },
  }) as unknown as NotificationIntakeFact;

const setup = () => {
  const env = new NotificationsTestEnv();
  env.clock.set(Instant.parse('2026-11-13T05:15:00Z'));
  return { env, intake: new NotificationIntake(env.notifyDeps()) };
};
const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

async function activate(env: NotificationsTestEnv, userId: string, email = false, details = false) {
  const prefs = await env.preferences.load(WS, userId);
  prefs.update({
    types: [{ type: 'SPENDING_ANOMALY', inApp: true, email }],
    quietHours: null,
    includeDetailsInEmail: details,
  });
  await env.preferences.save(prefs);
}

describe('NotificationIntake: gastos atípicos (desactivado por omisión)', () => {
  it('[TC-NOTIFICATIONS-ANOMALY-001] sin activar el tipo nadie recibe notificación ni email', async () => {
    const { env, intake } = setup();
    expect(await intake.notify(fact())).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-001] las preferencias muestran el tipo apagado en los dos canales y los demás activos', async () => {
    const { env } = setup();
    const view = (await env.preferences.load(WS, OWNER)).toView();
    expect(view.types.find((t) => t.type === 'SPENDING_ANOMALY')).toEqual({
      type: 'SPENDING_ANOMALY',
      inApp: false,
      email: false,
    });
    expect(
      view.types
        .filter((t) => t.type !== 'SPENDING_ANOMALY' && t.type !== 'BUDGET_OVERRUN_RISK')
        .every((t) => t.inApp && t.email),
    ).toBe(true);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] con el tipo activado OWNER y EDITOR reciben una sola notificación; el VIEWER no', async () => {
    const { env, intake } = setup();
    for (const userId of [OWNER, EDITOR, VIEWER]) await activate(env, userId);
    expect(await intake.notify(fact())).toEqual({ created: 2, refreshed: 0, deliveries: 0 });
    for (const userId of [OWNER, EDITOR]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'SPENDING_ANOMALY',
        severity: 'INFO',
        status: 'UNREAD',
        dedupeKey: 'SPENDING_ANOMALY:2026-11-13',
        sourceEventId: SOURCE_EVENT,
        params: { passDate: '2026-11-13', count: 2 },
        link: { kind: 'SPENDING_ANOMALIES', periodId: WS, periodLabel: '2026-11' },
      });
    }
    expect(forUser(env, VIEWER)).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] solo con el tipo activado en la app: sin email programado si el canal sigue apagado', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER, true);
    await activate(env, EDITOR, false);
    expect(await intake.notify(fact())).toEqual({ created: 2, refreshed: 0, deliveries: 1 });
  });

  it('[TC-NOTIFICATIONS-ANOMALY-003] repetir la pasada no duplica la notificación ni el email', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER, true);
    await intake.notify(fact());
    const again = await intake.notify(fact('2026-11-13', {}, '01928c4e-7a3b-7c11-8f00-000000000b02'));
    expect(again).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    await Promise.all([intake.notify(fact()), intake.notify(fact())]);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(env.deliveries.rows.size).toBe(1);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-003] otra pasada (otro día) genera otra notificación', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER);
    await intake.notify(fact('2026-11-13'));
    await intake.notify(fact('2026-11-14', {}, '01928c4e-7a3b-7c11-8f00-000000000b03'));
    expect(forUser(env, OWNER)).toHaveLength(2);
  });

  it('[TC-NOTIFICATIONS-ANOMALY-002] un hecho mal formado se rechaza sin crear nada', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER);
    await expect(intake.notify(fact('2026-11-13', { count: 0 }))).rejects.toThrow(/count/);
    await expect(intake.notify(fact('2026-11-13', { passDate: '2026-11-14' }))).rejects.toThrow(/passDate/);
    await expect(
      intake.notify(
        fact('2026-11-13', {
          top: {
            anomalyId: ANOMALY_ID,
            transactionDate: '2026-11-12',
            reportingAmount: { amount: '1.00', currency: 'BOB' },
            reasons: ['ERROR'],
          },
        }),
      ),
    ).rejects.toThrow(/reasons/);
    expect(env.notifications.rows.size).toBe(0);
  });
});

describe('Email de gastos atípicos', () => {
  async function mailsFor(options: { details: boolean; editorLocale?: string }) {
    const { env, intake } = setup();
    if (options.editorLocale) {
      env.recipients.members = env.recipients.members.map((m) =>
        m.userId === EDITOR ? { ...m, locale: options.editorLocale as string } : m,
      );
    }
    await activate(env, OWNER, true, options.details);
    await activate(env, EDITOR, true, options.details);
    await intake.notify(fact());
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    for (const userId of [OWNER, EDITOR]) {
      const n = forUser(env, userId)[0];
      const delivery = env.deliveries.byNotification(n?.id ?? '');
      expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery?.id ?? '' })).toBe('sent');
    }
    return env.sender.sent;
  }
  const withoutUrls = (value: string): string => value.replace(/https?:\/\/\S+/g, '');

  it('[TC-NOTIFICATIONS-ANOMALY-004] el email sin opt-in lleva la cantidad, la fecha y el enlace, sin montos ni nombres', async () => {
    const sent = await mailsFor({ details: false });
    const owner = sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.subject).toBe('Tienes gastos atípicos para revisar');
    expect(owner?.text).toContain('El 13/11/2026 se detectaron 2 gastos atípicos nuevos.');
    expect(owner?.text).toMatch(/https:\/\/app\.pfos\.test\/notificaciones\/[0-9a-f-]{36}/);
    for (const mail of sent) {
      const content = withoutUrls(`${mail.subject}\n${mail.text}\n${mail.html}`);
      for (const secret of ['304', 'BOB', 'Restaurantes', '12/11/2026', 'habitual']) {
        expect(content, `${mail.to} ${secret}`).not.toContain(secret);
      }
    }
  });

  it('[TC-NOTIFICATIONS-ANOMALY-004] con un solo gasto atípico el texto va en singular', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER, true);
    await intake.notify(fact('2026-11-13', { count: 1 }));
    const delivery = env.deliveries.byNotification(forUser(env, OWNER)[0]?.id ?? '');
    await new DispatchEmailDelivery(env.dispatchDeps()).run({
      workspaceId: WS,
      deliveryId: delivery?.id ?? '',
    });
    expect(env.sender.sent[0]?.text).toContain('El 13/11/2026 se detectó 1 gasto atípico nuevo.');
  });

  it('[TC-NOTIFICATIONS-ANOMALY-005] con opt-in el email sale en el idioma del destinatario con el monto y el motivo', async () => {
    const sent = await mailsFor({ details: true, editorLocale: 'en-US' });
    const editor = sent.find((m) => m.to === 'editor@pfos.test');
    expect(editor?.subject).toBe('You have unusual expenses to review');
    expect(editor?.text).toContain('304.00 BOB on 11/12/2026');
    expect(editor?.text).toContain('well above usual for its category');
    expect(editor?.text).toContain('On 11/13/2026 2 new unusual expenses were detected');
    const owner = sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.text).toContain('304,00 BOB el 12/11/2026');
  });

  it('[TC-NOTIFICATIONS-ANOMALY-005] el email del destinatario con locale pt-BR sale en portugués', async () => {
    const sent = await mailsFor({ details: false });
    const editor = sent.find((m) => m.to === 'editor@pfos.test');
    expect(editor?.subject).toBe('Você tem despesas atípicas para revisar');
    expect(editor?.text).toContain('Em 13/11/2026 foram detectadas 2 despesas atípicas novas.');
  });
});
