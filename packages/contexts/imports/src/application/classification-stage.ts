import {
  EMPTY_PROPOSAL,
  type ClassificationProposal,
  type FieldOrigin,
  type Originated,
  type RowEdits,
} from '../domain/index.js';
import type { ImportsDeps, RuleOutcome, RuleSubject } from './ports/index.js';

/** Sujetos por llamada de `RuleEvaluationQuery.evaluate` (D339). */
export const RULES_BLOCK = 5000;

export const rulesSubjectKind = (direction: 'IN' | 'OUT'): 'INCOME' | 'EXPENSE' =>
  direction === 'IN' ? 'INCOME' : 'EXPENSE';

export interface ProposalRowInput {
  readonly id: string;
  readonly kind: 'INCOME' | 'EXPENSE';
  readonly date: string;
  /** Positivo, escala de la moneda. */
  readonly amount: string;
  readonly description: string | null;
  readonly externalSource: string | null;
  /** Lo editado por el usuario: las reglas solo llenan lo vacío (`FILL_EMPTY`) y las ediciones mandan. */
  readonly edits: RowEdits;
}

export interface ProposalOutput {
  readonly proposal: ClassificationProposal;
  /** Contraparte efectiva (edición o propuesta): entra al puntaje de duplicados y al matching. */
  readonly effectiveCounterpartyId: string | null;
  /** La evaluación de reglas falló para esta fila. */
  readonly rulesUnavailable: boolean;
}

const RULE_ORIGIN = (o: { ruleId: string; ruleVersion: number }): FieldOrigin => ({
  type: 'RULE',
  ruleId: o.ruleId,
  ruleVersion: o.ruleVersion,
});

/**
 * Etapa de clasificación (decisión 8, orden de `add-rule-engine` D333): (1) contraparte por alias, (2) reglas con
 * `trigger = IMPORT` y `mode = FILL_EMPTY` por bloques de 5 000, (3) categoría por defecto de la contraparte,
 * (4) «sin categoría». Una excepción de RULES deja la propuesta sin reglas con `rulesUnavailable` (no bloquea la
 * revisión ni la aprobación). Lo editado por el usuario no se pisa: «reevaluar» recalcula solo la propuesta.
 */
export async function buildProposals(
  deps: ImportsDeps,
  input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly currencyCode: string;
    readonly rows: readonly ProposalRowInput[];
  },
): Promise<Map<string, ProposalOutput>> {
  const { workspaceId } = input;
  const descriptions = [...new Set(input.rows.map((r) => r.description).filter((d): d is string => !!d))];
  const aliases =
    descriptions.length > 0 ? await deps.counterparties.resolveAliases(workspaceId, descriptions) : new Map();

  const counterpartyOf = (row: ProposalRowInput): { id: string; origin: 'USER' | 'ALIAS' } | null => {
    if (row.edits.counterpartyId !== undefined) {
      return row.edits.counterpartyId === null ? null : { id: row.edits.counterpartyId, origin: 'USER' };
    }
    const alias = row.description === null ? null : (aliases.get(row.description) ?? null);
    return alias === null ? null : { id: alias, origin: 'ALIAS' };
  };

  const outcomes = new Map<string, RuleOutcome>();
  let rulesUnavailable = false;
  try {
    for (let i = 0; i < input.rows.length; i += RULES_BLOCK) {
      const chunk = input.rows.slice(i, i + RULES_BLOCK);
      const subjects: RuleSubject[] = chunk.map((row) => {
        const cp = counterpartyOf(row);
        return {
          ref: row.id,
          kind: row.kind,
          accountId: input.accountId,
          date: row.date,
          amount: { amount: row.amount, currency: input.currencyCode },
          description: row.description,
          counterpartyId: cp?.id ?? null,
          counterpartyOrigin: cp?.origin ?? null,
          categoryId: row.edits.categoryId ?? null,
          tagIds: row.edits.tagIds ?? [],
          externalSource: row.externalSource,
          customFields: [],
          splitCount: 1,
          notes: row.edits.note ?? null,
        };
      });
      for (const outcome of await deps.rules.evaluate({ workspaceId, subjects })) {
        outcomes.set(outcome.ref, outcome);
      }
    }
  } catch {
    // La falla de RULES no impide la revisión: las filas quedan sin propuesta de reglas (IMPORT_RULES_UNAVAILABLE).
    rulesUnavailable = true;
    outcomes.clear();
  }

  // Categoría por defecto de las contrapartes efectivas que no recibieron categoría de una regla.
  const defaultNeeded = new Set<string>();
  for (const row of input.rows) {
    const outcome = outcomes.get(row.id);
    const cpId = outcome?.counterparty?.counterpartyId ?? counterpartyOf(row)?.id ?? null;
    if (cpId !== null && !outcome?.category) defaultNeeded.add(cpId);
  }
  const defaults =
    defaultNeeded.size > 0
      ? await deps.counterparties.defaultCategories(workspaceId, [...defaultNeeded])
      : new Map();

  const out = new Map<string, ProposalOutput>();
  for (const row of input.rows) {
    const outcome = outcomes.get(row.id);
    const alias = row.edits.counterpartyId === undefined ? counterpartyOf(row) : null;
    let counterparty: Originated<string | null> | null = null;
    if (outcome?.counterparty) {
      counterparty = {
        value: outcome.counterparty.counterpartyId,
        origin: RULE_ORIGIN(outcome.counterparty.origin),
      };
    } else if (alias) {
      counterparty = { value: alias.id, origin: { type: 'ALIAS' } };
    }
    const effectiveCounterpartyId =
      row.edits.counterpartyId !== undefined ? row.edits.counterpartyId : (counterparty?.value ?? null);

    let category: Originated<string | null> | null = null;
    if (outcome?.category) {
      category = { value: outcome.category.categoryId, origin: RULE_ORIGIN(outcome.category.origin) };
    } else if (effectiveCounterpartyId !== null) {
      const fallback = defaults.get(effectiveCounterpartyId) ?? null;
      if (fallback !== null) category = { value: fallback, origin: { type: 'COUNTERPARTY_DEFAULT' } };
    }

    let tags: Originated<readonly string[]> | null = null;
    if (outcome && (outcome.addTags.length > 0 || outcome.removeTags.length > 0)) {
      const removed = new Set(outcome.removeTags.map((t) => t.tagId));
      const ids = [...new Set(outcome.addTags.map((t) => t.tagId))].filter((t) => !removed.has(t));
      const first = outcome.addTags[0] ?? outcome.removeTags[0];
      if (ids.length > 0 && first) tags = { value: ids, origin: RULE_ORIGIN(first.origin) };
    }

    const description = outcome?.description
      ? { value: outcome.description.text, origin: RULE_ORIGIN(outcome.description.origin) }
      : null;
    const first = outcome?.appendNotes[0];
    const notes =
      outcome && first
        ? { value: outcome.appendNotes.map((n) => n.text).join('\n'), origin: RULE_ORIGIN(first.origin) }
        : null;

    out.set(row.id, {
      proposal: {
        ...EMPTY_PROPOSAL,
        category,
        counterparty,
        tags,
        description,
        notes,
        needsReview: outcome?.markForReview ?? null,
        exclude: outcome?.exclude ?? null,
        rulesUnavailable,
      },
      effectiveCounterpartyId,
      rulesUnavailable,
    });
  }
  return out;
}
