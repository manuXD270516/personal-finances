import { Controller, Get, Inject, Param, Req, Res, StreamableFile } from '@nestjs/common';
import {
  ApiProblem,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPage,
  rateLimitHeaders,
  type RateLimitPolicy,
} from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { AuditLogExporter } from '../application/audit-export.js';
import {
  toAuditLogEntryDto,
  type AuditFilters,
  type AuditQueries,
  type AuditSort,
} from '../application/audit-queries.js';

/** Token del servicio de consultas de AUDIT en el módulo HTTP. */
export const AUDIT_QUERIES = Symbol('AUDIT_QUERIES');
/** Token de la exportación CSV del log. */
export const AUDIT_LOG_EXPORTER = Symbol('AUDIT_LOG_EXPORTER');

/** Exportaciones del log por usuario y minuto (design decisión 3). */
export const EXPORT_POLICY: RateLimitPolicy = { name: 'audit-export', quota: 10, windowSeconds: 60 };

type Query = Record<string, unknown>;
const str = (q: Query, k: string): string | undefined =>
  typeof q[k] === 'string' && (q[k] as string) !== '' ? (q[k] as string) : undefined;

/** Filtros de la consulta global (`listAuditLog` y `exportAuditLog` comparten parámetros). `action` es una lista separada por comas. */
export function filtersOf(query: Query): AuditFilters {
  const action = str(query, 'action');
  const f: Record<string, unknown> = {};
  for (const k of [
    'aggregateType',
    'aggregateId',
    'actorUserId',
    'origin',
    'correlationId',
    'category',
    'from',
    'to',
  ]) {
    const v = str(query, k);
    if (v !== undefined) f[k] = v;
  }
  if (action !== undefined) f['action'] = action.split(',').map((a) => a.trim());
  return f as AuditFilters;
}

/**
 * `GET /api/v1/workspaces/{workspaceId}/audit-log` (`listAuditLog`, design §Contratos): OWNER/EDITOR por
 * `x-required-role: EDITOR` (VIEWER → 403 `INSUFFICIENT_ROLE`, lo aplica el guard de identidad; docs/33 D105). Historial
 * de una entidad (`aggregateType` + `aggregateId`, cronológico) o consulta global (openspec add-global-audit-view:
 * `actorUserId`, `action`, `aggregateType`, `origin`, `correlationId`, `category` y rango `from`/`to` en la zona del
 * workspace, más reciente primero), paginados por cursor firmado (keyset `occurredAt` + `id`).
 * `GET …/audit-log/export?format=csv` (`exportAuditLog`): CSV de la misma consulta, solo OWNER (`x-required-role: OWNER`).
 */
@Controller()
export class AuditLogController {
  constructor(
    @Inject(AUDIT_QUERIES) private readonly queries: AuditQueries,
    @Inject(AUDIT_LOG_EXPORTER) private readonly exporter: AuditLogExporter,
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
    const filters = filtersOf(query);
    const sortParam = str(query, 'sort') as AuditSort | undefined;
    const sort: AuditSort = sortParam ?? (filters.aggregateId !== undefined ? 'occurredAt' : '-occurredAt');
    const scope = {
      resource: 'audit-log',
      workspaceId,
      filters: {
        aggregateType: filters.aggregateType ?? null,
        aggregateId: filters.aggregateId ?? null,
        actorUserId: filters.actorUserId ?? null,
        action: filters.action?.join(',') ?? null,
        origin: filters.origin ?? null,
        correlationId: filters.correlationId ?? null,
        category: filters.category ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
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
      ...filters,
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

  @Get('workspaces/:workspaceId/audit-log/export')
  async export(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Query,
  ): Promise<StreamableFile> {
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    if (query['format'] !== 'csv') throw new ApiProblem('VALIDATION_FAILED', 'format must be csv');
    await this.limitExports(principal.userId, workspaceId);
    const file = await this.exporter.export({ userId: principal.userId, workspaceId, ...filtersOf(query) });
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(file.body, { length: file.body.byteLength });
  }

  /** 10 exportaciones por usuario y minuto sobre el `RateLimiter` de la API (429 `RATE_LIMITED` + `Retry-After`). */
  private async limitExports(userId: string, workspaceId: string): Promise<void> {
    const limiter = this.options.rateLimit?.limiter;
    if (!limiter) return;
    const decision = await limiter.consume(
      `${userId}:${workspaceId}`,
      EXPORT_POLICY,
      this.options.clock.now().toDate(),
    );
    if (!decision.allowed) {
      throw new ApiProblem('RATE_LIMITED', `quota "${EXPORT_POLICY.name}" exceeded`, {
        headers: {
          ...rateLimitHeaders(EXPORT_POLICY, decision),
          'retry-after': String(decision.retryAfterSeconds),
        },
      });
    }
  }
}
