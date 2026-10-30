import type { Action } from './action.js';
import type { ConditionItem } from './condition.js';
import type { EvaluableRule } from './rule-evaluator.js';
import type { ActionCatalog, RuleSubject } from './types.js';

/** Fixtures de pruebas del dominio (no se exportan por el índice público). */
export function subject(over: Partial<RuleSubject> = {}): RuleSubject {
  return {
    ref: 'row-1',
    kind: 'EXPENSE',
    accountId: 'acc-bob',
    date: '2026-09-03',
    amount: { amount: '185.40', currency: 'BOB' },
    description: 'HIPERMAXI SUC 12',
    counterpartyId: null,
    counterpartyOrigin: null,
    categoryId: null,
    tagIds: [],
    externalSource: 'imports.csv-row',
    customFields: [],
    splitCount: 1,
    ...over,
  };
}

export function rule(
  id: string,
  over: {
    priority?: number;
    createdAt?: string;
    conditions?: readonly ConditionItem[];
    actions?: readonly Action[];
    stopProcessing?: boolean;
    enabled?: boolean;
    archived?: boolean;
    triggers?: EvaluableRule['triggers'];
    matchMode?: EvaluableRule['matchMode'];
    version?: number;
  } = {},
): EvaluableRule {
  return {
    id,
    version: over.version ?? 1,
    priority: over.priority ?? 100,
    createdAt: over.createdAt ?? '2026-10-01T00:00:00.000Z',
    enabled: over.enabled ?? true,
    archived: over.archived ?? false,
    triggers: over.triggers ?? ['IMPORT', 'RETROACTIVE', 'MANUAL_CREATE'],
    stopProcessing: over.stopProcessing ?? false,
    matchMode: over.matchMode ?? 'ALL',
    conditions: over.conditions ?? [{ field: 'DESCRIPTION', operator: 'contains', value: 'hipermaxi' }],
    actions: over.actions ?? [{ type: 'SET_CATEGORY', categoryId: 'cat-super' }],
  };
}

/** Catálogo con todo activo salvo lo que se indique. */
export function catalog(
  over: {
    archivedCategories?: readonly string[];
    kinds?: Readonly<Record<string, 'EXPENSE' | 'INCOME'>>;
    archivedTags?: readonly string[];
  } = {},
): ActionCatalog {
  const kinds: Record<string, 'EXPENSE' | 'INCOME'> = {
    'cat-super': 'EXPENSE',
    'cat-rest': 'EXPENSE',
    'cat-tel': 'EXPENSE',
    'cat-reembolsos': 'INCOME',
    ...over.kinds,
  };
  return {
    activeCategoryKind: (id) => (over.archivedCategories?.includes(id) ? null : (kinds[id] ?? null)),
    isTagActive: (id) => !over.archivedTags?.includes(id),
    isCounterpartyActive: () => true,
    isCustomFieldActive: () => true,
  };
}
