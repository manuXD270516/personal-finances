/**
 * Lógica pura del cierre de mes (openspec add-month-closing 6.1–6.2): tipos del contrato (`CloseChecklist`,
 * `CloseSnapshot`, `CloseReport`, `ClosingPolicy`…), reglas de habilitación de "Cerrar mes" y "Reabrir", enlaces del
 * detalle del checklist y vistas de los KPIs. Sin React ni zona horaria del proceso. Los montos son strings decimales
 * `{amount, currency}` (nunca `number`); las fechas de negocio `YYYY-MM-DD` se comparan como texto.
 */
import type { Money } from '../dashboard/types';
import { formatDecimal } from '../AuditHistory';
import type { FinancialPeriod } from './logic';

export type ChecklistSeverity = 'BLOCKING' | 'WARNING' | 'INFO';
export type ChecklistItemKind =
  | 'PENDING_TRANSACTIONS'
  | 'UNRECONCILED_ACCOUNTS'
  | 'UNRESOLVED_DUPLICATES'
  | 'UNCATEGORIZED'
  | 'UNRESOLVED_RECURRING'
  | 'RECONCILED_WITHOUT_STATEMENT';

/** Ítems cuya severidad configura el OWNER (el informativo no forma parte de la política). */
export const POLICY_KINDS = [
  'PENDING_TRANSACTIONS',
  'UNRECONCILED_ACCOUNTS',
  'UNRESOLVED_DUPLICATES',
  'UNCATEGORIZED',
  'UNRESOLVED_RECURRING',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export type PolicySeverity = 'BLOCKING' | 'WARNING';

export interface CloseChecklistDetail {
  readonly refType: 'TRANSACTION' | 'ACCOUNT' | 'DUPLICATE_CANDIDATE' | 'SPLIT';
  readonly refId: string;
  readonly label: string;
  readonly date: string | null;
  readonly amount: Money | null;
}

export interface CloseChecklistItem {
  readonly kind: ChecklistItemKind;
  readonly severity: ChecklistSeverity;
  readonly availability: 'AVAILABLE' | 'NOT_AVAILABLE';
  readonly count: number;
  readonly amounts: readonly Money[];
  readonly details: readonly CloseChecklistDetail[];
  readonly truncated: boolean;
}

export interface CloseChecklist {
  readonly periodId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly evaluatedAt: string;
  readonly canClose: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly items: readonly CloseChecklistItem[];
}

export interface CloseSnapshotSummary {
  readonly snapshotId: string;
  readonly closeNo: number;
  readonly closedAt: string;
  readonly closedBy: string | null;
  readonly previousSnapshotId: string | null;
  readonly isCurrent: boolean;
}

export interface CloseSnapshotBalance {
  readonly accountId: string;
  readonly accountName: string;
  readonly ledgerAccountId: string | null;
  readonly currency: string;
  readonly balance: Money;
  readonly presented: Money;
  readonly reconciliation: {
    readonly reconciliationId: string;
    readonly statementDate: string;
    readonly statementBalance: Money;
  } | null;
  readonly reconciliationBasis: 'STATEMENT' | 'WITHOUT_STATEMENT' | null;
  readonly reconciledWithoutStatementTransactionIds: readonly string[];
}

export interface CloseSnapshotFlowsByCurrency {
  readonly currency: string;
  readonly income: Money;
  readonly expense: Money;
  readonly savings: Money;
}

export interface CloseSnapshotBudgetLine {
  readonly target: { readonly kind: 'CATEGORY' | 'GROUP' | 'TAG'; readonly id: string };
  readonly targetName: string;
  readonly nature: 'EXPENSE' | 'INCOME';
  readonly reference: Money;
  readonly actual: Money;
  readonly status: string;
}

export interface CloseSnapshot extends CloseSnapshotSummary {
  readonly periodId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseCurrency: string;
  readonly balances: readonly CloseSnapshotBalance[];
  readonly reconciledWithoutStatement: readonly {
    readonly transactionId: string;
    readonly accountId: string;
    readonly businessDate: string;
    readonly amount: Money;
  }[];
  readonly flows: {
    readonly byCurrency: readonly CloseSnapshotFlowsByCurrency[];
    readonly consolidated: {
      readonly currency: string;
      readonly income: Money;
      readonly expense: Money;
      readonly savings: Money;
      /** Porcentaje con un decimal (HALF_EVEN); `null` sin ingresos. */
      readonly savingsRate: string | null;
      readonly complete: boolean;
      readonly unconverted: readonly Money[];
    };
  };
  readonly netWorth: {
    readonly amount: Money;
    readonly assets: Money;
    readonly liabilities: Money;
    readonly complete: boolean;
    readonly unconverted: readonly Money[];
    readonly rates: readonly unknown[];
  };
  readonly budgetVsActual: {
    readonly budgetId: string;
    readonly currency: string;
    readonly lines: readonly CloseSnapshotBudgetLine[];
    readonly totals: { readonly planned: Money; readonly actual: Money; readonly complete: boolean };
  } | null;
  readonly goalContributions: null;
  readonly checklist: readonly CloseChecklistItem[];
  readonly acknowledgedWarnings: {
    readonly items: readonly ChecklistItemKind[];
    readonly by: string | null;
    readonly at: string;
  } | null;
}

export type DeltaKpi = 'INCOME' | 'EXPENSE' | 'SAVINGS' | 'SAVINGS_RATE' | 'NET_WORTH';

export interface CloseDelta {
  readonly kpi: DeltaKpi;
  /** Dinero en la moneda base; puntos porcentuales (texto) para `SAVINGS_RATE`; `null` sin tasa. */
  readonly absolute: Money | string | null;
  /** Variación relativa con un decimal; `null` cuando el valor previo es 0. */
  readonly percentage: string | null;
}

export interface CloseReport {
  readonly snapshot: CloseSnapshot;
  readonly versions: readonly CloseSnapshotSummary[];
  readonly comparison: {
    readonly previousPeriodId: string;
    readonly previousLabel: string;
    readonly previousCloseNo: number;
    readonly deltas: readonly CloseDelta[];
  } | null;
  readonly comparisonUnavailableReason: 'NO_PREVIOUS_PERIOD' | 'NO_PREVIOUS_SNAPSHOT' | null;
}

export interface CloseSnapshotDiff {
  readonly from: number;
  readonly to: number;
  readonly balances: readonly {
    readonly accountId: string;
    readonly currency: string;
    readonly delta: Money;
  }[];
  readonly flows: {
    readonly byCurrency: readonly CloseSnapshotFlowsByCurrency[];
    readonly consolidated: { readonly income: Money; readonly expense: Money; readonly savings: Money };
  };
  readonly netWorth: { readonly delta: Money };
}

export interface ClosingPolicy {
  readonly severities: Readonly<Record<PolicyKind, PolicySeverity>>;
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

// ─────────────────────────── Checklist ───────────────────────────

export type ItemTone = 'BLOCKING' | 'WARNING' | 'INFO' | 'NOT_AVAILABLE';

/** Severidad que se presenta: un ítem no disponible se muestra como tal, sin importar su severidad configurada. */
export const toneOf = (item: CloseChecklistItem): ItemTone =>
  item.availability === 'NOT_AVAILABLE' ? 'NOT_AVAILABLE' : item.severity;

/** Icono decorativo (el texto de la severidad siempre acompaña: no se comunica solo con color). */
export const TONE_ICON: Readonly<Record<ItemTone, string>> = {
  BLOCKING: '⛔',
  WARNING: '▲',
  INFO: 'ℹ',
  NOT_AVAILABLE: '–',
};

/** Un ítem "con observaciones": disponible y con al menos un hallazgo. */
export const hasObservations = (item: CloseChecklistItem): boolean =>
  item.availability === 'AVAILABLE' && item.count > 0;

const TONE_ORDER: Readonly<Record<ItemTone, number>> = { BLOCKING: 0, WARNING: 1, INFO: 2, NOT_AVAILABLE: 3 };

/** Bloqueantes primero, luego advertencias, informativos y no disponibles (orden estable dentro de cada grupo). */
export const sortedItems = (items: readonly CloseChecklistItem[]): CloseChecklistItem[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_ORDER[toneOf(a.item)] - TONE_ORDER[toneOf(b.item)] || a.index - b.index)
    .map((x) => x.item);

/** Enlace del detalle: transacción → su detalle; cuenta → la cuenta. Duplicados y splits no tienen pantalla propia. */
export function detailHref(detail: CloseChecklistDetail, href: (path: string) => string): string | null {
  if (detail.refType === 'TRANSACTION') return href(`/transacciones/${detail.refId}`);
  if (detail.refType === 'ACCOUNT') return href(`/cuentas/${detail.refId}`);
  return null;
}

/** Enlace del listado completo de un ítem (cuando el detalle está truncado o para revisar todo el grupo). */
export function itemHref(kind: ChecklistItemKind, href: (path: string) => string): string | null {
  switch (kind) {
    case 'RECONCILED_WITHOUT_STATEMENT':
      return href('/transacciones?sinExtracto=1');
    case 'UNRECONCILED_ACCOUNTS':
      return href('/cuentas');
    case 'PENDING_TRANSACTIONS':
    case 'UNRESOLVED_DUPLICATES':
    case 'UNCATEGORIZED':
      return href('/transacciones');
    default:
      return null;
  }
}

// ─────────────────────────── Cierre ───────────────────────────

export type CloseBlock = 'ROLE' | 'STATUS' | 'NOT_ENDED' | 'BLOCKING' | 'ACK_REQUIRED' | 'UNAVAILABLE';

/** Un periodo se puede cerrar solo si está ACTIVE/REOPENED (`CLOSED` y `DRAFT` no). */
export const isClosable = (p: Pick<FinancialPeriod, 'status'>): boolean =>
  p.status === 'ACTIVE' || p.status === 'REOPENED';

/** El periodo ya terminó cuando su fin es anterior a hoy en la zona del workspace (comparación de texto). */
export const hasEnded = (p: Pick<FinancialPeriod, 'periodEnd'>, today: string): boolean =>
  p.periodEnd < today;

/**
 * Por qué no se puede cerrar (o `null` si se puede). Orden: rol → estado → no terminó → bloqueantes → falta el
 * reconocimiento de las advertencias. La API repite todas las validaciones; esto solo evita llamadas inútiles.
 */
export function closeBlock(input: {
  readonly canEdit: boolean;
  readonly period: Pick<FinancialPeriod, 'status' | 'periodEnd'>;
  readonly checklist: CloseChecklist | undefined;
  readonly today: string;
  readonly acknowledged: boolean;
}): CloseBlock | null {
  if (!input.canEdit) return 'ROLE';
  if (!isClosable(input.period)) return 'STATUS';
  if (!hasEnded(input.period, input.today)) return 'NOT_ENDED';
  if (!input.checklist) return 'UNAVAILABLE';
  if (!input.checklist.canClose) return 'BLOCKING';
  if (input.checklist.requiresAcknowledgement && !input.acknowledged) return 'ACK_REQUIRED';
  return null;
}

/** Cuerpo de `closePeriod`: la nota se recorta y es opcional. */
export function closeBody(
  acknowledged: boolean,
  note: string,
): { acknowledgeWarnings: boolean; note?: string } {
  const trimmed = note.trim();
  return { acknowledgeWarnings: acknowledged, ...(trimmed === '' ? {} : { note: trimmed }) };
}

export const NOTE_MAX = 500;
export const REASON_MAX = 500;

/** Motivo de reapertura: obligatorio, 1..500 caracteres tras recortar. */
export function reopenReasonError(raw: string): 'REQUIRED' | 'TOO_LONG' | null {
  const reason = raw.trim();
  if (reason === '') return 'REQUIRED';
  return reason.length > REASON_MAX ? 'TOO_LONG' : null;
}

/** Solo el OWNER reabre, y solo un periodo CLOSED. */
export const canReopen = (isOwner: boolean, p: Pick<FinancialPeriod, 'status'>): boolean =>
  isOwner && p.status === 'CLOSED';

/** Ítems que la API devuelve como extensión del problema 409 (`blockingItems` / `warningItems`). */
export function problemItems(problem: Readonly<Record<string, unknown>>): {
  readonly blocking: readonly CloseChecklistItem[];
  readonly warning: readonly CloseChecklistItem[];
} {
  const list = (v: unknown): CloseChecklistItem[] =>
    Array.isArray(v)
      ? (v as CloseChecklistItem[]).filter((i) => i !== null && typeof i === 'object' && 'kind' in i)
      : [];
  return { blocking: list(problem['blockingItems']), warning: list(problem['warningItems']) };
}

// ─────────────────────────── Reporte ───────────────────────────

/** Porcentaje con un decimal ya redondeado por la API (`"25.0"` → `25,0 %`). */
export const formatPercent = (value: string, locale: string): string => `${formatDecimal(value, locale)} %`;

/** Decimal con signo explícito para variaciones (`+10,0`, `-5,0`, `0,0`). */
export function signed(value: string, locale: string): string {
  const unsigned = value.replace(/^[-+]/, '');
  const zero = /^0*(\.0*)?$/.test(unsigned);
  return `${zero ? '' : value.startsWith('-') ? '-' : '+'}${formatDecimal(unsigned, locale)}`;
}

export const isMoney = (v: unknown): v is Money =>
  typeof v === 'object' && v !== null && 'amount' in v && 'currency' in v;

/** Base de conciliación de un saldo: con extracto, sin extracto o sin conciliar (advertencia reconocida). */
export type BalanceBasis = 'STATEMENT' | 'WITHOUT_STATEMENT' | 'NONE';
export const basisOf = (b: Pick<CloseSnapshotBalance, 'reconciliationBasis'>): BalanceBasis =>
  b.reconciliationBasis ?? 'NONE';

export const KPI_ORDER: readonly DeltaKpi[] = ['INCOME', 'EXPENSE', 'SAVINGS', 'SAVINGS_RATE', 'NET_WORTH'];

/** Versión vigente primero; luego las anteriores de la más reciente a la más antigua. */
export const versionsNewestFirst = (versions: readonly CloseSnapshotSummary[]): CloseSnapshotSummary[] =>
  [...versions].sort((a, b) => b.closeNo - a.closeNo);

/** Valor por defecto de la comparación: de la versión anterior a la vigente (si hay al menos dos). */
export function defaultComparison(
  versions: readonly CloseSnapshotSummary[],
): { readonly from: number; readonly to: number } | null {
  const sorted = versionsNewestFirst(versions);
  return sorted.length >= 2 ? { from: sorted[1]!.closeNo, to: sorted[0]!.closeNo } : null;
}

/** Descarga del reporte de una versión (CSV/PDF) por el proxy del BFF. */
export const exportPath = (base: string, periodId: string, format: 'csv' | 'pdf', closeNo?: number): string =>
  `${base}/periods/${periodId}/close-report/export?format=${format}${closeNo === undefined ? '' : `&closeNo=${closeNo}`}`;

/** Una política se puede guardar si cambió algún ítem respecto a la guardada. */
export const policyChanged = (
  saved: Readonly<Record<PolicyKind, PolicySeverity>>,
  draft: Readonly<Record<PolicyKind, PolicySeverity>>,
): boolean => POLICY_KINDS.some((k) => saved[k] !== draft[k]);
