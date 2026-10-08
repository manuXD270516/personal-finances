import { dec, type Decimal } from '@pf/shared-kernel';
import {
  CHECKLIST_ITEM_KINDS,
  type ChecklistItemKind,
  type ChecklistSeverity,
  type PolicySeverities,
} from './closing-policy.js';

export interface MoneyValue {
  readonly amount: string;
  readonly currency: string;
}

export type ChecklistRefType = 'TRANSACTION' | 'ACCOUNT' | 'DUPLICATE_CANDIDATE' | 'SPLIT';

export interface ChecklistDetail {
  readonly refType: ChecklistRefType;
  readonly refId: string;
  readonly label: string;
  readonly date: string | null;
  readonly amount: MoneyValue | null;
}

/** Máximo de detalles por ítem (design.md § Contratos); el resto se informa con `truncated`. */
export const MAX_CHECKLIST_DETAILS = 50;

export interface ChecklistItem {
  readonly kind: ChecklistItemKind;
  readonly severity: ChecklistSeverity;
  readonly availability: 'AVAILABLE' | 'NOT_AVAILABLE';
  readonly count: number;
  /** Montos por moneda, sin convertir. */
  readonly amounts: readonly MoneyValue[];
  readonly details: readonly ChecklistDetail[];
  readonly truncated: boolean;
}

/** Hallazgo ya contado por TRANSACTIONS (`TransactionsClosingQuery`). */
export interface Finding {
  readonly count: number;
  readonly amounts: readonly MoneyValue[];
  readonly details: readonly ChecklistDetail[];
  readonly truncated: boolean;
}

export interface UnreconciledAccount {
  readonly accountId: string;
  readonly name: string;
  readonly balance: MoneyValue;
}

export interface WithoutStatementAccount {
  readonly accountId: string;
  readonly name: string;
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly businessDate: string;
    readonly amount: MoneyValue;
  }[];
}

export interface ChecklistInput {
  readonly severities: PolicySeverities;
  readonly pending: Finding;
  readonly duplicates: Finding;
  readonly uncategorized: Finding;
  /** Cuentas exigidas sin conciliar; `null` = la reconciliación no está disponible (P-A9). */
  readonly unreconciled: readonly UnreconciledAccount[] | null;
  readonly withoutStatement: readonly WithoutStatementAccount[];
}

export interface CloseChecklist {
  readonly items: readonly ChecklistItem[];
  /** Ítems bloqueantes con observaciones: impiden el cierre. */
  readonly blockingItems: readonly ChecklistItem[];
  /** Advertencias con observaciones: exigen reconocimiento explícito. */
  readonly warningItems: readonly ChecklistItem[];
  readonly canClose: boolean;
  readonly requiresAcknowledgement: boolean;
}

const scaleOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/** Σ por moneda (sin convertir) conservando la escala de los montos recibidos. */
export function sumByCurrency(amounts: readonly MoneyValue[]): MoneyValue[] {
  const totals = new Map<string, { sum: Decimal; scale: number }>();
  for (const a of amounts) {
    const current = totals.get(a.currency);
    totals.set(a.currency, {
      sum: (current?.sum ?? dec('0')).plus(a.amount),
      scale: Math.max(current?.scale ?? 0, scaleOf(a.amount)),
    });
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, { sum, scale }]) => ({ amount: sum.toFixed(scale), currency }));
}

const notAvailable = (kind: ChecklistItemKind, severity: ChecklistSeverity): ChecklistItem => ({
  kind,
  severity,
  availability: 'NOT_AVAILABLE',
  count: 0,
  amounts: [],
  details: [],
  truncated: false,
});

/**
 * DS `CloseChecklistEvaluator` (FR-PLANNING-003; design.md decisión 1): puro, datos ya consultados → ítems con su
 * severidad (política del workspace) y el veredicto. Nunca consulta ni escribe nada.
 *   - bloqueante con conteo > 0 ⇒ `MONTH_CLOSING_BLOCKED`; advertencia con conteo > 0 ⇒ exige reconocimiento;
 *   - `UNRESOLVED_RECURRING` no está disponible hasta Phase 3 y nunca bloquea mientras no lo esté;
 *   - si la reconciliación no está disponible (`unreconciled = null`) el ítem bloquea con severidad `BLOCKING` (P-A9);
 *   - `RECONCILED_WITHOUT_STATEMENT` es siempre `INFO`: ni bloquea ni exige reconocimiento (docs/33 D111).
 */
export const CloseChecklistEvaluator = {
  evaluate(input: ChecklistInput): CloseChecklist {
    const policy = input.severities;
    const fromFinding = (
      kind: ChecklistItemKind,
      severity: ChecklistSeverity,
      f: Finding,
    ): ChecklistItem => ({
      kind,
      severity,
      availability: 'AVAILABLE',
      count: f.count,
      amounts: f.amounts,
      details: f.details.slice(0, MAX_CHECKLIST_DETAILS),
      truncated: f.truncated || f.details.length > MAX_CHECKLIST_DETAILS,
    });
    const unreconciled: ChecklistItem =
      input.unreconciled === null
        ? notAvailable('UNRECONCILED_ACCOUNTS', policy.UNRECONCILED_ACCOUNTS)
        : {
            kind: 'UNRECONCILED_ACCOUNTS',
            severity: policy.UNRECONCILED_ACCOUNTS,
            availability: 'AVAILABLE',
            count: input.unreconciled.length,
            amounts: [],
            details: input.unreconciled.slice(0, MAX_CHECKLIST_DETAILS).map((a) => ({
              refType: 'ACCOUNT' as const,
              refId: a.accountId,
              label: a.name,
              date: null,
              amount: a.balance,
            })),
            truncated: input.unreconciled.length > MAX_CHECKLIST_DETAILS,
          };

    const withoutStatementDetails: ChecklistDetail[] = input.withoutStatement.flatMap((a) => [
      { refType: 'ACCOUNT' as const, refId: a.accountId, label: a.name, date: null, amount: null },
      ...a.transactions.map((t) => ({
        refType: 'TRANSACTION' as const,
        refId: t.transactionId,
        label: a.name,
        date: t.businessDate,
        amount: t.amount,
      })),
    ]);
    const withoutStatement: ChecklistItem = {
      kind: 'RECONCILED_WITHOUT_STATEMENT',
      severity: 'INFO',
      availability: 'AVAILABLE',
      count: input.withoutStatement.length,
      amounts: sumByCurrency(input.withoutStatement.flatMap((a) => a.transactions.map((t) => t.amount))),
      details: withoutStatementDetails.slice(0, MAX_CHECKLIST_DETAILS),
      truncated: withoutStatementDetails.length > MAX_CHECKLIST_DETAILS,
    };

    const byKind: Record<ChecklistItemKind, ChecklistItem> = {
      PENDING_TRANSACTIONS: fromFinding('PENDING_TRANSACTIONS', policy.PENDING_TRANSACTIONS, input.pending),
      UNRECONCILED_ACCOUNTS: unreconciled,
      UNRESOLVED_DUPLICATES: fromFinding(
        'UNRESOLVED_DUPLICATES',
        policy.UNRESOLVED_DUPLICATES,
        input.duplicates,
      ),
      UNCATEGORIZED: fromFinding('UNCATEGORIZED', policy.UNCATEGORIZED, input.uncategorized),
      UNRESOLVED_RECURRING: notAvailable('UNRESOLVED_RECURRING', policy.UNRESOLVED_RECURRING),
      RECONCILED_WITHOUT_STATEMENT: withoutStatement,
    };
    const items = CHECKLIST_ITEM_KINDS.map((k) => byKind[k]);
    const blocks = (i: ChecklistItem): boolean =>
      i.severity === 'BLOCKING' &&
      (i.count > 0 || (i.availability === 'NOT_AVAILABLE' && i.kind === 'UNRECONCILED_ACCOUNTS'));
    const blockingItems = items.filter(blocks);
    const warningItems = items.filter((i) => i.severity === 'WARNING' && i.count > 0);
    return {
      items,
      blockingItems,
      warningItems,
      canClose: blockingItems.length === 0,
      requiresAcknowledgement: blockingItems.length === 0 && warningItems.length > 0,
    };
  },
} as const;
