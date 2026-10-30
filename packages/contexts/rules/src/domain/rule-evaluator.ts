import type { Action } from './action.js';
import { compileConditionTree, SubjectView, type CompiledNode, type ConditionTrace } from './condition.js';
import type { RuleDefinition } from './rule-definition.js';
import {
  SKIP_REASONS,
  type ActionCatalog,
  type EvaluationMode,
  type RuleOrigin,
  type RuleOutcome,
  type RuleSubject,
  type RuleTrigger,
  type SkippedAction,
} from './types.js';

/** Regla lista para evaluar (estado vigente + versión de la definición). */
export interface EvaluableRule extends RuleDefinition {
  readonly id: string;
  readonly version: number;
  readonly priority: number;
  readonly createdAt: string;
  readonly enabled: boolean;
  readonly archived: boolean;
}

interface Compiled {
  readonly rule: EvaluableRule;
  readonly origin: RuleOrigin;
  readonly node: CompiledNode;
}

/** Orden total y determinista: `(priority ASC, created_at ASC, id ASC)` (spec "Prioridad y resolución"). */
export function compareRules(a: EvaluableRule, b: EvaluableRule): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reglas activas del disparador, ordenadas y compiladas UNA vez. */
export class CompiledRuleSet {
  private constructor(
    readonly trigger: RuleTrigger,
    private readonly compiled: readonly Compiled[],
  ) {}

  /**
   * Compila las reglas del disparador. `cache` (opcional) reutiliza los árboles ya compilados por `(id, versión)`: una
   * versión es inmutable, así que el árbol compilado no cambia (el llamador es dueño del caché y su alcance).
   */
  static compile(
    rules: readonly EvaluableRule[],
    trigger: RuleTrigger,
    cache?: Map<string, CompiledNode>,
  ): CompiledRuleSet {
    const active = rules
      .filter((r) => r.enabled && !r.archived && r.triggers.includes(trigger))
      .sort(compareRules)
      .map((rule): Compiled => {
        const key = `${rule.id}:${rule.version}`;
        let node = cache?.get(key);
        if (!node) {
          node = compileConditionTree(rule.matchMode, rule.conditions);
          cache?.set(key, node);
        }
        return { rule, origin: { ruleId: rule.id, ruleVersion: rule.version }, node };
      });
    return new CompiledRuleSet(trigger, active);
  }

  get size(): number {
    return this.compiled.length;
  }

  /** Evalúa un sujeto contra la cadena de reglas (función pura, sin efectos). */
  evaluate(subject: RuleSubject, mode: EvaluationMode, catalog: ActionCatalog): RuleOutcome {
    const view = new SubjectView(subject);
    const acc = new Accumulator(subject, this.trigger, mode, catalog);
    for (const c of this.compiled) {
      if (!c.node.test(view)) continue;
      acc.matched.push(c.origin);
      for (const action of c.rule.actions) acc.apply(action, c.origin);
      if (c.rule.stopProcessing) break;
    }
    return acc.toOutcome();
  }
}

/** Acumula las acciones de las reglas coincidentes: por campo (y por etiqueta) gana la primera que lo fija. */
class Accumulator {
  readonly matched: RuleOrigin[] = [];
  private readonly skipped: SkippedAction[] = [];
  private category: RuleOutcome['category'] = null;
  private categoryClaimed = false;
  private counterparty: RuleOutcome['counterparty'] = null;
  private counterpartyClaimed = false;
  private readonly tagDecided = new Set<string>();
  private readonly addTags: { tagId: string; origin: RuleOrigin }[] = [];
  private readonly removeTags: { tagId: string; origin: RuleOrigin }[] = [];
  private readonly fieldDecided = new Set<string>();
  private readonly customFields: { fieldId: string; value: string | boolean; origin: RuleOrigin }[] = [];
  private description: RuleOutcome['description'] = null;
  private descriptionClaimed = false;
  private readonly appendNotes: { text: string; origin: RuleOrigin }[] = [];
  private review: RuleOrigin | null = null;
  private exclude: RuleOrigin | null = null;

  constructor(
    private readonly subject: RuleSubject,
    private readonly trigger: RuleTrigger,
    private readonly mode: EvaluationMode,
    private readonly catalog: ActionCatalog,
  ) {}

  private skip(origin: RuleOrigin, action: Action, reason: string): void {
    this.skipped.push({ origin, action: action.type, reason });
  }

  private get fillOnly(): boolean {
    return this.mode === 'FILL_EMPTY';
  }

  apply(action: Action, origin: RuleOrigin): void {
    const s = this.subject;
    switch (action.type) {
      case 'SET_CATEGORY': {
        if (this.categoryClaimed) return;
        if (s.splitCount !== 1) return this.skip(origin, action, SKIP_REASONS.multiSplit);
        const kind = this.catalog.activeCategoryKind(action.categoryId);
        if (kind === null) return this.skip(origin, action, SKIP_REASONS.targetArchived);
        if (kind !== (s.kind === 'INCOME' ? 'INCOME' : 'EXPENSE')) {
          return this.skip(origin, action, SKIP_REASONS.categoryKindMismatch);
        }
        if (this.fillOnly && s.categoryId !== null) return this.skip(origin, action, SKIP_REASONS.notEmpty);
        this.categoryClaimed = true;
        this.category = { categoryId: action.categoryId, origin };
        return;
      }
      case 'SET_COUNTERPARTY': {
        if (this.counterpartyClaimed) return;
        if (!this.catalog.isCounterpartyActive(action.counterpartyId)) {
          return this.skip(origin, action, SKIP_REASONS.targetArchived);
        }
        const replaceable = s.counterpartyId === null || s.counterpartyOrigin === 'ALIAS';
        if (this.fillOnly && !replaceable) return this.skip(origin, action, SKIP_REASONS.notEmpty);
        this.counterpartyClaimed = true;
        if (action.counterpartyId !== s.counterpartyId) {
          this.counterparty = { counterpartyId: action.counterpartyId, origin };
        }
        return;
      }
      case 'ADD_TAG': {
        if (this.tagDecided.has(action.tagId)) return;
        if (s.splitCount !== 1) return this.skip(origin, action, SKIP_REASONS.multiSplit);
        if (!this.catalog.isTagActive(action.tagId)) {
          return this.skip(origin, action, SKIP_REASONS.targetArchived);
        }
        this.tagDecided.add(action.tagId);
        if (!s.tagIds.includes(action.tagId)) this.addTags.push({ tagId: action.tagId, origin });
        return;
      }
      case 'REMOVE_TAG': {
        if (this.tagDecided.has(action.tagId)) return;
        if (s.splitCount !== 1) return this.skip(origin, action, SKIP_REASONS.multiSplit);
        const present = s.tagIds.includes(action.tagId);
        // Quitar una etiqueta es reemplazar un valor del usuario: solo en modo de reemplazo.
        if (this.fillOnly && present) return this.skip(origin, action, SKIP_REASONS.notEmpty);
        this.tagDecided.add(action.tagId);
        if (present) this.removeTags.push({ tagId: action.tagId, origin });
        return;
      }
      case 'SET_CUSTOM_FIELD': {
        if (this.fieldDecided.has(action.fieldId)) return;
        if (s.splitCount !== 1) return this.skip(origin, action, SKIP_REASONS.multiSplit);
        if (!this.catalog.isCustomFieldActive(action.fieldId)) {
          return this.skip(origin, action, SKIP_REASONS.targetArchived);
        }
        const current = s.customFields.find((f) => f.fieldId === action.fieldId);
        if (this.fillOnly && current !== undefined) return this.skip(origin, action, SKIP_REASONS.notEmpty);
        this.fieldDecided.add(action.fieldId);
        if (current === undefined || current.value !== action.value) {
          this.customFields.push({ fieldId: action.fieldId, value: action.value, origin });
        }
        return;
      }
      case 'SET_DESCRIPTION': {
        if (this.descriptionClaimed) return;
        // En la importación el texto original queda en el staging: la glosa visible siempre es reemplazable.
        const empty = (s.description ?? '').trim().length === 0;
        if (this.fillOnly && this.trigger !== 'IMPORT' && !empty) {
          return this.skip(origin, action, SKIP_REASONS.notEmpty);
        }
        this.descriptionClaimed = true;
        if (action.text !== s.description) this.description = { text: action.text, origin };
        return;
      }
      case 'APPEND_NOTE': {
        if ((s.notes ?? '').includes(action.text) || this.appendNotes.some((n) => n.text === action.text)) {
          return this.skip(origin, action, SKIP_REASONS.alreadyApplied);
        }
        this.appendNotes.push({ text: action.text, origin });
        return;
      }
      case 'MARK_FOR_REVIEW':
        if (this.review === null) this.review = origin;
        return;
      case 'EXCLUDE_FROM_IMPORT':
        // Sin efecto en la creación manual ni en la ejecución retroactiva.
        if (this.trigger === 'IMPORT' && this.exclude === null) this.exclude = origin;
        return;
    }
  }

  toOutcome(): RuleOutcome {
    return {
      ref: this.subject.ref,
      category: this.category,
      counterparty: this.counterparty,
      addTags: this.addTags,
      removeTags: this.removeTags,
      customFields: this.customFields,
      description: this.description,
      appendNotes: this.appendNotes,
      markForReview: this.review,
      exclude: this.exclude,
      matched: this.matched,
      skipped: this.skipped,
    };
  }
}

/** Evalúa un conjunto de sujetos con las reglas dadas (compila una sola vez). */
export function evaluateRules(input: {
  readonly rules: readonly EvaluableRule[];
  readonly subjects: readonly RuleSubject[];
  readonly trigger: RuleTrigger;
  readonly mode: EvaluationMode;
  readonly catalog: ActionCatalog;
}): RuleOutcome[] {
  const set = CompiledRuleSet.compile(input.rules, input.trigger);
  return input.subjects.map((s) => set.evaluate(s, input.mode, input.catalog));
}

/** Resultado de probar UNA regla contra un sujeto (vista previa): condiciones con su resultado y acciones. */
export interface RulePreview {
  readonly matched: boolean;
  readonly conditions: readonly ConditionTrace[];
  readonly outcome: RuleOutcome;
}

/**
 * Vista previa de una regla (guardada o no) contra un sujeto: ignora el estado `enabled` y el disparador (la regla se
 * prueba aunque esté inactiva) y no mira otras reglas.
 */
export function previewRule(input: {
  readonly rule: EvaluableRule;
  readonly subject: RuleSubject;
  readonly trigger: RuleTrigger;
  readonly mode: EvaluationMode;
  readonly catalog: ActionCatalog;
}): RulePreview {
  const node = compileConditionTree(input.rule.matchMode, input.rule.conditions);
  const view = new SubjectView(input.subject);
  const matched = node.test(view);
  const conditions = node.trace(view);
  const solo: EvaluableRule = { ...input.rule, enabled: true, archived: false, triggers: [input.trigger] };
  const outcome = matched
    ? CompiledRuleSet.compile([solo], input.trigger).evaluate(input.subject, input.mode, input.catalog)
    : {
        ref: input.subject.ref,
        category: null,
        counterparty: null,
        addTags: [],
        removeTags: [],
        customFields: [],
        description: null,
        appendNotes: [],
        markForReview: null,
        exclude: null,
        matched: [],
        skipped: [],
      };
  return { matched, conditions, outcome };
}
