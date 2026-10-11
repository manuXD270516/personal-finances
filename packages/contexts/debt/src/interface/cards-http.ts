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
import type { CardsQueries } from '../application/cards.queries.js';
import type { CardsService, RegisterCardCommand } from '../application/cards.service.js';
import type { InstallmentsService } from '../application/installments.service.js';

export const CARDS_SERVICE = Symbol('DEBT_CARDS_SERVICE');
export const CARDS_QUERIES = Symbol('DEBT_CARDS_QUERIES');
export const INSTALLMENTS_SERVICE = Symbol('DEBT_INSTALLMENTS_SERVICE');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

/** Los `details` de un error de dominio viajan como extensión `details` del problem (`conflictingDefinitions[]`). */
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

/** `/api/v1/workspaces/{workspaceId}/credit-cards*` (openspec add-credit-cards § Contratos). */
@Controller()
export class CreditCardsController {
  constructor(
    @Inject(CARDS_SERVICE) private readonly cards: CardsService,
    @Inject(CARDS_QUERIES) private readonly queries: CardsQueries,
    @Inject(INSTALLMENTS_SERVICE) private readonly installments: InstallmentsService,
  ) {}

  @Get('workspaces/:workspaceId/credit-cards')
  async list(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const status = str(query, 'status');
    const accountId = str(query, 'accountId');
    return {
      data: await this.queries.list(workspaceId, {
        ...(status ? { status } : {}),
        ...(accountId ? { accountId } : {}),
      }),
    };
  }

  @Post('workspaces/:workspaceId/credit-cards')
  @HttpCode(201)
  async create(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await withDetails(() =>
      this.cards.register({
        ...(body as unknown as RegisterCardCommand),
        workspaceId,
        userId: userIdOf(req),
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/credit-cards/${created.id}`);
    const view = await this.queries.get(workspaceId, created.id);
    return created.conflicts && created.conflicts.length > 0
      ? { ...view, paymentPlanConflicts: created.conflicts }
      : view;
  }

  @Get('workspaces/:workspaceId/credit-cards/:cardId')
  get(@Param('workspaceId') workspaceId: string, @Param('cardId') cardId: string) {
    return this.queries.get(workspaceId, cardId);
  }

  @Patch('workspaces/:workspaceId/credit-cards/:cardId')
  async update(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    await withDetails(() =>
      this.cards.update({
        workspaceId,
        userId: userIdOf(req),
        cardId,
        expectedVersion,
        edit: body as never,
      }),
    );
    return this.queries.get(workspaceId, cardId);
  }

  @Post('workspaces/:workspaceId/credit-cards/:cardId/archive')
  @HttpCode(200)
  async archive(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    await this.cards.archive({ workspaceId, userId: userIdOf(req), cardId, expectedVersion });
    return this.queries.get(workspaceId, cardId);
  }

  // ───────────────────────────────────────────── estados de cuenta

  @Get('workspaces/:workspaceId/credit-cards/:cardId/statements')
  async listStatements(
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @ValidatedQuery() query: Json,
  ) {
    const accountId = str(query, 'accountId');
    const from = str(query, 'from');
    const to = str(query, 'to');
    return {
      data: await this.queries.listStatements(workspaceId, cardId, {
        ...(accountId ? { accountId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    };
  }

  @Get('workspaces/:workspaceId/credit-cards/:cardId/statements/:statementId')
  getStatement(
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Param('statementId') statementId: string,
  ) {
    return this.queries.getStatement(workspaceId, cardId, statementId);
  }

  @Patch('workspaces/:workspaceId/credit-cards/:cardId/statements/:statementId')
  async updateStatement(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Param('statementId') statementId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    await withDetails(() =>
      this.cards.recordReported({
        workspaceId,
        userId: userIdOf(req),
        cardId,
        statementId,
        expectedVersion,
        ...('reportedBilledBalance' in body ? { reportedBilledBalance: body['reportedBilledBalance'] } : {}),
        ...('reportedMinimumDue' in body ? { reportedMinimumDue: body['reportedMinimumDue'] } : {}),
      }),
    );
    return this.queries.getStatement(workspaceId, cardId, statementId);
  }

  // ───────────────────────────────────────────── plan de pago

  @Put('workspaces/:workspaceId/credit-cards/:cardId/accounts/:accountId/payment-plan')
  async enablePlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    return withDetails(() =>
      this.cards.enablePlan({
        workspaceId,
        userId: userIdOf(req),
        cardId,
        accountId,
        expectedVersion,
        request: body as never,
      }),
    );
  }

  @Delete('workspaces/:workspaceId/credit-cards/:cardId/accounts/:accountId/payment-plan')
  disablePlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Param('accountId') accountId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    return this.cards.disablePlan({ workspaceId, userId: userIdOf(req), cardId, accountId, expectedVersion });
  }

  // ───────────────────────────────────────────── cuotas

  @Get('workspaces/:workspaceId/credit-cards/:cardId/installment-plans')
  async listInstallmentPlans(@Param('workspaceId') workspaceId: string, @Param('cardId') cardId: string) {
    return { data: await this.queries.listInstallmentPlans(workspaceId, cardId) };
  }

  @Post('workspaces/:workspaceId/credit-cards/:cardId/installment-plans')
  @HttpCode(201)
  async createInstallmentPlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const plan = await withDetails(() =>
      this.installments.create({
        workspaceId,
        userId: userIdOf(req),
        cardId,
        purchaseTransactionId: body['purchaseTransactionId'],
        installmentCount: body['installmentCount'],
        ...('annualRate' in body ? { annualRate: body['annualRate'] } : {}),
        ...('startCycle' in body ? { startCycle: body['startCycle'] } : {}),
      }),
    );
    res.setHeader(
      'location',
      `/api/v1/workspaces/${workspaceId}/credit-cards/${cardId}/installment-plans/${plan.id}`,
    );
    return plan;
  }

  @Post('workspaces/:workspaceId/credit-cards/:cardId/installment-plans/:planId/cancel')
  @HttpCode(200)
  cancelInstallmentPlan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @Param('planId') planId: string,
    @ExpectedVersion() expectedVersion: number,
  ) {
    return this.installments.cancel({ workspaceId, userId: userIdOf(req), cardId, planId, expectedVersion });
  }

  @Get('workspaces/:workspaceId/credit-cards/:cardId/future-charges')
  async futureCharges(
    @Param('workspaceId') workspaceId: string,
    @Param('cardId') cardId: string,
    @ValidatedQuery() query: Json,
  ) {
    const months = query['months'] === undefined ? 6 : Number(query['months']);
    return { data: await this.queries.getFutureCharges(workspaceId, cardId, months) };
  }
}
