import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { ValidatedQuery, principalOf, type ApiRequest, type ApiResponse } from '@pf/platform/nest';
import type { ForecastScopeDto } from '../contracts/index.js';
import type { ForecastQueries } from '../application/forecast-queries.js';
import type { RequestForecastRun } from '../application/request-forecast-run.js';

export const FORECASTING_REQUEST = Symbol('FORECASTING_REQUEST');
export const FORECASTING_QUERIES = Symbol('FORECASTING_QUERIES');

type Json = Record<string, unknown>;

const SCOPES: readonly string[] = [
  'TOTAL_EXPENSE',
  'CATEGORY_GROUP',
  'CATEGORY',
  'OTHER_CATEGORIES',
  'TOTAL_INCOME',
];

const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
/** Parámetro repetible (`explode: true`): llega como arreglo o como texto separado por comas. */
const list = (b: Json, k: string): string[] | undefined => {
  const v = b[k];
  const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : undefined;
  return raw?.map((x) => x.trim()).filter((x) => x !== '');
};

const encodeCursor = (c: { requestedAt: string; id: string }): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
function decodeCursor(raw: string): { requestedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Json;
    if (typeof parsed['requestedAt'] === 'string' && typeof parsed['id'] === 'string') {
      return { requestedAt: parsed['requestedAt'], id: parsed['id'] };
    }
  } catch {
    /* cursor ilegible */
  }
  throw new ApiProblem('INVALID_CURSOR', 'the cursor is not valid');
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** `/api/v1/workspaces/{workspaceId}/forecasts*` (openspec add-ml-forecasting-service § Contratos). */
@Controller()
export class ForecastingController {
  constructor(
    @Inject(FORECASTING_REQUEST) private readonly requests: RequestForecastRun,
    @Inject(FORECASTING_QUERIES) private readonly queries: ForecastQueries,
  ) {}

  @Post('workspaces/:workspaceId/forecasts')
  @HttpCode(202)
  async requestRun(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const { runId } = await this.requests.execute({ workspaceId, userId: userIdOf(req) });
    const run = await this.queries.getRun({ workspaceId, runId });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/forecasts/${runId}`);
    res.setHeader('retry-after', '30');
    return {
      id: runId,
      kind: 'FORECAST',
      status: 'PENDING',
      progressPct: 0,
      resource: { type: 'forecast-run', id: runId },
      result: null,
      error: null,
      createdAt: run.requestedAt,
      updatedAt: run.requestedAt,
    };
  }

  @Get('workspaces/:workspaceId/forecasts')
  async listRuns(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const rawLimit = query['limit'];
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new ApiProblem('VALIDATION_FAILED', 'limit must be between 1 and 50');
    }
    const cursor = str(query, 'cursor');
    const statuses = list(query, 'status');
    const page = await this.queries.listRuns({
      workspaceId,
      limit,
      ...(statuses ? { statuses } : {}),
      ...(cursor ? { cursor: decodeCursor(cursor) } : {}),
    });
    return { items: page.items, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
  }

  // Ruta literal antes de `:runId`.
  @Get('workspaces/:workspaceId/forecasts/latest')
  latest(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const scopes = list(query, 'scope');
    if (scopes?.some((s) => !SCOPES.includes(s))) throw new ApiProblem('INVALID_FILTER', 'unknown scope');
    const scopeRef = str(query, 'scopeRef');
    const rawHorizon = query['horizon'];
    const horizon = rawHorizon === undefined ? undefined : Number(rawHorizon);
    if (horizon !== undefined && !Number.isInteger(horizon)) {
      throw new ApiProblem('INVALID_FILTER', 'horizon must be 1, 3, 6 or 12');
    }
    return this.queries.getLatest({
      workspaceId,
      ...(scopes ? { scopes: scopes as ForecastScopeDto[] } : {}),
      ...(scopeRef ? { scopeRef } : {}),
      ...(horizon !== undefined ? { horizon } : {}),
    });
  }

  @Get('workspaces/:workspaceId/forecasts/:runId')
  getRun(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    return this.queries.getRun({ workspaceId, runId });
  }

  @Get('workspaces/:workspaceId/forecasts/:runId/lifecycle')
  lifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('runId') runId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, runId });
  }
}
