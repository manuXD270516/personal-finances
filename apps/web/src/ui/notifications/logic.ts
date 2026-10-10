/**
 * Lógica pura de notificaciones (openspec add-alerts 6.1/6.2): tipos del contrato, formato de fecha, enlace al
 * recurso de origen, reducción del estado de la bandeja, contador de la campana y borrador de preferencias.
 * Sin React ni DOM, para probarla sin render. Los textos de dominio (`title`, `body`) los renderiza el servidor en el
 * idioma del usuario: la UI nunca los recompone (TC-NOTIFICATIONS-I18N-001/-002).
 */

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type NotificationStatus = 'UNREAD' | 'READ' | 'ARCHIVED';
export type NotificationEmailStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED';

export interface NotificationLink {
  readonly kind: 'BUDGET_LINE' | 'PERIOD_CLOSE' | 'RECURRING_OCCURRENCE' | (string & {});
  readonly periodId: string;
  readonly periodLabel: string;
  /** Ocurrencia recurrente (solo `RECURRING_OCCURRENCE`, add-recurrence-engine): abre `/recurring/occurrences/{id}`. */
  readonly occurrenceId?: string;
  readonly budgetId?: string;
  readonly budgetLineId?: string;
  readonly targetKind?: string;
  readonly targetId?: string;
}

export interface AppNotification {
  readonly id: string;
  readonly type: string;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly messageKey: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly link: NotificationLink;
  readonly status: NotificationStatus;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly emailStatus?: NotificationEmailStatus;
}

export interface NotificationPage {
  readonly data: readonly AppNotification[];
  readonly page: { readonly limit: number; readonly hasMore: boolean; readonly nextCursor: string | null };
}

/** Evento de ventana que avisa a la campana de que cambió algo (marcar leída, archivar, leer todas). */
export const NOTIFICATIONS_CHANGED = 'pfos:notifications-changed';

/** Intervalo de consulta del contador de la campana (sin SSE). */
export const UNREAD_POLL_MS = 60_000;

/** Tope visual del contador de la campana. */
export function unreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Locale de formato (`Intl`) según el idioma de la UI; es-BO por defecto. */
export function formatLocaleFor(uiLocale: string): string {
  return uiLocale === 'en' ? 'en-US' : uiLocale === 'pt' ? 'pt-BR' : 'es-BO';
}

/** Fecha y hora absolutas de un instante RFC 3339 en la zona del usuario (p. ej. "8 oct 2026, 14:42"). */
export function formatInstant(iso: string, locale: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

// ───────────────────────────── Severidad y destino ─────────────────────────────

export interface SeverityPresentation {
  readonly icon: string;
  readonly color: string;
}

/** Icono decorativo y token de color; el texto de la severidad siempre se muestra (NFR-USAB-104). */
export function severityPresentation(severity: string): SeverityPresentation {
  switch (severity) {
    case 'CRITICAL':
      return { icon: '⛔', color: 'var(--pf-fin-over-budget)' };
    case 'WARNING':
      return { icon: '⚠', color: 'var(--pf-fin-warning)' };
    default:
      return { icon: 'ℹ', color: 'var(--pf-fg)' };
  }
}

/**
 * Ruta (sin prefijo de locale) del recurso que originó la notificación; `undefined` si el tipo de enlace no se
 * conoce (el enum es abierto). `BUDGET_LINE` abre el plan del periodo con la línea resaltada; si la línea ya no
 * existe, el plan lo avisa (TC-NOTIFICATIONS-INAPP-005). `RECURRING_OCCURRENCE` abre el detalle de la ocurrencia.
 */
export function resourcePath(link: NotificationLink): string | undefined {
  if (link.kind === 'BUDGET_LINE') {
    const query = new URLSearchParams({ periodo: link.periodLabel });
    if (link.budgetLineId) query.set('linea', link.budgetLineId);
    return `/planificacion/presupuestos?${query.toString()}`;
  }
  if (link.kind === 'PERIOD_CLOSE') {
    return `/planificacion/periodos/${encodeURIComponent(link.periodId)}/cierre`;
  }
  if (link.kind === 'RECURRING_OCCURRENCE' && link.occurrenceId) {
    return `/recurring/occurrences/${encodeURIComponent(link.occurrenceId)}`;
  }
  return undefined;
}

/** Ruta (sin locale) del detalle: el id es opaco; el enlace de los emails apunta aquí (TC-NOTIFICATIONS-EMAIL-003). */
export const detailPath = (id: string): string => `/notificaciones/${encodeURIComponent(id)}`;

// ───────────────────────────── Bandeja ─────────────────────────────

export type InboxFilter = 'RECENT' | 'UNREAD' | 'ARCHIVED';
export const INBOX_FILTERS: readonly InboxFilter[] = ['RECENT', 'UNREAD', 'ARCHIVED'];
export const INBOX_PAGE_SIZE = 20;

/** Consulta del listado: "Recientes" no envía `status` (la API devuelve sin leer y leídas). */
export function inboxQuery(filter: InboxFilter, cursor?: string | null): string {
  const query = new URLSearchParams({ limit: String(INBOX_PAGE_SIZE) });
  if (filter === 'UNREAD') query.set('status', 'UNREAD');
  if (filter === 'ARCHIVED') query.set('status', 'ARCHIVED');
  if (cursor) query.set('cursor', cursor);
  return query.toString();
}

/** ¿Una notificación con ese estado pertenece al filtro? */
export function belongsToFilter(filter: InboxFilter, status: NotificationStatus): boolean {
  if (filter === 'UNREAD') return status === 'UNREAD';
  if (filter === 'ARCHIVED') return status === 'ARCHIVED';
  return status !== 'ARCHIVED';
}

/** Reemplaza la notificación actualizada; si ya no pertenece al filtro (p. ej. archivada en "Recientes") sale de la lista. */
export function applyUpdated(
  items: readonly AppNotification[],
  filter: InboxFilter,
  updated: AppNotification,
): AppNotification[] {
  return items.flatMap((item) => {
    if (item.id !== updated.id) return [item];
    return belongsToFilter(filter, updated.status) ? [updated] : [];
  });
}

/** "Marcar todas como leídas": las sin leer pasan a leídas (y salen de la lista "Sin leer"). */
export function applyReadAll(
  items: readonly AppNotification[],
  filter: InboxFilter,
  readAt: string,
): AppNotification[] {
  return items.flatMap((item) => {
    if (item.status !== 'UNREAD') return [item];
    return filter === 'UNREAD' ? [] : [{ ...item, status: 'READ' as const, readAt }];
  });
}

/** Añade una página sin duplicar (un reintento o una actualización concurrente puede repetir elementos). */
export function appendPage(
  items: readonly AppNotification[],
  more: readonly AppNotification[],
): AppNotification[] {
  const seen = new Set(items.map((i) => i.id));
  return [...items, ...more.filter((m) => !seen.has(m.id))];
}

/** "Marcar todas" se deshabilita sin no leídas (en "Archivadas" nunca hay; con más páginas puede haberlas). */
export function canMarkAllRead(
  filter: InboxFilter,
  items: readonly AppNotification[],
  hasMore: boolean,
): boolean {
  if (filter === 'ARCHIVED') return false;
  return items.some((i) => i.status === 'UNREAD') || hasMore;
}

// ───────────────────────────── Contador de la campana ─────────────────────────────

/** Superficie mínima de `document`/`window` que necesita el sondeo (inyectable en tests). */
export interface EventSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
export interface PollDocument extends EventSource {
  readonly hidden: boolean;
}

export interface UnreadPollerOptions {
  /** Devuelve el contador; `undefined` si no cambió (304). Puede lanzar: el error se ignora. */
  readonly fetchCount: () => Promise<number | undefined>;
  readonly onCount: (count: number) => void;
  readonly doc: PollDocument;
  readonly win: EventSource;
  readonly intervalMs?: number;
}

/**
 * Sondeo del contador de no leídas (sin SSE): consulta al iniciar, cada 60 s, al recuperar foco/visibilidad y cuando
 * la propia UI avisa de un cambio. Con la pestaña oculta no consulta. Un fallo no rompe el marco: se ignora y se
 * reintenta en el siguiente ciclo. Tras `stop()` descarta cualquier respuesta en vuelo (cambio de workspace).
 */
export function createUnreadPoller(options: UnreadPollerOptions): { start(): void; stop(): void } {
  const { doc, win } = options;
  const interval = options.intervalMs ?? UNREAD_POLL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let generation = 0;

  const poll = () => {
    if (!running || doc.hidden) return;
    const mine = generation;
    options.fetchCount().then(
      (count) => {
        if (running && mine === generation && count !== undefined) options.onCount(count);
      },
      () => undefined,
    );
  };
  const onVisibility = () => {
    if (!doc.hidden) poll();
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      timer = setInterval(poll, interval);
      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('focus', poll);
      win.addEventListener(NOTIFICATIONS_CHANGED, poll);
      poll();
    },
    stop() {
      running = false;
      generation += 1;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('focus', poll);
      win.removeEventListener(NOTIFICATIONS_CHANGED, poll);
    },
  };
}

// ───────────────────────────── Preferencias ─────────────────────────────

export interface TypePreference {
  readonly type: string;
  readonly inApp: boolean;
  readonly email: boolean;
}
export interface QuietHours {
  readonly start: string;
  readonly end: string;
}
export interface NotificationPreferences {
  readonly types: readonly TypePreference[];
  readonly quietHours: QuietHours | null;
  readonly includeDetailsInEmail: boolean;
  readonly version: number;
}
export interface NotificationPreferencesInput {
  readonly types: readonly TypePreference[];
  readonly quietHours: QuietHours | null;
  readonly includeDetailsInEmail: boolean;
}

/** Borrador editable: el horario conserva sus horas aunque se desactive (para reactivarlo sin reescribir). */
export interface PreferencesDraft {
  readonly types: readonly TypePreference[];
  readonly includeDetailsInEmail: boolean;
  readonly quietEnabled: boolean;
  readonly start: string;
  readonly end: string;
}

export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '07:00';

export function draftFromPreferences(prefs: NotificationPreferences): PreferencesDraft {
  return {
    types: prefs.types.map((t) => ({ ...t })),
    includeDetailsInEmail: prefs.includeDetailsInEmail,
    quietEnabled: prefs.quietHours !== null,
    start: prefs.quietHours?.start ?? DEFAULT_QUIET_START,
    end: prefs.quietHours?.end ?? DEFAULT_QUIET_END,
  };
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const isHHmm = (value: string): boolean => HHMM.test(value);

export type QuietHoursError = 'format' | 'same';

/** Validación local del horario (solo si está activo): formato HH:mm de 24 h e inicio distinto del fin. */
export function quietHoursError(draft: PreferencesDraft): QuietHoursError | undefined {
  if (!draft.quietEnabled) return undefined;
  if (!isHHmm(draft.start) || !isHHmm(draft.end)) return 'format';
  if (draft.start === draft.end) return 'same';
  return undefined;
}

/** Cuerpo del `PUT` (sin `version`); `null` en `quietHours` si el horario está desactivado. */
export function preferencesInput(draft: PreferencesDraft): NotificationPreferencesInput {
  return {
    types: draft.types.map((t) => ({ type: t.type, inApp: t.inApp, email: t.email })),
    quietHours: draft.quietEnabled ? { start: draft.start, end: draft.end } : null,
    includeDetailsInEmail: draft.includeDetailsInEmail,
  };
}

/** ¿El borrador difiere de lo guardado? (el horario desactivado solo cuenta si antes estaba activo). */
export function preferencesChanged(saved: NotificationPreferences, draft: PreferencesDraft): boolean {
  return (
    JSON.stringify(preferencesInput(draftFromPreferences(saved))) !== JSON.stringify(preferencesInput(draft))
  );
}

export function setChannel(
  draft: PreferencesDraft,
  type: string,
  channel: 'inApp' | 'email',
  value: boolean,
): PreferencesDraft {
  return { ...draft, types: draft.types.map((t) => (t.type === type ? { ...t, [channel]: value } : t)) };
}

/** ¿El 400 de la API señala el horario de silencio? (`errors[].pointer` empieza por `/quietHours`). */
export function hasQuietHoursServerError(problem: { readonly [key: string]: unknown }): boolean {
  return (
    Array.isArray(problem.errors) &&
    problem.errors.some(
      (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { pointer?: unknown }).pointer === 'string' &&
        (e as { pointer: string }).pointer.startsWith('/quietHours'),
    )
  );
}
