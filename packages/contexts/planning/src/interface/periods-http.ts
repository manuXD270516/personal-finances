import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  type ApiConventionsOptions,
} from '@pf/platform/nest';
import { DomainError } from '@pf/shared-kernel';
import type { PeriodQueries } from '../application/period.queries.js';
import type { PeriodsService } from '../application/periods.service.js';
import type { FinancialPeriodDto, FinancialPeriodStatusDto } from '../contracts/index.js';

export const PERIODS_SERVICE = Symbol('PERIODS_SERVICE');
export const PERIOD_QUERIES = Symbol('PERIOD_QUERIES');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;
const list = (q: Json, k: string): string[] | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map(String);
};

/** Por defecto 24 periodos (dos años); 1..100 (design.md § Contratos). */
const PERIOD_PAGE_DEFAULT = 24;
const PERIOD_PAGE_MAX = 100;

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? PERIOD_PAGE_DEFAULT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), PERIOD_PAGE_MAX) : DEFAULT_PAGE_LIMIT;
}

/**
 * `/api/v1/workspaces/{workspaceId}/periods*` (openspec add-financial-periods § Contratos, tarea 5.1). Autenticación y
 * `x-required-role` (VIEWER lee; EDITOR crea/activa) los aplica el guard global de IDENTITY; validación de contrato,
 * Problem Details, ETag/If-Match e `Idempotency-Key` opcional, las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class PeriodsController {
  constructor(
    @Inject(PERIODS_SERVICE) private readonly service: PeriodsService,
    @Inject(PERIOD_QUERIES) private readonly queries: PeriodQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  /** `listPeriods`: por `periodStart` descendente; `containsDate` (excluyente con `status`) ⇒ el periodo o 404. */
  @Get('workspaces/:workspaceId/periods')
  async listPeriods(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const statuses = list(query, 'status') as FinancialPeriodStatusDto[] | undefined;
    const containsDate = str(query, 'containsDate');
    const limit = limitOf(query);
    if (containsDate !== undefined && statuses !== undefined) {
      throw new DomainError('VALIDATION_FAILED', 'containsDate and status are mutually exclusive').at(
        '/containsDate',
      );
    }
    let periods: readonly FinancialPeriodDto[];
    const filters = { status: statuses ?? null, containsDate: containsDate ?? null };
    if (containsDate !== undefined) {
      periods = [await this.queries.periodContaining(workspaceId, containsDate)];
    } else {
      periods = [
        ...(await this.queries.listPeriods({ workspaceId, ...(statuses ? { statuses } : {}) })),
      ].reverse();
    }
    const scope = { resource: 'periods', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const rows = periods.slice(offset, offset + limit + 1).map((p, i) => ({ p, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => r.p), page: page.page };
  }

  /** `ensurePeriods` (EDITOR): idempotente por naturaleza; `through` ≤ hoy + 24 meses. */
  @Post('workspaces/:workspaceId/periods')
  @HttpCode(200)
  async ensurePeriods(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    const through = str(body, 'through') ?? '';
    const result = await this.service.ensurePeriods({ workspaceId, through });
    return { data: result.periods };
  }

  @Get('workspaces/:workspaceId/periods/:periodId')
  async getPeriod(@Param('workspaceId') workspaceId: string, @Param('periodId') periodId: string) {
    return this.queries.period(workspaceId, periodId);
  }

  /** `activatePeriod` (EDITOR, `If-Match` obligatorio): `PERIOD_NOT_STARTED` / `INVALID_STATUS_TRANSITION` ⇒ 409. */
  @Post('workspaces/:workspaceId/periods/:periodId/activate')
  @HttpCode(200)
  async activatePeriod(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.activatePeriod({ workspaceId, periodId, expectedVersion: expected });
  }
}
