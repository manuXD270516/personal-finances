import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import {
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { isDomainError } from '@pf/shared-kernel';
import type { GoalStatus } from '../domain/index.js';
import { GOAL_STATUSES } from '../domain/index.js';
import type { GoalsQueries } from '../application/goals.queries.js';
import type { GoalsService } from '../application/goals.service.js';
import type { MovementsService, WithdrawMode } from '../application/movements.service.js';
import type { PlanService } from '../application/plan.service.js';
import { movementView } from '../application/views.js';
import type { SuggestionStatus } from '../application/ports/index.js';

export const GOALS_SERVICE = Symbol('GOALS_SERVICE');
export const GOALS_MOVEMENTS_SERVICE = Symbol('GOALS_MOVEMENTS_SERVICE');
export const GOALS_PLAN_SERVICE = Symbol('GOALS_PLAN_SERVICE');
export const GOALS_QUERIES = Symbol('GOALS_QUERIES');

type Json = Record<string, unknown>;
type MoneyBody = { amount: string; currency: string };

const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
/** Parámetro de lista (`explode: false`): el contrato lo entrega como arreglo; también acepta texto separado por comas. */
const csv = (b: Json, k: string): string[] | undefined => {
  const v = b[k];
  const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : undefined;
  return raw?.map((x) => x.trim()).filter((x) => x !== '');
};
const money = (b: Json, k: string): MoneyBody | undefined =>
  b[k] && typeof b[k] === 'object' ? (b[k] as MoneyBody) : undefined;

/** Los `details` de un error de dominio de metas viajan como extensión `details` del problem (RFC 9457). */
async function withDetails<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isDomainError(err) && err.details && Object.keys(err.details).length > 0) {
      throw new ApiProblem(err.code as never, err.message, {
        extensions: { details: err.details },
        cause: err,
      });
    }
    throw err;
  }
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

const body = (b: unknown): Json => (b && typeof b === 'object' ? (b as Json) : {});

/** `/api/v1/workspaces/{workspaceId}/goals*` (openspec add-savings-goals § Contratos). */
@Controller()
export class GoalsController {
  constructor(
    @Inject(GOALS_SERVICE) private readonly goals: GoalsService,
    @Inject(GOALS_MOVEMENTS_SERVICE) private readonly movements: MovementsService,
    @Inject(GOALS_PLAN_SERVICE) private readonly plans: PlanService,
    @Inject(GOALS_QUERIES) private readonly queries: GoalsQueries,
  ) {}

  // ───────────────────────────────────────────── metas

  @Get('workspaces/:workspaceId/goals')
  async listGoals(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const raw = csv(query, 'status');
    const statuses = raw
      ? raw.map((s) => {
          if (!(GOAL_STATUSES as readonly string[]).includes(s)) {
            throw new ApiProblem('VALIDATION_FAILED', 'unknown status');
          }
          return s as GoalStatus;
        })
      : undefined;
    const type = str(query, 'type');
    return this.queries.list(workspaceId, {
      ...(statuses ? { statuses } : {}),
      ...(type ? { type } : {}),
      includeArchived: str(query, 'includeArchived') === 'true',
    });
  }

  @Post('workspaces/:workspaceId/goals')
  @HttpCode(201)
  async createGoal(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const b = body(raw);
    const created = await withDetails(() =>
      this.goals.create({
        workspaceId,
        userId: userIdOf(req),
        name: b['name'] as string,
        type: b['type'] as string,
        target: b['target'] as MoneyBody,
        startDate: str(b, 'startDate'),
        targetDate: b['targetDate'] as string | null | undefined,
        linkedAccountIds: b['linkedAccountIds'] as string[] | undefined,
        priority: b['priority'] as number | undefined,
        icon: b['icon'] as string | null | undefined,
        color: b['color'] as string | null | undefined,
        notes: b['notes'] as string | null | undefined,
        tolerancePercent: str(b, 'tolerancePercent'),
        pacePeriods: b['pacePeriods'] as number | undefined,
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/goals/${created.id}`);
    return this.queries.get(workspaceId, created.id);
  }

  // Rutas literales antes de `:goalId`.
  @Get('workspaces/:workspaceId/goals/reservations')
  async reservations(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    return {
      data: await this.queries.reservations(workspaceId, { accountId: str(query, 'accountId') as string }),
    };
  }

  @Get('workspaces/:workspaceId/goals/contribution-suggestions')
  suggestions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const status = str(query, 'status');
    if (status && !['PENDING', 'CONFIRMED', 'DISMISSED', 'EXPIRED'].includes(status)) {
      throw new ApiProblem('VALIDATION_FAILED', 'unknown status');
    }
    return this.queries.suggestions(workspaceId, status as SuggestionStatus | undefined);
  }

  @Post('workspaces/:workspaceId/goals/contribution-suggestions/:suggestionId/confirm')
  @HttpCode(200)
  async confirmSuggestion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() raw: unknown,
  ) {
    const row = await withDetails(() =>
      this.movements.confirmSuggestion({
        workspaceId,
        userId: userIdOf(req),
        suggestionId,
        goalId: str(body(raw), 'goalId'),
      }),
    );
    return movementView(row);
  }

  @Post('workspaces/:workspaceId/goals/contribution-suggestions/:suggestionId/dismiss')
  @HttpCode(200)
  async dismissSuggestion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    const s = await this.movements.dismissSuggestion({ workspaceId, userId: userIdOf(req), suggestionId });
    return {
      id: s.id,
      transactionId: s.transactionId,
      transactionRevision: s.transactionRevision,
      accountId: s.accountId,
      amount: { amount: s.amount.toFixed(), currency: s.amount.currency.code },
      businessDate: s.businessDate,
      goalId: s.goalId,
      status: s.status,
      decidedAt: s.decidedAt,
      movementId: s.movementId,
      createdAt: s.createdAt,
    };
  }

  @Get('workspaces/:workspaceId/goals/transaction-links')
  async transactionLinks(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const ids = csv(query, 'transactionIds') ?? [];
    return { data: await this.queries.transactionLinks(workspaceId, ids) };
  }

  @Get('workspaces/:workspaceId/goals/:goalId')
  getGoal(@Param('workspaceId') workspaceId: string, @Param('goalId') goalId: string) {
    return this.queries.get(workspaceId, goalId);
  }

  @Patch('workspaces/:workspaceId/goals/:goalId')
  async updateGoal(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    await withDetails(() =>
      this.goals.update({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        expectedVersion,
        name: str(b, 'name'),
        type: str(b, 'type'),
        target: b['target'] as { amount: string; currency?: string } | undefined,
        targetDate: b['targetDate'] as string | null | undefined,
        linkedAccountIds: b['linkedAccountIds'] as string[] | undefined,
        priority: b['priority'] as number | undefined,
        icon: b['icon'] as string | null | undefined,
        color: b['color'] as string | null | undefined,
        notes: b['notes'] as string | null | undefined,
        tolerancePercent: str(b, 'tolerancePercent'),
        pacePeriods: b['pacePeriods'] as number | undefined,
      }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/pause')
  @HttpCode(200)
  async pause(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await withDetails(() =>
      this.goals.pause({ workspaceId, userId: userIdOf(req), goalId, expectedVersion }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/resume')
  @HttpCode(200)
  async resume(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await withDetails(() =>
      this.goals.resume({ workspaceId, userId: userIdOf(req), goalId, expectedVersion }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/close')
  @HttpCode(200)
  async close(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await withDetails(() =>
      this.goals.close({ workspaceId, userId: userIdOf(req), goalId, expectedVersion }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() raw: unknown,
  ) {
    await withDetails(() =>
      this.goals.cancel({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        expectedVersion,
        reason: str(body(raw), 'reason') ?? null,
      }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/archive')
  @HttpCode(200)
  async archive(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await withDetails(() =>
      this.goals.archive({ workspaceId, userId: userIdOf(req), goalId, expectedVersion }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  // ───────────────────────────────────────────── movimientos

  @Get('workspaces/:workspaceId/goals/:goalId/movements')
  listMovements(
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ValidatedQuery() query: Json,
  ) {
    const limit = str(query, 'limit');
    return this.queries.movements(workspaceId, goalId, {
      ...(str(query, 'from') ? { from: str(query, 'from') as string } : {}),
      ...(str(query, 'to') ? { to: str(query, 'to') as string } : {}),
      ...(str(query, 'cursor') ? { cursor: str(query, 'cursor') as string } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    });
  }

  @Post('workspaces/:workspaceId/goals/:goalId/contributions')
  @HttpCode(201)
  async contribute(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    const row = await withDetails(() =>
      this.movements.contribute({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        fund: b['fund'] as 'REAL' | 'EARMARK',
        amount: money(b, 'amount') as MoneyBody,
        businessDate: str(b, 'businessDate'),
        sourceAccountId: str(b, 'sourceAccountId') as string,
        destinationAccountId: str(b, 'destinationAccountId'),
        note: b['note'] as string | null | undefined,
      }),
    );
    return movementView(row);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/contributions/link')
  @HttpCode(201)
  async link(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @Body() raw: unknown,
  ) {
    const row = await withDetails(() =>
      this.movements.link({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        transactionId: str(body(raw), 'transactionId') as string,
      }),
    );
    return movementView(row);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/withdrawals')
  @HttpCode(201)
  async withdraw(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    const row = await withDetails(() =>
      this.movements.withdraw({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        fund: b['fund'] as 'REAL' | 'EARMARK',
        accountId: str(b, 'accountId') as string,
        amount: money(b, 'amount') as MoneyBody,
        mode: b['mode'] as WithdrawMode,
        reason: b['reason'] as string | null | undefined,
      }),
    );
    return movementView(row);
  }

  @Post('workspaces/:workspaceId/goals/:goalId/reassignments')
  @HttpCode(201)
  async reassign(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    const out = await withDetails(() =>
      this.movements.reassign({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        targetGoalId: str(b, 'targetGoalId') as string,
        fund: b['fund'] as 'REAL' | 'EARMARK',
        accountId: str(b, 'accountId') as string,
        amount: money(b, 'amount') as MoneyBody,
        reason: b['reason'] as string | null | undefined,
      }),
    );
    return {
      reassignmentId: out.reassignmentId,
      source: movementView(out.source),
      target: movementView(out.target),
    };
  }

  @Post('workspaces/:workspaceId/goals/:goalId/simulations')
  @HttpCode(200)
  simulate(@Param('workspaceId') workspaceId: string, @Param('goalId') goalId: string, @Body() raw: unknown) {
    const b = body(raw);
    return withDetails(() =>
      this.queries.simulate(workspaceId, goalId, {
        monthlyContribution: money(b, 'monthlyContribution'),
        targetAmount: money(b, 'targetAmount'),
        targetDate: b['targetDate'] as string | null | undefined,
      }),
    );
  }

  // ───────────────────────────────────────────── plan

  @Put('workspaces/:workspaceId/goals/:goalId/plan')
  @HttpCode(200)
  async setPlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() raw: unknown,
  ) {
    const b = body(raw);
    await withDetails(() =>
      this.plans.set({
        workspaceId,
        userId: userIdOf(req),
        goalId,
        expectedVersion,
        monthlyAmount: money(b, 'monthlyAmount') as MoneyBody,
        fund: b['fund'] as 'REAL' | 'EARMARK',
        sourceAccountId: b['sourceAccountId'] as string | null | undefined,
        destinationAccountId: b['destinationAccountId'] as string | null | undefined,
        dayOfMonth: b['dayOfMonth'] as number | null | undefined,
        automation: (b['automation'] ?? 'NONE') as 'NONE' | 'RECURRING',
        materialization: b['materialization'] as never,
      }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  @Delete('workspaces/:workspaceId/goals/:goalId/plan')
  @HttpCode(200)
  async removePlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await withDetails(() =>
      this.plans.remove({ workspaceId, userId: userIdOf(req), goalId, expectedVersion }),
    );
    return this.queries.get(workspaceId, goalId);
  }

  // ───────────────────────────────────────────── recorrido

  @Get('workspaces/:workspaceId/goals/:goalId/lifecycle')
  lifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, goalId });
  }
}
