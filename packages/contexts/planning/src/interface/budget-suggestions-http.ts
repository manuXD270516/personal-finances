import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { BudgetSuggestionService } from '../application/budget-suggestion.service.js';

export const BUDGET_SUGGESTION_SERVICE = Symbol('BUDGET_SUGGESTION_SERVICE');

type Json = Record<string, unknown>;

/**
 * `/api/v1/workspaces/{workspaceId}/budget-suggestions/*` (openspec add-historical-budgets § Contratos, tarea 5.2).
 * La vista previa (VIEWER) no tiene efectos ni auditoría; la confirmación (EDITOR, `Idempotency-Key`) aplica las líneas
 * elegidas en una sola unidad de trabajo. Roles, validación de contrato e idempotencia las aplican los guards y las
 * convenciones globales (`x-required-role`).
 */
@Controller()
export class BudgetSuggestionsController {
  constructor(@Inject(BUDGET_SUGGESTION_SERVICE) private readonly service: BudgetSuggestionService) {}

  /** `previewBudgetSuggestions` (VIEWER): sin efectos. */
  @Post('workspaces/:workspaceId/budget-suggestions/preview')
  @HttpCode(200)
  previewBudgetSuggestions(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    return this.service.preview({ workspaceId, request: body });
  }

  /** `confirmBudgetSuggestions` (EDITOR, `Idempotency-Key`): `BUDGET_SUGGESTION_STALE` si algo cambió. */
  @Post('workspaces/:workspaceId/budget-suggestions/confirm')
  @HttpCode(200)
  confirmBudgetSuggestions(@Param('workspaceId') workspaceId: string, @Body() body: Json) {
    return this.service.confirm({
      workspaceId,
      request: body['request'],
      token: body['token'],
      lines: body['lines'],
    });
  }
}
