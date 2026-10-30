/** Tipos de la API de reglas (openspec add-rule-engine; contracts/openapi `Rule*`). Dinero siempre como texto decimal. */

export type RuleTrigger = 'IMPORT' | 'MANUAL_CREATE' | 'RETROACTIVE';
export type RuleMatchMode = 'ALL' | 'ANY';
export type RuleStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type RuleMode = 'FILL_EMPTY' | 'OVERWRITE';

export type ConditionField =
  | 'DESCRIPTION'
  | 'COUNTERPARTY'
  | 'AMOUNT'
  | 'CURRENCY'
  | 'ACCOUNT'
  | 'KIND'
  | 'DATE'
  | 'WEEKDAY'
  | 'DAY_OF_MONTH'
  | 'CATEGORY'
  | 'TAG'
  | 'EXTERNAL_SOURCE'
  | 'CUSTOM_FIELD';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches_regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'is_empty'
  | 'is_not_empty';

export interface RuleCondition {
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  readonly value?: string | number | boolean;
  readonly valueTo?: string | number;
  readonly values?: readonly (string | number)[];
  readonly currency?: string;
  readonly fieldId?: string;
}

export interface RuleConditionGroup {
  readonly match: RuleMatchMode;
  readonly items: readonly RuleCondition[];
}

export type RuleConditionItem = RuleCondition | RuleConditionGroup;

export type ActionType =
  | 'SET_CATEGORY'
  | 'ADD_TAG'
  | 'REMOVE_TAG'
  | 'SET_COUNTERPARTY'
  | 'SET_CUSTOM_FIELD'
  | 'MARK_FOR_REVIEW'
  | 'SET_DESCRIPTION'
  | 'APPEND_NOTE'
  | 'EXCLUDE_FROM_IMPORT';

export interface RuleAction {
  readonly type: ActionType;
  readonly categoryId?: string;
  readonly tagId?: string;
  readonly counterpartyId?: string;
  readonly fieldId?: string;
  readonly value?: string | boolean;
  readonly text?: string;
}

export interface RuleStats {
  readonly classifiedTransactions: number;
  readonly lastAppliedAt: string | null;
  readonly unusedFor90Days: boolean;
}

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priority: number;
  readonly enabled: boolean;
  readonly status: RuleStatus;
  readonly triggers: readonly RuleTrigger[];
  readonly matchMode: RuleMatchMode;
  readonly conditions: readonly RuleConditionItem[];
  readonly actions: readonly RuleAction[];
  readonly stopProcessing: boolean;
  /** Versión de la definición. */
  readonly version: number;
  /** Versión de la fila (`ETag`, `If-Match`). */
  readonly rowVersion: number;
  readonly needsAttention: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stats?: RuleStats;
}

export interface RuleList {
  readonly data: readonly Rule[];
}

export interface RuleVersion {
  readonly ruleId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly name: string;
  readonly triggers: readonly RuleTrigger[];
  readonly matchMode: RuleMatchMode;
  readonly conditions: readonly RuleConditionItem[];
  readonly actions: readonly RuleAction[];
  readonly stopProcessing: boolean;
}

export interface RulePreview {
  readonly matched: boolean;
  readonly conditions: readonly {
    readonly path: string;
    readonly met: boolean;
    readonly actual: string | null;
  }[];
  readonly actions: readonly RuleAction[];
  readonly skipped: readonly { readonly action: string; readonly reason: string }[];
}

export interface DryRunChange {
  readonly field: string;
  readonly before: string | boolean | null;
  readonly after: string | boolean | null;
  readonly ruleId: string;
  readonly ruleVersion: number;
}

export interface DryRunItem {
  readonly transactionId: string;
  readonly version: number;
  readonly applicable: boolean;
  readonly reasons: readonly string[];
  readonly changes: readonly DryRunChange[];
}

export interface DryRun {
  readonly scanned: number;
  readonly changed: number;
  readonly truncated: boolean;
  readonly token: string;
  readonly items: readonly DryRunItem[];
}

export interface DryRunApplyResult {
  readonly bulkOperationId: string;
  readonly applied: number;
  readonly notApplicable: readonly { readonly transactionId: string; readonly reason: string }[];
}

export type CategoryOrigin = 'MANUAL' | 'RULE' | 'COUNTERPARTY_DEFAULT' | 'SYSTEM_DEFAULT' | 'UNKNOWN';

export interface Coverage {
  readonly count: number;
  readonly byOrigin: {
    readonly rule: number;
    readonly counterpartyDefault: number;
    readonly manual: number;
    readonly systemDefault: number;
    readonly unknown: number;
  };
  readonly ruleCoverage: string;
  readonly target: string;
  readonly meetsTarget: boolean;
  readonly byRule: readonly {
    readonly ruleId: string;
    readonly name: string;
    readonly version: number | null;
    readonly archived: boolean;
    readonly count: number;
  }[];
}

/** Referencia de regla en un split (`ruleRefs` del detalle de la transacción). */
export interface SplitRuleRef {
  readonly field: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly ruleName: string | null;
  readonly ruleArchived?: boolean;
}
