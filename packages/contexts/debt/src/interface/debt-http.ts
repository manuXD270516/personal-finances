import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { isDomainError } from '@pf/shared-kernel';
import {
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { LoanStatusDto } from '../contracts/index.js';
import type { LoansQueries } from '../application/loans.queries.js';
import type { LoansService, RegisterLoanCommand } from '../application/loans.service.js';
import type { PaymentsService } from '../application/payments.service.js';
import type { ReferencesService, UploadReferenceCommand } from '../application/references.service.js';

export const LOANS_SERVICE = Symbol('DEBT_LOANS_SERVICE');
export const PAYMENTS_SERVICE = Symbol('DEBT_PAYMENTS_SERVICE');
export const REFERENCES_SERVICE = Symbol('DEBT_REFERENCES_SERVICE');
export const LOANS_QUERIES = Symbol('DEBT_LOANS_QUERIES');

type Json = Record<string, unknown>;
const str = (b: Json, k: string): string | undefined =>
  typeof b[k] === 'string' ? (b[k] as string) : undefined;

/**
 * Los `details` de un error de dominio de préstamos viajan como extensión `details` del problem (RFC 9457):
 * `LOAN_REFERENCE_INVALID` (`rows[]`), `LOAN_BALANCE_MISMATCH`, `LOAN_OVERPAYMENT`, `PAYMENT_BREAKDOWN_MISMATCH`…
 */
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

const STATUSES = ['DRAFT', 'ACTIVE', 'PAID_OFF', 'CANCELLED'] as const;

/** `/api/v1/workspaces/{workspaceId}/loans*` (openspec add-loans § Contratos). */
@Controller()
export class LoansController {
  constructor(
    @Inject(LOANS_SERVICE) private readonly loans: LoansService,
    @Inject(PAYMENTS_SERVICE) private readonly payments: PaymentsService,
    @Inject(REFERENCES_SERVICE) private readonly references: ReferencesService,
    @Inject(LOANS_QUERIES) private readonly queries: LoansQueries,
  ) {}

  // ───────────────────────────────────────────── préstamos

  @Get('workspaces/:workspaceId/loans')
  async listLoans(@Param('workspaceId') workspaceId: string, @ValidatedQuery() query: Json) {
    const raw = str(query, 'status');
    const statuses = raw
      ? raw.split(',').map((s) => {
          if (!(STATUSES as readonly string[]).includes(s)) {
            throw new ApiProblem('VALIDATION_FAILED', 'unknown status');
          }
          return s as LoanStatusDto;
        })
      : undefined;
    const data = await this.queries.list(workspaceId, statuses ? { statuses } : {});
    return { data };
  }

  @Post('workspaces/:workspaceId/loans')
  @HttpCode(201)
  async registerLoan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const created = await withDetails(() =>
      this.loans.register({
        ...(body as unknown as RegisterLoanCommand),
        workspaceId,
        userId: userIdOf(req),
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/loans/${created.id}`);
    return this.queries.get(workspaceId, created.id);
  }

  @Post('workspaces/:workspaceId/loans/schedule-preview')
  @HttpCode(200)
  previewSchedule(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    return withDetails(() =>
      this.queries.previewTerms({ ...(body as unknown as RegisterLoanCommand), workspaceId }),
    );
  }

  @Get('workspaces/:workspaceId/loans/:loanId')
  getLoan(@Param('workspaceId') workspaceId: string, @Param('loanId') loanId: string) {
    return this.queries.get(workspaceId, loanId);
  }

  @Patch('workspaces/:workspaceId/loans/:loanId')
  async editLoan(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    const { name, lenderCounterpartyId, paymentAccountId, accountId, disbursementAccountId, ...terms } = body;
    const edited = await withDetails(() =>
      this.loans.edit({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        expectedVersion,
        name: name as string | undefined,
        lenderCounterpartyId: lenderCounterpartyId as string | null | undefined,
        paymentAccountId: paymentAccountId as string | undefined,
        accountId: accountId as string | undefined,
        disbursementAccountId: disbursementAccountId as string | undefined,
        terms: Object.keys(terms).length > 0 ? this.flattenTerms(terms) : undefined,
      }),
    );
    return this.queries.get(workspaceId, edited.id);
  }

  /** `principal: {amount}` del contrato → monto plano de las condiciones del dominio. */
  private flattenTerms(terms: Json): Json {
    const out: Json = { ...terms };
    const principal = out['principal'];
    if (principal && typeof principal === 'object') {
      out['principal'] = (principal as Json)['amount'];
    }
    return out;
  }

  @Post('workspaces/:workspaceId/loans/:loanId/disburse')
  @HttpCode(200)
  async disburse(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Body() body: Json,
  ) {
    const done = await withDetails(() =>
      this.loans.disburse({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        retainedFee: str(body ?? {}, 'retainedFee'),
      }),
    );
    return this.queries.get(workspaceId, done.id);
  }

  @Post('workspaces/:workspaceId/loans/:loanId/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    const done = await withDetails(() =>
      this.loans.cancel({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        expectedVersion,
        reason: str(body ?? {}, 'reason') ?? '',
      }),
    );
    return this.queries.get(workspaceId, done.id);
  }

  // ───────────────────────────────────────────── cronograma y pagos

  @Get('workspaces/:workspaceId/loans/:loanId/installments')
  async listInstallments(
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @ValidatedQuery() query: Json,
  ) {
    const version = query['version'] === undefined ? undefined : Number(query['version']);
    const result = await this.queries.installments(workspaceId, loanId, version);
    return { scheduleVersion: result.version, data: result.installments };
  }

  @Get('workspaces/:workspaceId/loans/:loanId/payments')
  async listPayments(@Param('workspaceId') workspaceId: string, @Param('loanId') loanId: string) {
    return { data: await this.queries.payments(workspaceId, loanId) };
  }

  @Post('workspaces/:workspaceId/loans/:loanId/payments')
  @HttpCode(201)
  async recordPayment(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Body() body: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const result = await withDetails(() =>
      this.payments.record({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        amount: body['amount'] as { amount: string; currency: string },
        businessDate: str(body, 'businessDate') ?? '',
        accountId: str(body, 'accountId'),
        paymentMethod: body['paymentMethod'] as string | null | undefined,
        installmentNo: body['installmentNo'] as number | undefined,
        breakdown: body['breakdown'] as RecordBreakdown | undefined,
      }),
    );
    res.setHeader('location', `/api/v1/workspaces/${workspaceId}/loans/${loanId}/payments`);
    return result;
  }

  @Post('workspaces/:workspaceId/loans/:loanId/payments/:paymentId/void')
  @HttpCode(200)
  voidPayment(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Param('paymentId') paymentId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() body: Json,
  ) {
    return withDetails(() =>
      this.payments.void({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        paymentId,
        expectedVersion,
        reason: str(body ?? {}, 'reason') ?? '',
      }),
    );
  }

  // ───────────────────────────────────────────── tabla del banco

  @Get('workspaces/:workspaceId/loans/:loanId/reference-schedules')
  async listReferences(@Param('workspaceId') workspaceId: string, @Param('loanId') loanId: string) {
    return { data: await this.references.list(workspaceId, loanId) };
  }

  @Post('workspaces/:workspaceId/loans/:loanId/reference-schedules/preview')
  @HttpCode(200)
  previewReference(@Body() body: Json) {
    const text = str(body, 'text');
    if (text === undefined) throw new ApiProblem('VALIDATION_FAILED', 'text is required');
    return this.references.detect(text, {
      delimiter: body['delimiter'] as ',' | ';' | '\t' | undefined,
      hasHeader: body['hasHeader'] as boolean | undefined,
    });
  }

  @Post('workspaces/:workspaceId/loans/:loanId/reference-schedules')
  @HttpCode(201)
  uploadReference(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Body() body: Json,
  ) {
    return withDetails(() =>
      this.references.upload({
        ...(body as unknown as UploadReferenceCommand),
        workspaceId,
        userId: userIdOf(req),
        loanId,
      }),
    );
  }

  @Get('workspaces/:workspaceId/loans/:loanId/reference-schedules/:referenceId/comparison')
  getComparison(
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.references.comparison(workspaceId, loanId, referenceId);
  }

  @Get('workspaces/:workspaceId/loans/:loanId/reference-schedules/:referenceId/comparison/export')
  async getComparisonCsv(
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Param('referenceId') referenceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const csv = await this.references.comparisonCsv(workspaceId, loanId, referenceId);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="comparison.csv"');
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  @Post('workspaces/:workspaceId/loans/:loanId/reference-schedules/:referenceId/comparison/explanation')
  @HttpCode(200)
  explain(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
    @Param('referenceId') referenceId: string,
    @Body() body: Json,
  ) {
    return withDetails(() =>
      this.references.explain({
        workspaceId,
        userId: userIdOf(req),
        loanId,
        referenceId,
        explanation: str(body, 'explanation') ?? '',
      }),
    );
  }

  // ───────────────────────────────────────────── recorrido

  @Get('workspaces/:workspaceId/loans/:loanId/lifecycle')
  getLifecycle(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('loanId') loanId: string,
  ) {
    return this.queries.lifecycle({ userId: userIdOf(req), workspaceId, loanId });
  }
}

type RecordBreakdown = Partial<Record<'principal' | 'interest' | 'fees' | 'insurance' | 'taxes', string>>;
