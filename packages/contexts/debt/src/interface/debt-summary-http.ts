import { createHash } from 'node:crypto';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { principalOf, type ApiRequest, type ApiResponse } from '@pf/platform/nest';
import type { DebtSummaryDto, DebtSummaryQuery } from '../contracts/index.js';

export const DEBT_SUMMARY_QUERIES = Symbol('DEBT_SUMMARY_QUERIES');

/**
 * ETag débil del resumen: hash del contenido (el resumen se calcula siempre desde la fuente de verdad, así que un 304
 * nunca es obsoleto). El día local entra a través del contenido (`asOf`, días de atraso).
 */
export function debtSummaryEtag(summary: DebtSummaryDto): string {
  const hash = createHash('sha256').update(JSON.stringify(summary)).digest('base64url').slice(0, 22);
  return `W/"${hash}"`;
}

/**
 * `GET /api/v1/workspaces/{workspaceId}/debts/summary` (`getDebtSummary`, VIEWER; openspec add-debt-summary). Rol y
 * validación de contrato los aplican las convenciones globales; `If-None-Match` ⇒ 304 lo resuelve el interceptor
 * condicional con el `ETag` que fija este handler.
 */
@Controller()
export class DebtSummaryController {
  constructor(@Inject(DEBT_SUMMARY_QUERIES) private readonly queries: DebtSummaryQuery) {}

  @Get('workspaces/:workspaceId/debts/summary')
  async getDebtSummary(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Res({ passthrough: true }) res: ApiResponse,
  ): Promise<DebtSummaryDto> {
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    const summary = await this.queries.getDebtSummary({ workspaceId, userId: principal.userId });
    res.setHeader('etag', debtSummaryEtag(summary));
    return summary;
  }
}
