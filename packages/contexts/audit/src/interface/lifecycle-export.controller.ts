import { Controller, Get, Inject, Param, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiProblem } from '@pf/platform/api';
import { principalOf, type ApiRequest, type ApiResponse } from '@pf/platform/nest';
import type { LifecycleExporter } from '../application/lifecycle-export.js';
import { reportLocale } from '../application/lifecycle-report.js';
import {
  LIFECYCLE_EXPORT_FORMATS,
  type LifecycleAggregateType,
  type LifecycleExportFormat,
} from '../contracts/index.js';

export const LIFECYCLE_EXPORTER = Symbol('LIFECYCLE_EXPORTER');

const WS = 'workspaces/:workspaceId';

const headerOf = (req: ApiRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const isFormat = (v: unknown): v is LifecycleExportFormat =>
  typeof v === 'string' && (LIFECYCLE_EXPORT_FORMATS as readonly string[]).includes(v);

/**
 * Descarga del recorrido en CSV o PDF (docs/31 D52; `export<Agregado>Lifecycle`): una ruta por agregado, junto a su
 * `GET …/lifecycle`. VIEWER+ (`x-required-role`, guard de identidad); el contrato valida `format` (`csv` | `pdf`). La
 * respuesta es un adjunto (`Content-Disposition: attachment`) con nombre ASCII seguro; nunca se cachea.
 */
@Controller()
export class LifecycleExportController {
  constructor(@Inject(LIFECYCLE_EXPORTER) private readonly exporter: LifecycleExporter) {}

  @Get(`${WS}/transactions/:transactionId/lifecycle/export`)
  transaction(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('transactionId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Transaction', id, format);
  }

  @Get(`${WS}/accounts/:accountId/lifecycle/export`)
  account(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('accountId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Account', id, format);
  }

  @Get(`${WS}/fx-rates/:fxRateId/lifecycle/export`)
  rate(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('fxRateId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'ExchangeRate', id, format);
  }

  @Get(`${WS}/categories/:categoryId/lifecycle/export`)
  category(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('categoryId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Category', id, format);
  }

  @Get(`${WS}/counterparties/:counterpartyId/lifecycle/export`)
  counterparty(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('counterpartyId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Counterparty', id, format);
  }

  @Get(`${WS}/periods/:periodId/lifecycle/export`)
  period(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('periodId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'FinancialPeriod', id, format);
  }

  @Get(`${WS}/reconciliations/:reconciliationId/lifecycle/export`)
  reconciliation(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('reconciliationId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Reconciliation', id, format);
  }

  @Get(`${WS}/recurring/occurrences/:occurrenceId/lifecycle/export`)
  recurringOccurrence(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('occurrenceId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'RecurringOccurrence', id, format);
  }

  @Get(`${WS}/subscriptions/:subscriptionId/lifecycle/export`)
  subscription(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('subscriptionId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'Subscription', id, format);
  }

  @Get(`${WS}/recurring/:definitionId/lifecycle/export`)
  recurringDefinition(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: ApiResponse,
    @Param('workspaceId') workspaceId: string,
    @Param('definitionId') id: string,
    @Query('format') format: unknown,
  ) {
    return this.download(req, res, workspaceId, 'RecurringDefinition', id, format);
  }

  private async download(
    req: ApiRequest,
    res: ApiResponse,
    workspaceId: string,
    aggregateType: LifecycleAggregateType,
    aggregateId: string,
    format: unknown,
  ): Promise<StreamableFile> {
    const principal = principalOf(req);
    if (!principal) throw new ApiProblem('UNAUTHENTICATED', 'an authenticated user is required');
    if (!isFormat(format)) throw new ApiProblem('VALIDATION_FAILED', 'format must be csv or pdf');
    const file = await this.exporter.export({
      userId: principal.userId,
      workspaceId,
      aggregateType,
      aggregateId,
      format,
      // Textos del PDF por `Accept-Language` (es; en/pt preparados); el BFF lo reenvía desde el navegador.
      locale: reportLocale(headerOf(req, 'accept-language')),
    });
    res.setHeader('content-type', file.contentType);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(file.body, { length: file.body.byteLength });
  }
}
