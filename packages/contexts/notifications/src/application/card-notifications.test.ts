import { describe, expect, it } from 'vitest';
import {
  CARD_ACCOUNT_ID,
  CARD_ID,
  cardPaymentDuePayload,
  cardUtilizationPayload,
  occurrenceDuePayload,
  STATEMENT_ID,
  WS,
} from '../domain/fixtures.js';
import { definitionOf } from '../domain/index.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const cardDue = definitionOf('CARD_PAYMENT_DUE');
const cardUtilization = definitionOf('CARD_UTILIZATION');
const occurrenceDue = definitionOf('RECURRING_PAYMENT_UPCOMING');

const event = (payload: Record<string, unknown>, eventId = '01928c4e-7a3b-7c11-8f00-000000000c02') => ({
  eventId,
  workspaceId: WS,
  occurredAt: '2026-11-12T13:00:00.000Z',
  payload,
});

const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

describe('NotifyFromEvent: tarjetas de crédito', () => {
  it('[TC-DEBT-CARD-034] el vencimiento va a OWNER y EDITOR (no VIEWER), una vez por tarjeta y cierre aunque llegue con otro eventId', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    expect(await notify.handle(event(cardPaymentDuePayload()), cardDue)).toEqual({
      created: 2,
      deliveries: 2,
    });
    expect(
      await notify.handle(
        event(cardPaymentDuePayload({ daysBefore: 1 }), '01928c4e-7a3b-7c11-8f00-000000000c99'),
        cardDue,
      ),
    ).toEqual({ created: 0, deliveries: 0 });
    expect(forUser(env, VIEWER)).toHaveLength(0);
    for (const userId of [OWNER, EDITOR]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'CARD_PAYMENT_DUE',
        severity: 'INFO',
        dedupeKey: `card-due:${CARD_ACCOUNT_ID}:2026-10-25`,
        link: { kind: 'CREDIT_CARD', cardId: CARD_ID, statementId: STATEMENT_ID },
        params: { cardName: 'Visa Oro', currency: 'BOB', dueDate: '2026-11-15' },
      });
    }
    // otro cierre de la misma cuenta es otro estado de cuenta
    const next = await notify.handle(
      event(
        cardPaymentDuePayload({ closingDate: '2026-11-25', dueDate: '2026-12-15' }),
        '01928c4e-7a3b-7c11-8f00-000000000c98',
      ),
      cardDue,
    );
    expect(next.created).toBe(2);
  });

  it('[TC-DEBT-CARD-034] con 1 día o menos para el vencimiento la severidad es WARNING', () => {
    expect(cardDue.plan(cardPaymentDuePayload({ daysBefore: 1 })).severity).toBe('WARNING');
    expect(cardDue.plan(cardPaymentDuePayload({ daysBefore: 0 })).severity).toBe('WARNING');
    expect(cardDue.plan(cardPaymentDuePayload({ daysBefore: 2 })).severity).toBe('INFO');
  });

  it('[TC-DEBT-CARD-034] el email sin opt-in no lleva montos ni el nombre de la tarjeta; con opt-in sí', async () => {
    const env = new NotificationsTestEnv();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: null, includeDetailsInEmail: false });
    await env.preferences.save(owner);
    await new NotifyFromEvent(env.notifyDeps()).handle(event(cardPaymentDuePayload()), cardDue);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    const n = forUser(env, OWNER)[0]!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(n.id)!.id });
    const plain = env.sender.sent.find((m) => m.to === 'owner@pfos.test')!;
    expect(plain.subject).toBe('Tienes un vencimiento de tarjeta');
    expect(plain.text).toContain('Una de tus tarjetas de crédito vence el 15/11/2026.');
    for (const leak of ['Visa Oro', '1120', '56,02', '56.02', 'BOB']) {
      expect(plain.text + plain.html + plain.subject, leak).not.toContain(leak);
    }

    const withDetails = await env.preferences.load(WS, OWNER);
    withDetails.update({ types: [], quietHours: null, includeDetailsInEmail: true });
    await env.preferences.save(withDetails);
    await new NotifyFromEvent(env.notifyDeps()).handle(
      event(
        cardPaymentDuePayload({ closingDate: '2026-11-25', dueDate: '2026-12-15' }),
        '01928c4e-7a3b-7c11-8f00-000000000c97',
      ),
      cardDue,
    );
    const second = forUser(env, OWNER).find((x) => x.dedupeKey.endsWith('2026-11-25'))!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(second.id)!.id });
    const detailed = env.sender.sent.filter((m) => m.to === 'owner@pfos.test').at(-1)!;
    expect(detailed.text).toContain('Visa Oro (BOB)');
    expect(detailed.text).toContain('1.120,50 BOB');
  });

  it('[TC-DEBT-CARD-034] respeta las preferencias por tipo y canal', async () => {
    const env = new NotificationsTestEnv();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'CARD_PAYMENT_DUE', inApp: true, email: false }],
      includeDetailsInEmail: false,
      quietHours: null,
    });
    await env.preferences.save(owner);
    const editor = await env.preferences.load(WS, EDITOR);
    editor.update({
      types: [{ type: 'CARD_PAYMENT_DUE', inApp: false, email: true }],
      includeDetailsInEmail: false,
      quietHours: null,
    });
    await env.preferences.save(editor);
    const outcome = await new NotifyFromEvent(env.notifyDeps()).handle(
      event(cardPaymentDuePayload()),
      cardDue,
    );
    // OWNER: solo in-app (sin entrega por email); EDITOR: sin in-app, por lo tanto sin notificación ni email.
    expect(outcome).toEqual({ created: 1, deliveries: 0 });
    expect(forUser(env, EDITOR)).toHaveLength(0);
  });

  it('[TC-DEBT-CARD-035] la utilización crea una sola notificación WARNING por destinatario con el umbral más alto', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    expect(await notify.handle(event(cardUtilizationPayload()), cardUtilization)).toEqual({
      created: 2,
      deliveries: 2,
    });
    expect(
      await notify.handle(
        event(cardUtilizationPayload(), '01928c4e-7a3b-7c11-8f00-000000000c98'),
        cardUtilization,
      ),
    ).toEqual({ created: 0, deliveries: 0 });
    expect(forUser(env, VIEWER)).toHaveLength(0);
    const [n] = forUser(env, OWNER);
    expect(n).toMatchObject({
      type: 'CARD_UTILIZATION',
      severity: 'WARNING',
      link: { kind: 'CREDIT_CARD', cardId: CARD_ID },
      params: { threshold: '80.00', alsoCrossed: ['30.00'], utilization: '85.00' },
    });
    // un nuevo cruce del mismo umbral (tras bajar de él) es otro hecho; el ámbito ACCOUNT incluye la cuenta
    const again = await notify.handle(
      event(cardUtilizationPayload({ crossingNo: 2 }), '01928c4e-7a3b-7c11-8f00-000000000c97'),
      cardUtilization,
    );
    expect(again.created).toBe(2);
    const otherAccount = await notify.handle(
      event(
        cardUtilizationPayload({ accountId: '01928c4e-0000-7000-8000-0000000a0004' }),
        '01928c4e-7a3b-7c11-8f00-000000000c96',
      ),
      cardUtilization,
    );
    expect(otherAccount.created).toBe(2);
  });

  it('[TC-DEBT-CARD-035] la clave de negocio sigue (tarjeta, ámbito, umbral, cruce) y se rechazan payloads inválidos', () => {
    expect(cardUtilization.plan(cardUtilizationPayload({ scope: 'SHARED', accountId: null })).dedupeKey).toBe(
      `card-utilization:${CARD_ID}:SHARED:80.00:1`,
    );
    expect(() =>
      cardUtilization.plan(cardUtilizationPayload({ scope: 'ACCOUNT', accountId: null })),
    ).toThrow();
    expect(() => cardUtilization.plan(cardUtilizationPayload({ crossingNo: 0 }))).toThrow();
    const { statementId: _omit, ...withoutStatement } = cardPaymentDuePayload();
    expect(() => cardDue.plan(withoutStatement)).toThrow();
  });

  it('[TC-DEBT-CARD-035] el email de utilización no lleva montos ni utilización sin opt-in', async () => {
    const env = new NotificationsTestEnv();
    await new NotifyFromEvent(env.notifyDeps()).handle(event(cardUtilizationPayload()), cardUtilization);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    const n = forUser(env, OWNER)[0]!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(n.id)!.id });
    const sent = env.sender.sent.find((m) => m.to === 'owner@pfos.test')!;
    expect(sent.text).toContain('Una de tus tarjetas de crédito alcanzó el 80 % de su límite.');
    for (const leak of ['Visa Oro', '85,00', '850', '1.000', 'USD']) {
      expect(sent.text + sent.html + sent.subject, leak).not.toContain(leak);
    }
  });

  it('[TC-DEBT-CARD-036] el pago de tarjeta sin aprobación no crea el aviso genérico de pago próximo', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const outcome = await notify.handle(
      event(
        occurrenceDuePayload({
          name: 'Pago Visa Oro BOB',
          kind: 'CARD_PAYMENT',
          managedBy: 'DEBT',
          requiresApproval: false,
          mode: 'NOTIFY_ONLY',
        }),
      ),
      occurrenceDue,
    );
    expect(outcome).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
  });

  it('[TC-DEBT-CARD-036] el pago de tarjeta con aprobación pendiente notifica "ocurrencia por aprobar" a OWNER y EDITOR', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const outcome = await notify.handle(
      event(
        occurrenceDuePayload({
          name: 'Pago Visa Oro BOB',
          kind: 'CARD_PAYMENT',
          managedBy: 'DEBT',
          requiresApproval: true,
          mode: 'PENDING_APPROVAL',
        }),
      ),
      occurrenceDue,
    );
    expect(outcome.created).toBe(2);
    expect(forUser(env, VIEWER)).toHaveLength(0);
    expect(forUser(env, OWNER)[0]).toMatchObject({ type: 'RECURRING_APPROVAL_REQUIRED' });
    expect(forUser(env, EDITOR)[0]).toMatchObject({ type: 'RECURRING_APPROVAL_REQUIRED' });
  });

  it('[TC-DEBT-CARD-036] otros pagos sin aprobación (no CARD_PAYMENT) conservan el aviso genérico', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const outcome = await notify.handle(
      event(occurrenceDuePayload({ requiresApproval: false, mode: 'NOTIFY_ONLY', kind: 'EXPENSE' })),
      occurrenceDue,
    );
    expect(outcome.created).toBe(2);
  });
});
