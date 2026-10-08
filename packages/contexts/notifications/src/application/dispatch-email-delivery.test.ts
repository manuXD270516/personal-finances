import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { definitionOf } from '../domain/index.js';
import { closePendingPayload, thresholdPayload, WS } from '../domain/fixtures.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { RetryableEmailError } from './ports/index.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const event = (
  payload: Record<string, unknown>,
  definition: 'BUDGET_THRESHOLD' | 'MONTH_CLOSE_PENDING' = 'BUDGET_THRESHOLD',
) => ({
  payload,
  definition: definitionOf(definition),
  source: {
    eventId: '01928c4e-7a3b-7c11-8f00-000000000301',
    workspaceId: WS,
    occurredAt: '2026-11-12T15:20:00.000Z',
    payload,
  },
});

/** Procesa el hecho y devuelve el despachador junto con la entrega de `userId`. */
async function setup(userId = OWNER, payload: Record<string, unknown> = thresholdPayload()) {
  const env = new NotificationsTestEnv();
  const e = event(payload);
  await new NotifyFromEvent(env.notifyDeps()).handle(e.source, e.definition);
  const notification = [...env.notifications.rows.values()].find((n) => n.userId === userId);
  const delivery = env.deliveries.byNotification(notification?.id ?? '');
  if (!notification || !delivery) throw new Error('notification not created');
  return {
    env,
    dispatch: new DispatchEmailDelivery(env.dispatchDeps()),
    notification,
    deliveryId: delivery.id,
  };
}

const run = (d: DispatchEmailDelivery, deliveryId: string) => d.run({ workspaceId: WS, deliveryId });

describe('DispatchEmailDelivery: envío', () => {
  it('[TC-NOTIFICATIONS-EMAIL-004] envía un email en español con asunto, Message-ID determinista y la entrega queda SENT', async () => {
    const { env, dispatch, deliveryId, notification } = await setup();
    expect(await run(dispatch, deliveryId)).toBe('sent');
    expect(env.sender.sent).toHaveLength(1);
    const [mail] = env.sender.sent;
    expect(mail).toMatchObject({
      to: 'owner@pfos.test',
      subject: 'Tienes una alerta de presupuesto',
      messageId: `<${deliveryId}@pfos.local>`,
      idempotencyKey: deliveryId,
      listUnsubscribeUrl: 'https://app.pfos.test/preferencias',
    });
    expect(mail?.text).toContain(`https://app.pfos.test/notificaciones/${notification.id}`);
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({
      status: 'SENT',
      attempts: 1,
      providerMessageId: `<${deliveryId}@pfos.local>`,
    });
    expect(env.metrics.emailDeliveries).toEqual(['sent']);
  });

  it('[TC-NOTIFICATIONS-EMAIL-005] repetir el despacho —también en dos instancias a la vez— no envía un segundo email', async () => {
    const { env, dispatch, deliveryId } = await setup();
    await run(dispatch, deliveryId);
    expect(await run(dispatch, deliveryId)).toBe('noop');
    const outcomes = await Promise.all([run(dispatch, deliveryId), run(dispatch, deliveryId)]);
    expect(outcomes).toEqual(['noop', 'noop']);
    expect(env.sender.sent).toHaveLength(1);
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('[TC-NOTIFICATIONS-EMAIL-005] dos instancias que arrancan a la vez: solo una envía', async () => {
    const { env, dispatch, deliveryId } = await setup();
    const outcomes = await Promise.all([run(dispatch, deliveryId), run(dispatch, deliveryId)]);
    expect(outcomes.sort()).toEqual(['noop', 'sent']);
    expect(env.sender.sent).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-EMAIL-001] sin opt-in el email es la variante basic: sin categoría, montos ni moneda', async () => {
    const { env, dispatch, deliveryId } = await setup();
    await run(dispatch, deliveryId);
    const mail = env.sender.sent[0];
    const content = `${mail?.subject}\n${mail?.text.replace(/https?:\/\/\S+/g, '')}\n${mail?.html.replace(/https?:\/\/\S+/g, '')}`;
    for (const forbidden of ['Restaurantes', '550', '600', 'BOB']) expect(content).not.toContain(forbidden);
    expect(mail?.text).toContain('alcanzó el 90 %');
  });

  it('[TC-NOTIFICATIONS-EMAIL-002] con opt-in el email indica categoría, 90 % y 550,00 de 600,00 BOB', async () => {
    const env = new NotificationsTestEnv();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: null, includeDetailsInEmail: true });
    await env.preferences.save(owner);
    const e = event(thresholdPayload());
    await new NotifyFromEvent(env.notifyDeps()).handle(e.source, e.definition);
    const notification = [...env.notifications.rows.values()].find((n) => n.userId === OWNER);
    const delivery = env.deliveries.byNotification(notification?.id ?? '');
    await run(new DispatchEmailDelivery(env.dispatchDeps()), delivery?.id ?? '');
    const mail = env.sender.sent[0];
    expect(mail?.text).toContain('Restaurantes');
    expect(mail?.text).toContain('90 %');
    expect(mail?.text).toContain('550,00 de 600,00 BOB');
    // El in-app no cambia por esta opción: siempre muestra los detalles.
  });

  it('[TC-NOTIFICATIONS-I18N-001] el asunto sale en el idioma del destinatario: es-BO, en-US, pt-BR y fr-FR (español)', async () => {
    const env = new NotificationsTestEnv();
    env.recipients.members = env.recipients.members.map((m) =>
      m.userId === OWNER ? { ...m, locale: 'en-US' } : m,
    );
    const e = event(thresholdPayload());
    await new NotifyFromEvent(env.notifyDeps()).handle(e.source, e.definition);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    for (const delivery of [...env.deliveries.rows.values()]) await run(dispatch, delivery.id);
    const subjectTo = (email: string) => env.sender.sent.find((m) => m.to === email)?.subject;
    expect(subjectTo('owner@pfos.test')).toBe('You have a budget alert');
    expect(subjectTo('editor@pfos.test')).toBe('Você tem um alerta de orçamento');
    expect(subjectTo('viewer@pfos.test')).toBe('Tienes una alerta de presupuesto');
  });

  it('el cierre pendiente se envía con su asunto propio', async () => {
    const env = new NotificationsTestEnv();
    const e = event(closePendingPayload(), 'MONTH_CLOSE_PENDING');
    await new NotifyFromEvent(env.notifyDeps()).handle(e.source, e.definition);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    for (const delivery of [...env.deliveries.rows.values()]) await run(dispatch, delivery.id);
    expect(env.sender.sent.map((m) => m.to).sort()).toEqual(['editor@pfos.test', 'owner@pfos.test']);
    expect(env.sender.sent.find((m) => m.to === 'owner@pfos.test')?.subject).toBe(
      'Tienes un mes pendiente de cierre',
    );
    expect(env.sender.sent.find((m) => m.to === 'editor@pfos.test')?.subject).toBe(
      'Você tem um mês pendente de fechamento',
    );
  });
});

describe('DispatchEmailDelivery: reintentos y fallos', () => {
  it('[TC-NOTIFICATIONS-EMAIL-006] con el proveedor caído hace 5 intentos con backoff, deja la entrega FAILED y el in-app intacto', async () => {
    const { env, dispatch, deliveryId, notification } = await setup();
    env.sender.down = true;
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      outcomes.push(await run(dispatch, deliveryId));
      const row = env.deliveries.rows.get(deliveryId);
      expect(row?.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(row?.status).toBe('RETRY');
        // La entrega solo vuelve a estar disponible tras su backoff.
        expect(await run(dispatch, deliveryId)).toBe('noop');
        env.clock.set(Instant.parse(row?.notBefore ?? ''));
        expect(env.scheduler.jobs.at(-1)?.startAfter?.toISOString()).toBe(row?.notBefore);
        expect(env.scheduler.jobs.at(-1)?.first).toBe(false);
      }
    }
    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'retry', 'failed']);
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      lastErrorCode: 'SMTP_CONNECTION',
    });
    expect(env.metrics.emailDeliveries.filter((s) => s === 'failed')).toHaveLength(1);
    // La notificación in-app existe desde el primer intento y no cambió.
    expect(env.notifications.rows.get(notification.id)).toMatchObject({ status: 'UNREAD' });
    // Los logs no contienen la dirección de email.
    expect(JSON.stringify(env.logger.lines)).not.toContain('owner@pfos.test');
    expect(JSON.stringify(env.logger.lines)).not.toContain('@');
  });

  it('[TC-NOTIFICATIONS-EMAIL-006] las esperas entre intentos son 1 min, 5 min, 25 min y 2 h', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.sender.down = true;
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const before = env.clock.now().epochMillis;
      await run(dispatch, deliveryId);
      const row = env.deliveries.rows.get(deliveryId);
      waits.push(Instant.parse(row?.notBefore ?? '').epochMillis - before);
      env.clock.set(Instant.parse(row?.notBefore ?? ''));
    }
    expect(waits).toEqual([60_000, 300_000, 1_500_000, 7_200_000]);
  });

  it('un error reintentable que se recupera deja la entrega SENT en el intento siguiente', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.sender.failures.push(new RetryableEmailError('SMTP_TIMEOUT'));
    expect(await run(dispatch, deliveryId)).toBe('retry');
    env.clock.set(Instant.parse(env.deliveries.rows.get(deliveryId)?.notBefore ?? ''));
    expect(await run(dispatch, deliveryId)).toBe('sent');
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(env.sender.sent).toHaveLength(1);
  });

  it('un rechazo permanente (destinatario inexistente) pasa a FAILED sin reintentar', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.sender.rejectPermanently();
    expect(await run(dispatch, deliveryId)).toBe('failed');
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastErrorCode: 'SMTP_550',
    });
    expect(env.scheduler.jobs.filter((j) => !j.first)).toHaveLength(0);
  });

  it('un fallo inesperado (no del proveedor) también se reintenta con un código genérico, sin filtrar el mensaje', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.sender.failures.push(new Error('boom owner@pfos.test'));
    expect(await run(dispatch, deliveryId)).toBe('retry');
    expect(env.deliveries.rows.get(deliveryId)?.lastErrorCode).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(env.logger.lines)).not.toContain('owner@pfos.test');
  });

  it('un fallo al registrar el envío ya aceptado NO provoca otro envío', async () => {
    const { env, dispatch, deliveryId } = await setup();
    const original = env.deliveries.markSent.bind(env.deliveries);
    let calls = 0;
    env.deliveries.markSent = (input) => {
      calls += 1;
      return calls < 3 ? Promise.reject(new Error('db down')) : original(input);
    };
    expect(await run(dispatch, deliveryId)).toBe('sent');
    expect(calls).toBe(3);
    expect(env.sender.sent).toHaveLength(1);
  });

  it('un lease expirado (el proceso cayó tras enviar) permite reclamar la entrega; antes de expirar, no', async () => {
    const { env, dispatch, deliveryId } = await setup();
    const row = env.deliveries.rows.get(deliveryId);
    if (!row) throw new Error('missing');
    row.status = 'SENDING';
    row.attempts = 1;
    row.leaseUntil = env.clock.now().plusMillis(60_000).toString();
    expect(await run(dispatch, deliveryId)).toBe('noop');
    env.clock.advance(61_000);
    expect(await run(dispatch, deliveryId)).toBe('sent');
    expect(env.deliveries.rows.get(deliveryId)?.attempts).toBe(2);
  });
});

describe('DispatchEmailDelivery: supresión y horario de silencio', () => {
  it('[TC-NOTIFICATIONS-EMAIL-007] con el canal deshabilitado la entrega queda SUPPRESSED/CHANNEL_DISABLED sin error ni reintentos', async () => {
    const { env, dispatch, deliveryId, notification } = await setup();
    env.sender.driver = 'none';
    expect(await run(dispatch, deliveryId)).toBe('suppressed');
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({
      status: 'SUPPRESSED',
      suppressionReason: 'CHANNEL_DISABLED',
    });
    expect(env.sender.sent).toHaveLength(0);
    expect(env.scheduler.jobs.filter((j) => !j.first)).toHaveLength(0);
    expect(env.notifications.rows.get(notification.id)?.status).toBe('UNREAD');
    expect(env.metrics.emailDeliveries).toEqual(['suppressed']);
  });

  it('sin email verificado la entrega queda SUPPRESSED/NO_EMAIL', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.recipients.members = env.recipients.members.map((m) =>
      m.userId === OWNER ? { ...m, email: null } : m,
    );
    expect(await run(dispatch, deliveryId)).toBe('suppressed');
    expect(env.deliveries.rows.get(deliveryId)?.suppressionReason).toBe('NO_EMAIL');
  });

  it('si el destinatario dejó el workspace la entrega queda SUPPRESSED/NOT_MEMBER', async () => {
    const { env, dispatch, deliveryId } = await setup(VIEWER);
    env.recipients.members = env.recipients.members.filter((m) => m.userId !== VIEWER);
    expect(await run(dispatch, deliveryId)).toBe('suppressed');
    expect(env.deliveries.rows.get(deliveryId)?.suppressionReason).toBe('NOT_MEMBER');
  });

  it('si el usuario desactivó el email después de crearse la entrega, no se envía (PREFERENCE_DISABLED)', async () => {
    const { env, dispatch, deliveryId } = await setup(EDITOR);
    const prefs = await env.preferences.load(WS, EDITOR);
    prefs.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(prefs);
    expect(await run(dispatch, deliveryId)).toBe('suppressed');
    expect(env.deliveries.rows.get(deliveryId)?.suppressionReason).toBe('PREFERENCE_DISABLED');
    expect(env.sender.sent).toHaveLength(0);
  });

  it('si la notificación fue purgada la entrega queda SUPPRESSED/NOTIFICATION_GONE', async () => {
    const { env, dispatch, deliveryId, notification } = await setup();
    env.notifications.rows.delete(notification.id);
    expect(await run(dispatch, deliveryId)).toBe('suppressed');
    expect(env.deliveries.rows.get(deliveryId)?.suppressionReason).toBe('NOTIFICATION_GONE');
  });

  it('[TC-NOTIFICATIONS-PREFS-002] el silencio se diferido hasta las 07:00 de La Paz y entonces se envía', async () => {
    const env = new NotificationsTestEnv();
    env.clock.set(Instant.parse('2026-11-13T03:15:00Z')); // 23:15 en La Paz
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: { start: '22:00', end: '07:00' }, includeDetailsInEmail: false });
    await env.preferences.save(owner);
    const e = event(thresholdPayload());
    await new NotifyFromEvent(env.notifyDeps()).handle(e.source, e.definition);
    const notification = [...env.notifications.rows.values()].find((n) => n.userId === OWNER);
    const delivery = env.deliveries.byNotification(notification?.id ?? '');
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());

    // El trabajo corre antes de tiempo (p. ej. el barrido): la entrega no está vencida.
    expect(await run(dispatch, delivery?.id ?? '')).toBe('noop');
    expect(notification?.createdAt).toBe('2026-11-13T03:15:00.000Z');
    expect(delivery).toMatchObject({ status: 'PENDING', notBefore: '2026-11-13T11:00:00.000Z' });

    env.clock.set(Instant.parse('2026-11-13T11:00:00Z')); // 07:00 en La Paz
    expect(await run(dispatch, delivery?.id ?? '')).toBe('sent');
    expect(env.sender.sent.filter((m) => m.to === 'owner@pfos.test')).toHaveLength(1);
  });

  it('el horario de silencio vigente manda: si el usuario lo creó después, el despacho se reprograma sin consumir intento', async () => {
    const { env, dispatch, deliveryId } = await setup();
    env.clock.set(Instant.parse('2026-11-13T03:15:00Z')); // 23:15 en La Paz
    const prefs = await env.preferences.load(WS, OWNER);
    prefs.update({ types: [], quietHours: { start: '22:00', end: '07:00' }, includeDetailsInEmail: false });
    await env.preferences.save(prefs);

    expect(await run(dispatch, deliveryId)).toBe('deferred');
    expect(env.deliveries.rows.get(deliveryId)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      notBefore: '2026-11-13T11:00:00.000Z',
    });
    expect(env.scheduler.jobs.at(-1)?.startAfter?.toISOString()).toBe('2026-11-13T11:00:00.000Z');
    expect(env.sender.sent).toHaveLength(0);
  });
});

describe('DispatchEmailDelivery: barrido', () => {
  it('reencola las entregas vencidas cuyo trabajo se perdió, y solo esas', async () => {
    const { env, dispatch, deliveryId } = await setup();
    const jobsBefore = env.scheduler.jobs.length;
    // Recién creada: aún dentro del margen de gracia ⇒ no se reencola.
    expect(await dispatch.sweep(WS)).toBe(0);
    env.clock.advance(5 * 60_000);
    expect(await dispatch.sweep(WS)).toBe(3);
    expect(env.scheduler.jobs.length).toBe(jobsBefore + 3);
    expect(env.scheduler.jobs.at(-1)?.first).toBe(false);
    // Una entrega ya enviada no se reencola.
    await run(dispatch, deliveryId);
    expect(await dispatch.sweep(WS)).toBe(2);
  });
});
