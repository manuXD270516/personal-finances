import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '@pf/platform/nest';
import type { BulkEditService } from '../application/bulk-edit.service.js';
import { listFiltersOf, listQueryOf, toTransactionDto, userIdOf, type Json } from './transactions-http.js';

export const BULK_EDIT_SERVICE = Symbol('BULK_EDIT_SERVICE');

/**
 * `POST W/transactions/bulk-edit` y `…/bulk-edit/preview` (openspec add-bulk-edit § Contratos; EDITOR u OWNER, D28).
 * La validación de contrato (`additionalProperties: false`, `maxItems: 500`) rechaza con 400 cualquier cambio
 * financiero; `Idempotency-Key` y el rate limit los aplican las convenciones globales de `@pf/platform/nest`.
 */
@Controller()
export class BulkEditController {
  constructor(@Inject(BULK_EDIT_SERVICE) private readonly service: BulkEditService) {}

  @Post('workspaces/:workspaceId/transactions/bulk-edit/preview')
  @HttpCode(200)
  async previewBulkEditTransactions(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
  ) {
    const selection = body['selection'] as { items?: { id: string }[]; filter?: Json };
    const preview = await this.service.preview({
      workspaceId,
      userId: userIdOf(req),
      selection: selection.items
        ? { items: selection.items }
        : { filter: listQueryOf(listFiltersOf(selection.filter ?? {})) },
      changes: body['changes'],
    });
    return {
      count: preview.count,
      truncated: preview.truncated,
      items: preview.items.map((i) => ({ ...i, reasons: [...i.reasons] })),
    };
  }

  @Post('workspaces/:workspaceId/transactions/bulk-edit')
  @HttpCode(200)
  async bulkEditTransactions(
    @Req() req: ApiRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Json,
  ) {
    const result = await this.service.bulkEdit({
      workspaceId,
      userId: userIdOf(req),
      items: (body['items'] as { id: string; version: number }[] | undefined) ?? [],
      changes: body['changes'],
    });
    return { bulkOperationId: result.bulkOperationId, data: result.data.map((s) => toTransactionDto(s)) };
  }
}
