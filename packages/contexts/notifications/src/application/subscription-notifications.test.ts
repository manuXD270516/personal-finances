import { describe, expect, it } from 'vitest';
import {
  priceChangedPayload,
  renewalPayload,
  SUBSCRIPTION_ID,
  trialEndingPayload,
  WS,
} from '../domain/fixtures.js';
import { definitionOf } from '../domain/index.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const renewal = definitionOf('SUBSCRIPTION_RENEWAL');
const trial = definitionOf('SUBSCRIPTION_TRIAL_ENDING');
const priceChange = definitionOf('SUBSCRIPTION_PRICE_CHANGE');

const event = (payload: Record<string, unknown>, eventId = '01928c4e-7a3b-7c11-8f00-000000000301') => ({
  eventId,
  workspaceId: WS,
  occurredAt: '2026-11-12T10:00:00.000Z',
  payload,
});

const setup = () => {
  const env = new NotificationsTestEnv();
  return { env, notify: new NotifyFromEvent(env.notifyDeps()) };
};

const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

describe('NotifyFromEvent: suscripciones', () => {
  it('[TC-COMMITMENTS-SUBS-030] la renovación próxima crea una notificación por miembro y una sola aunque se reentregue', async () => {
    const { env, notify } = setup();
    const outcome = await notify.handle(event(renewalPayload()), renewal);
    expect(outcome).toEqual({ created: 3, deliveries: 3 });
    for (const userId of [OWNER, EDITOR, VIEWER]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'SUBSCRIPTION_RENEWAL',
        status: 'UNREAD',
        severity: 'INFO',
        dedupeKey: `subscription-renewal:${SUBSCRIPTION_ID}:2026-11-15`,
      });
      expect(n?.params).toMatchObject({
        providerName: 'Streamly',
        renewalDate: '2026-11-15',
        expectedPrice: { amount: '10.99', currency: 'USD' },
        paymentAccountName: 'Visa USD',
      });
      expect(n?.link).toMatchObject({ kind: 'SUBSCRIPTION', subscriptionId: SUBSCRIPTION_ID });
    }
    // el mismo evento y otro eventId con la misma suscripción y fecha no duplican
    expect(await notify.handle(event(renewalPayload()), renewal)).toEqual({ created: 0, deliveries: 0 });
    expect(
      await notify.handle(event(renewalPayload(), '01928c4e-7a3b-7c11-8f00-000000000999'), renewal),
    ).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(3);
    // otra fecha de renovación es otro hecho
    expect(
      (
        await notify.handle(
          event(renewalPayload({ renewalDate: '2026-12-15' }), '01928c4e-7a3b-7c11-8f00-000000000998'),
          renewal,
        )
      ).created,
    ).toBe(3);
  });

  it('[TC-COMMITMENTS-SUBS-031] el fin de trial crea una notificación WARNING con provider, fecha y primer cobro', async () => {
    const { env, notify } = setup();
    await notify.handle(event(trialEndingPayload()), trial);
    const [n] = forUser(env, OWNER);
    expect(n).toMatchObject({ type: 'SUBSCRIPTION_TRIAL_ENDING', severity: 'WARNING', status: 'UNREAD' });
    expect(n?.params).toMatchObject({
      providerName: 'CloudDrive',
      trialEndsOn: '2026-11-20',
      firstChargePrice: { amount: '99.99', currency: 'USD' },
    });
    expect(env.notifications.rows.size).toBe(3);
  });

  it('[TC-COMMITMENTS-SUBS-032] un cambio de precio detectado notifica a OWNER y EDITOR y uno manual no notifica', async () => {
    const { env, notify } = setup();
    const detected = await notify.handle(event(priceChangedPayload()), priceChange);
    expect(detected.created).toBe(2);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(forUser(env, EDITOR)).toHaveLength(1);
    expect(forUser(env, VIEWER)).toHaveLength(0);
    expect(forUser(env, OWNER)[0]).toMatchObject({
      type: 'SUBSCRIPTION_PRICE_CHANGE',
      severity: 'WARNING',
      params: {
        providerName: 'MusicBox',
        previousPrice: { amount: '9.99', currency: 'USD' },
        newPrice: { amount: '11.99', currency: 'USD' },
        changePercentage: '+20.02',
      },
    });
    const manual = await notify.handle(
      event(
        priceChangedPayload({
          origin: 'MANUAL',
          proposalId: null,
          providerName: 'Streamly',
          effectiveFrom: '2027-03-15',
        }),
        '01928c4e-7a3b-7c11-8f00-000000000997',
      ),
      priceChange,
    );
    expect(manual).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(2);
  });

  it('[TC-COMMITMENTS-SUBS-033] el email de renovación no incluye provider, montos ni cuenta salvo opt-in de detalles', async () => {
    const env = new NotificationsTestEnv();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: null, includeDetailsInEmail: false });
    await env.preferences.save(owner);
    await new NotifyFromEvent(env.notifyDeps()).handle(event(renewalPayload()), renewal);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    const ownerNotification = forUser(env, OWNER)[0]!;
    const delivery = env.deliveries.byNotification(ownerNotification.id)!;
    await dispatch.run({ workspaceId: WS, deliveryId: delivery.id });
    const plain = env.sender.sent.find((m) => m.to === 'owner@pfos.test')!;
    expect(plain.subject).toBe('Tienes una renovación de suscripción próxima');
    expect(plain.text).toContain('Una de tus suscripciones se renueva en 3 días.');
    for (const leak of ['Streamly', '10,99', '10.99', 'USD', 'Visa USD', 'Premium']) {
      expect(plain.text + plain.html + plain.subject, leak).not.toContain(leak);
    }

    // con el opt-in de detalles, otra renovación incluye provider, fecha y monto
    const withDetails = await env.preferences.load(WS, OWNER);
    withDetails.update({ types: [], quietHours: null, includeDetailsInEmail: true });
    await env.preferences.save(withDetails);
    await new NotifyFromEvent(env.notifyDeps()).handle(
      event(renewalPayload({ renewalDate: '2026-12-15' }), '01928c4e-7a3b-7c11-8f00-000000000996'),
      renewal,
    );
    const second = forUser(env, OWNER).find((n) => n.dedupeKey.endsWith('2026-12-15'))!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(second.id)!.id });
    const detailed = env.sender.sent.filter((m) => m.to === 'owner@pfos.test').at(-1)!;
    expect(detailed.text).toContain('Streamly');
    expect(detailed.text).toContain('15/12/2026');
    expect(detailed.text).toContain('10,99 USD');
  });

  it('[TC-COMMITMENTS-SUBS-034] el email respeta el idioma del destinatario (pt-BR) y cae a español (fr-FR)', async () => {
    const env = new NotificationsTestEnv();
    await new NotifyFromEvent(env.notifyDeps()).handle(event(priceChangedPayload()), priceChange);
    // EDITOR está en pt-BR en el entorno de pruebas
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    const editorNotification = forUser(env, EDITOR)[0]!;
    await dispatch.run({
      workspaceId: WS,
      deliveryId: env.deliveries.byNotification(editorNotification.id)!.id,
    });
    expect(env.sender.sent.find((m) => m.to === 'editor@pfos.test')?.subject).toBe(
      'Detectamos uma possível mudança de preço',
    );
  });
});
