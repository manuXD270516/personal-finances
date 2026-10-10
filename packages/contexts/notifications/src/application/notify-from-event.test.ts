import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { definitionOf } from '../domain/index.js';
import { closePendingPayload, occurrenceDuePayload, thresholdPayload, WS } from '../domain/fixtures.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const threshold = definitionOf('BUDGET_THRESHOLD');
const closePending = definitionOf('MONTH_CLOSE_PENDING');
const occurrenceDue = definitionOf('RECURRING_PAYMENT_UPCOMING');

const event = (payload: Record<string, unknown>, eventId = '01928c4e-7a3b-7c11-8f00-000000000301') => ({
  eventId,
  workspaceId: WS,
  occurredAt: '2026-11-12T15:20:00.000Z',
  payload,
});

const setup = () => {
  const env = new NotificationsTestEnv();
  return { env, notify: new NotifyFromEvent(env.notifyDeps()) };
};

const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

describe('NotifyFromEvent: umbral de presupuesto', () => {
  it('un workspace sin miembros activos (inexistente o retirado) es un no-op: ni notificaciones ni entregas ni jobs', async () => {
    const { env, notify } = setup();
    env.recipients.members = [];
    const outcome = await notify.handle(event(thresholdPayload()), threshold);
    expect(outcome).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
    expect(env.scheduler.jobs).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-INAPP-001] cada miembro activo recibe una notificación UNREAD con el contenido del hecho', async () => {
    const { env, notify } = setup();
    const outcome = await notify.handle(event(thresholdPayload()), threshold);
    expect(outcome).toEqual({ created: 3, deliveries: 3 });
    for (const userId of [OWNER, EDITOR, VIEWER]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'BUDGET_THRESHOLD',
        status: 'UNREAD',
        severity: 'INFO',
        sourceEventId: '01928c4e-7a3b-7c11-8f00-000000000301',
      });
      expect(n?.params).toMatchObject({
        periodLabel: '2026-11',
        threshold: '90',
        alsoCrossed: ['50', '75'],
        reference: { amount: '600.00', currency: 'BOB' },
        actual: { amount: '550.00', currency: 'BOB' },
      });
    }
    expect(env.metrics.created_).toEqual(['BUDGET_THRESHOLD', 'BUDGET_THRESHOLD', 'BUDGET_THRESHOLD']);
  });

  it('[TC-NOTIFICATIONS-INAPP-002] un miembro que desactivó el tipo in-app no recibe notificación ni entrega por email', async () => {
    const { env, notify } = setup();
    const viewer = await env.preferences.load(WS, VIEWER);
    viewer.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: false, email: true }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(viewer);

    await notify.handle(event(thresholdPayload()), threshold);

    expect(forUser(env, VIEWER)).toHaveLength(0);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(env.deliveries.rows.size).toBe(2);
    expect(env.scheduler.jobs.every((j) => j.deliveryId !== undefined)).toBe(true);
  });

  it('[TC-NOTIFICATIONS-DEDUP-001] el mismo evento entregado dos veces no duplica notificaciones ni entregas', async () => {
    const { env, notify } = setup();
    await notify.handle(event(thresholdPayload()), threshold);
    const second = await notify.handle(event(thresholdPayload()), threshold);
    expect(second).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(3);
    expect(env.deliveries.rows.size).toBe(3);
    expect(env.scheduler.jobs).toHaveLength(3);
  });

  it('[TC-NOTIFICATIONS-DEDUP-001] dos instancias a la vez crean una sola notificación por destinatario', async () => {
    const { env, notify } = setup();
    await Promise.all([
      notify.handle(event(thresholdPayload()), threshold),
      notify.handle(event(thresholdPayload()), threshold),
    ]);
    expect(env.notifications.rows.size).toBe(3);
    expect(env.deliveries.rows.size).toBe(3);
  });

  it('[TC-NOTIFICATIONS-DEDUP-002] otro eventId con el mismo objetivo, periodo y umbral no crea otra notificación', async () => {
    const { env, notify } = setup();
    await notify.handle(event(thresholdPayload()), threshold);
    const outcome = await notify.handle(
      event(
        thresholdPayload({ crossedAt: '2026-11-13T09:00:00.000Z' }),
        '01928c4e-7a3b-7c11-8f00-000000000999',
      ),
      threshold,
    );
    expect(outcome.created).toBe(0);
    expect(env.notifications.rows.size).toBe(3);
    expect(env.deliveries.rows.size).toBe(3);
    // Un umbral distinto del mismo objetivo sí es otro hecho.
    const other = await notify.handle(
      event(
        thresholdPayload({ threshold: '100', alsoCrossed: ['90'] }),
        '01928c4e-7a3b-7c11-8f00-000000000998',
      ),
      threshold,
    );
    expect(other.created).toBe(3);
    expect([...env.notifications.rows.values()].some((n) => n.severity === 'WARNING')).toBe(true);
  });

  it('[TC-NOTIFICATIONS-PREFS-001] con el email desactivado para el tipo hay notificación in-app y ninguna entrega', async () => {
    const { env, notify } = setup();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(owner);

    await notify.handle(event(thresholdPayload({ threshold: '100', alsoCrossed: [] })), threshold);

    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(
      [...env.deliveries.rows.values()].filter((d) =>
        forUser(env, OWNER).some((n) => n.id === d.notificationId),
      ),
    ).toHaveLength(0);
    expect(env.deliveries.rows.size).toBe(2);
  });

  it('[TC-NOTIFICATIONS-PREFS-002] horario de silencio: el in-app existe ya y el email queda diferido al fin del silencio', async () => {
    const { env, notify } = setup();
    // 2026-11-12 23:15 en La Paz = 2026-11-13T03:15Z.
    env.clock.set(Instant.parse('2026-11-13T03:15:00Z'));
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({ types: [], quietHours: { start: '22:00', end: '07:00' }, includeDetailsInEmail: false });
    await env.preferences.save(owner);

    await notify.handle(event(thresholdPayload()), threshold);

    const [notification] = forUser(env, OWNER);
    expect(notification?.createdAt).toBe('2026-11-13T03:15:00.000Z');
    const delivery = env.deliveries.byNotification(notification?.id ?? '');
    expect(delivery).toMatchObject({ status: 'PENDING', notBefore: '2026-11-13T11:00:00.000Z' });
    const job = env.scheduler.jobs.find((j) => j.deliveryId === delivery?.id);
    expect(job?.startAfter?.toISOString()).toBe('2026-11-13T11:00:00.000Z');
    // Los demás miembros, sin silencio, no esperan.
    const editorDelivery = env.deliveries.byNotification(forUser(env, EDITOR)[0]?.id ?? '');
    expect(editorDelivery?.notBefore).toBe('2026-11-13T03:15:00.000Z');
    expect(env.scheduler.jobs.find((j) => j.deliveryId === editorDelivery?.id)?.startAfter).toBeNull();
  });

  it('registra el retraso evento → notificación (NFR-PERF-008)', async () => {
    const { env, notify } = setup();
    env.clock.set(Instant.parse('2026-11-12T15:20:03.500Z'));
    await notify.handle(event(thresholdPayload()), threshold);
    expect(env.metrics.lags).toEqual([{ type: 'BUDGET_THRESHOLD', seconds: 3.5 }]);
  });

  it('un payload mal formado falla sin crear nada (el consumidor reintenta y termina en dead-letter)', async () => {
    const { env, notify } = setup();
    await expect(notify.handle(event(thresholdPayload({ periodId: 'x' })), threshold)).rejects.toThrow(
      /periodId/,
    );
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
  });

  it('un miembro que ya no es activo no recibe notificaciones', async () => {
    const { env, notify } = setup();
    env.recipients.members = env.recipients.members.filter((m) => m.userId !== EDITOR);
    await notify.handle(event(thresholdPayload()), threshold);
    expect(forUser(env, EDITOR)).toHaveLength(0);
    expect(env.notifications.rows.size).toBe(2);
  });
});

describe('NotifyFromEvent: cierre de mes pendiente', () => {
  it('[TC-NOTIFICATIONS-INAPP-007] solo OWNER y EDITOR reciben una notificación con enlace al cierre; la segunda entrega no duplica', async () => {
    const { env, notify } = setup();
    const e = event(closePendingPayload(), '01928c4e-7a3b-7c11-8f00-000000000303');
    const first = await notify.handle(e, closePending);
    const second = await notify.handle(e, closePending);
    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(forUser(env, VIEWER)).toHaveLength(0);
    for (const userId of [OWNER, EDITOR]) {
      const [n] = forUser(env, userId);
      expect(n).toMatchObject({ type: 'MONTH_CLOSE_PENDING', severity: 'WARNING', status: 'UNREAD' });
      expect(n?.link).toMatchObject({ kind: 'PERIOD_CLOSE', periodLabel: '2026-10' });
      expect(n?.dedupeKey).toMatch(/^month-close-pending:/);
    }
    expect(env.notifications.rows.size).toBe(2);
  });

  it('una preferencia del tipo de umbrales no afecta al cierre pendiente', async () => {
    const { env, notify } = setup();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'BUDGET_THRESHOLD', inApp: false, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(owner);
    await notify.handle(event(closePendingPayload()), closePending);
    expect(forUser(env, OWNER)).toHaveLength(1);
  });
});

describe('NotifyFromEvent: ocurrencia recurrente próxima', () => {
  it('[TC-COMMITMENTS-RECUR-043] OWNER y EDITOR reciben "por aprobar" enlazada a la ocurrencia; el VIEWER no', async () => {
    const { env, notify } = setup();
    const outcome = await notify.handle(event(occurrenceDuePayload()), occurrenceDue);
    expect(outcome).toEqual({ created: 2, deliveries: 2 });
    expect(forUser(env, VIEWER)).toHaveLength(0);
    for (const userId of [OWNER, EDITOR]) {
      const [n, ...rest] = forUser(env, userId);
      expect(rest).toHaveLength(0);
      expect(n).toMatchObject({
        type: 'RECURRING_APPROVAL_REQUIRED',
        status: 'UNREAD',
        dedupeKey: 'occurrence-due:01928c4e-0000-7000-8000-0000000cc001',
        link: {
          kind: 'RECURRING_OCCURRENCE',
          occurrenceId: '01928c4e-0000-7000-8000-0000000cc001',
          periodId: '01928c4e-0000-7000-8000-0000000fa011',
          periodLabel: '2026-11',
        },
      });
      expect(n?.params).toMatchObject({ name: 'Alquiler', dueDate: '2026-11-05' });
    }
  });

  it('[TC-COMMITMENTS-RECUR-044] el hecho entregado dos veces con eventId distinto deja una notificación y una entrega por destinatario', async () => {
    const { env, notify } = setup();
    await notify.handle(event(occurrenceDuePayload()), occurrenceDue);
    const second = await notify.handle(
      event(occurrenceDuePayload(), '01928c4e-7a3b-7c11-8f00-000000000777'),
      occurrenceDue,
    );
    expect(second).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(2);
    expect(env.deliveries.rows.size).toBe(2);
    expect(env.scheduler.jobs).toHaveLength(2);
  });

  it('sin aprobación crea RECURRING_PAYMENT_UPCOMING', async () => {
    const { env, notify } = setup();
    await notify.handle(
      event(occurrenceDuePayload({ requiresApproval: false, mode: 'AUTO_CREATE' })),
      occurrenceDue,
    );
    expect(forUser(env, OWNER)[0]?.type).toBe('RECURRING_PAYMENT_UPCOMING');
  });

  it('D119: gestionada por una suscripción y sin aprobación no genera aviso genérico', async () => {
    const { env, notify } = setup();
    const outcome = await notify.handle(
      event(
        occurrenceDuePayload({ managedBy: 'SUBSCRIPTION', requiresApproval: false, mode: 'AUTO_CREATE' }),
      ),
      occurrenceDue,
    );
    expect(outcome).toEqual({ created: 0, deliveries: 0 });
    expect(env.notifications.rows.size).toBe(0);
    expect(env.deliveries.rows.size).toBe(0);
    // Con aprobación requerida sí se avisa aunque la gestione una suscripción.
    const approval = await notify.handle(
      event(occurrenceDuePayload({ managedBy: 'SUBSCRIPTION' }), '01928c4e-7a3b-7c11-8f00-000000000778'),
      occurrenceDue,
    );
    expect(approval.created).toBe(2);
  });

  it('respeta las preferencias por tipo: con el tipo desactivado in-app no hay notificación', async () => {
    const { env, notify } = setup();
    const editor = await env.preferences.load(WS, EDITOR);
    editor.update({
      types: [{ type: 'RECURRING_APPROVAL_REQUIRED', inApp: false, email: true }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(editor);
    await notify.handle(event(occurrenceDuePayload()), occurrenceDue);
    expect(forUser(env, EDITOR)).toHaveLength(0);
    expect(forUser(env, OWNER)).toHaveLength(1);
  });
});
