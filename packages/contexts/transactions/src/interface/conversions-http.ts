import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiProblem, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage } from '@pf/platform/api';
import {
  API_CONVENTIONS,
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiConventionsOptions,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type {
  ConversionFeeDto,
  ConversionFields,
  ConversionsService,
  ListConversionsQuery,
  RateDto,
} from '../application/conversions.service.js';
import type { MoneyDto } from '../application/transactions.service.js';
import { conversionDetailDto, rateDto } from './conversion-dto.js';
import { toTransactionDto } from './transactions-http.js';

export const CONVERSIONS_SERVICE = Symbol('CONVERSIONS_SERVICE');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

function limitOf(q: Json): number {
  const raw = Number(q['limit'] ?? DEFAULT_PAGE_LIMIT);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
}

function userIdOf(req: ApiRequest): string {
  const principal = principalOf(req);
  if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
  return principal.userId;
}

/** Cuerpo común de `ConversionCreate` / `ConversionAmend` (ya validado contra el contrato). */
function fieldsOf(body: Json): ConversionFields {
  const provider = body['provider'] as { counterpartyId?: string; name?: string } | undefined;
  return {
    transactionDate: str(body, 'transactionDate') ?? '',
    sourceAccountId: str(body, 'sourceAccountId') ?? '',
    targetAccountId: str(body, 'targetAccountId') ?? '',
    sourceAmount: body['sourceAmount'] as MoneyDto,
    targetAmount: body['targetAmount'] as MoneyDto,
    quotedRate: (body['quotedRate'] as RateDto | undefined) ?? null,
    referenceFxRateId: str(body, 'referenceFxRateId') ?? null,
    fees: (body['fees'] as ConversionFeeDto[] | undefined) ?? [],
    provider: provider
      ? { counterpartyId: provider.counterpartyId ?? null, name: provider.name ?? null }
      : null,
    executedAt: str(body, 'executedAt') ?? '',
    externalRef: str(body, 'externalRef') ?? null,
    ...('description' in body ? { description: str(body, 'description') ?? null } : {}),
    ...('notes' in body ? { notes: str(body, 'notes') ?? null } : {}),
  };
}

/**
 * `/api/v1/workspaces/{workspaceId}/conversions*` (add-manual-conversions design.md § Contratos): la conversión es
 * un `Transaction` `kind=CONVERSION` con su `ConversionDetail` (y el costo total derivado). Autenticación, rol,
 * validación de contrato, Problem Details, ETag/If-Match e `Idempotency-Key` los aplican las convenciones globales.
 */
@Controller()
export class ConversionsController {
  constructor(
    @Inject(CONVERSIONS_SERVICE) private readonly service: ConversionsService,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/conversions')
  async listConversions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const limit = limitOf(query);
    const filters = {
      sourceCurrency: str(query, 'sourceCurrency') ?? null,
      targetCurrency: str(query, 'targetCurrency') ?? null,
      dateFrom: str(query, 'dateFrom') ?? null,
      dateTo: str(query, 'dateTo') ?? null,
      sort: str(query, 'sort') ?? '-transactionDate',
    };
    const scope = { resource: 'conversions', workspaceId, filters };
    const cursor = str(query, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      const [n] = this.options.cursors.decode(cursor, scope);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      offset = n;
    }
    const found = await this.service.listConversions({
      workspaceId,
      offset,
      limit: limit + 1,
      sort: filters.sort as NonNullable<ListConversionsQuery['sort']>,
      ...(filters.sourceCurrency ? { sourceCurrency: filters.sourceCurrency } : {}),
      ...(filters.targetCurrency ? { targetCurrency: filters.targetCurrency } : {}),
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    });
    const rows = found.map((s, i) => ({ s, at: offset + i + 1 }));
    const page = buildPage(
      rows,
      limit,
      (r) => [r.at],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data.map((r) => toTransactionDto(r.s)), page: page.page };
  }

  @Post('workspaces/:workspaceId/conversions')
  @HttpCode(201)
  async createConversion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const view = await this.service.recordConversion({
      workspaceId,
      userId: userIdOf(req),
      ...fieldsOf(body),
      ...(str(body, 'id') ? { id: str(body, 'id') as string } : {}),
      ...(body['status'] ? { status: body['status'] as 'PENDING' | 'POSTED' | 'CLEARED' } : {}),
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/conversions/${view.transaction.id}`);
    return toTransactionDto(view.transaction, view.totalCost);
  }

  @Post('workspaces/:workspaceId/conversions/preview')
  @HttpCode(200)
  async previewConversion(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    const p = await this.service.previewConversion({
      workspaceId,
      sourceCurrency: str(body, 'sourceCurrency') ?? '',
      targetCurrency: str(body, 'targetCurrency') ?? '',
      sourceAmount: (body['sourceAmount'] as MoneyDto | undefined) ?? null,
      targetAmount: (body['targetAmount'] as MoneyDto | undefined) ?? null,
      quotedRate: (body['quotedRate'] as RateDto | undefined) ?? null,
      fees: (body['fees'] as ConversionFeeDto[] | undefined) ?? [],
      executedAt: str(body, 'executedAt') ?? null,
      referenceFxRateId: str(body, 'referenceFxRateId') ?? null,
    });
    const quotedGiven = body['quotedRate'] !== undefined;
    return {
      sourceAmount: p.sourceAmount.toJSON(),
      convertedSourceAmount: p.convertedSourceAmount.toJSON(),
      grossTargetAmount: p.grossTargetAmount.toJSON(),
      targetAmount: p.targetAmount.toJSON(),
      effectiveRate: rateDto(p.effectiveRate),
      quotedRate: p.quotedRate ? rateDto(p.quotedRate, quotedGiven) : null,
      referenceRate: p.referenceRate
        ? {
            rate: rateDto(p.referenceRate.rate, true),
            fxRateId: p.referenceRate.fxRateId,
            source: p.referenceRate.source,
            ...(p.referenceRate.rateType ? { rateType: p.referenceRate.rateType } : {}),
            ...(p.referenceRate.asOf ? { asOf: p.referenceRate.asOf } : {}),
          }
        : null,
      spread: p.spread ? { percentage: p.spread.percentage, amount: p.spread.amount.toJSON() } : null,
      quotedRateDeviation: p.quotedRateDeviation?.toJSON() ?? null,
      totalCost: {
        amount: p.totalCost.amount,
        complete: p.totalCost.complete,
        missingValuations: [...p.totalCost.missingValuations],
      },
    };
  }

  @Get('workspaces/:workspaceId/conversions/:transactionId')
  async getConversion(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
  ) {
    const view = await this.service.getConversion(workspaceId, transactionId);
    return toTransactionDto(view.transaction, view.totalCost);
  }

  @Put('workspaces/:workspaceId/conversions/:transactionId')
  async amendConversion(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ) {
    const view = await this.service.amendConversion({
      workspaceId,
      userId: userIdOf(req),
      transactionId,
      expectedVersion: expected,
      ...fieldsOf(body),
      reason: str(body, 'reason') ?? null,
    });
    return toTransactionDto(view.transaction, view.totalCost);
  }

  @Get('workspaces/:workspaceId/conversions/:transactionId/revisions')
  async listConversionRevisions(
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') transactionId: string,
  ) {
    const revisions = await this.service.listRevisions(workspaceId, transactionId);
    return {
      data: revisions.map((r) => ({
        revision: r.revision,
        journalEntryId: r.journalEntryId,
        active: r.active,
        createdAt: r.createdAt ?? r.detail.executedAt,
        detail: conversionDetailDto(r.detail),
      })),
    };
  }
}
