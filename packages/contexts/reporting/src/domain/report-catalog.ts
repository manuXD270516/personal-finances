export type ReportId =
  | 'INCOME_EXPENSES'
  | 'BUDGET_VS_ACTUAL'
  | 'EXPENSES_BY_CATEGORY'
  | 'EXPENSES_BY_TAG'
  | 'EXPENSES_BY_ACCOUNT'
  | 'MONTHLY_TRENDS'
  | 'CASH_FLOW'
  | 'NET_WORTH'
  | 'SAVINGS_GOALS'
  | 'DEBT_EVOLUTION'
  | 'RECURRING_COSTS'
  | 'SUBSCRIPTION_EVOLUTION'
  | 'FX_CONVERSIONS'
  | 'FEES'
  | 'ACCOUNT_BALANCE_HISTORY'
  | 'FORECAST_VS_ACTUAL';

export type ReportAvailability = 'AVAILABLE' | 'PARTIAL' | 'PLANNED';

export interface CatalogEntry {
  readonly reportId: ReportId;
  /** Número del reporte en docs/14 §7 (1..16). */
  readonly number: number;
  readonly status: ReportAvailability;
  readonly phase: number;
  /** Change en que llega un reporte planificado; `null` si ya está disponible. */
  readonly plannedIn: string | null;
  /** Ruta HTTP relativa al workspace del reporte disponible. */
  readonly endpoint: string | null;
  /** Vista de la aplicación que cubre un reporte parcial. */
  readonly viewPath: string | null;
}

const available = (reportId: ReportId, number: number, endpoint: string): CatalogEntry => ({
  reportId,
  number,
  status: 'AVAILABLE',
  phase: 7,
  plannedIn: null,
  endpoint,
  viewPath: null,
});
const partial = (reportId: ReportId, number: number, viewPath: string): CatalogEntry => ({
  reportId,
  number,
  status: 'PARTIAL',
  phase: 7,
  plannedIn: 'add-financial-reports-extended',
  endpoint: null,
  viewPath,
});
const planned = (reportId: ReportId, number: number, phase: number, plannedIn: string): CatalogEntry => ({
  reportId,
  number,
  status: 'PLANNED',
  phase,
  plannedIn,
  endpoint: null,
  viewPath: null,
});

/**
 * Catálogo estático de los 16 reportes (design decisión 14). Este change deja disponibles los seis Must (1, 2, 3, 7, 8
 * y 15); los parciales enlazan a la vista existente; el resto lo trae `add-financial-reports-extended` y el pronóstico
 * vs real, Phase 8. Un reporte planificado nunca muestra cifras.
 */
export const REPORT_CATALOG: readonly CatalogEntry[] = [
  available('INCOME_EXPENSES', 1, '/reports/income-expenses'),
  available('BUDGET_VS_ACTUAL', 2, '/reports/budget-vs-actual'),
  available('EXPENSES_BY_CATEGORY', 3, '/reports/expenses/by-category'),
  planned('EXPENSES_BY_TAG', 4, 7, 'add-financial-reports-extended'),
  planned('EXPENSES_BY_ACCOUNT', 5, 7, 'add-financial-reports-extended'),
  planned('MONTHLY_TRENDS', 6, 7, 'add-financial-reports-extended'),
  available('CASH_FLOW', 7, '/reports/cash-flow'),
  available('NET_WORTH', 8, '/reports/net-worth'),
  partial('SAVINGS_GOALS', 9, '/goals'),
  partial('DEBT_EVOLUTION', 10, '/debts'),
  partial('RECURRING_COSTS', 11, '/recurring/suscripciones'),
  planned('SUBSCRIPTION_EVOLUTION', 12, 7, 'add-financial-reports-extended'),
  partial('FX_CONVERSIONS', 13, '/fx/costos'),
  planned('FEES', 14, 7, 'add-financial-reports-extended'),
  available('ACCOUNT_BALANCE_HISTORY', 15, '/reports/accounts/{accountId}/balance-history'),
  planned('FORECAST_VS_ACTUAL', 16, 8, 'phase-8'),
];

/** Los identificadores de reporte con métrica de duración (`reporting_report_duration_seconds{report}`). */
export const REPORT_IDS: readonly ReportId[] = REPORT_CATALOG.map((e) => e.reportId);
