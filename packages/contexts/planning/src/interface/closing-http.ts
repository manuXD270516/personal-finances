import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import {
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import { DomainError, isDomainError } from '@pf/shared-kernel';
import type { ClosingQueries } from '../application/closing.queries.js';
import type { ClosingService } from '../application/closing.service.js';

export const CLOSING_SERVICE = Symbol('CLOSING_SERVICE');
export const CLOSING_QUERIES = Symbol('CLOSING_QUERIES');

type Json = Record<string, unknown>;
const WS = 'workspaces/:workspaceId';

const userIdOf = (req: ApiRequest): string => {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
};

const closeNoOf = (value: unknown, pointer: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new DomainError('VALIDATION_FAILED', 'closeNo must be >= 1').at(pointer);
  return n;
};

/** Un periodo nunca cerrado responde 404 con `REFERENCE_NOT_FOUND` (spec "Reporte de cierre consultable"). */
function neverClosed(err: unknown): never {
  if (isDomainError(err) && err.code === 'REFERENCE_NOT_FOUND') {
    throw new ApiProblem('REFERENCE_NOT_FOUND', err.message, { status: 404 });
  }
  throw err;
}

/** Publica `blockingItems`/`warningItems` como extensión del problem+json (docs/10 §9; design.md § Contratos). */
function withItems(err: unknown): never {
  if (
    isDomainError(err) &&
    (err.code === 'MONTH_CLOSING_BLOCKED' || err.code === 'MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED')
  ) {
    const key = err.code === 'MONTH_CLOSING_BLOCKED' ? 'blockingItems' : 'warningItems';
    throw new ApiProblem(err.code as 'MONTH_CLOSING_BLOCKED', err.message, {
      extensions: { [key]: err.details[key] ?? [] },
    });
  }
  throw err;
}

/**
 * `/api/v1/workspaces/{workspaceId}/periods/{periodId}/close*`, snapshots, reporte y política de cierre (openspec
 * add-month-closing § Contratos, tareas 5.1, 5.2 y 5.4). Autenticación y `x-required-role` (VIEWER consulta; EDITOR
 * cierra; OWNER reabre y cambia la política) los aplica el guard global de IDENTITY; `If-Match`, `Idempotency-Key`
 * y Problem Details, las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class ClosingController {
  constructor(
    @Inject(CLOSING_SERVICE) private readonly service: ClosingService,
    @Inject(CLOSING_QUERIES) private readonly queries: ClosingQueries,
  ) {}

  @Get(`${WS}/periods/:periodId/close-checklist`)
  getCloseChecklist(@Param('workspaceId') workspaceId: string, @Param('periodId') periodId: string) {
    return this.service.getChecklist(workspaceId, periodId);
  }

  /** `closePeriod` (EDITOR, `If-Match` e `Idempotency-Key`): 200 con el periodo y `Location` del snapshot. */
  @Post(`${WS}/periods/:periodId/close`)
  @HttpCode(200)
  async closePeriod(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    if (body['acknowledgeWarnings'] !== undefined && typeof body['acknowledgeWarnings'] !== 'boolean') {
      throw new DomainError('VALIDATION_FAILED', 'acknowledgeWarnings must be boolean').at(
        '/acknowledgeWarnings',
      );
    }
    try {
      const period = await this.service.closePeriod({
        workspaceId,
        periodId,
        expectedVersion: expected,
        acknowledgeWarnings: body['acknowledgeWarnings'] === true,
        note: typeof body['note'] === 'string' ? body['note'] : null,
      });
      res.setHeader(
        'location',
        `/api/v1/workspaces/${workspaceId}/periods/${periodId}/close-snapshots/${period.latestCloseNo ?? ''}`,
      );
      return period;
    } catch (err) {
      return withItems(err);
    }
  }

  /** `reopenPeriod` (OWNER, `If-Match` e `Idempotency-Key`, motivo 1..500). */
  @Post(`${WS}/periods/:periodId/reopen`)
  @HttpCode(200)
  reopenPeriod(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
    return this.service.reopenPeriod({ workspaceId, periodId, expectedVersion: expected, reason });
  }

  @Get(`${WS}/periods/:periodId/close-snapshots`)
  async listCloseSnapshots(@Param('workspaceId') workspaceId: string, @Param('periodId') periodId: string) {
    return { items: await this.queries.listSnapshots(workspaceId, periodId) };
  }

  /** Antes de `:closeNo` para que `compare` no se interprete como versión. */
  @Get(`${WS}/periods/:periodId/close-snapshots/compare`)
  compareCloseSnapshots(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ValidatedQuery() query: Json,
  ) {
    const from = closeNoOf(query['from'], '/from');
    const to = closeNoOf(query['to'], '/to');
    if (from === undefined || to === undefined) {
      throw new DomainError('VALIDATION_FAILED', 'from and to are required').at(
        from === undefined ? '/from' : '/to',
      );
    }
    return this.queries.compare(workspaceId, periodId, from, to);
  }

  @Get(`${WS}/periods/:periodId/close-snapshots/:closeNo`)
  getCloseSnapshot(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @Param('closeNo') closeNo: string,
  ) {
    return this.queries.getSnapshot(workspaceId, periodId, closeNoOf(closeNo, '/closeNo') as number);
  }

  @Get(`${WS}/periods/:periodId/close-report`)
  async getCloseReport(
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ValidatedQuery() query: Json,
  ) {
    try {
      return await this.queries.report(workspaceId, periodId, closeNoOf(query['closeNo'], '/closeNo'));
    } catch (err) {
      return neverClosed(err);
    }
  }

  @Get(`${WS}/periods/:periodId/close-report/export`)
  async exportCloseReport(
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
    @ValidatedQuery() query: Json,
  ): Promise<StreamableFile> {
    const format = query['format'];
    if (format !== 'csv' && format !== 'pdf') {
      throw new DomainError('VALIDATION_FAILED', 'format must be csv or pdf').at('/format');
    }
    const closeNo = closeNoOf(query['closeNo'], '/closeNo');
    const file = await this.queries
      .exportReport({ workspaceId, periodId, format, ...(closeNo === undefined ? {} : { closeNo }) })
      .catch(neverClosed);
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(file.body, { length: file.body.byteLength });
  }

  @Get(`${WS}/periods/:periodId/lifecycle`)
  getPeriodLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, periodId });
  }

  @Get(`${WS}/planning/closing-policy`)
  getClosingPolicy(@Param('workspaceId') workspaceId: string) {
    return this.service.getPolicy(workspaceId);
  }

  /** `updateClosingPolicy` (OWNER, `If-Match`): auditado con la severidad anterior y la nueva. */
  @Put(`${WS}/planning/closing-policy`)
  updateClosingPolicy(
    @Param('workspaceId') workspaceId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const severities = body['severities'];
    if (typeof severities !== 'object' || severities === null || Array.isArray(severities)) {
      throw new DomainError('VALIDATION_FAILED', 'severities is required').at('/severities');
    }
    return this.service.updatePolicy({
      workspaceId,
      severities: severities as Json,
      expectedVersion: expected,
    });
  }
}
