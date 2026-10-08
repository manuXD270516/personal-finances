import { DomainError } from '@pf/shared-kernel';
import type { BudgetLine, BudgetLineSpec } from './budget-line.js';
import type { Budget } from './budget.js';
import { sameSpec, targetKey, type TemplateLine } from './budget-template.js';
import type { BudgetNature, BudgetTarget } from './budget-types.js';
import { TargetOverlapPolicy, type TargetTree } from './target-overlap-policy.js';

export type PropagationAction = 'ADD' | 'UPDATE' | 'REMOVE';
export type ConflictReason = 'OVERRIDDEN' | 'MANUAL_LINE' | 'TARGET_OVERLAP' | 'CURRENCY_MISMATCH';

/** Cambio que la propagación aplicará a una línea de un plan futuro en borrador. */
export interface PlannedChange {
  readonly action: PropagationAction;
  readonly target: BudgetTarget;
  readonly nature: BudgetNature;
  /** Línea del plan afectada (`null` en `ADD`). */
  readonly lineId: string | null;
  readonly from: BudgetLineSpec | null;
  readonly to: BudgetLineSpec | null;
  /** Línea de la versión nueva del template (`null` en `REMOVE`). */
  readonly templateLine: TemplateLine | null;
}

/** Línea que NO se toca: modificada a mano, propia del plan o que chocaría con otra (design decisión 7; docs/33 D85). */
export interface PlannedConflict {
  readonly action: PropagationAction;
  readonly reason: ConflictReason;
  readonly target: BudgetTarget;
  readonly lineId: string | null;
  readonly current: BudgetLineSpec | null;
  readonly proposed: BudgetLineSpec | null;
}

export interface BudgetPropagationPlan {
  readonly budget: Budget;
  readonly changes: PlannedChange[];
  readonly conflicts: PlannedConflict[];
}

export interface TemplateDiffEntry {
  readonly action: PropagationAction;
  readonly target: BudgetTarget;
  readonly before: TemplateLine | null;
  readonly after: TemplateLine | null;
}

/** Diferencia por objetivo entre la versión vigente del template y la instantánea nueva. */
export function diffTemplates(
  base: readonly TemplateLine[],
  next: readonly TemplateLine[],
): TemplateDiffEntry[] {
  const before = new Map(base.map((l) => [targetKey(l.target), l]));
  const after = new Map(next.map((l) => [targetKey(l.target), l]));
  const out: TemplateDiffEntry[] = [];
  for (const [key, n] of after) {
    const b = before.get(key);
    if (!b) out.push({ action: 'ADD', target: n.target, before: null, after: n });
    else if (!sameSpec(b.spec, n.spec) || b.currency !== n.currency) {
      out.push({ action: 'UPDATE', target: n.target, before: b, after: n });
    }
  }
  for (const [key, b] of before) {
    if (!after.has(key)) out.push({ action: 'REMOVE', target: b.target, before: b, after: null });
  }
  return out;
}

/** Una línea del plan "sigue" al template si proviene de una línea de template (no es propia del plan). */
const isManaged = (line: BudgetLine): boolean => line.snapshot.templateLineId !== null;

/**
 * DS `PropagationPlanner` (design decisión 7; docs/33 D85): por cada plan alcanzado y cada diferencia del template
 * decide `ADD` / `UPDATE` / `REMOVE` o conflicto. Nunca pisa una línea modificada a mano (`overridden`) ni una línea
 * propia del plan; las líneas quitadas del template se quitan solo si no fueron editadas. Función pura: el llamador
 * decide qué planes están en alcance (futuros en borrador).
 */
export const PropagationPlanner = {
  plan(input: {
    readonly diff: readonly TemplateDiffEntry[];
    readonly budgets: readonly Budget[];
    readonly tree: TargetTree;
  }): BudgetPropagationPlan[] {
    return input.budgets.map((budget) => {
      const changes: PlannedChange[] = [];
      const conflicts: PlannedConflict[] = [];
      for (const entry of input.diff) {
        const existing = budget.lines.find(
          (l) => l.target.kind === entry.target.kind && l.target.id === entry.target.id,
        );
        const proposed = entry.after?.spec ?? null;
        if (entry.action === 'ADD') {
          const n = entry.after!;
          if (existing) {
            if (sameSpec(existing.spec, n.spec)) continue;
            conflicts.push({
              action: 'ADD',
              reason: 'MANUAL_LINE',
              target: n.target,
              lineId: existing.id,
              current: existing.spec,
              proposed,
            });
            continue;
          }
          if (n.currency !== budget.snapshot.currency) {
            conflicts.push({
              action: 'ADD',
              reason: 'CURRENCY_MISMATCH',
              target: n.target,
              lineId: null,
              current: null,
              proposed,
            });
            continue;
          }
          try {
            TargetOverlapPolicy.assertAllowed(
              budget.lines.map((l) => l.target),
              n.target,
              input.tree,
            );
          } catch (err) {
            if (err instanceof DomainError) {
              conflicts.push({
                action: 'ADD',
                reason: 'TARGET_OVERLAP',
                target: n.target,
                lineId: null,
                current: null,
                proposed,
              });
              continue;
            }
            throw err;
          }
          changes.push({
            action: 'ADD',
            target: n.target,
            nature: n.nature,
            lineId: null,
            from: null,
            to: n.spec,
            templateLine: n,
          });
        } else if (entry.action === 'UPDATE') {
          const n = entry.after!;
          if (!existing) continue; // quitada a mano del plan: no se vuelve a agregar
          if (sameSpec(existing.spec, n.spec)) continue;
          if (isManaged(existing) && !existing.snapshot.overridden) {
            changes.push({
              action: 'UPDATE',
              target: n.target,
              nature: existing.nature,
              lineId: existing.id,
              from: existing.spec,
              to: n.spec,
              templateLine: n,
            });
          } else {
            conflicts.push({
              action: 'UPDATE',
              reason: isManaged(existing) ? 'OVERRIDDEN' : 'MANUAL_LINE',
              target: n.target,
              lineId: existing.id,
              current: existing.spec,
              proposed,
            });
          }
        } else {
          if (!existing || !isManaged(existing)) continue;
          if (existing.snapshot.overridden) {
            conflicts.push({
              action: 'REMOVE',
              reason: 'OVERRIDDEN',
              target: entry.target,
              lineId: existing.id,
              current: existing.spec,
              proposed: null,
            });
          } else {
            changes.push({
              action: 'REMOVE',
              target: entry.target,
              nature: existing.nature,
              lineId: existing.id,
              from: existing.spec,
              to: null,
              templateLine: null,
            });
          }
        }
      }
      return { budget, changes, conflicts };
    });
  },
} as const;
