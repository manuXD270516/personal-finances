import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
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
import type { MoneyDto } from '../contracts/index.js';
import type { SubscriptionChargesService } from '../application/subscription-charges.service.js';
import type { SubscriptionsQueries } from '../application/subscriptions.queries.js';
import type { BillingCycleInput, SubscriptionsService } from '../application/subscriptions.service.js';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../domain/index.js';

export const SUBSCRIPTIONS_SERVICE = Symbol('COMMITMENTS_SUBSCRIPTIONS_SERVICE');
export const SUBSCRIPTION_CHARGES_SERVICE = Symbol('COMMITMENTS_SUBSCRIPTION_CHARGES_SERVICE');
export const SUBSCRIPTIONS_QUERIES = Symbol('COMMITMENTS_SUBSCRIPTIONS_QUERIES');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;
const obj = (b: Json, k: string): Json | undefined =>
  typeof b[k] === 'object' && b[k] !== null && !Array.isArray(b[k]) ? (b[k] as Json) : undefined;
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

const moneyOf = (value: unknown): MoneyDto => value as MoneyDto;

function cycleOf(body: Json): BillingCycleInput | undefined {
  const cycle = obj(body, 'billingCycle');
  if (!cycle) return undefined;
  return {
    cadence: str(cycle, 'cadence') ?? '',
    ...(typeof cycle['interval'] === 'number' ? { interval: cycle['interval'] as number } : {}),
    ...(Array.isArray(cycle['monthDays']) ? { monthDays: cycle['monthDays'] as number[] } : {}),
    ...(typeof cycle['rrule'] === 'string' ? { rrule: cycle['rrule'] as string } : {}),
  };
}

function reminderOf(body: Json) {
  const reminder = obj(body, 'reminder');
  if (!reminder) return undefined;
  return {
    ...(typeof reminder['enabled'] === 'boolean' ? { enabled: reminder['enabled'] as boolean } : {}),
    ...(typeof reminder['daysBefore'] === 'number' ? { daysBefore: reminder['daysBefore'] as number } : {}),
  };
}

function materializationOf(body: Json) {
  const m = obj(body, 'materialization');
  if (!m) return undefined;
  return {
    ...(str(m, 'mode') ? { mode: str(m, 'mode') as string } : {}),
    ...('autoCreateStatus' in m
      ? { autoCreateStatus: (m['autoCreateStatus'] as string | null) ?? null }
      : {}),
    ...(typeof m['leadDays'] === 'number' ? { leadDays: m['leadDays'] as number } : {}),
  };
}

/**
 * `/api/v1/workspaces/{workspaceId}/subscriptions*` (openspec add-subscriptions § Contratos). Autenticación y
 * `x-required-role` (VIEWER lee; EDITOR escribe) los aplica el guard global de IDENTITY; validación de contrato,
 * Problem Details, ETag/If-Match e `Idempotency-Key`, las convenciones globales de `@pf/platform/nest`. Las rutas
 * estáticas (`cost-summary`) se declaran antes que `:subscriptionId`.
 */
@Controller()
export class SubscriptionsController {
  constructor(
    @Inject(SUBSCRIPTIONS_SERVICE) private readonly service: SubscriptionsService,
    @Inject(SUBSCRIPTION_CHARGES_SERVICE) private readonly charges: SubscriptionChargesService,
    @Inject(SUBSCRIPTIONS_QUERIES) private readonly queries: SubscriptionsQueries,
    @Inject(API_CONVENTIONS) private readonly options: ApiConventionsOptions,
  ) {}

  @Get('workspaces/:workspaceId/subscriptions')
  async listSubscriptions(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const statuses = list(query, 'status')?.filter((s): s is SubscriptionStatus =>
      (SUBSCRIPTION_STATUSES as readonly string[]).includes(s),
    );
    const counterpartyId = str(query, 'counterpartyId');
    const paymentAccountId = str(query, 'paymentAccountId');
    const limit = limitOf(query);
    const scope = {
      resource: 'subscriptions',
      workspaceId,
      filters: {
        status: statuses ?? null,
        counterpartyId: counterpartyId ?? null,
        paymentAccountId: paymentAccountId ?? null,
      },
    };
    const cursor = str(query, 'cursor');
    let after: readonly [string, string] | undefined;
    if (cursor !== undefined) {
      const position = this.options.cursors.decode(cursor, scope);
      if (typeof position[0] !== 'string' || typeof position[1] !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = [position[0], position[1]];
    }
    // `limit` filas más una: la extra solo indica que hay otra página (`buildPage`).
    const found = await this.queries.list(workspaceId, {
      statuses: statuses && statuses.length > 0 ? statuses : undefined,
      counterpartyId,
      paymentAccountId,
      limit: limit + 1,
      after,
    });
    const page = buildPage(
      found,
      limit,
      (s) => [s.nextRenewalOn ?? '9999-12-31', s.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }

  @Post('workspaces/:workspaceId/subscriptions')
  @HttpCode(201)
  async createSubscription(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await this.service.create({
      workspaceId,
      userId: userIdOf(req),
      counterpartyId: str(body, 'counterpartyId') ?? '',
      name: str(body, 'name') ?? '',
      planName: str(body, 'planName') ?? null,
      price: moneyOf(body['price']),
      billingCycle: cycleOf(body) ?? { cadence: '' },
      firstRenewalOn: str(body, 'firstRenewalOn') ?? '',
      paymentAccountId: str(body, 'paymentAccountId') ?? '',
      materialization: materializationOf(body),
      categoryId: str(body, 'categoryId') ?? null,
      trialEndsOn: str(body, 'trialEndsOn') ?? null,
      reminder: reminderOf(body),
      priceTolerancePercent: str(body, 'priceTolerancePercent'),
      cancellationUrl: str(body, 'cancellationUrl') ?? null,
    });
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/subscriptions/${created.id}`);
    return created;
  }

  @Get('workspaces/:workspaceId/subscriptions/cost-summary')
  getSubscriptionCostSummary(@Param('workspaceId') workspaceId: string) {
    return this.queries.costSummary(workspaceId);
  }

  @Get('workspaces/:workspaceId/subscriptions/:subscriptionId')
  getSubscription(
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.queries.get(workspaceId, subscriptionId);
  }

  @Patch('workspaces/:workspaceId/subscriptions/:subscriptionId')
  updateSubscription(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.update({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      ...(body['name'] !== undefined ? { name: str(body, 'name') as string } : {}),
      ...('planName' in body ? { planName: (body['planName'] as string | null) ?? null } : {}),
      ...('categoryId' in body ? { categoryId: (body['categoryId'] as string | null) ?? null } : {}),
      ...(body['materialization'] ? { materialization: materializationOf(body) } : {}),
      ...(body['reminder'] ? { reminder: reminderOf(body) } : {}),
      ...(str(body, 'priceTolerancePercent')
        ? { priceTolerancePercent: str(body, 'priceTolerancePercent') }
        : {}),
      ...('cancellationUrl' in body
        ? { cancellationUrl: (body['cancellationUrl'] as string | null) ?? null }
        : {}),
      ...(str(body, 'paymentAccountId') ? { paymentAccountId: str(body, 'paymentAccountId') } : {}),
      ...(body['billingCycle'] ? { billingCycle: cycleOf(body) } : {}),
      ...(str(body, 'effectiveFrom') ? { effectiveFrom: str(body, 'effectiveFrom') } : {}),
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/prices')
  @HttpCode(201)
  addSubscriptionPrice(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.changePrice({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      price: moneyOf(body['price']),
      effectiveFrom: str(body, 'effectiveFrom') ?? '',
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/prices/:priceId/supersede')
  @HttpCode(200)
  supersedeSubscriptionPrice(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('priceId') priceId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.supersedePrice({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      priceId,
      price: moneyOf(body['price']),
      reason: str(body, 'reason'),
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/price-proposals/:proposalId/accept')
  @HttpCode(200)
  acceptSubscriptionPriceProposal(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.acceptProposal({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      proposalId,
      effectiveFrom: str(body ?? {}, 'effectiveFrom'),
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/price-proposals/:proposalId/reject')
  @HttpCode(200)
  rejectSubscriptionPriceProposal(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('proposalId') proposalId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.rejectProposal({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      proposalId,
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/pause')
  @HttpCode(200)
  pauseSubscription(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.pause({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/resume')
  @HttpCode(200)
  resumeSubscription(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.resume({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/cancel')
  @HttpCode(200)
  cancelSubscription(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.cancel({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
      effectiveOn: str(body ?? {}, 'effectiveOn'),
      reason: str(body ?? {}, 'reason'),
    });
  }

  @Post('workspaces/:workspaceId/subscriptions/:subscriptionId/scheduled-cancellation/undo')
  @HttpCode(200)
  undoScheduledSubscriptionCancellation(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @ExpectedVersion() expected: number,
  ) {
    return this.service.undoScheduledCancellation({
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      expectedVersion: expected,
    });
  }

  @Get('workspaces/:workspaceId/subscriptions/:subscriptionId/charges')
  async listSubscriptionCharges(
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @ValidatedQuery() query: Json,
  ) {
    const limit = limitOf(query);
    const scope = { resource: 'subscription-charges', workspaceId, filters: { subscriptionId } };
    const cursor = str(query, 'cursor');
    let after: readonly [string, string] | undefined;
    if (cursor !== undefined) {
      const position = this.options.cursors.decode(cursor, scope);
      if (typeof position[0] !== 'string' || typeof position[1] !== 'string') {
        throw new ApiProblem('INVALID_CURSOR', 'cursor is invalid for this resource');
      }
      after = [position[0], position[1]];
    }
    const found = await this.queries.listCharges(workspaceId, subscriptionId, limit + 1, after);
    const page = buildPage(
      found,
      limit,
      (c) => [c.occurrenceDate, c.id],
      (position) => this.options.cursors.encode(scope, position),
    );
    return { data: page.data, page: page.page };
  }

  @Patch('workspaces/:workspaceId/subscriptions/:subscriptionId/charges/:chargeId')
  async updateSubscriptionCharge(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('chargeId') chargeId: string,
    @Body() body: Json,
    @ExpectedVersion() expected: number,
  ) {
    const updated = await this.charges.recordOriginalAmount({
      expectedVersion: expected,
      workspaceId,
      userId: userIdOf(req),
      subscriptionId,
      chargeId,
      amount: moneyOf(body['priceCurrencyAmount']),
    });
    const [charge] = (await this.queries.listCharges(workspaceId, subscriptionId, 500)).filter(
      (c) => c.id === updated.id,
    );
    return charge;
  }

  @Get('workspaces/:workspaceId/subscriptions/:subscriptionId/lifecycle')
  getSubscriptionLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, subscriptionId });
  }
}
