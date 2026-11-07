import { createHash } from 'node:crypto';
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
import type {
  DrillDownParams,
  DrillDownReport,
  FinancialReportsService,
  ReportExport,
} from '../application/financial-reports.exports.js';
import type { ReportResult } from '../application/financial-reports.queries.js';
import type { SavedReportViewsService } from '../application/saved-report-views.js';
import type { ReportCatalogDto } from '../contracts/financial-reports.js';
import type { ReportCompareMode, ReportGrouping, LiquidityComponent } from '../domain/index.js';
import type { ReportParams } from '../application/report-context.js';

export const FINANCIAL_REPORTS = Symbol('FINANCIAL_REPORTS');
export const SAVED_REPORT_VIEWS = Symbol('SAVED_REPORT_VIEWS');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;
const num = (q: Json, k: string): number | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
};
const list = (q: Json, k: string): string[] | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : [v]).map(String);
};

/** Parámetros comunes de los reportes (`{común}` del contrato) ya normalizados. */
export function reportParams(req: ApiRequest, workspaceId: string, q: Json): ReportParams {
  const opt = <T>(key: string, value: T | undefined) => (value === undefined ? {} : { [key]: value });
  return {
    userId: principalOf(req)?.userId ?? null,
    workspaceId,
    from: str(q, 'from') as string,
    to: str(q, 'to') as string,
    ...opt('grouping', str(q, 'grouping') as ReportGrouping | undefined),
    ...opt('compare', str(q, 'compare') as ReportCompareMode | undefined),
    ...opt('compareFrom', str(q, 'compareFrom')),
    ...opt('compareTo', str(q, 'compareTo')),
    ...opt('normalize', str(q, 'normalize') as 'NONE' | 'PER_DAY' | undefined),
    ...opt('rolling', num(q, 'rolling')),
    ...opt('reportingCurrency', str(q, 'reportingCurrency')),
    ...opt('conversion', str(q, 'conversion') as 'HISTORICAL' | 'CUTOFF' | undefined),
    ...opt('accountIds', list(q, 'accountId')),
    ...opt('currencies', list(q, 'currency')),
    ...opt('categoryIds', list(q, 'categoryId')),
    ...opt('tagIds', list(q, 'tagId')),
    ...opt('tagMatch', str(q, 'tagMatch') as 'ANY' | 'ALL' | undefined),
    ...opt('counterpartyIds', list(q, 'counterpartyId')),
  } as ReportParams;
}

function drillParams(req: ApiRequest, workspaceId: string, q: Json): DrillDownParams {
  const opt = <T>(key: string, value: T | undefined) => (value === undefined ? {} : { [key]: value });
  return {
    ...reportParams(req, workspaceId, q),
    report: str(q, 'report') as DrillDownReport,
    ...opt('nature', str(q, 'nature') as 'INCOME' | 'EXPENSE' | undefined),
    ...opt('categoryGroupId', str(q, 'categoryGroupId')),
    ...opt('budgetPeriodId', str(q, 'budgetPeriodId')),
    ...opt('budgetLineId', str(q, 'budgetLineId')),
    ...opt('component', str(q, 'component') as LiquidityComponent | undefined),
    ...opt('accountId', str(q, 'historyAccountId')),
    ...opt('date', str(q, 'date')),
    ...opt('limit', num(q, 'limit')),
    ...opt('cursor', str(q, 'cursor')),
  };
}

/**
 * ETag débil de un reporte: versión de datos + hash del contenido sin `generatedAt`. Como el reporte se calcula SIEMPRE
 * desde la fuente de verdad, un consumidor de versiones atrasado nunca produce un 304 obsoleto (read-your-writes).
 */
export function reportEtag(
  result: ReportResult<{ readonly meta: { readonly generatedAt: string } }>,
): string {
  const { generatedAt: _g, ...meta } = result.report.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...result.report, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${result.dataVersion}-${hash}"`;
}

function sendCsv(res: ApiResponse, file: ReportExport): StreamableFile {
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  return new StreamableFile(file.body, { length: file.body.byteLength });
}

/**
 * `GET /api/v1/workspaces/{workspaceId}/reports/*` (add-financial-reports; VIEWER): catálogo, seis reportes, drill-down
 * y exportaciones CSV. Autenticación, rol, validación de contrato y la cuota `costly` de las exportaciones las aplican
 * las convenciones globales; `If-None-Match` ⇒ 304 lo resuelve el interceptor condicional con el `ETag` fijado aquí.
 */
@Controller()
export class FinancialReportsController {
  constructor(
    @Inject(FINANCIAL_REPORTS) private readonly reports: FinancialReportsService,
    @Inject(SAVED_REPORT_VIEWS) private readonly views: SavedReportViewsService,
  ) {}

  private async json<T extends { readonly meta: { readonly generatedAt: string } }>(
    res: ApiResponse,
    result: Promise<ReportResult<T>>,
  ): Promise<T> {
    const r = await result;
    res.setHeader('etag', reportEtag(r));
    res.setHeader('cache-control', 'private, no-cache');
    return r.report;
  }

  @Get('workspaces/:workspaceId/reports/catalog')
  getReportCatalog(@Res({ passthrough: true }) res: ApiResponse): ReportCatalogDto {
    res.setHeader('cache-control', 'private, no-cache');
    return this.reports.getCatalog();
  }

  @Get('workspaces/:workspaceId/reports/income-expenses')
  getIncomeExpensesReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const g = str(q, 'granularity') as 'PERIOD' | 'WEEK' | undefined;
    return this.json(
      res,
      this.reports.getIncomeExpenses({ ...reportParams(req, ws, q), ...(g ? { granularity: g } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/income-expenses/export')
  async exportIncomeExpensesReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const g = str(q, 'granularity') as 'PERIOD' | 'WEEK' | undefined;
    return sendCsv(
      res,
      await this.reports.exportIncomeExpenses({
        ...reportParams(req, ws, q),
        ...(g ? { granularity: g } : {}),
      }),
    );
  }

  @Get('workspaces/:workspaceId/reports/expenses/by-category')
  getExpensesByCategoryReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const topN = num(q, 'topN');
    return this.json(
      res,
      this.reports.getExpensesByCategory({
        ...reportParams(req, ws, q),
        ...(topN !== undefined ? { topN } : {}),
      }),
    );
  }

  @Get('workspaces/:workspaceId/reports/expenses/by-category/export')
  async exportExpensesByCategoryReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const topN = num(q, 'topN');
    return sendCsv(
      res,
      await this.reports.exportExpensesByCategory({
        ...reportParams(req, ws, q),
        ...(topN !== undefined ? { topN } : {}),
      }),
    );
  }

  @Get('workspaces/:workspaceId/reports/budget-vs-actual')
  getBudgetVsActualReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getBudgetVsActual(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/budget-vs-actual/export')
  async exportBudgetVsActualReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportBudgetVsActual(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/cash-flow')
  getCashFlowReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getCashFlow(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/cash-flow/export')
  async exportCashFlowReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportCashFlow(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/accounts/:accountId/balance-history')
  getAccountBalanceHistoryReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('accountId') accountId: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getAccountBalanceHistory({ ...reportParams(req, ws, q), accountId }));
  }

  @Get('workspaces/:workspaceId/reports/accounts/:accountId/balance-history/export')
  async exportAccountBalanceHistoryReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('accountId') accountId: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(
      res,
      await this.reports.exportAccountBalanceHistory({ ...reportParams(req, ws, q), accountId }),
    );
  }

  @Get('workspaces/:workspaceId/reports/net-worth')
  getNetWorthReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const g = str(q, 'granularity') as 'PERIOD' | 'DAY' | undefined;
    return this.json(
      res,
      this.reports.getNetWorth({ ...reportParams(req, ws, q), ...(g ? { granularity: g } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/net-worth/export')
  async exportNetWorthReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const g = str(q, 'granularity') as 'PERIOD' | 'DAY' | undefined;
    return sendCsv(
      res,
      await this.reports.exportNetWorth({ ...reportParams(req, ws, q), ...(g ? { granularity: g } : {}) }),
    );
  }

  // ───────────────────────────────────────────── reportes ampliados (add-financial-reports-extended)

  @Get('workspaces/:workspaceId/reports/expenses/by-tag')
  getExpensesByTagReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getExpensesByTag(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/expenses/by-tag/export')
  async exportExpensesByTagReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportExpensesByTag(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/expenses/by-account')
  getExpensesByAccountReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getExpensesByAccount(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/expenses/by-account/export')
  async exportExpensesByAccountReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportExpensesByAccount(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/trends')
  getTrendsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getTrends(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/trends/export')
  async exportTrendsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportTrends(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/fees')
  getFeesReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getFees(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/fees/export')
  async exportFeesReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportFees(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/goals')
  getGoalsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const goalIds = list(q, 'goalId');
    return this.json(
      res,
      this.reports.getGoals({ ...reportParams(req, ws, q), ...(goalIds ? { goalIds } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/goals/export')
  async exportGoalsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const goalIds = list(q, 'goalId');
    return sendCsv(
      res,
      await this.reports.exportGoals({ ...reportParams(req, ws, q), ...(goalIds ? { goalIds } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/debts')
  getDebtsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const kind = str(q, 'debtKind') as 'LOAN' | 'CARD' | undefined;
    return this.json(
      res,
      this.reports.getDebts({ ...reportParams(req, ws, q), ...(kind ? { debtKind: kind } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/debts/export')
  async exportDebtsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    const kind = str(q, 'debtKind') as 'LOAN' | 'CARD' | undefined;
    return sendCsv(
      res,
      await this.reports.exportDebts({ ...reportParams(req, ws, q), ...(kind ? { debtKind: kind } : {}) }),
    );
  }

  @Get('workspaces/:workspaceId/reports/recurring')
  getRecurringCostsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getRecurringCosts(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/recurring/export')
  async exportRecurringCostsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportRecurringCosts(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/subscriptions')
  getSubscriptionsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getSubscriptions(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/subscriptions/export')
  async exportSubscriptionsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportSubscriptions(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/conversions')
  getConversionsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getConversions(reportParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/conversions/export')
  async exportConversionsReport(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportConversions(reportParams(req, ws, q)));
  }

  // ───────────────────────────────────────────── vistas guardadas (personales)

  private userOf(req: ApiRequest): string {
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    return principal.userId;
  }

  @Get('workspaces/:workspaceId/reports/saved-views')
  async listSavedReportViews(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    res.setHeader('cache-control', 'private, no-store');
    const reportId = str(q, 'reportId');
    const data = await this.views.list({
      userId: this.userOf(req),
      workspaceId: ws,
      ...(reportId ? { reportId } : {}),
    });
    return { data };
  }

  @Post('workspaces/:workspaceId/reports/saved-views')
  @HttpCode(201)
  createSavedReportView(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    res.setHeader('cache-control', 'private, no-store');
    const b = (raw && typeof raw === 'object' ? raw : {}) as Json;
    return this.views.create({
      userId: this.userOf(req),
      workspaceId: ws,
      reportId: b['reportId'],
      name: b['name'],
      params: b['params'],
    });
  }

  @Get('workspaces/:workspaceId/reports/saved-views/:viewId')
  getSavedReportView(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('viewId') viewId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    res.setHeader('cache-control', 'private, no-store');
    return this.views.open({ userId: this.userOf(req), workspaceId: ws, viewId });
  }

  @Patch('workspaces/:workspaceId/reports/saved-views/:viewId')
  updateSavedReportView(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('viewId') viewId: string,
    @ExpectedVersion() expectedVersion: number,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    res.setHeader('cache-control', 'private, no-store');
    const b = (raw && typeof raw === 'object' ? raw : {}) as Json;
    return this.views.update({
      userId: this.userOf(req),
      workspaceId: ws,
      viewId,
      expectedVersion,
      ...('name' in b ? { name: b['name'] } : {}),
      ...('params' in b ? { params: b['params'] } : {}),
    });
  }

  @Delete('workspaces/:workspaceId/reports/saved-views/:viewId')
  @HttpCode(204)
  async deleteSavedReportView(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @Param('viewId') viewId: string,
  ): Promise<void> {
    await this.views.delete({ userId: this.userOf(req), workspaceId: ws, viewId });
  }

  @Get('workspaces/:workspaceId/reports/drill-down')
  getReportDrillDown(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return this.json(res, this.reports.getDrillDown(drillParams(req, ws, q)));
  }

  @Get('workspaces/:workspaceId/reports/drill-down/export')
  async exportReportDrillDown(
    @Req() req: ApiRequest,
    @Param('workspaceId') ws: string,
    @ValidatedQuery() q: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ) {
    return sendCsv(res, await this.reports.exportDrillDown(drillParams(req, ws, q)));
  }
}
