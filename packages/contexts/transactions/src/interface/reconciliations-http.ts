import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { isDomainError } from '@pf/shared-kernel';
import { ApiProblem, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type {
  ReconciliationLifecycleView,
  ReconciliationsService,
  ReconciliationView,
} from '../application/reconciliations.service.js';
import { limitOf, str, userIdOf, type Json } from './transactions-http.js';

export const RECONCILIATIONS_SERVICE = Symbol('RECONCILIATIONS_SERVICE');

/** `Reconciliation` del contrato OpenAPI (dinero como `{amount, currency}`; pasivos expresados como deuda positiva). */
export function toReconciliationDto(v: ReconciliationView) {
  const s = v.reconciliation;
  return {
    id: s.id,
    accountId: s.accountId,
    status: s.status,
    statementDate: s.statementDate,
    statementBalance: s.statementBalance.toJSON(),
    clearedBalance: v.clearedBalance?.toJSON() ?? null,
    difference: v.difference?.toJSON() ?? null,
    adjustmentTransactionId: s.adjustmentTransactionId,
    startedBy: s.startedBy,
    startedAt: s.startedAt ?? '1970-01-01T00:00:00.000Z',
    completedAt: s.completedAt,
    cancelledAt: s.cancelledAt,
    version: s.version,
    ...(v.items
      ? {
          items: v.items.map((i) => ({
            transactionId: i.transactionId,
            reconciledAt: i.reconciledAt,
            verifiedWithoutStatement: i.verifiedWithoutStatement,
            unreconciledAt: i.unreconciledAt,
            unreconcileReason: i.unreconcileReason,
          })),
        }
      : {}),
  };
}

/**
 * `/api/v1/workspaces/{workspaceId}/reconciliations*` y `…/accounts/{id}/reconciliation-status` (add-reconciliation
 * § Contratos). Autenticación y `x-required-role` los aplica el guard de IDENTITY; validación de contrato, Problem
 * Details, ETag/If-Match e `Idempotency-Key` las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class ReconciliationsController {
  constructor(
    @Inject(RECONCILIATIONS_SERVICE) private readonly service: ReconciliationsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/reconciliations')
  async listReconciliations(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filters = { accountId: str(query, 'accountId') ?? null, status: str(query, 'status') ?? null };
    const scope = { resource: 'reconciliations', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const found = await this.service.list({
      workspaceId,
      offset,
      limit: limit + 1,
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.status ? { status: filters.status as 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' } : {}),
    });
    const rows = found.map((v, i) => ({ v, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => toReconciliationDto(r.v)), page: page.page };
  }

  @Post('workspaces/:workspaceId/reconciliations')
  @HttpCode(201)
  async startReconciliation(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const view = await this.service.start({
      workspaceId,
      userId: userIdOf(req),
      accountId: str(body, 'accountId') ?? '',
      statementDate: str(body, 'statementDate') ?? '',
      statementBalance: str(body, 'statementBalance') ?? '',
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/reconciliations/${view.reconciliation.id}`);
    return toReconciliationDto(view);
  }

  @Get('workspaces/:workspaceId/reconciliations/:reconciliationId')
  async getReconciliation(
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') reconciliationId: string,
  ) {
    return toReconciliationDto(await this.service.get(workspaceId, reconciliationId));
  }

  @Post('workspaces/:workspaceId/reconciliations/:reconciliationId/cleared')
  @HttpCode(200)
  async toggleReconciliationCleared(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') reconciliationId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    return toReconciliationDto(
      await this.service.toggleCleared({
        workspaceId,
        userId: userIdOf(req),
        reconciliationId,
        expectedVersion: expected,
        items: (body['items'] as { id: string; version: number }[] | undefined) ?? [],
        cleared: body['cleared'] === true,
      }),
    );
  }

  /**
   * `completeReconciliation`: ante `RECONCILIATION_DIFFERENCE_NOT_ZERO` el problem lleva la extensión `difference`
   * (`Money`) para que la UI ofrezca el ajuste; ante `PERIOD_CLOSED` un `errors[]` por transacción incluida.
   */
  @Post('workspaces/:workspaceId/reconciliations/:reconciliationId/complete')
  @HttpCode(200)
  async completeReconciliation(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') reconciliationId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const adjustment = body['adjustment'] as { reason?: string } | undefined;
    try {
      return toReconciliationDto(
        await this.service.complete({
          workspaceId,
          userId: userIdOf(req),
          reconciliationId,
          expectedVersion: expected,
          ...(adjustment ? { adjustment: { reason: adjustment.reason ?? '' } } : {}),
        }),
      );
    } catch (err) {
      if (isDomainError(err) && err.code === 'RECONCILIATION_DIFFERENCE_NOT_ZERO') {
        throw new ApiProblem('RECONCILIATION_DIFFERENCE_NOT_ZERO', err.message, {
          extensions: { difference: err.details['difference'] },
          cause: err,
        });
      }
      throw err;
    }
  }

  @Post('workspaces/:workspaceId/reconciliations/:reconciliationId/cancel')
  @HttpCode(200)
  async cancelReconciliation(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') reconciliationId: string,
    @ExpectedVersion() expected: number,
  ) {
    return toReconciliationDto(
      await this.service.cancel({
        workspaceId,
        userId: userIdOf(req),
        reconciliationId,
        expectedVersion: expected,
      }),
    );
  }

  /** `getReconciliationLifecycle` (VIEWER+): recorrido de la sesión (START/COMPLETE/CANCEL + anotaciones). */
  @Get('workspaces/:workspaceId/reconciliations/:reconciliationId/lifecycle')
  async getReconciliationLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') reconciliationId: string,
  ) {
    const view = await this.service.lifecycle({ userId: userIdOf(req), workspaceId, reconciliationId });
    return lifecycleDto(view);
  }

  /** `getReconciliationStatus`: `ReconciliationStatusQuery.getCoverage` para una cuenta (`asOf` = corte). */
  @Get('workspaces/:workspaceId/accounts/:accountId/reconciliation-status')
  async getReconciliationStatus(
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') accountId: string,
    @ValidatedQuery() query: Json,
  ) {
    const from = str(query, 'from');
    return this.service.accountStatus({
      workspaceId,
      accountId,
      ...(str(query, 'asOf') ? { asOf: str(query, 'asOf') as string } : {}),
      ...(from ? { from } : {}),
    });
  }
}

/** Recorrido de la sesión + saldos de la sesión para mostrar extracto, saldo confirmado y diferencia por transición. */
function lifecycleDto(view: ReconciliationLifecycleView) {
  const r = view.reconciliation;
  return {
    ...view.lifecycle,
    reconciliation: {
      accountId: r.accountId,
      statementDate: r.statementDate,
      statementBalance: r.statementBalance.toJSON(),
      clearedBalance: r.clearedBalance?.toJSON() ?? null,
      difference: r.difference?.toJSON() ?? null,
      adjustmentTransactionId: r.adjustmentTransactionId,
    },
  };
}
