import type { Budget } from '../domain/index.js';
import type { BudgetOriginDto } from './budget-view.js';
import type { BudgetsDeps } from './ports/index.js';

/** Resuelve el origen visible del plan: template y versión (nombre incluido) y plan clonado. */
export async function originOf(deps: BudgetsDeps, budget: Budget): Promise<BudgetOriginDto> {
  const s = budget.snapshot;
  const ref = s.templateVersionId
    ? await deps.templates.versionRef(s.workspaceId, s.templateVersionId)
    : null;
  return {
    templateVersion: ref
      ? { templateId: ref.templateId, versionNo: ref.versionNo, name: ref.templateName }
      : null,
    clonedFromBudgetId: s.clonedFromBudgetId,
  };
}
