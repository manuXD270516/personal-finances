import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
} from '@pf/platform/nest';
import type { MatchingQueries } from '../application/matching.queries.js';
import type { MatchingService } from '../application/matching.service.js';
import { SUGGESTION_STATUSES, type SuggestionStatus } from '../domain/index.js';

export const MATCHING_SERVICE = Symbol('COMMITMENTS_MATCHING_SERVICE');
export const MATCHING_QUERIES = Symbol('COMMITMENTS_MATCHING_QUERIES');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

const list = (q: Json, k: string): string[] | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : String(v).split(',')).map(String);
};

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** `If-Match` opcional de confirmar y descartar: `"<versión>"` o ausente. */
function optionalVersion(req: ApiRequest): number | undefined {
  const raw = req.headers['if-match'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const m = /^"([1-9]\d{0,9})"$/.exec(value.trim());
  if (!m) {
    throw new ApiProblem('VALIDATION_FAILED', 'If-Match must be a strong entity tag such as "7"');
  }
  return Number(m[1]);
}

/**
 * `/api/v1/workspaces/{workspaceId}/recurring/match-suggestions*` (openspec add-commitment-matching § Contratos).
 * Autenticación y `x-required-role` (VIEWER lee; EDITOR confirma y descarta) los aplica el guard global de IDENTITY.
 * Se registra ANTES de `RecurringController`: `match-suggestions` no debe resolverse como `:definitionId`.
 */
@Controller()
export class MatchSuggestionsController {
  constructor(
    @Inject(MATCHING_SERVICE) private readonly service: MatchingService,
    @Inject(MATCHING_QUERIES) private readonly queries: MatchingQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/recurring/match-suggestions')
  async listMatchSuggestions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const statuses = (list(query, 'status') ?? ['PROPOSED']).filter((s): s is SuggestionStatus =>
      (SUGGESTION_STATUSES as readonly string[]).includes(s),
    );
    const filters = {
      status: statuses,
      occurrenceId: str(query, 'occurrenceId') ?? null,
      transactionId: str(query, 'transactionId') ?? null,
      definitionId: str(query, 'definitionId') ?? null,
    };
    const scope = { resource: 'recurring-match-suggestions', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let after: readonly [string, string] | undefined;
    if (cursor !== undefined) {
      const position = this.options.cursors.decode(cursor, scope);
      if (typeof position[0] !== 'string' || typeof position[1] !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = [position[0], position[1]];
    }
    const found = await this.queries.list(workspaceId, {
      statuses,
      occurrenceId: filters.occurrenceId ?? undefined,
      transactionId: filters.transactionId ?? undefined,
      definitionId: filters.definitionId ?? undefined,
      limit: limit + 1,
      after,
    });
    const page = buildPage(
      found.data,
      limit,
      (s) => [s.score, s.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page, proposedCount: found.proposedCount };
  }

  @Post('workspaces/:workspaceId/recurring/match-suggestions/:suggestionId/confirm')
  @HttpCode(200)
  async confirmMatchSuggestion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    const confirmed = await this.service.confirm({
      workspaceId,
      userId: userIdOf(req),
      suggestionId,
      expectedVersion: optionalVersion(req),
    });
    return {
      suggestion: await this.queries.get(workspaceId, confirmed.suggestion),
      occurrence: confirmed.occurrence,
    };
  }

  @Post('workspaces/:workspaceId/recurring/match-suggestions/:suggestionId/dismiss')
  @HttpCode(200)
  async dismissMatchSuggestion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    const dismissed = await this.service.dismiss({
      workspaceId,
      userId: userIdOf(req),
      suggestionId,
      expectedVersion: optionalVersion(req),
    });
    return this.queries.get(workspaceId, dismissed);
  }
}
