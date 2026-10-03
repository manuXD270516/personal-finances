import { createHash } from 'node:crypto';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { ValidatedQuery, principalOf, type ApiRequest, type ApiResponse } from '@pf/platform/nest';
import type { CompareMode } from '../domain/index.js';
import type { ReportSummaryQueries } from '../application/report-summary.queries.js';
import type { ReportSummaryDto } from '../contracts/index.js';

export const REPORT_SUMMARY_QUERIES = Symbol('REPORT_SUMMARY_QUERIES');

type Json = Record<string, unknown>;
const str = (q: Json, k: string): string | undefined =>
  typeof q[k] === 'string' ? (q[k] as string) : undefined;
const int = (q: Json, k: string): number | undefined => {
  const v = q[k];
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
};

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

/**
 * `GET /api/v1/workspaces/{workspaceId}/reports/summary` (`getReportSummary`, VIEWER). Autenticación, rol y validación
 * de contrato (incl. `topCategories` 0..20) los aplican las convenciones globales; `If-None-Match` ⇒ 304 lo resuelve
 * el interceptor condicional con el `ETag` que fija este handler.
 */
@Controller()
export class ReportingController {
  constructor(@Inject(REPORT_SUMMARY_QUERIES) private readonly queries: ReportSummaryQueries) {}

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
}
