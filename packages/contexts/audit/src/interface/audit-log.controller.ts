import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
} from '@pf/platform/nest';
import { toAuditLogEntryDto, type AuditQueries, type AuditSort } from '../application/audit-queries.js';

/** Token del servicio de consultas de AUDIT en el módulo HTTP. */
export const AUDIT_QUERIES = Symbol('AUDIT_QUERIES');

type Query = Record<string, unknown>;
const str = (q: Query, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;

/**
 * `GET /api/v1/workspaces/{workspaceId}/audit-log` (`listAuditLog`, design §Contratos): OWNER/EDITOR por
 * `x-required-role: EDITOR` (VIEWER → 403 `INSUFFICIENT_ROLE`, lo aplica el guard de identidad). Historial de una
 * entidad (`aggregateType` + `aggregateId`, cronológico) o búsqueda por rango (`from`/`to` en la zona del workspace,
 * más reciente primero), paginados por cursor firmado (keyset `occurredAt` + `id`).
 */
@Controller()
export class AuditLogController {
  constructor(
    @Inject(AUDIT_QUERIES) private readonly queries: AuditQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/audit-log')
  async list(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Query,
  ) {
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    const rawLimit = Number(query['limit'] ?? DEFAULT_PAGE_LIMIT);
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
    const aggregateType = str(query, 'aggregateType');
    const aggregateId = str(query, 'aggregateId');
    const from = str(query, 'from');
    const to = str(query, 'to');
    const sortParam = str(query, 'sort') as AuditSort | undefined;
    const sort: AuditSort = sortParam ?? (aggregateId !== undefined ? 'occurredAt' : '-occurredAt');
    const scope = {
      resource: 'audit-log',
      workspaceId,
      filters: {
        aggregateType: aggregateType ?? null,
        aggregateId: aggregateId ?? null,
        from: from ?? null,
        to: to ?? null,
        sort,
      },
    };
    const cursor = str(query, 'cursor');
    let after: { occurredAt: string; id: string } | undefined;
    if (cursor !== undefined) {
      const [occurredAt, id] = this.options.cursors.decode(cursor, scope);
      if (typeof occurredAt !== 'string' || typeof id !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = { occurredAt, id };
    }
    const rows = await this.queries.list({
      userId: principal.userId,
      workspaceId,
      ...(aggregateType !== undefined ? { aggregateType } : {}),
      ...(aggregateId !== undefined ? { aggregateId } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      sort,
      ...(after ? { after } : {}),
      limit: limit + 1,
    });
    const page = buildPage(
      rows,
      limit,
      (r) => [r.occurredAt.toString(), r.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map(toAuditLogEntryDto), page: page.page };
  }
}
