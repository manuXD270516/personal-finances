import type { FinancialPeriodDto, PeriodCreatedHook } from '../contracts/index.js';
import type { BudgetsService } from './budgets.service.js';

/**
 * Participante de la creación de periodos de PLANNING (openspec add-budget-templates decisión 5; contrato con
 * `add-financial-periods`, decisión 15): `EnsurePeriods` lo invoca de forma síncrona, dentro de su unidad de trabajo, por
 * cada periodo insertado. Con un template predeterminado activo crea el plan del periodo desde su última versión; es
 * idempotente (un periodo con plan no se toca) y una falla revierte la creación del periodo.
 */
export class TemplatePeriodHook implements PeriodCreatedHook {
  constructor(private readonly budgets: BudgetsService) {}

  async onPeriodCreated(input: {
    readonly workspaceId: string;
    readonly period: FinancialPeriodDto;
  }): Promise<void> {
    await this.budgets.applyDefaultTemplate({ workspaceId: input.workspaceId, periodId: input.period.id });
  }
}
