/**
 * Lógica pura de la reconciliación por cuenta (openspec add-reconciliation, tarea 6.1): tipos del contrato, lectura del
 * saldo del extracto (admite signo), conjunto de transacciones que se muestran en la sesión, estado de la diferencia
 * y reglas de habilitación. Sin React ni zona horaria del proceso: las fechas de negocio `YYYY-MM-DD` se comparan como
 * texto.
 */
import { parseAmount, type AmountError } from '../common/money';
import type { Money, Transaction } from '../common/types';

export type ReconciliationState = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ReconciliationItem {
  readonly transactionId: string;
  readonly reconciledAt: string;
  readonly verifiedWithoutStatement: boolean;
  readonly unreconciledAt: string | null;
  readonly unreconcileReason: string | null;
}

/** `Reconciliation` del contrato OpenAPI. */
export interface Reconciliation {
  readonly id: string;
  readonly accountId: string;
  readonly status: ReconciliationState;
  readonly statementDate: string;
  readonly statementBalance: Money;
  readonly clearedBalance: Money | null;
  readonly difference: Money | null;
  readonly adjustmentTransactionId: string | null;
  readonly startedBy: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly version: number;
  readonly items?: readonly ReconciliationItem[];
}

/** `ReconciliationStatus` del contrato (estado por cuenta a un corte). */
export interface ReconciliationStatus {
  readonly accountId: string;
  readonly lastCompleted: {
    readonly reconciliationId: string;
    readonly statementDate: string;
    readonly statementBalance: Money;
    readonly difference: Money;
    readonly completedAt: string;
  } | null;
  readonly inProgressReconciliationId: string | null;
  readonly unreconciledPostedCountThrough: number;
  readonly unreconciledClearedCountThrough: number;
  readonly reconciledWithoutStatementCount: number;
  readonly reconciledThrough: boolean;
  readonly reconciliationBasis: 'STATEMENT' | 'WITHOUT_STATEMENT' | null;
}

export type StatementBalanceResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: AmountError };

/**
 * Saldo del extracto tal como lo escribe el usuario: decimal tolerante al locale en la escala de la moneda de la cuenta,
 * con signo opcional (una cuenta puede estar sobregirada); en tarjetas y préstamos se ingresa la deuda como positiva.
 * Más decimales que la escala ⇒ `SCALE` (nunca se redondea, INV-020). El cero es válido.
 */
export function parseStatementBalance(
  raw: string,
  opts: { readonly locale: string; readonly currency: string; readonly scale: number },
): StatementBalanceResult {
  const text = raw.trim();
  const negative = text.startsWith('-') || text.startsWith('−');
  const parsed = parseAmount(negative ? text.slice(1) : text, { ...opts, allowZero: true });
  if (!parsed.ok) return parsed;
  const isZero = /^0*(\.0*)?$/.test(parsed.value);
  return { ok: true, value: negative && !isZero ? `-${parsed.value}` : parsed.value };
}

export type DifferenceState = 'ZERO' | 'POSITIVE' | 'NEGATIVE';

/** Estado de la diferencia (extracto − saldo confirmado): cero habilita finalizar sin ajuste. */
export function differenceState(difference: Money | null): DifferenceState | null {
  if (!difference) return null;
  if (/^-?0*(\.0*)?$/.test(difference.amount)) return 'ZERO';
  return difference.amount.startsWith('-') ? 'NEGATIVE' : 'POSITIVE';
}

/** Dirección del ajuste que anula la diferencia: el extracto mayor aumenta el saldo presentado. */
export function adjustmentDirection(difference: Money | null): 'INCREASE' | 'DECREASE' | null {
  const state = differenceState(difference);
  if (state === 'POSITIVE') return 'INCREASE';
  if (state === 'NEGATIVE') return 'DECREASE';
  return null;
}

/** Valor absoluto de un monto (para mostrar el ajuste de una diferencia negativa). */
export const absMoney = (m: Money): Money => ({ ...m, amount: m.amount.replace(/^-/, '') });

/**
 * Transacciones que se listan en la sesión: las `posted` y `cleared` de la cuenta con fecha ≤ extracto (las
 * `reconciled` ya cuadran con extractos anteriores; `pending` y `void` nunca suman), ordenadas por fecha.
 */
export function sessionCandidates(
  transactions: readonly Transaction[],
  accountId: string,
  statementDate: string,
): Transaction[] {
  return transactions
    .filter(
      (t) =>
        (t.status === 'POSTED' || t.status === 'CLEARED') &&
        t.transactionDate <= statementDate &&
        t.legs.some((l) => l.accountId === accountId),
    )
    .sort((a, b) =>
      a.transactionDate === b.transactionDate
        ? a.id.localeCompare(b.id)
        : a.transactionDate.localeCompare(b.transactionDate),
    );
}

/** Query de las transacciones de la sesión (`listTransactions` hasta la fecha del extracto, estados abiertos). */
export function sessionTransactionsQuery(accountId: string, statementDate: string): URLSearchParams {
  const q = new URLSearchParams();
  q.append('accountId', accountId);
  q.append('status', 'POSTED');
  q.append('status', 'CLEARED');
  q.set('dateTo', statementDate);
  q.set('sort', 'transactionDate');
  return q;
}

/** Una sesión en curso admite confirmar y finalizar; una completada o cancelada es de solo lectura. */
export const isEditable = (r: Reconciliation, canEdit: boolean): boolean =>
  canEdit && r.status === 'IN_PROGRESS';

/** Marca "conciliada sin extracto — pendiente de revisión" (docs/33 D111), derivada del modo. */
export const isWithoutStatement = (t: Pick<Transaction, 'systemFlags' | 'reconciliationMode'>): boolean =>
  t.systemFlags?.includes('RECONCILED_WITHOUT_STATEMENT') === true ||
  t.reconciliationMode === 'WITHOUT_STATEMENT';
