import { Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { definitionOf } from '../domain/index.js';
import { thresholdPayload, WS } from '../domain/fixtures.js';
import { InboxActions } from './inbox.actions.js';
import { InboxQueries } from './inbox.queries.js';
import { NotifyFromEvent } from './notify-from-event.js';
import {
  RESTAURANTS_ID,
  NotificationsTestEnv,
  OWNER,
  VIEWER,
  treeWithRestaurants,
} from './testing/in-memory.js';

const threshold = definitionOf('BUDGET_THRESHOLD');

/** Tres notificaciones del OWNER (umbrales 50, 75 y 90 %) en minutos consecutivos. */
async function inboxWithThree() {
  const env = new NotificationsTestEnv();
  const notify = new NotifyFromEvent(env.notifyDeps());
  for (const [index, t] of ['50', '75', '90'].entries()) {
    env.clock.set(Instant.parse(`2026-11-12T15:2${index}:00Z`));
    await notify.handle(
      {
        eventId: `01928c4e-7a3b-7c11-8f00-00000000030${index}`,
        workspaceId: WS,
        occurredAt: '2026-11-12T15:20:00.000Z',
        payload: thresholdPayload({ threshold: t, alsoCrossed: [] }),
      },
      threshold,
    );
  }
  const own = (userId: string) =>
    [...env.notifications.rows.values()]
      .filter((n) => n.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    env,
    queries: new InboxQueries(env.inboxDeps()),
    actions: new InboxActions(env.inboxDeps()),
    owner: own(OWNER),
    viewer: own(VIEWER),
  };
}

describe('Centro de notificaciones', () => {
  it('[TC-NOTIFICATIONS-INAPP-003] leer y archivar actualizan la lista y el contador; archivadas solo al filtrar', async () => {
    const { queries, actions, owner } = await inboxWithThree();
    const [a, b, c] = owner;
    await actions.markRead({ workspaceId: WS, userId: OWNER, notificationId: a?.id ?? '' });
    await actions.archive({ workspaceId: WS, userId: OWNER, notificationId: b?.id ?? '' });

    expect(await queries.getUnreadCount(WS, OWNER)).toBe(1);
    const list = await queries.list({ workspaceId: WS, userId: OWNER, limit: 10 });
    expect(list.map((n) => n.id)).toEqual([c?.id, a?.id]); // de la más reciente a la más antigua
    expect(list.map((n) => n.status)).toEqual(['UNREAD', 'READ']);
    const archived = await queries.list({ workspaceId: WS, userId: OWNER, status: 'ARCHIVED', limit: 10 });
    expect(archived.map((n) => n.id)).toEqual([b?.id]);
    // Repetir "leer" responde igual (idempotente) y conserva la primera lectura.
    const first = await actions.markRead({ workspaceId: WS, userId: OWNER, notificationId: a?.id ?? '' });
    const again = await actions.markRead({ workspaceId: WS, userId: OWNER, notificationId: a?.id ?? '' });
    expect(again).toEqual(first);
    expect(await queries.getUnreadCount(WS, OWNER)).toBe(1);
  });

  it('[TC-NOTIFICATIONS-INAPP-004] marcar todas como leídas deja el contador en cero e informa cuántas cambió', async () => {
    const { queries, actions } = await inboxWithThree();
    expect(await actions.markAllRead({ workspaceId: WS, userId: OWNER })).toBe(3);
    expect(await queries.getUnreadCount(WS, OWNER)).toBe(0);
    expect(await actions.markAllRead({ workspaceId: WS, userId: OWNER })).toBe(0);
  });

  it('[TC-NOTIFICATIONS-INAPP-004] "marcar todas" no toca las de otros usuarios', async () => {
    const { queries, actions } = await inboxWithThree();
    await actions.markAllRead({ workspaceId: WS, userId: OWNER });
    expect(await queries.getUnreadCount(WS, VIEWER)).toBe(3);
  });

  it('[TC-NOTIFICATIONS-INAPP-006] la notificación de otro usuario responde RESOURCE_NOT_FOUND y sigue sin leer', async () => {
    const { env, queries, actions, owner } = await inboxWithThree();
    const target = owner[0]?.id ?? '';
    await expect(
      actions.markRead({ workspaceId: WS, userId: VIEWER, notificationId: target }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      actions.archive({ workspaceId: WS, userId: VIEWER, notificationId: target }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await queries.get(WS, VIEWER, target)).toBeNull();
    expect(env.notifications.rows.get(target)?.status).toBe('UNREAD');
    await expect(
      actions.markRead({
        workspaceId: WS,
        userId: OWNER,
        notificationId: '01928c4e-0000-7000-8000-ffffffffffff',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('pagina con posición: limit + 1 permite saber si hay más y `after` continúa donde terminó', async () => {
    const { queries, owner } = await inboxWithThree();
    const page1 = await queries.list({ workspaceId: WS, userId: OWNER, limit: 3 });
    expect(page1).toHaveLength(3);
    const second = page1[1];
    const rest = await queries.list({
      workspaceId: WS,
      userId: OWNER,
      after: { createdAt: second?.createdAt ?? '', id: second?.id ?? '' },
      limit: 3,
    });
    expect(rest.map((n) => n.id)).toEqual([owner[0]?.id]);
  });

  it('el filtro de estado solo admite UNREAD, READ o ARCHIVED', async () => {
    const { queries } = await inboxWithThree();
    await expect(
      queries.list({ workspaceId: WS, userId: OWNER, status: 'DISMISSED', limit: 10 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('Presentación en el idioma del usuario', () => {
  it('[TC-NOTIFICATIONS-I18N-002] fr-FR cae a español y cambiar el locale a en-US traduce la misma notificación', async () => {
    const { env, queries } = await inboxWithThree();
    const viewerList = await queries.list({ workspaceId: WS, userId: VIEWER, limit: 10 });
    expect(viewerList[0]?.title).toBe('Alerta de presupuesto: Restaurantes alcanzó el 90 %');
    env.locales.set(VIEWER, 'en-US');
    const english = await queries.list({ workspaceId: WS, userId: VIEWER, limit: 10 });
    expect(english[0]?.id).toBe(viewerList[0]?.id);
    expect(english[0]?.title).toBe('Budget alert: Restaurantes reached 90 %');
    expect(english[0]?.body).toContain('550.00 of 600.00 BOB');
  });

  it('[TC-NOTIFICATIONS-I18N-001] el in-app del OWNER (es-BO) usa formato es-BO y el del EDITOR (pt-BR) portugués', async () => {
    const { env, queries } = await inboxWithThree();
    const owner = await queries.list({ workspaceId: WS, userId: OWNER, limit: 1 });
    expect(owner[0]?.body).toContain('550,00 de 600,00 BOB');
    env.locales.set(OWNER, 'pt-BR');
    const pt = await queries.list({ workspaceId: WS, userId: OWNER, limit: 1 });
    expect(pt[0]?.title).toBe('Alerta de orçamento: Restaurantes atingiu 90 %');
  });

  it('renombrar la categoría cambia el texto mostrado; si ya no existe se muestra un texto genérico', async () => {
    const { env, queries } = await inboxWithThree();
    env.tree = treeWithRestaurants('Comidas fuera');
    expect((await queries.list({ workspaceId: WS, userId: OWNER, limit: 1 }))[0]?.title).toContain(
      'Comidas fuera',
    );
    env.tree = { groups: [], categories: [], tags: [] };
    const gone = await queries.list({ workspaceId: WS, userId: OWNER, limit: 1 });
    expect(gone[0]?.title).toContain('una línea del presupuesto');
    expect(gone[0]?.params['targetId']).toBe(RESTAURANTS_ID);
  });

  it('expone el estado agregado del email y NO la dirección ni datos internos de la entrega', async () => {
    const { env, queries, owner } = await inboxWithThree();
    const delivery = env.deliveries.byNotification(owner[2]?.id ?? '');
    if (delivery) delivery.status = 'RETRY';
    const list = await queries.list({ workspaceId: WS, userId: OWNER, limit: 10 });
    expect(list[0]?.emailStatus).toBe('PENDING');
    const json = JSON.stringify(list);
    expect(json).not.toContain('@');
    expect(json).not.toContain('lease');
  });
});
