import { BudgetLine } from './budget-line.js';
import type { Budget } from './budget.js';
import type { BudgetTarget } from './budget-types.js';
import type { TemplateVersion } from './budget-template.js';
import type { TargetTree } from './target-overlap-policy.js';

export type OmittedReason = 'TARGET_ARCHIVED' | 'CURRENCY_MISMATCH';

/** Línea omitida al aplicar un template o clonar un plan (design decisión 3; docs/33 D79). */
export interface OmittedLine {
  readonly target: BudgetTarget;
  readonly reason: OmittedReason;
}

export interface CopiedLines {
  readonly lines: BudgetLine[];
  readonly omitted: OmittedLine[];
}

/** Un objetivo inexistente o archivado ya no puede planificarse. */
export function isTargetArchived(tree: TargetTree, target: BudgetTarget): boolean {
  if (target.kind === 'CATEGORY') return tree.categories.get(target.id)?.archived ?? true;
  if (target.kind === 'GROUP') return tree.groups.get(target.id)?.archived ?? true;
  return tree.tags.get(target.id)?.archived ?? true;
}

/**
 * DS `BudgetFromTemplateFactory` (design decisiones 2 y 3): copia las líneas de una versión de template al plan de un
 * periodo. Las de objetivo archivado (`TARGET_ARCHIVED`) o de otra moneda que la del plan (`CURRENCY_MISMATCH`, sin
 * convertir montos planificados) se omiten e informan; el template de origen no cambia.
 */
export const BudgetFromTemplateFactory = {
  build(input: {
    readonly version: TemplateVersion;
    readonly workspaceId: string;
    readonly budgetId: string;
    readonly currency: string;
    readonly tree: TargetTree;
    readonly nextId: () => string;
  }): CopiedLines {
    const lines: BudgetLine[] = [];
    const omitted: OmittedLine[] = [];
    for (const l of input.version.lines) {
      if (isTargetArchived(input.tree, l.target)) {
        omitted.push({ target: l.target, reason: 'TARGET_ARCHIVED' });
      } else if (l.currency !== input.currency) {
        omitted.push({ target: l.target, reason: 'CURRENCY_MISMATCH' });
      } else {
        lines.push(
          BudgetLine.create({
            id: input.nextId(),
            workspaceId: input.workspaceId,
            budgetId: input.budgetId,
            target: l.target,
            nature: l.nature,
            spec: l.spec,
            source: 'TEMPLATE',
            templateLineId: l.id,
          }),
        );
      }
    }
    return { lines, omitted };
  },
} as const;

/**
 * DS `BudgetCloner` (design decisión 4): copia objetivo, tipo, montos, umbrales, política de rollover, marca de
 * modificada y línea de template de origen del plan anterior. NO copia el gastado, los cruces de umbral ni el
 * remanente recibido (`rolloverIn` se recalcula con el plan nuevo).
 */
export const BudgetCloner = {
  build(input: {
    readonly previous: Budget;
    readonly workspaceId: string;
    readonly budgetId: string;
    readonly currency: string;
    readonly tree: TargetTree;
    readonly nextId: () => string;
  }): CopiedLines {
    const lines: BudgetLine[] = [];
    const omitted: OmittedLine[] = [];
    const sameCurrency = input.previous.snapshot.currency === input.currency;
    for (const prev of input.previous.lines) {
      const s = prev.snapshot;
      if (isTargetArchived(input.tree, s.target)) {
        omitted.push({ target: s.target, reason: 'TARGET_ARCHIVED' });
      } else if (!sameCurrency) {
        omitted.push({ target: s.target, reason: 'CURRENCY_MISMATCH' });
      } else {
        lines.push(
          BudgetLine.create({
            id: input.nextId(),
            workspaceId: input.workspaceId,
            budgetId: input.budgetId,
            target: s.target,
            nature: s.nature,
            spec: prev.spec,
            source: s.source === 'MANUAL' ? 'MANUAL' : 'CLONE',
            templateLineId: s.templateLineId,
            overridden: s.overridden,
          }),
        );
      }
    }
    return { lines, omitted };
  },
} as const;
