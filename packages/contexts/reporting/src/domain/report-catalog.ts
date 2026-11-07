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
 * Catálogo estático de los 16 reportes (design decisión 14). Con `add-financial-reports-extended` quedan disponibles
 * 15; el pronóstico vs real, Phase 8, sigue planificado. Un reporte planificado nunca muestra cifras.
 */
export const REPORT_CATALOG: readonly CatalogEntry[] = [
  available('INCOME_EXPENSES', 1, '/reports/income-expenses'),
  available('BUDGET_VS_ACTUAL', 2, '/reports/budget-vs-actual'),
  available('EXPENSES_BY_CATEGORY', 3, '/reports/expenses/by-category'),
  available('EXPENSES_BY_TAG', 4, '/reports/expenses/by-tag'),
  available('EXPENSES_BY_ACCOUNT', 5, '/reports/expenses/by-account'),
  available('MONTHLY_TRENDS', 6, '/reports/trends'),
  available('CASH_FLOW', 7, '/reports/cash-flow'),
  available('NET_WORTH', 8, '/reports/net-worth'),
  available('SAVINGS_GOALS', 9, '/reports/goals'),
  available('DEBT_EVOLUTION', 10, '/reports/debts'),
  available('RECURRING_COSTS', 11, '/reports/recurring'),
  available('SUBSCRIPTION_EVOLUTION', 12, '/reports/subscriptions'),
  available('FX_CONVERSIONS', 13, '/reports/conversions'),
  available('FEES', 14, '/reports/fees'),
  available('ACCOUNT_BALANCE_HISTORY', 15, '/reports/accounts/{accountId}/balance-history'),
  planned('FORECAST_VS_ACTUAL', 16, 8, 'phase-8'),
];

/** Los identificadores de reporte con métrica de duración (`reporting_report_duration_seconds{report}`). */
export const REPORT_IDS: readonly ReportId[] = REPORT_CATALOG.map((e) => e.reportId);
