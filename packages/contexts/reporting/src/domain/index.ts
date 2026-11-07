export { ConsolidationService, type Consolidated, type DatedAmount } from './consolidation-service.js';
export {
  KpiCalculator,
  type CategoryTotal,
  type DateRangeText,
  type NominalFlow,
  type CategoryAmount,
  type CategoryTotalsOptions,
  type TopCategoriesOptions,
} from './kpi-calculator.js';
export {
  NetWorthValuator,
  type NetWorthByCurrency,
  type NetWorthResult,
  type ValuedAccount,
} from './net-worth-valuator.js';
export {
  endOfDayInstant,
  PeriodComparator,
  type CompareMode,
  type Comparison,
  type DateRange,
  type Variation,
} from './period-comparator.js';
export {
  HOME_QUESTIONS,
  homeQuestions,
  type HomeQuestion,
  type HomeQuestionStatus,
} from './home-questions.js';
export { convertExact, present, sumByCurrency, type ExactRate } from './valuation.js';
export {
  DEFAULT_SERIES_MONTHS,
  MAX_SERIES_MONTHS,
  NetWorthSeriesBuilder,
  type ClosedFigures,
  type SeriesCutoff,
  type SeriesPeriod,
  type SeriesPoint,
  type SeriesPointInput,
} from './net-worth-series.js';
export { CommittedPeriod, type CommittedValued, type PeriodRange } from './committed-period.js';
export {
  countsAsOutflow,
  DEFAULT_UPCOMING_DAYS,
  MAX_UPCOMING_DAYS,
  OCCURRENCE_REF_NAMESPACE,
  UpcomingPaymentsAssembler,
  UpcomingWindow,
  type AccountClass,
  type OccurrenceInput,
  type PendingInput,
  type UpcomingAmountType,
  type UpcomingItem,
  type UpcomingItemStatus,
  type UpcomingWindowValue,
} from './upcoming-payments.js';
export { UpcomingValuation, type ValuedTotal } from './upcoming-valuation.js';
export {
  ProjectedBalanceCalculator,
  type ProjectedBalanceAccount,
  type ProjectedBalanceLine,
  type ProjectedPending,
} from './projected-balance.js';
export {
  SurprisePaymentClassifier,
  type ResolvedOutflowInput,
  type SurprisePayment,
} from './surprise-payments.js';
export {
  CASH_FLOW_CALENDAR_DURATION_METRIC,
  evaluateReadModelAlert,
  SPENDABLE_DURATION_METRIC,
  UPCOMING_PAYMENTS_DURATION_METRIC,
  UPCOMING_PAYMENTS_ROWS_METRIC,
  UPCOMING_READ_MODEL_ALERT,
  type ReadModelAlertState,
  type UpcomingMetricSample,
} from './upcoming-read-model-alert.js';
export {
  SpendableCalculator,
  type SpendableAccount,
  type SpendableCommittedItem,
  type SpendableConsolidation,
  type SpendableInput,
  type SpendablePlanned,
  type SpendableReservation,
  type SpendableReservedLine,
  type SpendableResult,
  type SpendableTerms,
} from './spendable-calculator.js';
export {
  channelKey,
  channelOf,
  ConversionCostAggregator,
  percentage,
  type ChannelKind,
  type CostAnalysis,
  type CostConversion,
  type CostGroup,
  type CostPeriod,
  type CostTotals,
  type CostValuation,
  type ConversionChannel,
  type ConversionCostGrouping,
  type ExcludedBucket,
  type ExclusionReason,
} from './conversion-cost.js';
export { CostPeriodCalendar, MAX_COST_PERIODS, type KnownPeriod } from './cost-periods.js';
export {
  daysBetween,
  isoWeekOf,
  MAX_REPORT_PERIODS,
  MAX_REPORT_WEEKS,
  ReportPeriodCalendar,
  type ReportGrouping,
  type ReportPeriod,
} from './report-periods.js';
export {
  ReportConversionPolicy,
  type RateLookup,
  type ReportAmount,
  type ReportConversionPolicyKind,
} from './report-conversion.js';
export {
  ReportComparator,
  ROLLING_WINDOWS,
  type ComparisonPair,
  type ReportBaseline,
  type ReportCompareMode,
  type ReportVariation,
  type RollingWindow,
} from './report-comparator.js';
export { IncomeExpenseReport, type FlowFact, type IncomeExpenseFigures } from './income-expense-report.js';
export {
  CategoryTreeReport,
  isNegativeNet,
  type CategoryGroup,
  type CategoryGroupInfo,
  type CategoryLeaf,
  type CategoryNode,
  type CategoryNodeInfo,
  type CategoryTree,
} from './category-tree-report.js';
export {
  COMPONENT_CLASSES,
  componentOf,
  LIQUIDITY_COMPONENTS,
  LiquidityFlowReport,
  type FlowCounterpart,
  type LiquidityComponent,
  type LiquidityConsolidated,
  type LiquidityCurrencyBlock,
  type LiquidityFlowFigures,
  type SetFlow,
} from './liquidity-flow-report.js';
export { BalanceStepSeries, MAX_BALANCE_HISTORY_DAYS, type BalanceDay } from './balance-step-series.js';
export {
  NetWorthDecomposer,
  type DecomposerFlow,
  type NetWorthDecomposition,
  type Revaluation,
} from './net-worth-decomposer.js';
export { describeMismatch, ReportReconciler, type ReconciliationMismatch } from './report-reconciler.js';
export {
  REPORT_CATALOG,
  REPORT_IDS,
  type CatalogEntry,
  type ReportAvailability,
  type ReportId,
} from './report-catalog.js';
export {
  evaluateReportsReadModelAlert,
  REPORT_DURATION_METRIC,
  REPORTS_READ_MODEL_ALERT,
  type ReportDurationSample,
  type ReportsReadModelAlertState,
} from './reports-read-model-alert.js';
export {
  categoriesOfTarget,
  PlannedSpending,
  type PlanCategoryNode,
  type PlannedCommittedItem,
  type PlannedLineInput,
  type PlannedPeriodInput,
  type PlannedSpendingPeriod,
  type PlannedSpendingResult,
} from './planned-spending.js';
export {
  CashFlowCalendar,
  certaintyOf,
  type CashFlowAccountBlock,
  type CashFlowAccountInput,
  type CashFlowAmountType,
  type CashFlowCertainty,
  type CashFlowCurrencyBlock,
  type CashFlowDayPoint,
  type CashFlowEvent,
  type CashFlowEventKind,
  type CashFlowInput,
  type CashFlowLowest,
  type CashFlowManagedBy,
  type CashFlowMovementInput,
  type CashFlowResult,
} from './cash-flow-calendar.js';
export {
  CASH_FLOW_RISK_ORDER,
  CashFlowConsolidator,
  CashFlowRiskPolicy,
  CashFlowSuggester,
  LOW_RISK_MARGIN,
  type CashFlowConsolidation,
  type CashFlowRisk,
  type CashFlowRiskAssessment,
  type CashFlowSuggestion,
} from './cash-flow-risk.js';
export {
  NEXT_INCOME_FALLBACK_DAYS,
  NEXT_INCOME_LOOKAHEAD_DAYS,
  SpendableEssentials,
  SpendableHorizon,
  type EssentialCategory,
  type EssentialCommittedItem,
  type EssentialItem,
  type EssentialPlanPeriod,
  type EssentialsResult,
  type EssentialWarning,
  type EssentialWarningReason,
  type ResolvedHorizon,
  type SpendableHorizonMode,
  type UpcomingIncome,
} from './spendable-horizon.js';
export { CategoryVariation, type CategoryVariationValue } from './category-variation.js';
export { ShortfallEpisodePolicy, type ShortfallEpisodeAction } from './shortfall-episode.js';
export {
  MAX_ESSENTIAL_CATEGORIES,
  SPENDABLE_HORIZON_MODES,
  SpendableSettingsPolicy,
  type SettingsCategory,
  type SettingsChange,
  type SpendableSettingsMode,
  type SpendableSettingsValue,
} from './spendable-settings.js';
