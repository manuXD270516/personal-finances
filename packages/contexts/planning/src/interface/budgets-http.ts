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
  Req,
  Res,
} from '@nestjs/common';
import type { AuditLogEntryDto } from '@pf/audit/contracts';
import { ApiProblem, DEFAULT_PAGE_LIMIT, buildPage } from '@pf/platform/api';
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
import type { BudgetQueries } from '../application/budget.queries.js';
import type { BudgetsService } from '../application/budgets.service.js';
import type { BudgetLineInput } from '../domain/index.js';

export const BUDGETS_SERVICE = Symbol('BUDGETS_SERVICE');
export const BUDGET_QUERIES = Symbol('BUDGET_QUERIES');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;

/** Por defecto 24 planes (dos años); 1..100. */
const BUDGET_PAGE_DEFAULT = 24;
const BUDGET_PAGE_MAX = 100;

function limitOf(q: Json, fallback = BUDGET_PAGE_DEFAULT): number {
  const raw = Number(q['limit'] ?? fallback);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), BUDGET_PAGE_MAX) : DEFAULT_PAGE_LIMIT;
}

const userIdOf = (req: ApiRequest): string => {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
};

const LINE_FIELDS = [
  'kind',
  'planned',
  'min',
  'max',
  'percent',
  'incomeBasis',
  'rolloverPolicy',
  'rolloverCap',
  'thresholds',
] as const;

/** Campos de la línea presentes en el cuerpo (un `null` explícito se conserva: quita el valor). */
function lineFields(body: Json): BudgetLineInput {
  const out: Record<string, unknown> = {};
  for (const key of LINE_FIELDS) if (key in body) out[key] = body[key];
  return out as BudgetLineInput;
}

const auditEntryDto = (e: AuditLogEntryDto) => ({ ...e, changes: [...e.changes] });

/**
 * `/api/v1/workspaces/{workspaceId}/budgets*` y `/periods/{periodId}/budget` (openspec add-budgets § Contratos, tarea
 * 5.1). Autenticación y `x-required-role` (VIEWER lee; EDITOR escribe) los aplica el guard global de IDENTITY;
 * validación de contrato, Problem Details, ETag/If-Match e `Idempotency-Key` (en la transacción del comando), las
 * convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class BudgetsController {
  constructor(
    @Inject(BUDGETS_SERVICE) private readonly service: BudgetsService,
    @Inject(BUDGET_QUERIES) private readonly queries: BudgetQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  /** `listBudgets`: planes con su resumen, del periodo más reciente al más antiguo. */
  @Get('workspaces/:workspaceId/budgets')
  async listBudgets(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const periodFrom = str(query, 'periodFrom');
    const periodTo = str(query, 'periodTo');
    const limit = limitOf(query);
    const scope = {
      resource: 'budgets',
      workspaceId,
      filters: { periodFrom: periodFrom ?? null, periodTo: periodTo ?? null },
    };
    const all = await this.queries.listBudgets(workspaceId, { periodFrom, periodTo });
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const rows = all.slice(offset, offset + limit + 1).map((b, i) => ({ b, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => r.b), page: page.page };
  }

  /** `createBudget` (EDITOR, `Idempotency-Key`): `BUDGET_ALREADY_EXISTS` / `PERIOD_CLOSED` => 409. */
  @Post('workspaces/:workspaceId/budgets')
  @HttpCode(201)
  async createBudget(
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const periodId = str(body, 'periodId');
    if (periodId === undefined)
      throw new DomainError('VALIDATION_FAILED', 'periodId is required').at('/periodId');
    const budget = await this.service.createBudget({
      workspaceId,
      periodId,
      source: (body['source'] ?? undefined) as { kind?: unknown } | undefined,
      zeroBased: typeof body['zeroBased'] === 'boolean' ? body['zeroBased'] : undefined,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/budgets/${budget.id}`);
    return budget;
  }

  @Get('workspaces/:workspaceId/budgets/:budgetId')
  getBudget(@Param('workspaceId') workspaceId: string, @Param('budgetId') budgetId: string) {
    return this.queries.getBudget(workspaceId, budgetId);
  }

  /** `updateBudget` (EDITOR, `If-Match`): modo base cero. */
  @Patch('workspaces/:workspaceId/budgets/:budgetId')
  updateBudget(
    @Param('workspaceId') workspaceId: string,
    @Param('budgetId') budgetId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    if (typeof body['zeroBased'] !== 'boolean') {
      throw new DomainError('VALIDATION_FAILED', 'zeroBased is required').at('/zeroBased');
    }
    return this.service.setZeroBased({
      workspaceId,
      budgetId,
      zeroBased: body['zeroBased'],
      expectedVersion: expected,
    });
  }

  @Get('workspaces/:workspaceId/periods/:periodId/budget')
  getBudgetByPeriod(@Param('workspaceId') workspaceId: string, @Param('periodId') periodId: string) {
    return this.queries.getBudgetByPeriod(workspaceId, periodId);
  }

  /** `getBudgetHistory`: auditoría del plan y de sus líneas (VIEWER+, como el historial de una transacción). */
  @Get('workspaces/:workspaceId/budgets/:budgetId/history')
  async getBudgetHistory(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('budgetId') budgetId: string,
    @ValidatedQuery() query: Json,
  ) {
    const limit = limitOf(query, DEFAULT_PAGE_LIMIT);
    const scope = { resource: 'budget-history', workspaceId, filters: { budgetId } };
    const cursor = str(query, 'cursor');
    let after: { occurredAt: string; id: string } | undefined;
    if (cursor !== undefined) {
      const [occurredAt, id] = this.options.cursors.decode(cursor, scope);
      if (typeof occurredAt !== 'string' || typeof id !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = { occurredAt, id };
    }
    const rows = await this.queries.history({
      userId: userIdOf(req),
      workspaceId,
      budgetId,
      ...(after ? { after } : {}),
      limit: limit + 1,
    });
    const page = buildPage(
      [...rows],
      limit,
      (r) => [r.occurredAt, r.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map(auditEntryDto), page: page.page };
  }

  /** `addBudgetLine` (EDITOR, `Idempotency-Key`). */
  @Post('workspaces/:workspaceId/budgets/:budgetId/lines')
  @HttpCode(201)
  async addBudgetLine(
    @Param('workspaceId') workspaceId: string,
    @Param('budgetId') budgetId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const line = await this.service.addLine({
      workspaceId,
      budgetId,
      target: body['target'],
      spec: lineFields(body),
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/budgets/${budgetId}/lines/${line.id}`);
    return line;
  }

  /** `updateBudgetLine` (EDITOR, `If-Match` = versión de la línea). */
  @Patch('workspaces/:workspaceId/budgets/:budgetId/lines/:lineId')
  updateBudgetLine(
    @Param('workspaceId') workspaceId: string,
    @Param('budgetId') budgetId: string,
    @Param('lineId') lineId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return this.service.updateLine({
      workspaceId,
      budgetId,
      lineId,
      expectedVersion: expected,
      patch: lineFields(body),
    });
  }

  @Delete('workspaces/:workspaceId/budgets/:budgetId/lines/:lineId')
  @HttpCode(204)
  async removeBudgetLine(
    @Param('workspaceId') workspaceId: string,
    @Param('budgetId') budgetId: string,
    @Param('lineId') lineId: string,
  ): Promise<void> {
    await this.service.removeLine({ workspaceId, budgetId, lineId });
  }
}
