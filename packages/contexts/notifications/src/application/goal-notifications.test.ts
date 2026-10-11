import { describe, expect, it } from 'vitest';
import {
  contributionRecordedPayload,
  earmarkExceedsPayload,
  EMERGENCY_GOAL_ID,
  GOAL_ACCOUNT_ID,
  goalReachedPayload,
  occurrenceDuePayload,
  WS,
} from '../domain/fixtures.js';
import { definitionOf } from '../domain/index.js';
import { DispatchEmailDelivery } from './dispatch-email-delivery.js';
import { NotifyFromEvent } from './notify-from-event.js';
import { EDITOR, NotificationsTestEnv, OWNER, VIEWER } from './testing/in-memory.js';

const overAllocated = definitionOf('GOAL_OVER_ALLOCATED');
const reached = definitionOf('GOAL_REACHED');
const milestone = definitionOf('GOAL_MILESTONE');
const occurrenceDue = definitionOf('RECURRING_PAYMENT_UPCOMING');

let sequence = 0;
const event = (payload: Record<string, unknown>, aggregateVersion?: number) => ({
  eventId: `01928c4e-7a3b-7c11-8f00-${String(++sequence).padStart(12, '0')}`,
  workspaceId: WS,
  occurredAt: '2026-10-20T13:00:00.000Z',
  aggregateVersion,
  payload,
});

const forUser = (env: NotificationsTestEnv, userId: string) =>
  [...env.notifications.rows.values()].filter((n) => n.userId === userId);

const wholeWord = (word: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u');

describe('NotifyFromEvent: sobre-asignación de metas', () => {
  it('[TC-GOALS-SAVINGS-042] OWNER y EDITOR reciben una; VIEWER no; el mismo episodio con otro eventId no duplica', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    expect(await notify.handle(event(earmarkExceedsPayload()), overAllocated)).toEqual({
      created: 2,
      deliveries: 2,
    });
    expect(await notify.handle(event(earmarkExceedsPayload()), overAllocated)).toEqual({
      created: 0,
      deliveries: 0,
    });
    expect(forUser(env, VIEWER)).toHaveLength(0);
    for (const userId of [OWNER, EDITOR]) {
      const rows = forUser(env, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'GOAL_OVER_ALLOCATED',
        status: 'UNREAD',
        link: { kind: 'GOAL_RESERVATIONS', accountId: GOAL_ACCOUNT_ID },
        params: { shortfall: { amount: '1200.00', currency: 'BOB' }, accountName: 'Banco BOB' },
      });
    }
  });

  it('[TC-GOALS-SAVINGS-042] otro episodio de la misma cuenta es otro aviso', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    await notify.handle(event(earmarkExceedsPayload()), overAllocated);
    const next = await notify.handle(
      event(earmarkExceedsPayload({ episodeId: '01928c4e-0000-7000-8000-0000000e0011' })),
      overAllocated,
    );
    expect(next.created).toBe(2);
  });

  it('[TC-GOALS-SAVINGS-042] un payload malformado falla sin crear nada (el consumidor lo reintenta)', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    await expect(notify.handle(event({ accountId: 'x' }), overAllocated)).rejects.toThrow(/accountId/);
    expect(env.notifications.rows.size).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-042] respeta la preferencia por tipo: sin in-app no hay notificación ni email', async () => {
    const env = new NotificationsTestEnv();
    const owner = await env.preferences.load(WS, OWNER);
    owner.update({
      types: [{ type: 'GOAL_OVER_ALLOCATED', inApp: false, email: true }],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    await env.preferences.save(owner);
    const outcome = await new NotifyFromEvent(env.notifyDeps()).handle(
      event(earmarkExceedsPayload()),
      overAllocated,
    );
    expect(outcome).toEqual({ created: 1, deliveries: 1 });
    expect(forUser(env, OWNER)).toHaveLength(0);
  });
});

describe('NotifyFromEvent: email de metas', () => {
  it('[TC-GOALS-SAVINGS-043] sin opt-in el email no lleva montos, monedas ni nombres; el in-app sí; con opt-in sí', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    await notify.handle(event(earmarkExceedsPayload()), overAllocated);
    const dispatch = new DispatchEmailDelivery(env.dispatchDeps());
    const n = forUser(env, OWNER)[0]!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(n.id)!.id });
    const plain = env.sender.sent.find((m) => m.to === 'owner@pfos.test')!;
    expect(plain.text).toContain('Una de tus cuentas tiene más dinero reservado para metas que su saldo.');
    const content = `${plain.subject}\n${plain.text}\n${plain.html}`.replaceAll(/https?:\/\/\S+/g, '');
    for (const word of ['Banco', 'BOB', 'Laptop', 'Fondo', 'emergencia', '1200', '1\\.200', '5800', '7000']) {
      expect(content, word).not.toMatch(wholeWord(word));
    }
    expect(n.params).toMatchObject({ accountName: 'Banco BOB' });

    const withDetails = await env.preferences.load(WS, OWNER);
    withDetails.update({ types: [], quietHours: null, includeDetailsInEmail: true });
    await env.preferences.save(withDetails);
    await notify.handle(
      event(earmarkExceedsPayload({ episodeId: '01928c4e-0000-7000-8000-0000000e0012' })),
      overAllocated,
    );
    const second = forUser(env, OWNER).find((x) => x.dedupeKey.endsWith('0e0012'))!;
    await dispatch.run({ workspaceId: WS, deliveryId: env.deliveries.byNotification(second.id)!.id });
    const detailed = env.sender.sent.filter((m) => m.to === 'owner@pfos.test').at(-1)!;
    expect(detailed.text).toContain('Banco BOB');
    expect(detailed.text).toContain('1.200,00 BOB');
  });
});

describe('NotifyFromEvent: meta alcanzada', () => {
  it('[TC-GOALS-SAVINGS-044] llega a OWNER, EDITOR y VIEWER; la reentrega no duplica y otro alcance (otra versión) sí', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    expect(await notify.handle(event(goalReachedPayload(), 5), reached)).toEqual({
      created: 3,
      deliveries: 3,
    });
    expect(await notify.handle(event(goalReachedPayload(), 5), reached)).toEqual({
      created: 0,
      deliveries: 0,
    });
    expect((await notify.handle(event(goalReachedPayload(), 9), reached)).created).toBe(3);
    for (const userId of [OWNER, EDITOR, VIEWER]) {
      expect(forUser(env, userId)).toHaveLength(2);
      expect(forUser(env, userId)[0]).toMatchObject({ type: 'GOAL_REACHED', link: { kind: 'GOAL' } });
    }
  });
});

describe('NotifyFromEvent: hitos', () => {
  it('[TC-GOALS-SAVINGS-045] los cuatro casos del TC en orden, para cada miembro', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const laptopId = '01928c4e-0000-7000-8000-0000000c0011';
    const cusco = '01928c4e-0000-7000-8000-0000000c0013';

    // 1) Fondo de emergencia 46.67 -> 53.33: hito 50
    expect((await notify.handle(event(contributionRecordedPayload()), milestone)).created).toBe(3);
    // 2) Laptop 20.00 -> 55.56: una sola notificación del 50 con el 25 en alsoCrossed
    expect(
      (
        await notify.handle(
          event(
            contributionRecordedPayload({
              goalId: laptopId,
              goalName: 'Laptop',
              percentBefore: '20.00',
              percentAfter: '55.56',
            }),
          ),
          milestone,
        )
      ).created,
    ).toBe(3);
    // 3) Fondo de emergencia baja a 48.00 y vuelve a 52.00: el 50 ya se notificó
    expect(
      (
        await notify.handle(
          event(contributionRecordedPayload({ percentBefore: '48.00', percentAfter: '52.00' })),
          milestone,
        )
      ).created,
    ).toBe(0);
    // 4) Progreso incompleto: sin hitos
    expect(
      (
        await notify.handle(
          event(
            contributionRecordedPayload({
              goalId: cusco,
              goalName: 'Viaje a Cusco',
              percentBefore: '20.00',
              percentAfter: '30.00',
              progressComplete: false,
            }),
          ),
          milestone,
        )
      ).created,
    ).toBe(0);

    for (const userId of [OWNER, EDITOR, VIEWER]) {
      const rows = forUser(env, userId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
        [`goal-milestone:${laptopId}:50`, `goal-milestone:${EMERGENCY_GOAL_ID}:50`].sort(),
      );
      const laptop = rows.find((r) => r.dedupeKey.includes(laptopId))!;
      expect(laptop.params).toMatchObject({ milestone: '50', alsoCrossed: ['25'] });
      expect(laptop).toMatchObject({ type: 'GOAL_MILESTONE', severity: 'INFO', link: { kind: 'GOAL' } });
    }
  });

  it('[TC-GOALS-SAVINGS-045] el hito es por meta y destinatario para siempre, aunque otro evento lo vuelva a cruzar', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    await notify.handle(event(contributionRecordedPayload()), milestone);
    // bajó y vuelve a cruzar el 50 mucho después: sigue sin avisar
    const again = await notify.handle(
      event(contributionRecordedPayload({ percentBefore: '10.00', percentAfter: '90.00' })),
      milestone,
    );
    // cruza 25 y 75 (nuevos) y 50 (ya avisado): se notifica el mayor (75), el 50 no se repite
    expect(again.created).toBe(3);
    expect(forUser(env, OWNER).map((r) => r.dedupeKey)).toEqual(
      expect.arrayContaining([
        `goal-milestone:${EMERGENCY_GOAL_ID}:50`,
        `goal-milestone:${EMERGENCY_GOAL_ID}:75`,
      ]),
    );
  });
});

describe('Tolerancia de managedBy = GOAL (N6)', () => {
  const goalOccurrence = (o: Record<string, unknown> = {}) =>
    occurrenceDuePayload({ managedBy: 'GOAL', kind: 'EXPENSE', ...o });

  it('[TC-GOALS-SAVINGS-045] RecurringOccurrenceDue con managedBy GOAL no falla y conserva el aviso genérico, una vez', async () => {
    const env = new NotificationsTestEnv();
    const notify = new NotifyFromEvent(env.notifyDeps());
    const first = await notify.handle(
      event(goalOccurrence({ requiresApproval: false, mode: 'NOTIFY_ONLY' })),
      occurrenceDue,
    );
    expect(first).toEqual({ created: 2, deliveries: 2 });
    expect(forUser(env, OWNER)[0]).toMatchObject({ type: 'RECURRING_PAYMENT_UPCOMING' });
    // reentrega con otro eventId: no duplica
    const again = await notify.handle(
      event(goalOccurrence({ requiresApproval: false, mode: 'NOTIFY_ONLY' })),
      occurrenceDue,
    );
    expect(again.created).toBe(0);
    expect(forUser(env, OWNER)).toHaveLength(1);
    expect(occurrenceDue.suppressed?.(goalOccurrence({ requiresApproval: false }))).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-045] por aprobar con managedBy GOAL notifica a OWNER y EDITOR', async () => {
    const env = new NotificationsTestEnv();
    const outcome = await new NotifyFromEvent(env.notifyDeps()).handle(
      event(goalOccurrence()),
      occurrenceDue,
    );
    expect(outcome.created).toBe(2);
    expect(forUser(env, OWNER)[0]).toMatchObject({ type: 'RECURRING_APPROVAL_REQUIRED' });
    expect(forUser(env, VIEWER)).toHaveLength(0);
  });
});
