import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeKind,
  MergeParticipantInput,
  MergePreviewResult,
} from '@pf/classification/contracts';
import {
  isGroup,
  parseDefinition,
  type Action,
  type Condition,
  type ConditionItem,
  type Rule,
  type RuleDefinition,
} from '../domain/index.js';
import type { RulesDeps } from './ports/index.js';
import { diff, ruleAuditView } from './rules.service.js';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Quita los elementos estructuralmente idénticos (los duplicados que deja una fusión); conserva el primero. */
function collapse<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of items) if (!out.some((o) => same(o, item))) out.push(item);
  return out;
}

const fieldOf = (kind: MergeKind) => (kind === 'CATEGORY' ? 'CATEGORY' : 'COUNTERPARTY');

function retargetCondition(c: Condition, kind: MergeKind, from: string, to: string): Condition {
  if (c.field !== fieldOf(kind)) return c;
  const value = c.value === from ? to : c.value;
  const values = c.values === undefined ? undefined : collapse(c.values.map((v) => (v === from ? to : v)));
  return {
    ...c,
    ...(value === undefined ? {} : { value }),
    ...(values === undefined ? {} : { values }),
  };
}

function retargetItems(
  items: readonly ConditionItem[],
  kind: MergeKind,
  from: string,
  to: string,
): ConditionItem[] {
  return collapse(
    items.map((i) =>
      isGroup(i)
        ? {
            ...i,
            items: collapse(i.items.map((c) => retargetCondition(c, kind, from, to))),
          }
        : retargetCondition(i, kind, from, to),
    ),
  );
}

function retargetAction(a: Action, kind: MergeKind, from: string, to: string): Action {
  if (kind === 'CATEGORY' && a.type === 'SET_CATEGORY' && a.categoryId === from) {
    return { ...a, categoryId: to };
  }
  if (kind === 'COUNTERPARTY' && a.type === 'SET_COUNTERPARTY' && a.counterpartyId === from) {
    return { ...a, counterpartyId: to };
  }
  return a;
}

/**
 * Definición de la regla con la origen reemplazada por la destino en las condiciones y acciones del tipo fusionado
 * (`CATEGORY`: condiciones sobre la categoría y `SET_CATEGORY`; `COUNTERPARTY`: sobre la contraparte y
 * `SET_COUNTERPARTY`); las condiciones y acciones que quedan duplicadas se colapsan. `null` si la regla no la usa.
 */
export function retargetDefinition(
  def: RuleDefinition,
  kind: MergeKind,
  from: string,
  to: string,
): RuleDefinition | null {
  const next = parseDefinition({
    matchMode: def.matchMode,
    conditions: retargetItems(def.conditions, kind, from, to),
    actions: collapse(def.actions.map((a) => retargetAction(a, kind, from, to))),
    triggers: def.triggers,
    stopProcessing: def.stopProcessing,
  });
  return same(next, def) ? null : next;
}

/**
 * Participante de RULES en la fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge,
 * decisión 4): cada regla NO archivada (activa o inactiva) cuya condición o acción usa la origen recibe una versión
 * NUEVA con la destino (las versiones anteriores quedan para la auditoría). Las decisiones y resultados de las
 * sugerencias son historia y no cambian. Corre en la unidad de trabajo de la fusión.
 */
export class RulesMergeParticipant implements ClassificationMergeParticipant {
  readonly context = 'rules';

  constructor(private readonly deps: Pick<RulesDeps, 'rules' | 'audit' | 'clock'>) {}

  private async affected(
    input: MergeParticipantInput,
  ): Promise<readonly { readonly rule: Rule; readonly next: RuleDefinition }[]> {
    const rules = await this.deps.rules.listAll(input.workspaceId, { includeArchived: false });
    return rules.flatMap((rule) => {
      const next = retargetDefinition(rule.snapshot, input.kind, input.sourceId, input.targetId);
      return next ? [{ rule, next }] : [];
    });
  }

  async preview(input: MergeParticipantInput): Promise<MergePreviewResult> {
    return { counts: [{ key: 'RULES', count: (await this.affected(input)).length }], conflicts: [] };
  }

  async apply(input: MergeParticipantInput & { readonly operationId: string }): Promise<MergeApplyResult> {
    const affected = await this.affected(input);
    const now = this.deps.clock.now().toString();
    for (const { rule, next } of affected) {
      const before = ruleAuditView(rule.snapshot);
      const expectedRowVersion = rule.snapshot.rowVersion;
      rule.update({ definition: next }, now);
      if (!(await this.deps.rules.update(rule, expectedRowVersion))) {
        throw new Error(`rule ${rule.id} changed during the merge`);
      }
      await this.deps.rules.insertVersion(rule.snapshot, input.userId);
      await this.deps.audit.append({
        workspaceId: input.workspaceId,
        action: 'rules.rule.updated',
        aggregateType: 'Rule',
        aggregateId: rule.id,
        aggregateVersion: rule.snapshot.version,
        correlationId: input.operationId,
        actor: { type: 'USER', userId: input.userId },
        changes: diff(before, ruleAuditView(rule.snapshot)),
      });
    }
    return { counts: [{ key: 'RULES', count: affected.length }] };
  }
}
