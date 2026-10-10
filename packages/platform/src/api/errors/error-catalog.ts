/**
 * Catálogo ÚNICO de códigos de error de la API (docs/10 §9.1, `components.schemas.ErrorCode` del contrato).
 *
 * - `code` es contrato estable para el cliente: mantiene significado y estado HTTP entre versiones compatibles.
 * - `title` es inglés técnico (RFC 9457); la UI muestra el mensaje en español de `errors.es.json` por `code`.
 * - Un test verifica igualdad de conjuntos y de estados con el contrato y con los catálogos i18n de finance-web
 *   (TC-PLATFORM-API-005). Agregar un código aquí exige agregarlo al contrato y a `errors.<locale>.json`.
 */
export const ERROR_CATALOG = {
  // platform / api-conventions
  VALIDATION_FAILED: { status: 400, title: 'Request does not match the contract' },
  INVALID_CURSOR: { status: 400, title: 'Invalid pagination cursor' },
  INVALID_SORT: { status: 400, title: 'Sort key not allowed' },
  INVALID_FILTER: { status: 400, title: 'Invalid filter' },
  RESOURCE_NOT_FOUND: { status: 404, title: 'Resource not found' },
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed on this resource' },
  CONCURRENCY_CONFLICT: { status: 409, title: 'Concurrent modification detected' },
  IDEMPOTENCY_REQUEST_IN_PROGRESS: {
    status: 409,
    title: 'A request with this Idempotency-Key is in progress',
  },
  PRECONDITION_FAILED: { status: 412, title: 'If-Match does not match the current version' },
  PRECONDITION_REQUIRED: { status: 428, title: 'If-Match header is required' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 428, title: 'Idempotency-Key header is required' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, title: 'Idempotency-Key reused with a different payload' },
  REFERENCE_NOT_FOUND: { status: 422, title: 'Referenced resource not found in this workspace' },
  RATE_LIMITED: { status: 429, title: 'Rate limit exceeded' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service temporarily unavailable' },
  // identity / security
  UNAUTHENTICATED: { status: 401, title: 'Authentication required' },
  WORKSPACE_ACCESS_DENIED: { status: 403, title: 'Not an active member of the workspace' },
  INSUFFICIENT_ROLE: { status: 403, title: 'Role not allowed for this operation' },
  INVALID_TIMEZONE: { status: 422, title: 'Invalid IANA time zone' },
  WORKSPACE_PENDING_DELETION: { status: 409, title: 'Workspace is pending deletion' },
  LAST_OWNER_CANNOT_LEAVE: { status: 409, title: 'The last owner cannot leave the workspace' },
  DEMO_WORKSPACE_ALREADY_EXISTS: { status: 409, title: 'A demo workspace already exists for this user' },
  WORKSPACE_NOT_DEMO: { status: 409, title: 'Workspace is not a demo workspace' },
  DEMO_DATA_DISABLED: { status: 403, title: 'Loading demo data is disabled in this environment' },
  // money / ledger
  MONEY_INVALID_AMOUNT: { status: 422, title: 'Invalid amount' },
  AMOUNT_OUT_OF_RANGE: { status: 422, title: 'Amount out of range' },
  AMOUNT_SCALE_EXCEEDED: { status: 422, title: 'Amount has more decimals than the currency allows' },
  AMOUNT_NOT_POSITIVE: { status: 422, title: 'Amount must be positive' },
  CURRENCY_MISMATCH: { status: 422, title: 'Currency does not match' },
  LEDGER_UNBALANCED_ENTRY: { status: 422, title: 'Journal entry is not balanced' },
  LEDGER_ENTRY_TOO_FEW_POSTINGS: { status: 422, title: 'Journal entry needs at least two postings' },
  LEDGER_ZERO_AMOUNT_POSTING: { status: 422, title: 'Posting amount cannot be zero' },
  LEDGER_SPLIT_REQUIRED: { status: 422, title: 'Posting must reference a split' },
  LEDGER_ENTRY_ALREADY_REVERSED: { status: 409, title: 'Journal entry already reversed' },
  LEDGER_ENTRY_NOT_REVERSIBLE: { status: 409, title: 'Journal entry cannot be reversed' },
  PERIOD_CLOSED: { status: 409, title: 'Accounting period is closed' },
  // accounts
  ACCOUNT_ARCHIVED: { status: 409, title: 'Account is archived' },
  ACCOUNT_CLOSED: { status: 409, title: 'Account is closed' },
  ACCOUNT_BALANCE_NOT_ZERO: { status: 409, title: 'Account balance is not zero' },
  ACCOUNT_CURRENCY_IMMUTABLE: { status: 409, title: 'Account currency cannot change' },
  ACCOUNT_CURRENCY_KIND_MISMATCH: { status: 422, title: 'Currency kind not allowed for this account type' },
  ACCOUNT_NAME_TAKEN: { status: 409, title: 'Account name already in use' },
  INSTITUTION_ARCHIVED: { status: 409, title: 'Institution is archived' },
  // transactions
  SPLITS_DO_NOT_SUM: { status: 422, title: 'Splits do not sum to the transaction amount' },
  INVALID_STATUS_TRANSITION: { status: 409, title: 'Invalid status transition' },
  TRANSACTION_RECONCILED: { status: 409, title: 'Transaction is reconciled' },
  REFUND_EXCEEDS_ORIGINAL: { status: 422, title: 'Refund exceeds the original expense' },
  TRANSFER_SAME_ACCOUNT: { status: 422, title: 'Transfer source and destination are the same account' },
  TRANSFER_CURRENCY_MISMATCH: { status: 422, title: 'Transfer accounts have different currencies' },
  CONVERSION_SAME_CURRENCY: { status: 422, title: 'Conversion between the same currency' },
  CONVERSION_AMOUNTS_INCONSISTENT: { status: 422, title: 'Conversion amounts are inconsistent' },
  // classification
  CATEGORY_ARCHIVED: { status: 409, title: 'Category is archived' },
  TAG_ARCHIVED: { status: 409, title: 'Tag is archived' },
  COUNTERPARTY_ARCHIVED: { status: 409, title: 'Counterparty is archived' },
  CATEGORY_KIND_MISMATCH: { status: 422, title: 'Category kind does not match the transaction' },
  CATEGORY_DEPTH_EXCEEDED: { status: 422, title: 'Category hierarchy too deep' },
  CATEGORY_GROUP_NOT_EMPTY: { status: 409, title: 'Category group is not empty' },
  SYSTEM_CATEGORY_IMMUTABLE: { status: 409, title: 'System categories are immutable' },
  COUNTERPARTY_ALIAS_TAKEN: { status: 409, title: 'Counterparty alias already in use' },
  NAME_TAKEN: { status: 409, title: 'Name already in use' },
  // classification: custom fields (Phase 2, add-custom-fields)
  CUSTOM_FIELD_KEY_TAKEN: { status: 409, title: 'Custom field key already in use' },
  CUSTOM_FIELD_ARCHIVED: { status: 409, title: 'Custom field is archived' },
  CUSTOM_FIELD_TYPE_LOCKED: {
    status: 409,
    title: 'Custom field type or target is locked by existing values',
  },
  CUSTOM_FIELD_OPTION_IN_USE: { status: 409, title: 'Custom field option is in use' },
  CUSTOM_FIELD_VALUE_INVALID: { status: 422, title: 'Custom field value is invalid' },
  CUSTOM_FIELD_REQUIRED: { status: 422, title: 'A required custom field has no value' },
  CUSTOM_FIELD_TARGET_MISMATCH: { status: 422, title: 'Custom field does not apply to this entity' },
  // fx
  FX_RATE_NOT_FOUND: { status: 422, title: 'No exchange rate for the pair and date' },
  FX_RATE_ALREADY_SUPERSEDED: { status: 409, title: 'Exchange rate already superseded' },
  FX_RATE_ANOMALY_ALREADY_REVIEWED: { status: 409, title: 'Exchange rate anomaly already reviewed' },
  FX_RATE_NOT_ANOMALOUS: { status: 422, title: 'Exchange rate is not flagged as anomalous' },
  CURRENCY_NOT_ENABLED: { status: 422, title: 'Currency not enabled in this workspace' },
  // planning (Phase 2)
  PERIOD_NOT_STARTED: { status: 409, title: 'Financial period has not started yet' },
  PERIOD_NOT_ENDED: { status: 409, title: 'Financial period has not ended yet' },
  PERIOD_PREVIOUS_NOT_CLOSED: { status: 409, title: 'The previous financial period is not closed' },
  PERIOD_NEXT_CLOSED: { status: 409, title: 'The next financial period is closed' },
  MONTH_CLOSING_BLOCKED: { status: 409, title: 'Month closing is blocked by checklist items' },
  MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED: {
    status: 409,
    title: 'Month closing warnings are not acknowledged',
  },
  BUDGET_ALREADY_EXISTS: { status: 409, title: 'The period already has a budget plan' },
  BUDGET_LINE_DUPLICATE_TARGET: { status: 409, title: 'The plan already has a line for this target' },
  BUDGET_TARGET_OVERLAP: { status: 409, title: 'The target overlaps another line of the plan' },
  BUDGET_INVALID_AMOUNTS: { status: 422, title: 'Budget line amounts are not valid' },
  BUDGET_INVALID_LINE_KIND: { status: 422, title: 'Budget line kind is not allowed for this target' },
  BUDGET_THRESHOLD_INVALID: { status: 422, title: 'Alert thresholds are not valid' },
  BUDGET_TEMPLATE_ARCHIVED: { status: 409, title: 'The budget template is archived' },
  BUDGET_PROPAGATION_STALE: { status: 409, title: 'The plans or the template changed since the preview' },
  BUDGET_NO_TEMPLATE_ORIGIN: { status: 422, title: 'The plan does not come from a template' },
  // transactions / reconciliation (Phase 2)
  RECONCILIATION_IN_PROGRESS: { status: 409, title: 'The account already has a reconciliation in progress' },
  RECONCILIATION_STATEMENT_DATE_INVALID: {
    status: 422,
    title: 'Reconciliation statement date is not allowed',
  },
  RECONCILIATION_DIFFERENCE_NOT_ZERO: {
    status: 422,
    title: 'Reconciliation difference must be zero or adjusted',
  },
  // identity / workspace portability (Phase 2, add-workspace-export)
  REAUTHENTICATION_REQUIRED: { status: 403, title: 'A recent authentication is required for this operation' },
  EXPORT_IN_PROGRESS: { status: 409, title: 'The workspace already has an export in progress' },
  IMPORT_IN_PROGRESS: { status: 409, title: 'The user already has an import in progress' },
  EXPORT_NOT_READY: { status: 409, title: 'The export is not ready yet' },
  EXPORT_EXPIRED: { status: 410, title: 'The export has expired or was discarded' },
  EXPORT_FILE_CORRUPTED: { status: 422, title: 'The export file is corrupted or was altered' },
  EXPORT_FORMAT_UNSUPPORTED: { status: 422, title: 'The export format is not supported' },
  EXPORT_VERIFICATION_FAILED: { status: 422, title: 'The imported data does not match the export manifest' },
  UPLOAD_TOO_LARGE: { status: 413, title: 'The uploaded file exceeds the maximum size' },
  // imports / basic CSV import (Phase 3)
  IMPORT_UNSUPPORTED_FORMAT: { status: 422, title: 'The file is not readable delimited text' },
  IMPORT_TOO_MANY_ROWS: { status: 422, title: 'The file has more data rows than allowed' },
  IMPORT_MAPPING_INVALID: { status: 422, title: 'The column mapping is not valid for this file' },
  IMPORT_REVIEW_INCOMPLETE: { status: 409, title: 'The import still has rows waiting for a decision' },
  // transactions / bulk edit (Phase 2)
  BULK_EDIT_NOT_APPLICABLE: { status: 422, title: 'The change does not apply to the transaction' },
  // commitments / recurrence engine (Phase 3)
  INVALID_RRULE: { status: 422, title: 'The recurrence rule is not supported or produces no dates' },
  RECURRING_KIND_NOT_AVAILABLE: {
    status: 422,
    title: 'This kind of recurring definition is not available yet',
  },
  RECURRING_INVALID_SCHEDULE: { status: 422, title: 'The recurring schedule is not valid' },
  RECURRING_INVALID_AMOUNT: { status: 422, title: 'The recurring amount is not valid for its type' },
  RECURRING_MODE_NOT_ALLOWED: { status: 422, title: 'Automatic creation needs a fixed or estimated amount' },
  RECURRING_REVISION_DATE_INVALID: {
    status: 422,
    title: 'The effective date must be after the last resolved occurrence',
  },
  OCCURRENCE_AMOUNT_REQUIRED: { status: 422, title: 'An amount is required to approve this occurrence' },
  OCCURRENCE_LINK_MISMATCH: { status: 422, title: 'The transaction does not match the occurrence' },
  OCCURRENCE_ALREADY_MATERIALIZED: { status: 409, title: 'The occurrence already has its transaction' },
  TRANSACTION_ALREADY_LINKED: { status: 409, title: 'The transaction already resolves another occurrence' },
  MATCH_SUGGESTION_NOT_PENDING: { status: 409, title: 'The match suggestion is no longer pending' },
  RECURRING_MANAGED_EXTERNALLY: {
    status: 409,
    title: 'The recurring definition is managed by another module; operate it from there',
  },
  // commitments / subscriptions (Phase 3)
  SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL: {
    status: 422,
    title: 'The price effective date must be after the last price entry',
  },
  SUBSCRIPTION_PROPOSAL_NOT_PENDING: { status: 409, title: 'The price proposal is no longer pending' },
} as const satisfies Record<string, { readonly status: number; readonly title: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ErrorCatalogEntry {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
}

export const isErrorCode = (code: string): code is ErrorCode => Object.hasOwn(ERROR_CATALOG, code);

/** `PERIOD_CLOSED` → `period-closed` (sufijo del `type` URI, docs/10 §9). */
export const kebabCode = (code: string): string => code.toLowerCase().replaceAll('_', '-');

/** Base por defecto del `type` de Problem Details (dominio placeholder, docs/10 §18.3; configurable). */
export const DEFAULT_PROBLEM_TYPE_BASE = 'https://pfos.dev/problems/';

export const ErrorCatalog = {
  codes(): ErrorCode[] {
    return Object.keys(ERROR_CATALOG) as ErrorCode[];
  },
  entries(): ErrorCatalogEntry[] {
    return ErrorCatalog.codes().map((code) => ({ code, ...ERROR_CATALOG[code] }));
  },
  get(code: string): ErrorCatalogEntry | undefined {
    return isErrorCode(code) ? { code, ...ERROR_CATALOG[code] } : undefined;
  },
  status(code: ErrorCode): number {
    return ERROR_CATALOG[code].status;
  },
  title(code: ErrorCode): string {
    return ERROR_CATALOG[code].title;
  },
  typeUri(code: string, base: string = DEFAULT_PROBLEM_TYPE_BASE): string {
    return `${base.endsWith('/') ? base : `${base}/`}${kebabCode(code)}`;
  },
} as const;
