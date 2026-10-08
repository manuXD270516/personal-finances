import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { DomainError } from '@pf/shared-kernel';
import type { InboxActions } from '../application/inbox.actions.js';
import type { InboxQueries } from '../application/inbox.queries.js';
import type { PreferencesService } from '../application/preferences.service.js';

export const INBOX_ACTIONS = Symbol('NOTIFICATIONS_INBOX_ACTIONS');
export const INBOX_QUERIES = Symbol('NOTIFICATIONS_INBOX_QUERIES');
export const PREFERENCES_SERVICE = Symbol('NOTIFICATIONS_PREFERENCES_SERVICE');

type Json = Record<string, unknown>;
const WS = 'workspaces/:workspaceId';

const userIdOf = (req: ApiRequest): string => {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
};

const str = (q: Json, key: string): string | undefined =>
  typeof q[key] === 'string' ? (q[key] as string) : undefined;

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

/**
 * `/api/v1/workspaces/{workspaceId}/notifications*` y `/notification-preferences` (openspec add-alerts § Contratos,
 * tarea 5.1). Todas son "self": cualquier rol con membresía activa (`x-required-role: VIEWER`, guard global de
 * IDENTITY) opera SOLO sobre sus propias notificaciones y preferencias; una ajena responde `RESOURCE_NOT_FOUND`
 * (RLS + filtro por usuario). `If-Match`, `ETag` y Problem Details, las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class NotificationsController {
  constructor(
    @Inject(INBOX_ACTIONS) private readonly actions: InboxActions,
    @Inject(INBOX_QUERIES) private readonly queries: InboxQueries,
    @Inject(PREFERENCES_SERVICE) private readonly preferences: PreferencesService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  /** `listNotifications`: por defecto `UNREAD` + `READ`; `status=ARCHIVED` para las archivadas. */
  @Get(`${WS}/notifications`)
  async listNotifications(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
  ) {
    const userId = userIdOf(req);
    const limit = limitOf(query);
    const status = str(query, 'status');
    const scope = {
      resource: 'notifications',
      workspaceId,
      filters: { status: status ?? null, userId },
    };
    const cursor = str(query, 'cursor');
    let after: { createdAt: string; id: string } | undefined;
    if (cursor !== undefined) {
      const [createdAt, id] = this.options.cursors.decode(cursor, scope);
      if (typeof createdAt !== 'string' || typeof id !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = { createdAt, id };
    }
    const rows = await this.queries.list({
      workspaceId,
      userId,
      ...(status !== undefined ? { status } : {}),
      ...(after ? { after } : {}),
      limit: limit + 1,
    });
    const page = buildPage(
      [...rows],
      limit,
      (r) => [r.createdAt, r.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }

  /** `getUnreadNotificationCount`: `{unread}` con `ETag` (las archivadas no cuentan). */
  @Get(`${WS}/notifications/unread-count`)
  async getUnreadNotificationCount(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const unread = await this.queries.getUnreadCount(workspaceId, userIdOf(req));
    res.setHeader('etag', `"${unread}"`);
    return { unread };
  }

  /** `markAllNotificationsRead`: `{updated}`. */
  @Post(`${WS}/notifications/read-all`)
  @HttpCode(200)
  async markAllNotificationsRead(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return { updated: await this.actions.markAllRead({ workspaceId, userId: userIdOf(req) }) };
  }

  /** `getNotification`: una notificación propia (destino del enlace del email). Ajena o inexistente ⇒ 404. */
  @Get(`${WS}/notifications/:notificationId`)
  async getNotification(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('notificationId') notificationId: string,
  ) {
    const view = await this.queries.get(workspaceId, userIdOf(req), notificationId);
    if (!view) throw new DomainError('RESOURCE_NOT_FOUND', `notification ${notificationId} not found`);
    return view;
  }

  /** `markNotificationRead` (idempotente). */
  @Post(`${WS}/notifications/:notificationId/read`)
  @HttpCode(200)
  markNotificationRead(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.actions.markRead({ workspaceId, userId: userIdOf(req), notificationId });
  }

  /** `archiveNotification` (idempotente). */
  @Post(`${WS}/notifications/:notificationId/archive`)
  @HttpCode(200)
  archiveNotification(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.actions.archive({ workspaceId, userId: userIdOf(req), notificationId });
  }

  /** `getNotificationPreferences`: por defecto ambos canales activos, sin detalles y sin horario de silencio. */
  @Get(`${WS}/notification-preferences`)
  getNotificationPreferences(@Req() req: ApiRequest, @Param('workspaceId') workspaceId: string) {
    return this.preferences.get(workspaceId, userIdOf(req));
  }

  /** `updateNotificationPreferences` (`If-Match`): auditado; horario inválido ⇒ 400 `VALIDATION_FAILED`. */
  @Put(`${WS}/notification-preferences`)
  updateNotificationPreferences(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const types = Array.isArray(body['types']) ? (body['types'] as Json[]) : [];
    const quiet = body['quietHours'];
    return this.preferences.update({
      workspaceId,
      userId: userIdOf(req),
      expectedVersion: expected,
      preferences: {
        types: types.map((t) => ({
          type: String(t['type']),
          inApp: t['inApp'] === true,
          email: t['email'] === true,
        })),
        quietHours:
          quiet && typeof quiet === 'object'
            ? { start: String((quiet as Json)['start']), end: String((quiet as Json)['end']) }
            : null,
        includeDetailsInEmail: body['includeDetailsInEmail'] === true,
      },
    });
  }
}
