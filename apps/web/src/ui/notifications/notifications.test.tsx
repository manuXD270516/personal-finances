import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceApiError } from '../../bff/finance-api-client';
import { esContext, textOf } from '../test-support';
import { CAT, line, plan, uuid } from '../planning/budget-fixtures';
import { lineHighlight, requestedPeriodId } from '../planning/budget-logic';
import { BudgetLinesTable, LineMissingNotice, type TargetNames } from '../planning/BudgetLinesTable';
import { activeNav, isNotificationsRoute } from '../shell/nav';
import {
  appendPage,
  applyReadAll,
  applyUpdated,
  canMarkAllRead,
  createUnreadPoller,
  detailPath,
  draftFromPreferences,
  formatInstant,
  formatLocaleFor,
  hasQuietHoursServerError,
  inboxQuery,
  NOTIFICATIONS_CHANGED,
  preferencesChanged,
  preferencesInput,
  quietHoursError,
  resourcePath,
  setChannel,
  unreadBadge,
  type AppNotification,
  type NotificationPreferences,
} from './logic';
import { NotificationBellView } from './NotificationBell';
import { NotificationDetailView } from './NotificationDetail';
import { InboxView } from './NotificationInbox';
import { NotificationPreferencesView } from './NotificationPreferencesPanel';
import {
  createReadOnce,
  fetchUnreadCount,
  loadPreferences,
  markAllNotificationsRead,
  savePreferences,
  transitionNotification,
} from './service';

const f = esContext('Notifications');
const href = (path: string) => `/es${path}`;

const PERIOD_ID = uuid(900);
const LINE_ID = uuid(901);
const NOTE_A = uuid(1001);
const NOTE_B = uuid(1002);
const NOTE_C = uuid(1003);

function note(over: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    type: 'BUDGET_THRESHOLD',
    severity: 'INFO',
    title: 'Presupuesto Restaurantes al 90 %',
    body: 'Llevas el 90 % de lo planificado en este periodo.',
    messageKey: 'notifications.budget_threshold.v1',
    params: {},
    link: {
      kind: 'BUDGET_LINE',
      periodId: PERIOD_ID,
      periodLabel: '2026-11',
      budgetId: uuid(902),
      budgetLineId: LINE_ID,
    },
    status: 'UNREAD',
    createdAt: '2026-11-12T23:15:00Z',
    readAt: null,
    ...over,
  };
}

const A = note({ id: NOTE_A, status: 'READ', readAt: '2026-11-12T23:20:00Z' });
const B = note({ id: NOTE_B, status: 'ARCHIVED', severity: 'WARNING', emailStatus: 'SENT' });
const C = note({ id: NOTE_C, status: 'UNREAD', severity: 'CRITICAL', emailStatus: 'FAILED' });

function renderInbox(over: Partial<Parameters<typeof InboxView>[0]> = {}): string {
  return renderToStaticMarkup(
    <InboxView
      f={f}
      uiLocale="es"
      filter="RECENT"
      onFilter={() => undefined}
      items={[C, A]}
      hasMore={false}
      loadingMore={false}
      busy={false}
      href={href}
      {...over}
    />,
  );
}

/** Etiqueta de apertura de un elemento con ese `data-testid`. */
const tagOf = (html: string, testId: string): string =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';
const count = (html: string, testId: string): number => html.split(`data-testid="${testId}"`).length - 1;

describe('Notificaciones: lógica pura', () => {
  it('[TC-NOTIFICATIONS-INAPP-003] el contador visual se topa en 99+', () => {
    expect(unreadBadge(1)).toBe('1');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(100)).toBe('99+');
    expect(unreadBadge(2500)).toBe('99+');
  });

  it('formatea fecha y hora en la zona del usuario (America/La_Paz = UTC-4) y el locale de la UI', () => {
    const iso = '2026-11-13T02:15:00Z';
    expect(formatInstant(iso, 'es-BO', 'America/La_Paz')).toMatch(/12/);
    expect(formatInstant(iso, 'es-BO', 'America/La_Paz')).toMatch(/10:15/);
    expect(formatInstant(iso, 'es-BO', 'UTC')).toMatch(/13/);
    expect(formatInstant('no-es-fecha', 'es-BO', 'UTC')).toBe('no-es-fecha');
    expect(formatLocaleFor('es')).toBe('es-BO');
    expect(formatLocaleFor('en')).toBe('en-US');
    expect(formatLocaleFor('pt')).toBe('pt-BR');
  });

  it('[TC-NOTIFICATIONS-INAPP-005] traduce el enlace al recurso: línea del plan con resaltado o cierre del periodo', () => {
    expect(resourcePath(A.link)).toBe(`/planificacion/presupuestos?periodo=2026-11&linea=${LINE_ID}`);
    expect(resourcePath({ kind: 'PERIOD_CLOSE', periodId: PERIOD_ID, periodLabel: '2026-10' })).toBe(
      `/planificacion/periodos/${PERIOD_ID}/cierre`,
    );
    expect(resourcePath({ kind: 'BUDGET_LINE', periodId: PERIOD_ID, periodLabel: '2026-11' })).toBe(
      '/planificacion/presupuestos?periodo=2026-11',
    );
    expect(
      resourcePath({ kind: 'FUTURE_KIND', periodId: PERIOD_ID, periodLabel: '2026-11' }),
    ).toBeUndefined();
  });

  it('[TC-COMMITMENTS-RECUR-043] el enlace RECURRING_OCCURRENCE abre el detalle de la ocurrencia', () => {
    const occurrenceId = '0198f0aa-0000-7000-8000-00000000c0de';
    expect(
      resourcePath({
        kind: 'RECURRING_OCCURRENCE',
        periodId: PERIOD_ID,
        periodLabel: '2026-10',
        occurrenceId,
      }),
    ).toBe(`/recurring/occurrences/${occurrenceId}`);
    // Sin occurrenceId no hay destino (el enum de enlaces es abierto).
    expect(
      resourcePath({ kind: 'RECURRING_OCCURRENCE', periodId: PERIOD_ID, periodLabel: '2026-10' }),
    ).toBeUndefined();
  });

  it('[TC-NOTIFICATIONS-EMAIL-003] la ruta del detalle lleva solo el id opaco (sin query, montos ni nombres)', () => {
    expect(detailPath(NOTE_A)).toBe(`/notificaciones/${NOTE_A}`);
    expect(detailPath(NOTE_A)).not.toMatch(/[?=&]/);
    expect(isNotificationsRoute('/notificaciones')).toBe(true);
    expect(isNotificationsRoute(`/en/notificaciones/${NOTE_A}`)).toBe(true);
    expect(isNotificationsRoute('/notificacionesx')).toBe(false);
    // No es una sección de la sidebar.
    expect(activeNav('/notificaciones')).toBeUndefined();
    expect(activeNav(`/notificaciones/${NOTE_A}`)).toBeUndefined();
  });

  it('consulta la bandeja: Recientes sin status; Sin leer y Archivadas con status; cursor opcional', () => {
    expect(inboxQuery('RECENT')).toBe('limit=20');
    expect(inboxQuery('UNREAD')).toBe('limit=20&status=UNREAD');
    expect(inboxQuery('ARCHIVED', 'abc')).toBe('limit=20&status=ARCHIVED&cursor=abc');
  });

  it('[TC-NOTIFICATIONS-INAPP-003] leer y archivar actualizan la lista según el filtro', () => {
    const read = { ...C, status: 'READ' as const, readAt: '2026-11-13T00:00:00Z' };
    const recent = applyUpdated([C, A], 'RECENT', read);
    expect(recent.map((n) => [n.id, n.status])).toEqual([
      [NOTE_C, 'READ'],
      [NOTE_A, 'READ'],
    ]);
    // En "Sin leer", al leerla sale de la lista.
    expect(applyUpdated([C], 'UNREAD', read)).toEqual([]);
    // Archivada sale de "Recientes" y de "Sin leer", y permanece en "Archivadas".
    const archived = { ...A, status: 'ARCHIVED' as const };
    expect(applyUpdated([C, A], 'RECENT', archived).map((n) => n.id)).toEqual([NOTE_C]);
    expect(applyUpdated([B], 'ARCHIVED', archived)).toEqual([B]);
    // Actualizar algo ausente no altera la lista.
    expect(applyUpdated([C], 'RECENT', archived)).toEqual([C]);
  });

  it('[TC-NOTIFICATIONS-INAPP-004] marcar todas como leídas deja la lista sin no leídas', () => {
    const all = applyReadAll([C, A], 'RECENT', '2026-11-13T00:00:00Z');
    expect(all.every((n) => n.status === 'READ')).toBe(true);
    expect(all.find((n) => n.id === NOTE_C)?.readAt).toBe('2026-11-13T00:00:00Z');
    expect(applyReadAll([C], 'UNREAD', 'x')).toEqual([]);
  });

  it('paginación: añade sin duplicar y decide cuándo habilitar "Marcar todas"', () => {
    expect(appendPage([C, A], [A, B]).map((n) => n.id)).toEqual([NOTE_C, NOTE_A, NOTE_B]);
    expect(canMarkAllRead('RECENT', [C, A], false)).toBe(true);
    expect(canMarkAllRead('RECENT', [A], false)).toBe(false);
    expect(canMarkAllRead('RECENT', [A], true)).toBe(true);
    expect(canMarkAllRead('ARCHIVED', [C], true)).toBe(false);
  });

  it('[TC-NOTIFICATIONS-PREFS-003] los valores por defecto parten con ambos canales y sin detalles ni horario', () => {
    const draft = draftFromPreferences(DEFAULT_PREFS);
    expect(draft.types.every((t) => t.inApp && t.email)).toBe(true);
    expect(draft.includeDetailsInEmail).toBe(false);
    expect(draft.quietEnabled).toBe(false);
    expect(preferencesInput(draft)).toEqual({
      types: DEFAULT_PREFS.types,
      quietHours: null,
      includeDetailsInEmail: false,
    });
    expect(preferencesChanged(DEFAULT_PREFS, draft)).toBe(false);
  });

  it('[TC-NOTIFICATIONS-PREFS-001] desactivar el email de umbrales solo cambia ese canal', () => {
    const draft = setChannel(draftFromPreferences(DEFAULT_PREFS), 'BUDGET_THRESHOLD', 'email', false);
    expect(draft.types).toEqual([
      { type: 'BUDGET_THRESHOLD', inApp: true, email: false },
      { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
      { type: 'RECURRING_PAYMENT_UPCOMING', inApp: true, email: true },
      { type: 'RECURRING_APPROVAL_REQUIRED', inApp: true, email: true },
    ]);
    expect(preferencesChanged(DEFAULT_PREFS, draft)).toBe(true);
  });

  it('valida el horario de silencio: HH:mm de 24 h e inicio distinto del fin (cruzar medianoche es válido)', () => {
    const base = draftFromPreferences(DEFAULT_PREFS);
    const on = { ...base, quietEnabled: true };
    expect(quietHoursError(base)).toBeUndefined();
    expect(quietHoursError({ ...on, start: '22:00', end: '07:00' })).toBeUndefined();
    expect(quietHoursError({ ...on, start: '', end: '07:00' })).toBe('format');
    expect(quietHoursError({ ...on, start: '24:00', end: '07:00' })).toBe('format');
    expect(quietHoursError({ ...on, start: '7:00', end: '08:00' })).toBe('format');
    expect(quietHoursError({ ...on, start: '07:00', end: '07:00' })).toBe('same');
    // Desactivado, las horas sobrantes no se validan ni se envían.
    expect(quietHoursError({ ...base, start: '07:00', end: '07:00' })).toBeUndefined();
    expect(preferencesInput({ ...on, start: '22:00', end: '07:00' }).quietHours).toEqual({
      start: '22:00',
      end: '07:00',
    });
  });

  it('reconoce el 400 de la API que señala el horario de silencio', () => {
    expect(
      hasQuietHoursServerError({
        code: 'VALIDATION_FAILED',
        errors: [{ pointer: '/quietHours', code: 'X' }],
      }),
    ).toBe(true);
    expect(hasQuietHoursServerError({ errors: [{ pointer: '/types/0', code: 'X' }] })).toBe(false);
    expect(hasQuietHoursServerError({})).toBe(false);
  });
});

const DEFAULT_PREFS: NotificationPreferences = {
  types: [
    { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
    { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
    { type: 'RECURRING_PAYMENT_UPCOMING', inApp: true, email: true },
    { type: 'RECURRING_APPROVAL_REQUIRED', inApp: true, email: true },
  ],
  quietHours: null,
  includeDetailsInEmail: false,
  version: 1,
};

describe('Campana: sondeo del contador', () => {
  afterEach(() => vi.useRealTimers());

  function setup(fetchCount: () => Promise<number | undefined>) {
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const win = new EventTarget();
    const counts: number[] = [];
    const poller = createUnreadPoller({ fetchCount, onCount: (n) => counts.push(n), doc, win });
    return { doc, win, counts, poller };
  }

  it('[TC-NOTIFICATIONS-INAPP-003] consulta al montar, cada 60 s y al recuperar foco o visibilidad', async () => {
    vi.useFakeTimers();
    const fetchCount = vi.fn(async () => 3);
    const { doc, win, counts, poller } = setup(fetchCount);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(1);
    expect(counts).toEqual([3]);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchCount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchCount).toHaveBeenCalledTimes(2);

    win.dispatchEvent(new Event('focus'));
    expect(fetchCount).toHaveBeenCalledTimes(3);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fetchCount).toHaveBeenCalledTimes(4);
    // La propia UI avisa de un cambio (marcar leída, archivar).
    win.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    expect(fetchCount).toHaveBeenCalledTimes(5);
    poller.stop();
  });

  it('con la pestaña oculta no consulta ni al volver el temporizador; al mostrarse consulta de inmediato', async () => {
    vi.useFakeTimers();
    const fetchCount = vi.fn(async () => 1);
    const { doc, poller } = setup(fetchCount);
    doc.hidden = true;
    poller.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchCount).not.toHaveBeenCalled();
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fetchCount).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('un fallo de la consulta se ignora y se reintenta en el siguiente ciclo', async () => {
    vi.useFakeTimers();
    const fetchCount = vi
      .fn<() => Promise<number | undefined>>()
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValue(7);
    const { counts, poller } = setup(fetchCount);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(counts).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(counts).toEqual([7]);
    poller.stop();
  });

  it('un 304 (sin cambios) no altera el contador y tras detener se descartan respuestas y eventos', async () => {
    vi.useFakeTimers();
    let resolveSlow: (n: number) => void = () => undefined;
    const fetchCount = vi
      .fn<() => Promise<number | undefined>>()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<number>((resolve) => (resolveSlow = resolve)));
    const { win, counts, poller } = setup(fetchCount);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(counts).toEqual([2]);
    // Respuesta en vuelo que llega después de cambiar de workspace (stop): se descarta.
    await vi.advanceTimersByTimeAsync(60_000);
    poller.stop();
    resolveSlow(99);
    await vi.advanceTimersByTimeAsync(0);
    expect(counts).toEqual([2]);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchCount).toHaveBeenCalledTimes(3);
  });

  it('el servicio envía If-None-Match con el ETag recibido y conserva el ETag ante un 304', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { unread: 4 }, etag: '"a"' })
      .mockResolvedValueOnce({ data: undefined, etag: '"a"' });
    const api = { get, command: vi.fn() };
    const first = await fetchUnreadCount(api, '/workspaces/w1');
    expect(first).toEqual({ unread: 4, etag: '"a"' });
    expect(get).toHaveBeenCalledWith('/workspaces/w1/notifications/unread-count', {});
    const second = await fetchUnreadCount(api, '/workspaces/w1', first.etag);
    expect(second.unread).toBeUndefined();
    expect(get).toHaveBeenLastCalledWith('/workspaces/w1/notifications/unread-count', { etag: '"a"' });
  });
});

describe('Campana: vista', () => {
  const render = (n: number, current = false) =>
    renderToStaticMarkup(<NotificationBellView count={n} href="/notificaciones" current={current} t={f.t} />);

  it('[TC-NOTIFICATIONS-INAPP-003] sin no leídas no muestra contador y el nombre es "Notificaciones"', () => {
    const html = render(0);
    expect(tagOf(html, 'notification-bell')).toContain('href="/notificaciones"');
    expect(html).not.toContain('notification-unread-count');
    expect(textOf(html)).toContain('Notificaciones');
    expect(textOf(html)).not.toContain('sin leer');
  });

  it('con no leídas muestra el contador visual, el nombre accesible con el total y el anuncio moderado', () => {
    const html = render(3);
    expect(html).toMatch(/data-testid="notification-unread-count"[^>]*>3</);
    expect(tagOf(html, 'notification-unread-count')).toContain('aria-hidden="true"');
    expect(html).toContain('Notificaciones (3 sin leer)');
    expect(tagOf(html, 'notification-live')).toContain('aria-live="polite"');
    expect(html).toContain('Tienes 3 notificaciones sin leer.');
    expect(render(1)).toContain('Tienes 1 notificación sin leer.');
  });

  it('muestra 99+ pero el nombre accesible conserva el total real; marca la ruta actual', () => {
    const html = render(250, true);
    expect(html).toMatch(/data-testid="notification-unread-count"[^>]*>99\+</);
    expect(html).toContain('(250 sin leer)');
    expect(tagOf(html, 'notification-bell')).toContain('aria-current="page"');
  });
});

describe('Bandeja', () => {
  it('[TC-NOTIFICATIONS-INAPP-003] lista de la más reciente a la más antigua con los atributos de prueba', () => {
    const html = renderInbox();
    expect(count(html, 'notification-list')).toBe(1);
    expect(count(html, 'notification-item')).toBe(2);
    expect(html).toContain(`data-notification-id="${NOTE_C}"`);
    expect(html).toContain('data-status="UNREAD"');
    expect(html.indexOf(NOTE_C)).toBeLessThan(html.indexOf(NOTE_A));
    expect(count(html, 'notification-title')).toBe(2);
    expect(count(html, 'notification-body')).toBe(2);
    expect(html).toContain(`href="/es/notificaciones/${NOTE_C}"`);
    // Un solo h1 y los elementos son h2.
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-I18N-001] muestra el título y el cuerpo que entrega el servidor, sin recomponerlos', () => {
    const en = note({
      id: uuid(1010),
      title: 'You have a budget alert',
      body: 'Your Restaurants budget reached 90 %.',
      messageKey: 'notifications.budget_threshold.v1',
    });
    const html = renderInbox({ items: [en] });
    expect(textOf(html)).toContain('You have a budget alert');
    expect(textOf(html)).toContain('Your Restaurants budget reached 90 %.');
  });

  it('[TC-NOTIFICATIONS-I18N-002] un texto ya traducido por el servidor se muestra tal cual aunque la UI esté en otro idioma', () => {
    const pt = note({
      id: uuid(1011),
      title: 'Você tem um alerta de orçamento',
      body: 'Corpo em português.',
    });
    const html = renderInbox({ items: [pt] });
    expect(textOf(html)).toContain('Você tem um alerta de orçamento');
    expect(textOf(html)).toContain('Corpo em português.');
  });

  it('muestra severidad con icono y texto, estado con texto y el estado del email como etiqueta', () => {
    const html = renderInbox();
    expect(html).toContain('Crítica');
    expect(html).toContain('Información');
    expect(html).toMatch(/<span aria-hidden="true">⛔<\/span> Crítica/);
    // La no leída lleva el texto "Sin leer"; la leída, "Leída".
    expect(html).toMatch(/data-testid="notification-status" data-status="UNREAD">Sin leer</);
    expect(html).toMatch(/data-testid="notification-status" data-status="READ">Leída</);
    expect(html).toContain('Email: Fallido');
    expect(count(html, 'notification-email-status')).toBe(1);
    expect(html).toContain('<time');
    expect(html).toContain('dateTime="2026-11-12T23:15:00Z"');
  });

  it('acciones por elemento: "Marcar como leída" solo en no leídas y "Archivar" salvo en archivadas', () => {
    const html = renderInbox({ items: [C, A, B] });
    expect(count(html, 'notification-mark-read')).toBe(1);
    expect(count(html, 'notification-archive')).toBe(2);
    expect(html).toContain('aria-label="Marcar como leída: Presupuesto Restaurantes al 90 %"');
    expect(html).not.toContain('notification-mark-read" disabled');
  });

  it('[TC-NOTIFICATIONS-INAPP-004] "Marcar todas como leídas" se deshabilita sin no leídas', () => {
    const withUnread = renderInbox({ items: [C, A] });
    expect(tagOf(withUnread, 'notifications-mark-all-read')).not.toContain('disabled');
    const none = renderInbox({ items: [A] });
    expect(tagOf(none, 'notifications-mark-all-read')).toContain('disabled');
    const archived = renderInbox({ filter: 'ARCHIVED', items: [B] });
    expect(tagOf(archived, 'notifications-mark-all-read')).toContain('disabled');
  });

  it('pestañas accesibles: tablist con tres filtros, la seleccionada con aria-selected y foco itinerante', () => {
    const html = renderInbox({ filter: 'UNREAD', items: [C] });
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(/id="inbox-tab-UNREAD"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="inbox-tab-RECENT"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(textOf(html)).toContain('Recientes');
    expect(textOf(html)).toContain('Sin leer');
    expect(textOf(html)).toContain('Archivadas');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="inbox-tab-UNREAD"');
  });

  it('estados: carga, vacío y error con ProblemMessage; "Cargar más" solo con más páginas', () => {
    expect(renderInbox({ items: undefined })).toContain('aria-busy="true"');
    const empty = renderInbox({ items: [] });
    expect(textOf(empty)).toContain('No tienes notificaciones');
    expect(count(empty, 'notification-list')).toBe(0);
    const failed = renderInbox({ items: [], problem: { code: 'SERVICE_UNAVAILABLE' } });
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('No tienes notificaciones');
    expect(count(renderInbox(), 'notifications-load-more')).toBe(0);
    const more = renderInbox({ hasMore: true });
    expect(count(more, 'notifications-load-more')).toBe(1);
    expect(textOf(more)).toContain('Cargar más');
    expect(textOf(renderInbox({ hasMore: true, loadingMore: true }))).toContain('Cargando…');
  });

  it('anuncia el resultado de una acción en una región de estado', () => {
    const html = renderInbox({ status: f.t('done.allRead', { count: 2 }) });
    expect(html).toMatch(/role="status"[^>]*>2 notificaciones marcadas como leídas\./);
  });
});

describe('Servicio de notificaciones (API)', () => {
  const base = '/workspaces/w1';

  it('[TC-NOTIFICATIONS-INAPP-003] leer y archivar son POST sin Idempotency-Key y devuelven la notificación', async () => {
    const read = { ...C, status: 'READ' as const };
    const command = vi.fn().mockResolvedValue({ data: read });
    const api = { get: vi.fn(), command };
    expect(await transitionNotification(api, base, NOTE_C, 'read')).toEqual(read);
    expect(command).toHaveBeenCalledWith('POST', `${base}/notifications/${NOTE_C}/read`, undefined, {
      idempotent: false,
    });
    await transitionNotification(api, base, NOTE_C, 'archive');
    expect(command).toHaveBeenLastCalledWith('POST', `${base}/notifications/${NOTE_C}/archive`, undefined, {
      idempotent: false,
    });
  });

  it('[TC-NOTIFICATIONS-INAPP-004] marcar todas informa cuántas cambiaron', async () => {
    const command = vi.fn().mockResolvedValue({ data: { updated: 1 } });
    expect(await markAllNotificationsRead({ get: vi.fn(), command }, base)).toBe(1);
    expect(command).toHaveBeenCalledWith('POST', `${base}/notifications/read-all`, undefined, {
      idempotent: false,
    });
  });

  it('[TC-NOTIFICATIONS-EMAIL-003] el detalle se marca como leído una sola vez aunque el efecto se repita', async () => {
    const command = vi.fn().mockResolvedValue({ data: { ...C, status: 'READ' } });
    const api = { get: vi.fn(), command };
    const readOnce = createReadOnce();
    const first = await readOnce(api, base, C);
    const second = await readOnce(api, base, C);
    expect(first?.status).toBe('READ');
    expect(second).toBeUndefined();
    expect(command).toHaveBeenCalledTimes(1);
    // Una ya leída no se vuelve a marcar.
    expect(await createReadOnce()(api, base, A)).toBeUndefined();
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('[TC-NOTIFICATIONS-PREFS-003] carga las preferencias con su ETag y las guarda con If-Match', async () => {
    const get = vi.fn().mockResolvedValue({ data: DEFAULT_PREFS, etag: '"1"' });
    const saved = { ...DEFAULT_PREFS, version: 2, includeDetailsInEmail: true };
    const command = vi.fn().mockResolvedValue({ data: saved, etag: '"2"' });
    const api = { get, command };
    const loaded = await loadPreferences(api, base);
    expect(loaded).toEqual({ prefs: DEFAULT_PREFS, etag: '"1"' });
    const draft = { ...draftFromPreferences(DEFAULT_PREFS), includeDetailsInEmail: true };
    const result = await savePreferences(api, base, loaded!, draft);
    expect(command).toHaveBeenCalledWith(
      'PUT',
      `${base}/notification-preferences`,
      { types: DEFAULT_PREFS.types, quietHours: null, includeDetailsInEmail: true },
      { ifMatch: '"1"', idempotent: false },
    );
    expect(result).toEqual({ prefs: saved, etag: '"2"' });
  });

  it('propaga el 412 para que la UI ofrezca recargar', async () => {
    const command = vi.fn().mockRejectedValue(new FinanceApiError(412, { code: 'PRECONDITION_FAILED' }));
    await expect(
      savePreferences(
        { get: vi.fn(), command },
        base,
        { prefs: DEFAULT_PREFS, etag: '"1"' },
        draftFromPreferences(DEFAULT_PREFS),
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
});

describe('Detalle', () => {
  const render = (loaded: Parameters<typeof NotificationDetailView>[0]['loaded']) =>
    renderToStaticMarkup(<NotificationDetailView f={f} uiLocale="es" loaded={loaded} href={href} />);

  it('[TC-NOTIFICATIONS-INAPP-005] BUDGET_LINE enlaza al plan del periodo con la línea resaltada', () => {
    const html = render({ status: 'ready', notification: C });
    expect(html).toContain('data-testid="notification-detail"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(tagOf(html, 'notification-open-resource')).toContain(
      `href="/es/planificacion/presupuestos?periodo=2026-11&amp;linea=${LINE_ID}"`,
    );
    expect(textOf(html)).toContain('Ver la línea en el plan de noviembre de 2026');
    expect(textOf(html)).toContain(C.title);
    expect(textOf(html)).toContain(C.body);
    expect(textOf(html)).toContain('Crítica');
    expect(tagOf(html, 'notification-back')).toContain('href="/es/notificaciones"');
  });

  it('PERIOD_CLOSE enlaza al cierre del mes', () => {
    const close = note({
      id: uuid(1020),
      type: 'MONTH_CLOSE_PENDING',
      link: { kind: 'PERIOD_CLOSE', periodId: PERIOD_ID, periodLabel: '2026-10' },
    });
    const html = render({ status: 'ready', notification: close });
    expect(tagOf(html, 'notification-open-resource')).toContain(
      `href="/es/planificacion/periodos/${PERIOD_ID}/cierre"`,
    );
    expect(textOf(html)).toContain('Ir al cierre de octubre de 2026');
  });

  it('[TC-COMMITMENTS-RECUR-043] RECURRING_OCCURRENCE enlaza al detalle de la ocurrencia', () => {
    const occurrenceId = '0198f0aa-0000-7000-8000-00000000c0de';
    const due = note({
      id: uuid(1022),
      type: 'RECURRING_APPROVAL_REQUIRED',
      link: { kind: 'RECURRING_OCCURRENCE', periodId: PERIOD_ID, periodLabel: '2026-10', occurrenceId },
    });
    const html = render({ status: 'ready', notification: due });
    expect(tagOf(html, 'notification-open-resource')).toContain(
      `href="/es/recurring/occurrences/${occurrenceId}"`,
    );
    expect(textOf(html)).toContain('Ver el pago recurrente de octubre de 2026');
  });

  it('un tipo de enlace desconocido no ofrece destino y la notificación sigue visible', () => {
    const unknown = note({
      id: uuid(1021),
      link: { kind: 'FUTURE_KIND', periodId: PERIOD_ID, periodLabel: '2026-11' },
    });
    const html = render({ status: 'ready', notification: unknown });
    expect(count(html, 'notification-open-resource')).toBe(0);
    expect(textOf(html)).toContain(unknown.title);
  });

  it('[TC-NOTIFICATIONS-EMAIL-003] 404: mensaje "no existe o no es tuya" con enlace a la bandeja; otros errores por code', () => {
    const missing = render({ status: 'notFound' });
    expect(textOf(missing)).toContain('Esta notificación no existe o no es tuya.');
    expect(missing).toContain('role="alert"');
    expect(tagOf(missing, 'notification-back')).toContain('href="/es/notificaciones"');
    const failed = render({ status: 'error', problem: { code: 'SERVICE_UNAVAILABLE' } });
    expect(failed).toContain('data-error-code="SERVICE_UNAVAILABLE"');
    expect(render({ status: 'loading' })).toContain('aria-busy="true"');
  });
});

describe('Preferencias', () => {
  const view = (over: Partial<Parameters<typeof NotificationPreferencesView>[0]> = {}) =>
    renderToStaticMarkup(
      <NotificationPreferencesView
        f={f}
        uiLocale="es"
        draft={draftFromPreferences(DEFAULT_PREFS)}
        {...over}
      />,
    );

  it('[TC-NOTIFICATIONS-PREFS-003] por defecto tiene ambos canales activados y los detalles desactivados', () => {
    const html = view();
    for (const type of [
      'BUDGET_THRESHOLD',
      'MONTH_CLOSE_PENDING',
      'RECURRING_PAYMENT_UPCOMING',
      'RECURRING_APPROVAL_REQUIRED',
    ]) {
      for (const channel of ['inApp', 'email']) {
        expect(tagOf(html, `pref-${type}-${channel}`)).toContain('checked=""');
      }
    }
    expect(tagOf(html, 'pref-include-details')).not.toContain('checked');
    expect(tagOf(html, 'pref-quiet-enabled')).not.toContain('checked');
    expect(tagOf(html, 'pref-quiet-start')).toContain('disabled');
  });

  it('[TC-NOTIFICATIONS-PREFS-001] casillas por tipo y canal con nombre accesible "<tipo> · <canal>"', () => {
    const html = view();
    expect(tagOf(html, 'pref-BUDGET_THRESHOLD-email')).toContain(
      'aria-label="Alertas de presupuesto · Email"',
    );
    expect(tagOf(html, 'pref-MONTH_CLOSE_PENDING-inApp')).toContain(
      'aria-label="Cierre de mes pendiente · En la app"',
    );
    expect(tagOf(html, 'pref-RECURRING_PAYMENT_UPCOMING-email')).toContain(
      'aria-label="Pago recurrente próximo · Email"',
    );
    expect(tagOf(html, 'pref-RECURRING_APPROVAL_REQUIRED-inApp')).toContain(
      'aria-label="Pago recurrente por aprobar · En la app"',
    );
    expect(html).toContain('data-testid="notification-preferences"');
    expect(html).toContain('<caption');
  });

  it('muestra la advertencia de privacidad de los emails con detalles', () => {
    const text = textOf(view());
    expect(text).toContain('Incluir detalles (montos y nombres) en los emails');
    expect(text).toContain(
      'Los emails viajan por canales externos; por defecto no incluyen montos ni nombres de categorías. Activa esta opción solo si aceptas ver esos datos en tu correo. Las notificaciones dentro de la app no cambian.',
    );
  });

  it('horario de silencio: casilla, horas de 24 h, zona horaria del usuario y ayuda', () => {
    const html = view({
      draft: { ...draftFromPreferences(DEFAULT_PREFS), quietEnabled: true, start: '22:00', end: '07:00' },
    });
    expect(textOf(html)).toContain('Activar horario de silencio');
    expect(tagOf(html, 'pref-quiet-start')).toContain('type="time"');
    expect(tagOf(html, 'pref-quiet-start')).toContain('value="22:00"');
    expect(tagOf(html, 'pref-quiet-end')).toContain('value="07:00"');
    expect(tagOf(html, 'pref-quiet-start')).not.toContain('disabled');
    expect(textOf(html)).toContain('Hora de America/La_Paz (24 h).');
    expect(textOf(html)).toContain(
      'Los emails dentro de este horario se envían al terminar; las notificaciones dentro de la app llegan al momento.',
    );
  });

  it('errores del horario: local (formato, igual) y del servidor, asociados al campo', () => {
    const on = { ...draftFromPreferences(DEFAULT_PREFS), quietEnabled: true };
    const same = view({ draft: on, quietError: 'same' });
    expect(textOf(same)).toContain('La hora de inicio y la de fin deben ser distintas.');
    expect(tagOf(same, 'pref-quiet-start')).toContain('aria-invalid="true"');
    expect(textOf(view({ draft: on, quietError: 'format' }))).toContain('formato HH:mm');
    expect(textOf(view({ draft: on, quietError: 'server' }))).toContain(
      'El horario de silencio no es válido.',
    );
  });

  it('avisos de guardado, 412 con recarga y otros errores con ProblemMessage', () => {
    expect(textOf(view({ notice: 'saved' }))).toContain('Preferencias de notificaciones guardadas.');
    expect(textOf(view({ notice: 'noChanges' }))).toContain('No hay cambios para guardar.');
    const conflict = view({ problem: { code: 'PRECONDITION_FAILED' }, conflict: true });
    expect(conflict).toContain('data-error-code="PRECONDITION_FAILED"');
    expect(count(conflict, 'notification-preferences-reload')).toBe(1);
    expect(textOf(conflict)).toContain('Cargar la versión actual');
    expect(count(view(), 'notification-preferences-reload')).toBe(0);
    expect(view({ draft: undefined })).toContain('aria-busy="true"');
    expect(tagOf(view(), 'notification-preferences-save')).not.toContain('disabled');
    expect(tagOf(view({ busy: true }), 'notification-preferences-save')).toContain('disabled');
  });
});

describe('Plan de presupuestos: enlace desde una notificación', () => {
  const names: TargetNames = {
    CATEGORY: new Map([[CAT.rest, 'Restaurantes']]),
    GROUP: new Map(),
    TAG: new Map(),
  };
  const fb = esContext('Budgets');
  const restaurantes = line({ id: LINE_ID, kind: 'MAXIMUM', progress: {} });
  const budget = plan([restaurantes]);

  it('resuelve el periodo por etiqueta YYYY-MM o por id; uno desconocido cae al periodo por defecto', () => {
    const periods = [
      { id: PERIOD_ID, label: '2026-11' },
      { id: uuid(910), label: '2026-10' },
    ];
    expect(requestedPeriodId(periods, '2026-11')).toBe(PERIOD_ID);
    expect(requestedPeriodId(periods, uuid(910))).toBe(uuid(910));
    expect(requestedPeriodId(periods, '2031-01')).toBeUndefined();
    expect(requestedPeriodId(periods, undefined)).toBeUndefined();
  });

  it('[TC-NOTIFICATIONS-INAPP-005] distingue línea existente, línea que ya no existe y sin parámetro', () => {
    expect(lineHighlight(budget, LINE_ID)).toBe('found');
    expect(lineHighlight(budget, uuid(999))).toBe('missing');
    expect(lineHighlight(budget, undefined)).toBeUndefined();
  });

  it('[TC-NOTIFICATIONS-INAPP-005] resalta la fila con data-highlighted, aria-current y texto', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={budget} names={names} f={fb} canEdit={false} highlightedId={LINE_ID} />,
    );
    expect(html).toMatch(new RegExp(`<tr[^>]*data-line-id="${LINE_ID}"[^>]*data-highlighted="true"`));
    expect(html).toMatch(new RegExp(`<tr[^>]*data-line-id="${LINE_ID}"[^>]*aria-current="true"`));
    expect(textOf(html)).toContain('Línea de la notificación');
  });

  it('sin resaltado no marca ninguna fila', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={budget} names={names} f={fb} canEdit={false} />,
    );
    expect(html).not.toContain('data-highlighted');
    expect(html).not.toContain('aria-current');
  });

  it('[TC-NOTIFICATIONS-INAPP-005] el aviso "ya no existe" es una región de estado', () => {
    const html = renderToStaticMarkup(<LineMissingNotice f={fb} />);
    expect(html).toContain('role="status"');
    expect(tagOf(html, 'budget-line-missing')).toContain('role="status"');
    expect(textOf(html)).toBe(
      'La línea del presupuesto que originó la notificación ya no existe en este plan.',
    );
  });
});
