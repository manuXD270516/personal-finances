import { createHash } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Put, Req, Res, StreamableFile } from '@nestjs/common';
import {
  ExpectedVersion,
  ValidatedQuery,
  principalOf,
  type ApiRequest,
  type ApiResponse,
} from '@pf/platform/nest';
import type { CompareMode } from '../domain/index.js';
import type { CashFlowCalendarQueries } from '../application/cash-flow-calendar.queries.js';
import type { SpendableSettingsService } from '../application/spendable-settings.use-cases.js';
import type { ConversionCostQueries } from '../application/conversion-cost.queries.js';
import type { NetWorthHistoryQueries } from '../application/net-worth-history.queries.js';
import type { ReportSummaryQueries } from '../application/report-summary.queries.js';
import type { SpendableQueries } from '../application/spendable.queries.js';
import type { UpcomingPaymentsQueries } from '../application/upcoming-payments.queries.js';
import type {
  CashFlowCalendarDto,
  ConversionCostAnalysisDto,
  ConversionCostGroupingDto,
  NetWorthHistoryDto,
  ReportSummaryDto,
  SpendableDto,
  SpendableSettingsDto,
  SurprisePaymentsDto,
  UpcomingPaymentsDto,
} from '../contracts/index.js';

export const REPORT_SUMMARY_QUERIES = Symbol('REPORT_SUMMARY_QUERIES');
export const NET_WORTH_HISTORY_QUERIES = Symbol('NET_WORTH_HISTORY_QUERIES');
export const UPCOMING_PAYMENTS_QUERIES = Symbol('UPCOMING_PAYMENTS_QUERIES');
export const SPENDABLE_QUERIES = Symbol('SPENDABLE_QUERIES');
export const CONVERSION_COST_QUERIES = Symbol('CONVERSION_COST_QUERIES');
export const CASH_FLOW_QUERIES = Symbol('CASH_FLOW_QUERIES');
export const SPENDABLE_SETTINGS_SERVICE = Symbol('SPENDABLE_SETTINGS_SERVICE');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;
const int = (q: Json, k: string): number | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
};

/** Filtros comunes del análisis de costo de conversiones y su exportación. */
function conversionCostFilters(query: Json): {
  from?: string;
  to?: string;
  grouping?: ConversionCostGroupingDto;
} {
  return {
    ...(str(query, 'from') ? { from: str(query, 'from') as string } : {}),
    ...(str(query, 'to') ? { to: str(query, 'to') as string } : {}),
    ...(str(query, 'grouping') ? { grouping: str(query, 'grouping') as ConversionCostGroupingDto } : {}),
  };
}

/**
 * ETag débil del resumen: versión derivada del workspace + hash del contenido (sin `generatedAt`). El contenido se
 * calcula SIEMPRE desde la fuente de verdad, así que un consumidor de versiones atrasado nunca produce un 304 obsoleto
 * (read-your-writes, TC-REPORTING-DASHBOARD-006).
 */
export function summaryEtag(summary: ReportSummaryDto, dataVersion: string): string {
  const { generatedAt: _generatedAt, ...meta } = summary.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...summary, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${dataVersion}-${hash}"`;
}

/** ETag débil de la evolución del patrimonio: versión de datos + hash del contenido (sin `generatedAt`). */
export function historyEtag(history: NetWorthHistoryDto, dataVersion: string): string {
  const { generatedAt: _generatedAt, ...meta } = history.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...history, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${dataVersion}-${hash}"`;
}

/**
 * ETag débil de los próximos pagos: versión de datos + hash del contenido (sin `generatedAt`). El día local entra en la
 * clave a través del contenido (ventana y días de atraso cambian a medianoche aunque no haya eventos).
 */
export function upcomingEtag(upcoming: UpcomingPaymentsDto, dataVersion: string): string {
  const { generatedAt: _generatedAt, ...meta } = upcoming.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...upcoming, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${dataVersion}-${hash}"`;
}

/** ETag débil del disponible para gastar: versión de datos + hash del contenido (sin `generatedAt`). */
export function spendableEtag(spendable: SpendableDto, dataVersion: string): string {
  const { generatedAt: _generatedAt, ...meta } = spendable.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...spendable, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${dataVersion}-${hash}"`;
}

/** ETag débil del calendario de flujo de caja: versión de datos + hash del contenido (sin `generatedAt`). */
export function cashFlowEtag(calendar: CashFlowCalendarDto, dataVersion: string): string {
  const { generatedAt: _generatedAt, ...meta } = calendar.meta;
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...calendar, meta }))
    .digest('base64url')
    .slice(0, 22);
  return `W/"${dataVersion}-${hash}"`;
}

/**
 * `GET /api/v1/workspaces/{workspaceId}/reports/summary` (`getReportSummary`, VIEWER). Autenticación, rol y validación
 * de contrato (incl. `topCategories` 0..20) los aplican las convenciones globales; `If-None-Match` ⇒ 304 lo resuelve
 * el interceptor condicional con el `ETag` que fija este handler.
 */
@Controller()
export class ReportingController {
  constructor(
    @Inject(REPORT_SUMMARY_QUERIES) private readonly queries: ReportSummaryQueries,
    @Inject(NET_WORTH_HISTORY_QUERIES) private readonly history: NetWorthHistoryQueries,
    @Inject(UPCOMING_PAYMENTS_QUERIES) private readonly upcoming: UpcomingPaymentsQueries,
    @Inject(SPENDABLE_QUERIES) private readonly spendable: SpendableQueries,
    @Inject(CONVERSION_COST_QUERIES) private readonly conversionCosts: ConversionCostQueries,
    @Inject(CASH_FLOW_QUERIES) private readonly cashFlow: CashFlowCalendarQueries,
    @Inject(SPENDABLE_SETTINGS_SERVICE) private readonly spendableSettings: SpendableSettingsService,
  ) {}

  @Get('workspaces/:workspaceId/reports/summary')
  async getReportSummary(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<ReportSummaryDto> {
    const top = int(query, 'topCategories');
    const { summary, dataVersion } = await this.queries.getReportSummary({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(str(query, 'month') ? { month: str(query, 'month') as string } : {}),
      ...(str(query, 'dateFrom') ? { dateFrom: str(query, 'dateFrom') as string } : {}),
      ...(str(query, 'dateTo') ? { dateTo: str(query, 'dateTo') as string } : {}),
      ...(str(query, 'reportingCurrency')
        ? { reportingCurrency: str(query, 'reportingCurrency') as string }
        : {}),
      ...(top !== undefined ? { topCategories: top } : {}),
      ...(str(query, 'compare') ? { compare: str(query, 'compare') as CompareMode } : {}),
    });
    res.setHeader('etag', summaryEtag(summary, dataVersion));
    res.setHeader('cache-control', 'private, no-cache');
    return summary;
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/net-worth/history` (`getNetWorthHistory`, VIEWER): evolución del
   * patrimonio por periodo financiero (add-net-worth-evolution). Mismo manejo de `ETag`/`If-None-Match` que el resumen.
   */
  @Get('workspaces/:workspaceId/reports/net-worth/history')
  async getNetWorthHistory(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<NetWorthHistoryDto> {
    const { history, dataVersion } = await this.history.getNetWorthHistory({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(str(query, 'from') ? { from: str(query, 'from') as string } : {}),
      ...(str(query, 'to') ? { to: str(query, 'to') as string } : {}),
      ...(str(query, 'reportingCurrency')
        ? { reportingCurrency: str(query, 'reportingCurrency') as string }
        : {}),
    });
    res.setHeader('etag', historyEtag(history, dataVersion));
    res.setHeader('cache-control', 'private, no-cache');
    return history;
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/upcoming-payments` (`getUpcomingPayments`, VIEWER): próximos pagos,
   * comprometido del periodo y saldo proyectado (add-upcoming-payments). Mismo manejo de `ETag`/`If-None-Match`.
   */
  @Get('workspaces/:workspaceId/reports/upcoming-payments')
  async getUpcomingPayments(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<UpcomingPaymentsDto> {
    const days = int(query, 'days');
    const { upcoming, dataVersion } = await this.upcoming.getUpcomingPayments({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(days !== undefined ? { days } : {}),
      ...(str(query, 'reportingCurrency')
        ? { reportingCurrency: str(query, 'reportingCurrency') as string }
        : {}),
    });
    res.setHeader('etag', upcomingEtag(upcoming, dataVersion));
    res.setHeader('cache-control', 'private, no-cache');
    return upcoming;
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/spendable` (`getSpendable`, VIEWER): el disponible para gastar libre de
   * compromisos con el detalle de sus términos (add-spendable-amount). Mismo manejo de `ETag`/`If-None-Match`.
   */
  @Get('workspaces/:workspaceId/reports/spendable')
  async getSpendable(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<SpendableDto> {
    const { spendable, dataVersion } = await this.spendable.getSpendable({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(str(query, 'reportingCurrency')
        ? { reportingCurrency: str(query, 'reportingCurrency') as string }
        : {}),
    });
    res.setHeader('etag', spendableEtag(spendable, dataVersion));
    res.setHeader('cache-control', 'private, no-cache');
    return spendable;
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/cash-flow-calendar` (`getCashFlowCalendar`, VIEWER): calendario de flujo
   * de caja de 7, 30, 60 o 90 días con saldo esperado, riesgo de déficit y consolidado (add-cash-flow-forecast). Mismo
   * manejo de `ETag`/`If-None-Match`; horizonte o cuenta inválidos ⇒ 400 `INVALID_FILTER`.
   */
  @Get('workspaces/:workspaceId/reports/cash-flow-calendar')
  async getCashFlowCalendar(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<CashFlowCalendarDto> {
    const horizon = int(query, 'horizon');
    const { calendar, dataVersion } = await this.cashFlow.getCashFlowCalendar({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(horizon !== undefined ? { horizon } : {}),
      ...(str(query, 'accountId') ? { accountId: str(query, 'accountId') as string } : {}),
      ...(str(query, 'reportingCurrency')
        ? { reportingCurrency: str(query, 'reportingCurrency') as string }
        : {}),
    });
    res.setHeader('etag', cashFlowEtag(calendar, dataVersion));
    res.setHeader('cache-control', 'private, no-cache');
    return calendar;
  }

  /** `GET …/reports/spendable/settings` (`getSpendableSettings`, VIEWER): modo de horizonte y esenciales del disponible. */
  @Get('workspaces/:workspaceId/reports/spendable/settings')
  getSpendableSettings(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
  ): Promise<SpendableSettingsDto> {
    return this.spendableSettings.get({ userId: principalOf(req)?.userId ?? null, workspaceId });
  }

  /**
   * `PUT …/reports/spendable/settings` (`updateSpendableSettings`, OWNER, `If-Match` obligatorio): auditado; categoría de
   * ingreso ⇒ 422 `CATEGORY_KIND_MISMATCH`, archivada ⇒ 409 `CATEGORY_ARCHIVED`, versión vencida ⇒ 412.
   */
  @Put('workspaces/:workspaceId/reports/spendable/settings')
  updateSpendableSettings(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ExpectedVersion() expected: number,
    @Body() body: Json,
  ): Promise<SpendableSettingsDto> {
    const ids = Array.isArray(body['essentialCategoryIds'])
      ? (body['essentialCategoryIds'] as unknown[])
      : [];
    return this.spendableSettings.update({
      userId: principalOf(req)?.userId ?? '',
      workspaceId,
      expectedVersion: expected,
      settings: {
        horizonMode: body['horizonMode'] as 'FINANCIAL_PERIOD' | 'NEXT_INCOME',
        subtractEssentials: body['subtractEssentials'] === true,
        essentialCategoryIds: ids.map(String),
      },
    });
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/conversion-costs` (`getConversionCostAnalysis`, VIEWER): spread y fees
   * por periodo, canal y par de las conversiones posteadas (add-conversion-cost-analysis, FR-FX-011). Solo lectura.
   */
  @Get('workspaces/:workspaceId/reports/conversion-costs')
  async getConversionCostAnalysis(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<ConversionCostAnalysisDto> {
    const analysis = await this.conversionCosts.getAnalysis({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...conversionCostFilters(query),
      ...(str(query, 'compareWith') === 'PARALLEL_SIDE' ? { compareWith: 'PARALLEL_SIDE' as const } : {}),
    });
    res.setHeader('cache-control', 'private, no-cache');
    return analysis;
  }

  /**
   * `GET /api/v1/workspaces/{workspaceId}/reports/conversion-costs/export` (`exportConversionCostAnalysis`, VIEWER): el
   * mismo análisis como CSV (una fila por grupo, celdas de texto neutralizadas). La cuota de operaciones costosas
   * (`x-rate-limit: costly`) la aplica la plataforma.
   */
  @Get('workspaces/:workspaceId/reports/conversion-costs/export')
  async exportConversionCostAnalysis(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<StreamableFile> {
    const file = await this.conversionCosts.exportCsv({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...conversionCostFilters(query),
    });
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(file.body, { length: file.body.byteLength });
  }

  /** `GET /api/v1/workspaces/{workspaceId}/reports/surprise-payments` (`getSurprisePayments`, VIEWER, SM-07). */
  @Get('workspaces/:workspaceId/reports/surprise-payments')
  async getSurprisePayments(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @ValidatedQuery() query: Json,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<SurprisePaymentsDto> {
    const result = await this.upcoming.getSurprisePayments({
      userId: principalOf(req)?.userId ?? null,
      workspaceId,
      ...(str(query, 'period') ? { period: str(query, 'period') as string } : {}),
    });
    res.setHeader('cache-control', 'private, no-cache');
    return result;
  }
}
