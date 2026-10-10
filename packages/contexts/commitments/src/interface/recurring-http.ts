import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import { isDomainError } from '@pf/shared-kernel';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { CommitmentsQueries } from '../application/commitments.queries.js';
import type { DefinitionsService, TemplateChanges } from '../application/definitions.service.js';
import type { OccurrencesService } from '../application/occurrences.service.js';
import type { ApiTemplate } from '../application/template-resolver.js';
import {
  OCCURRENCE_STATUSES,
  type DefinitionStatus,
  type OccurrenceStatus,
  type RecurringKind,
} from '../domain/index.js';

export const DEFINITIONS_SERVICE = Symbol('COMMITMENTS_DEFINITIONS_SERVICE');
export const OCCURRENCES_SERVICE = Symbol('COMMITMENTS_OCCURRENCES_SERVICE');
export const COMMITMENTS_QUERIES = Symbol('COMMITMENTS_QUERIES');

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

/**
 * `/api/v1/workspaces/{workspaceId}/recurring*` (openspec add-recurrence-engine § Contratos). Autenticación y
 * `x-required-role` (VIEWER lee; EDITOR escribe) los aplica el guard global de IDENTITY; validación de contrato,
 * Problem Details, ETag/If-Match e `Idempotency-Key`, las convenciones globales de `@pf/platform/nest`. Las rutas
 * estáticas (`occurrences`, `committed`) se declaran antes que `:definitionId`.
 */
@Controller()
export class RecurringController {
  constructor(
    @Inject(DEFINITIONS_SERVICE) private readonly definitions: DefinitionsService,
    @Inject(OCCURRENCES_SERVICE) private readonly occurrences: OccurrencesService,
    @Inject(COMMITMENTS_QUERIES) private readonly queries: CommitmentsQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  // ───────────────────────────────────────────── definiciones

  @Get('workspaces/:workspaceId/recurring')
  async listRecurringDefinitions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const status = str(query, 'status') as DefinitionStatus | undefined;
    const kind = str(query, 'kind') as RecurringKind | undefined;
    const q = str(query, 'q');
    const limit = limitOf(query);
    const scope = {
      resource: 'recurring',
      workspaceId,
      filters: { status: status ?? null, kind: kind ?? null, q: q ?? null },
    };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const all = await this.queries.listDefinitions(workspaceId, { status, kind, q });
    const rows = all.slice(offset, offset + limit + 1).map((d, i) => ({ d, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => r.d), page: page.page };
  }

  @Post('workspaces/:workspaceId/recurring')
  @HttpCode(201)
  async createRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await this.definitions.create({
      workspaceId,
      userId: userIdOf(req),
      name: str(body, 'name') ?? '',
      description: str(body, 'description') ?? null,
      notes: str(body, 'notes') ?? null,
      kind: str(body, 'kind') ?? '',
      template: body['template'] as ApiTemplate,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/recurring/${created.id}`);
    return created;
  }

  // ───────────────────────────────────────────── ocurrencias (rutas estáticas primero)

  @Get('workspaces/:workspaceId/recurring/occurrences')
  async listRecurringOccurrences(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    return this.occurrencePage(workspaceId, query, undefined);
  }

  @Get('workspaces/:workspaceId/recurring/committed')
  getCommittedAmount(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    return this.queries.getCommitted(workspaceId, str(query, 'periodId'));
  }

  @Get('workspaces/:workspaceId/recurring/occurrences/:occurrenceId')
  getRecurringOccurrence(
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    return this.queries.getOccurrence(workspaceId, occurrenceId);
  }

  @Patch('workspaces/:workspaceId/recurring/occurrences/:occurrenceId')
  updateRecurringOccurrence(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.occurrences.edit({
      workspaceId,
      userId: userIdOf(req),
      occurrenceId,
      expectedVersion: expected,
      ...(body['expectedAmount'] ? { expectedAmount: body['expectedAmount'] as never } : {}),
      ...(body['expectedMin'] ? { expectedMin: body['expectedMin'] as never } : {}),
      ...(body['expectedMax'] ? { expectedMax: body['expectedMax'] as never } : {}),
      ...(str(body, 'dueDate') ? { dueDate: str(body, 'dueDate') as string } : {}),
    });
  }

  @Post('workspaces/:workspaceId/recurring/occurrences/:occurrenceId/materialize')
  @HttpCode(201)
  async materializeRecurringOccurrence(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: Json,
  ) {
    return this.occurrences.materialize({
      workspaceId,
      userId: userIdOf(req),
      occurrenceId,
      amount: (body['amount'] as never) ?? null,
      businessDate: str(body, 'businessDate') ?? null,
      status: (str(body, 'status') as 'PENDING' | 'POSTED' | undefined) ?? null,
    });
  }

  @Post('workspaces/:workspaceId/recurring/occurrences/:occurrenceId/skip')
  @HttpCode(200)
  skipRecurringOccurrence(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: Json,
  ) {
    return this.occurrences.skip({
      workspaceId,
      userId: userIdOf(req),
      occurrenceId,
      reason: str(body, 'reason') ?? null,
    });
  }

  @Post('workspaces/:workspaceId/recurring/occurrences/:occurrenceId/link')
  @HttpCode(200)
  async linkRecurringOccurrence(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: Json,
  ) {
    try {
      return await this.occurrences.link({
        workspaceId,
        userId: userIdOf(req),
        occurrenceId,
        transactionId: str(body, 'transactionId') ?? '',
      });
    } catch (err) {
      // `details.reasons` (ACCOUNT, KIND, CURRENCY, VOIDED) viaja como extensión del problem (RFC 9457).
      if (isDomainError(err) && err.code === 'OCCURRENCE_LINK_MISMATCH') {
        throw new ApiProblem('OCCURRENCE_LINK_MISMATCH', err.message, {
          fields: err.violations.map((v) => ({
            pointer: v.pointer,
            code: v.code,
            detail: v.detail ?? err.message,
          })),
          extensions: { details: { reasons: err.details['reasons'] } },
          cause: err,
        });
      }
      throw err;
    }
  }

  @Get('workspaces/:workspaceId/recurring/occurrences/:occurrenceId/lifecycle')
  getRecurringOccurrenceLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') occurrenceId: string,
  ) {
    return this.queries.occurrenceLifecycle({ userId: userIdOf(req), workspaceId, occurrenceId });
  }

  // ───────────────────────────────────────────── una definición

  @Get('workspaces/:workspaceId/recurring/:definitionId')
  getRecurringDefinition(
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.queries.getDefinition(workspaceId, definitionId);
  }

  @Patch('workspaces/:workspaceId/recurring/:definitionId')
  updateRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.definitions.updateDetails({
      workspaceId,
      userId: userIdOf(req),
      definitionId,
      expectedVersion: expected,
      ...(body['name'] !== undefined ? { name: str(body, 'name') as string } : {}),
      ...('description' in body ? { description: (body['description'] as string | null) ?? null } : {}),
      ...('notes' in body ? { notes: (body['notes'] as string | null) ?? null } : {}),
      ...(body['matching'] !== undefined
        ? {
            matching: body['matching'] as {
              amountTolerancePercent?: string | null;
              dateWindowDays?: number | null;
            },
          }
        : {}),
    });
  }

  @Post('workspaces/:workspaceId/recurring/:definitionId/revisions')
  @HttpCode(200)
  reviseRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.definitions.revise({
      workspaceId,
      userId: userIdOf(req),
      definitionId,
      expectedVersion: expected,
      effectiveFrom: str(body, 'effectiveFrom') ?? '',
      changes: (body['changes'] as TemplateChanges | undefined) ?? {},
    });
  }

  @Post('workspaces/:workspaceId/recurring/:definitionId/pause')
  @HttpCode(200)
  pauseRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.definitions.pause({
      workspaceId,
      userId: userIdOf(req),
      definitionId,
      expectedVersion: expected,
    });
  }

  @Post('workspaces/:workspaceId/recurring/:definitionId/resume')
  @HttpCode(200)
  resumeRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.definitions.resume({
      workspaceId,
      userId: userIdOf(req),
      definitionId,
      expectedVersion: expected,
    });
  }

  @Post('workspaces/:workspaceId/recurring/:definitionId/end')
  @HttpCode(200)
  endRecurringDefinition(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.definitions.end({
      workspaceId,
      userId: userIdOf(req),
      definitionId,
      expectedVersion: expected,
      endDate: str(body, 'endDate'),
    });
  }

  @Get('workspaces/:workspaceId/recurring/:definitionId/occurrences')
  listDefinitionOccurrences(
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
    @ValidatedQuery() query: Json,
  ) {
    return this.occurrencePage(workspaceId, query, definitionId);
  }

  @Get('workspaces/:workspaceId/recurring/:definitionId/lifecycle')
  getRecurringDefinitionLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') definitionId: string,
  ) {
    return this.queries.definitionLifecycle({ userId: userIdOf(req), workspaceId, definitionId });
  }

  private async occurrencePage(workspaceId: string, query: Json, definitionId: string | undefined) {
    const limit = limitOf(query);
    const statuses = list(query, 'status')?.filter((s): s is OccurrenceStatus =>
      (OCCURRENCE_STATUSES as readonly string[]).includes(s),
    );
    const days = query['days'] !== undefined ? Number(query['days']) : undefined;
    const requiresApproval =
      query['requiresApproval'] === undefined ? undefined : String(query['requiresApproval']) === 'true';
    const filters = {
      definitionId: definitionId ?? null,
      from: str(query, 'from') ?? null,
      to: str(query, 'to') ?? null,
      status: statuses ?? null,
      days: days ?? null,
      requiresApproval: requiresApproval ?? null,
    };
    const scope = { resource: 'recurring-occurrences', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let after: readonly [string, string] | undefined;
    if (cursor !== undefined) {
      const position = this.options.cursors.decode(cursor, scope);
      if (typeof position[0] !== 'string' || typeof position[1] !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = [position[0], position[1]];
    }
    const found = await this.queries.listOccurrences(workspaceId, {
      definitionId,
      from: filters.from ?? undefined,
      to: filters.to ?? undefined,
      statuses,
      requiresApproval,
      days,
      limit,
      after,
    });
    const page = buildPage(
      found,
      limit,
      (o) => [o.dueDate, o.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }
}
