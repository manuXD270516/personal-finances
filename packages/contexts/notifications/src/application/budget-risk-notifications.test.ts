import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { NotificationIntakeFact } from '../contracts/index.js';
import { WS } from '../domain/fixtures.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotificationIntake } from './notification-intake.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const PERIOD_ID = '01928c4e-0000-7000-8000-0000000b0001';
const BUDGET_ID = '01928c4e-0000-7000-8000-0000000b0002';
const LINE_ID = '01928c4e-0000-7000-8000-0000000b0003';
const TARGET_ID = '01928c4e-0000-7000-8000-0000000b0004';
const SOURCE_EVENT = '01928c4e-7a3b-7c11-8f00-000000000c01';

const fact = (overrides: Record<string, unknown> = {}, lineId = LINE_ID): NotificationIntakeFact =>
  ({
    workspaceId: WS,
    type: 'BUDGET_OVERRUN_RISK',
    factKey: `budget-risk:${PERIOD_ID}:${lineId}`,
    sourceEventId: SOURCE_EVENT,
    occurredAt: '2026-11-10T16:25:00.000Z',
    payload: {
      periodId: PERIOD_ID,
      periodLabel: '2026-11',
      budgetId: BUDGET_ID,
      budgetLineId: lineId,
      target: { kind: 'CATEGORY', id: TARGET_ID, name: 'Restaurantes' },
      projected: { amount: '840.00', currency: 'BOB' },
      reference: { amount: '600.00', currency: 'BOB' },
      estimatedDate: '2026-11-22',
      basis: 'RUN_RATE',
      detectedAt: '2026-11-10T16:25:00.000Z',
      timeZone: 'America/La_Paz',
      ...overrides,
    },
  }) as unknown as NotificationIntakeFact;

const setup = () => {
  const env = new NotificationsTestEnv();
  env.clock.set(Instant.parse('2026-11-10T16:25:00Z'));
  return { env, intake: new NotificationIntake(env.notifyDeps()) };
};
const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

async function activate(env: NotificationsTestEnv, userId: string, email = false, details = false) {
  const prefs = await env.preferences.load(WS, userId);
  prefs.update({
    types: [{ type: 'BUDGET_OVERRUN_RISK', inApp: true, email }],
    quietHours: null,
    includeDetailsInEmail: details,
  });
  await env.preferences.save(prefs);
}

describe('NotificationIntake: riesgo de presupuesto (desactivado por omisión)', () => {
  it('[TC-NOTIFICATIONS-BUDGETRISK-001] las preferencias muestran el tipo apagado en los dos canales', async () => {
    const { env } = setup();
    const view = (await env.preferences.load(WS, OWNER)).toView();
    expect(view.types.find((t) => t.type === 'BUDGET_OVERRUN_RISK')).toEqual({
      type: 'BUDGET_OVERRUN_RISK',
      inApp: false,
      email: false,
    });
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] solo quien activó el tipo recibe el aviso con proyección, referencia y fecha', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER);
    // El EDITOR y el VIEWER no activaron el tipo: no reciben nada.
    expect(await intake.notify(fact())).toEqual({ created: 1, refreshed: 0, deliveries: 0 });
    const [n, ...rest] = forUser(env, OWNER);
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({
      type: 'BUDGET_OVERRUN_RISK',
      severity: 'WARNING',
      status: 'UNREAD',
      dedupeKey: `BUDGET_OVERRUN_RISK:${PERIOD_ID}:${LINE_ID}`,
      params: {
        periodLabel: '2026-11',
        targetName: 'Restaurantes',
        projected: { amount: '840.00', currency: 'BOB' },
        reference: { amount: '600.00', currency: 'BOB' },
        estimatedDate: '2026-11-22',
      },
      link: {
        kind: 'BUDGET_LINE',
        periodId: PERIOD_ID,
        periodLabel: '2026-11',
        budgetId: BUDGET_ID,
        budgetLineId: LINE_ID,
        targetKind: 'CATEGORY',
        targetId: TARGET_ID,
      },
    });
    expect(forUser(env, EDITOR)).toHaveLength(0);
    expect(forUser(env, VIEWER)).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] todo miembro que activó el tipo lo recibe, VIEWER incluido (como el umbral)', async () => {
    const { env, intake } = setup();
    for (const userId of [OWNER, EDITOR, VIEWER]) await activate(env, userId);
    expect(await intake.notify(fact())).toEqual({ created: 3, refreshed: 0, deliveries: 0 });
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] sin activar el tipo nadie recibe notificación ni email', async () => {
    const { env, intake } = setup();
    expect(await intake.notify(fact())).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-002] repetir el hecho de la misma línea y periodo no duplica la notificación', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER, true);
    await intake.notify(fact());
    expect(await intake.notify(fact())).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(env.deliveries.rows.size).toBe(1);
    // Otra línea del mismo periodo sí avisa.
    await intake.notify(
      fact({ budgetLineId: '01928c4e-0000-7000-8000-0000000b0009' }, '01928c4e-0000-7000-8000-0000000b0009'),
    );
    expect(forUser(env, OWNER)).toHaveLength(2);
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-003] un hecho mal formado se rechaza sin crear nada', async () => {
    const { env, intake } = setup();
    await activate(env, OWNER);
    await expect(intake.notify(fact({ basis: 'CERTAIN' }))).rejects.toThrow(/basis/);
    await expect(intake.notify(fact({ target: { kind: 'TAG', id: TARGET_ID, name: 'x' } }))).rejects.toThrow(
      /target.kind/,
    );
    await expect(intake.notify(fact({ projected: { amount: '-1', currency: 'BOB' } }))).rejects.toThrow(
      /projected/,
    );
    await expect(
      intake.notify({ ...fact(), factKey: 'budget-risk:otro:linea' } as NotificationIntakeFact),
    ).rejects.toThrow(/factKey/);
    expect(env.notifications.rows.size).toBe(0);
  });
});

describe('Email de riesgo de presupuesto', () => {
  async function mailsFor(options: { details: boolean; payload?: Record<string, unknown> }) {
    const { env, intake } = setup();
    await activate(env, OWNER, true, options.details);
    await activate(env, EDITOR, true, options.details);
    await intake.notify(fact(options.payload ?? {}));
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    for (const userId of [OWNER, EDITOR]) {
      const n = forUser(env, userId)[0];
      const delivery = env.deliveries.byNotification(n?.id ?? '');
      expect(await dispatch.run({ workspaceId: WS, deliveryId: delivery?.id ?? '' })).toBe('sent');
    }
    return env.sender.sent;
  }
  const withoutUrls = (value: string): string => value.replace(/https?:\/\/\S+/g, '');

  it('[TC-NOTIFICATIONS-BUDGETRISK-004] el email sin opt-in indica un presupuesto en riesgo, la fecha estimada y el enlace, sin montos ni nombres', async () => {
    const sent = await mailsFor({ details: false });
    const owner = sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.subject).toBe('Un presupuesto podría excederse');
    expect(owner?.text).toContain('Un presupuesto de 2026-11 podría excederse alrededor del 22/11/2026');
    expect(owner?.text).toMatch(/https:\/\/app\.pfos\.test\/notificaciones\/[0-9a-f-]{36}/);
    for (const mail of sent) {
      const content = withoutUrls(`${mail.subject}\n${mail.text}\n${mail.html}`);
      for (const secret of ['840', '600', 'Restaurantes', 'BOB']) {
        expect(content, `${mail.to} ${secret}`).not.toContain(secret);
      }
    }
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-004] con opt-in el email lleva la proyección, el tope y el nombre, sin certezas', async () => {
    const sent = await mailsFor({ details: true });
    const owner = sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.text).toContain('Restaurantes superaría su tope de 2026-11 alrededor del 22/11/2026');
    expect(owner?.text).toContain('840,00 de 600,00 BOB');
    expect(owner?.text).toContain('según el ritmo del periodo');
    expect(owner?.text).toContain('Es una estimación');
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-004] sin fecha estimada usa la plantilla sin fecha', async () => {
    const sent = await mailsFor({ details: false, payload: { estimatedDate: null } });
    const owner = sent.find((m) => m.to === 'owner@pfos.test');
    expect(owner?.text).toContain('podría excederse antes de que termine el periodo');
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-005] el aviso y el email del destinatario con locale pt-BR salen en portugués con la fecha 22/11/2026', async () => {
    const { env, intake } = setup();
    await activate(env, EDITOR, true);
    await intake.notify(fact());
    const n = forUser(env, EDITOR)[0];
    expect(n).toBeDefined();
    const delivery = env.deliveries.byNotification(n?.id ?? '');
    await new DispatchEmailDelivery(env.dispatchDeps()).run({
      workspaceId: WS,
      deliveryId: delivery?.id ?? '',
    });
    const mail = env.sender.sent.find((m) => m.to === 'editor@pfos.test');
    expect(mail?.subject).toBe('Um orçamento pode ser ultrapassado');
    expect(mail?.text).toContain('por volta de 22/11/2026');
  });
});
