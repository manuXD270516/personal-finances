import { DomainError } from '@pf/shared-kernel';
import { parseActions, type Action } from './action.js';
import { parseConditionItems, type ConditionItem } from './condition.js';
import {
  DEFAULT_TRIGGERS,
  MATCH_MODES,
  MAX_ACTIONS,
  MAX_CONDITIONS,
  RULE_TRIGGERS,
  type MatchMode,
  type RuleTrigger,
} from './types.js';

/** Definición de una regla: lo que hace (versionado, spec "Versionado de reglas"). */
export interface RuleDefinition {
  readonly matchMode: MatchMode;
  readonly conditions: readonly ConditionItem[];
  readonly actions: readonly Action[];
  readonly triggers: readonly RuleTrigger[];
  readonly stopProcessing: boolean;
}

export interface DefinitionLimits {
  readonly maxConditions: number;
  readonly maxActions: number;
}

export const DEFAULT_DEFINITION_LIMITS: DefinitionLimits = {
  maxConditions: MAX_CONDITIONS,
  maxActions: MAX_ACTIONS,
};

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/** Valida los disparadores: subconjunto no vacío y sin repetidos; ausente ⇒ importación y ejecución retroactiva. */
export function parseTriggers(raw: unknown, pointer = '/triggers'): RuleTrigger[] {
  if (raw === undefined) return [...DEFAULT_TRIGGERS];
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((t) => typeof t !== 'string' || !(RULE_TRIGGERS as readonly string[]).includes(t))
  ) {
    throw invalid(`triggers must be a non-empty subset of ${RULE_TRIGGERS.join(', ')}`, pointer);
  }
  return RULE_TRIGGERS.filter((t) => raw.includes(t));
}

/**
 * Valida y normaliza una definición completa. Cualquier propiedad de acción fuera del esquema (monto, moneda, cuenta,
 * fecha, tipo, estado) ⇒ `VALIDATION_FAILED`; un patrón regex inválido ⇒ `RULE_INVALID_REGEX`.
 */
export function parseDefinition(
  raw: {
    readonly matchMode?: unknown;
    readonly conditions?: unknown;
    readonly actions?: unknown;
    readonly triggers?: unknown;
    readonly stopProcessing?: unknown;
  },
  limits: DefinitionLimits = DEFAULT_DEFINITION_LIMITS,
): RuleDefinition {
  const mode = raw.matchMode ?? 'ALL';
  if (typeof mode !== 'string' || !(MATCH_MODES as readonly string[]).includes(mode)) {
    throw invalid('matchMode must be ALL or ANY', '/matchMode');
  }
  const stop = raw.stopProcessing ?? false;
  if (typeof stop !== 'boolean') throw invalid('stopProcessing must be a boolean', '/stopProcessing');
  return {
    matchMode: mode as MatchMode,
    conditions: parseConditionItems(raw.conditions, limits.maxConditions),
    actions: parseActions(raw.actions, limits.maxActions),
    triggers: parseTriggers(raw.triggers),
    stopProcessing: stop,
  };
}

/** Igualdad estructural de dos definiciones (decide si un cambio crea versión nueva). */
export function sameDefinition(a: RuleDefinition, b: RuleDefinition): boolean {
  return (
    a.matchMode === b.matchMode &&
    a.stopProcessing === b.stopProcessing &&
    JSON.stringify(a.triggers) === JSON.stringify(b.triggers) &&
    JSON.stringify(a.conditions) === JSON.stringify(b.conditions) &&
    JSON.stringify(a.actions) === JSON.stringify(b.actions)
  );
}
