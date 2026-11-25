/** Tipos de la vista `/gastos-atipicos` (contrato `SpendingAnomaly` del OpenAPI; add-spending-anomaly-detection). */

export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export type SpendingAnomalyReasonKind =
  'CATEGORY_OUTLIER' | 'COUNTERPARTY_OUTLIER' | 'NEW_COUNTERPARTY_HIGH_AMOUNT' | (string & {});

export interface SpendingAnomalyReason {
  readonly kind: SpendingAnomalyReasonKind;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  /** Mediana (categoría y contraparte) o percentil 95 (contraparte nueva) en la moneda de reporte. */
  readonly reference: Money;
  /** Monto ÷ mediana con 1 decimal; `null` en la contraparte nueva. */
  readonly ratio: string | null;
  readonly robustScore: string | null;
  readonly sampleSize: number;
}

export type DismissReason = 'EXPECTED_ONE_OFF' | 'NOT_UNUSUAL' | 'OTHER';
export const DISMISS_REASONS: readonly DismissReason[] = ['EXPECTED_ONE_OFF', 'NOT_UNUSUAL', 'OTHER'];

export interface SpendingAnomaly {
  readonly id: string;
  readonly transactionId: string;
  readonly transactionVersion: number;
  readonly transactionDate: string;
  readonly transactionChanged: boolean;
  readonly amount: Money;
  readonly reportingAmount: Money;
  readonly categoryIds: readonly string[];
  readonly counterpartyId: string | null;
  readonly reasons: readonly SpendingAnomalyReason[];
  readonly status: 'OPEN' | 'DISMISSED';
  readonly detectedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly dismissReason: DismissReason | (string & {}) | null;
}

export interface SpendingAnomalyPage {
  readonly featureStatus: 'ENABLED' | 'DISABLED';
  readonly items: readonly SpendingAnomaly[];
  readonly nextCursor: string | null;
}

export type StatusFilter = 'OPEN' | 'DISMISSED' | 'ALL';
export const STATUS_FILTERS: readonly StatusFilter[] = ['OPEN', 'DISMISSED', 'ALL'];

/** Nombres de categorías y contrapartes (catálogo del workspace). */
export interface AnomalyNames {
  readonly category: (id: string) => string | undefined;
  readonly counterparty: (id: string) => string | undefined;
}
