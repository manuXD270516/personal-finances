import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { ResolvedOccurrencesQuery, UpcomingPaymentsQuery } from '@pf/commitments/contracts';
import type { LoanScheduleQuery } from '@pf/debt/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import { ANOMALY_METRICS } from '@pf/forecasting/contracts';
import {
  MlForecastingServiceClient,
  type AnomalyRuntimeOptions,
  type ForecastingRuntimeOptions,
} from '@pf/forecasting/interface/forecasting.module';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import { dec } from '@pf/shared-kernel';
import type { NotificationIntakePort } from '@pf/notifications/contracts';
import type { ExpenseLineQuery, NominalFlowQuery } from '@pf/transactions/contracts';
import type { ApiConfig, WorkerConfig } from '@pf/platform/config';

/** Variables `FORECASTING_*` que lee la composición (API y worker; las del worker son opcionales en la API). */
export type ForecastingConfig = Partial<
  Pick<
    ApiConfig,
    | 'FORECASTING_ENABLED'
    | 'FORECASTING_ANOMALIES_ENABLED'
    | 'FORECASTING_STALE_DAYS'
    | 'FORECASTING_COHERENCE_GAP_RATIO'
    | 'REPORTING_RATE_VALIDITY_WINDOW'
  >
> &
  Partial<
    Pick<
      WorkerConfig,
      | 'FORECASTING_SERVICE_URL'
      | 'FORECASTING_SERVICE_TOKEN_FILE'
      | 'FORECASTING_SERVICE_TIMEOUT_MS'
      | 'FORECASTING_MAX_AGE_DAYS'
      | 'FORECASTING_MAX_ATTEMPTS'
      | 'FORECASTING_HISTORY_MAX_PERIODS'
      | 'FORECASTING_MIN_PERIODS_MODEL'
      | 'FORECASTING_MIN_PERIODS_SIMPLE'
      | 'FORECASTING_ANOMALY_LOOKBACK_DAYS'
      | 'FORECASTING_ANOMALY_ROBUST_Z'
      | 'FORECASTING_ANOMALY_MIN_RATIO'
      | 'FORECASTING_ANOMALY_MIN_SAMPLE'
      | 'FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE'
    >
  >;

/** Ajustes de FORECAST desde la configuración (los valores por omisión son los de `docs/config-reference.md`). */
export function forecastingSettingsFrom(
  config: ForecastingConfig,
  rateValidityWindowDays: number,
): NonNullable<ForecastingRuntimeOptions['settings']> {
  return {
    enabled: config.FORECASTING_ENABLED ?? false,
    maxAgeDays: config.FORECASTING_MAX_AGE_DAYS ?? 7,
    historyMaxPeriods: Math.min(config.FORECASTING_HISTORY_MAX_PERIODS ?? 60, 120),
    thresholds: {
      minPeriodsModel: config.FORECASTING_MIN_PERIODS_MODEL ?? 6,
      minPeriodsSimple: config.FORECASTING_MIN_PERIODS_SIMPLE ?? 3,
    },
    retry: {
      maxAttempts: config.FORECASTING_MAX_ATTEMPTS ?? 5,
      baseDelayMs: 5 * 60_000,
      factor: 3,
      windowMs: 24 * 3_600_000,
      stallMs: 15 * 60_000,
    },
    staleDays: config.FORECASTING_STALE_DAYS ?? 35,
    rateValidityWindowDays,
    coherenceGapRatio: String(config.FORECASTING_COHERENCE_GAP_RATIO ?? 0.05),
  };
}

/** ACL del servicio `finance-ml`: solo el worker lo llama (la API lo compone igual y nunca lo usa). */
export function forecastingServiceClient(config: ForecastingConfig): MlForecastingServiceClient {
  return new MlForecastingServiceClient({
    baseUrl: config.FORECASTING_SERVICE_URL ?? 'http://ml-forecasting:8090',
    tokenFile: config.FORECASTING_SERVICE_TOKEN_FILE ?? '',
    timeoutMs: config.FORECASTING_SERVICE_TIMEOUT_MS ?? 300_000,
  });
}

/** Métricas `pf.ml.forecast.*` (docs/18): duración por resultado, fallas por motivo y series con datos insuficientes. */
export function forecastingMetrics(): NonNullable<ForecastingRuntimeOptions['metrics']> {
  const counters = otelCounters('@pf/forecasting');
  const histograms = otelHistograms('@pf/forecasting');
  return {
    observeDuration: (outcome, seconds) => histograms.record('pf.ml.forecast.duration', seconds, { outcome }),
    failure: (reason) => counters.increment('pf.ml.forecast.failures.total', { reason }),
    insufficient: (count) => {
      if (count > 0) counters.increment('pf.ml.forecast.insufficient_data.total', {}, count);
    },
  };
}

/**
 * Adaptadores de los puertos de lectura de FORECAST sobre los contratos públicos de IDENTITY, TRANSACTIONS,
 * CLASSIFICATION y FX (nunca sobre REPORTING: REPORTING leerá FORECAST, `arch:check` prohíbe el ciclo).
 */
export function forecastingReadPorts(input: {
  readonly calendar: WorkspaceCalendarQuery;
  readonly settings: {
    settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
  };
  readonly flows: NominalFlowQuery;
  readonly categories: CategoryCatalogQuery;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates' | 'enabledCurrencies'>;
  /** Catálogo de cuentas (cuentas líquidas por moneda para la serie del gasto variable líquido). */
  readonly accounts: Pick<AccountCatalogQuery, 'listAccounts'>;
}): Pick<ForecastingRuntimeOptions, 'settingsOf' | 'flows' | 'categories' | 'rates' | 'liquidAccounts'> {
  return {
    settingsOf: {
      async settingsOf(workspaceId) {
        // Una consulta por vez: nunca en paralelo sobre el mismo cliente.
        const calendar = await input.calendar.calendarOf(workspaceId);
        const settings = await input.settings.settingsOf(workspaceId);
        const currencies = await input.rates.enabledCurrencies(workspaceId);
        return {
          timeZone: calendar.timeZone,
          startDay: calendar.fiscalMonthStartDay,
          reportingCurrency: settings.baseCurrency,
          reportingScale: currencies.find((c) => c.code === settings.baseCurrency)?.scale ?? 2,
        };
      },
    },
    flows: {
      loadFlows: (workspaceId, dateFrom, dateTo) =>
        input.flows.summarizeNominalFlows({ workspaceId, dateFrom, dateTo }),
      // Porciones con componente de préstamo (interés, cargos, seguro, impuestos): se restan de la historia variable.
      async loadLoanComponents(workspaceId, dateFrom, dateTo) {
        const rows = await input.flows.summarizeNominalFlows({
          workspaceId,
          dateFrom,
          dateTo,
          groupBy: ['ORIGIN'],
        });
        return rows
          .filter((r) => r.nature === 'EXPENSE' && r.origin?.loanComponent)
          .map((r) => ({ businessDate: r.businessDate, categoryId: r.categoryId, amount: r.amount }));
      },
      // add-predicted-cash-flow-band: gasto por cuenta (y su componente de préstamo) para el gasto variable líquido.
      async loadLiquidFlows(workspaceId, dateFrom, dateTo) {
        const rows = await input.flows.summarizeNominalFlows({
          workspaceId,
          dateFrom,
          dateTo,
          groupBy: ['ACCOUNT', 'ORIGIN'],
        });
        return rows
          .filter((r) => r.nature === 'EXPENSE' && r.accountId !== undefined)
          .map((r) => ({
            businessDate: r.businessDate,
            accountId: r.accountId as string,
            amount: r.amount,
            loanComponent: Boolean(r.origin?.loanComponent),
          }));
      },
    },
    liquidAccounts: {
      async liquidAccounts(workspaceId) {
        // Una consulta por vez: nunca en paralelo sobre el mismo cliente.
        const accounts = await input.accounts.listAccounts({ workspaceId });
        const currencies = await input.rates.enabledCurrencies(workspaceId);
        return accounts
          .filter((a) => a.nature === 'ASSET' && a.liquidity === 'LIQUID')
          .map((a) => ({
            accountId: a.accountId,
            currency: a.currency,
            scale: currencies.find((c) => c.code === a.currency)?.scale ?? 2,
          }));
      },
    },
    categories: {
      async catalog(workspaceId) {
        // El pronóstico lo corre el worker (sin usuario): el catálogo no filtra por usuario.
        const tree = await input.categories.categoryTree({ userId: '', workspaceId });
        return {
          groups: tree.groups.map((g) => ({ groupId: g.groupId, name: g.name })),
          categories: tree.categories
            .filter((c) => c.kind === 'EXPENSE')
            .map((c) => ({
              categoryId: c.categoryId,
              groupId: c.groupId,
              name: c.name,
              uncategorized: c.systemCode === 'UNCATEGORIZED',
            })),
        };
      },
    },
    rates: {
      resolve: (workspaceId, req) =>
        input.rates.resolveValuationRates({
          workspaceId,
          requests: req.requests,
          windowDays: req.windowDays,
        }),
    },
  };
}

/**
 * Adaptadores de los costos conocidos (add-expense-forecasts) sobre los contratos públicos de COMMITMENTS (ocurrencias
 * resueltas, no resueltas y la proyección sin guardar) y DEBT (cuotas futuras con componentes). Lecturas en serie: nunca
 * en paralelo sobre el mismo cliente.
 */
export function forecastingKnownPorts(input: {
  readonly upcoming: Pick<UpcomingPaymentsQuery, 'projectForForecast'>;
  readonly resolved: Pick<ResolvedOccurrencesQuery, 'listResolved'>;
  readonly loans: LoanScheduleQuery;
}): Pick<ForecastingRuntimeOptions, 'known'> {
  return {
    known: {
      async listResolved(workspaceId, from, to, direction) {
        const rows = await input.resolved.listResolved({ workspaceId, from, to, direction });
        return rows.map((r) => ({
          kind: r.kind,
          managedBy: r.managedBy,
          transactionDate: r.transactionDate,
          amount: r.amount,
          categoryId: r.categoryId,
          accountId: r.accountId,
        }));
      },
      async project(workspaceId, from, to) {
        const rows = await input.upcoming.projectForForecast({ workspaceId, from, to });
        return rows.map((o) => ({
          date: o.date,
          definitionId: o.definitionId,
          occurrenceId: o.occurrenceId,
          projected: o.projected,
          kind: o.kind,
          amountType: o.amountType,
          amount: o.amount,
          minAmount: o.minAmount,
          maxAmount: o.maxAmount,
          categoryId: o.categoryId,
          managedBy: o.managedBy,
          label: o.label,
        }));
      },
      installments: (workspaceId, from, to) =>
        input.loans.listUpcomingInstallments({ workspaceId, from, to }),
    },
  };
}

type ExpenseLine = Awaited<ReturnType<AnomalyRuntimeOptions['expenses']['listExpenseLines']>>[number];

/** Transacciones por página al recorrer las líneas de gasto (la historia anual del Large Seed son ~20 000 porciones). */
const EXPENSE_LINES_PAGE = 2000;

/**
 * Adaptadores de la detección de gastos atípicos (add-spending-anomaly-detection) sobre los contratos públicos de
 * TRANSACTIONS (`ExpenseLineQuery`), COMMITMENTS (ocurrencias resueltas) y, solo en el worker, NOTIFICATIONS
 * (`NotificationIntakePort`, dentro de la misma unidad de trabajo). Lecturas en serie: nunca en paralelo sobre el mismo cliente.
 */
export function forecastingAnomalyPorts(input: {
  readonly expenseLines: ExpenseLineQuery;
  readonly resolved: Pick<ResolvedOccurrencesQuery, 'listResolved'>;
  readonly config: ForecastingConfig;
  readonly rateValidityWindowDays: number;
  /** Solo el worker avisa; la API nunca ejecuta la detección. */
  readonly intake?: Pick<NotificationIntakePort, 'notify'>;
}): AnomalyRuntimeOptions {
  const { config, intake } = input;
  return {
    expenses: {
      async listExpenseLines(workspaceId, from, to) {
        const out: ExpenseLine[] = [];
        let after: string | undefined;
        for (;;) {
          const page = await input.expenseLines.listExpenseLines({
            workspaceId,
            from,
            to,
            limit: EXPENSE_LINES_PAGE,
            ...(after ? { after } : {}),
          });
          for (const l of page.items) {
            // Administrados por otro módulo (préstamos, cargos de tarjeta de D465, metas): no se evalúan.
            if (l.managedBy !== null || l.debtRole !== null) continue;
            out.push({
              transactionId: l.transactionId,
              version: l.version,
              date: l.date,
              counterpartyId: l.counterpartyId,
              categoryId: l.categoryId,
              splitIndex: l.splitIndex,
              amount: l.amount,
            });
          }
          if (!page.next) break;
          after = page.next;
        }
        return out;
      },
    },
    resolved: {
      // Pagos vinculados a una ocurrencia de un compromiso (cambios de precio de suscripciones: otro módulo, D475).
      async transactionIds(workspaceId, from, to) {
        const rows = await input.resolved.listResolved({ workspaceId, from, to, direction: 'OUTFLOW' });
        return new Set(rows.map((r) => r.transactionId));
      },
    },
    transactions: {
      statesOf: (workspaceId, transactionIds) =>
        input.expenseLines.transactionStates({ workspaceId, transactionIds }),
    },
    ...(intake
      ? {
          notifier: {
            notify: async (f) => {
              await intake.notify({
                workspaceId: f.workspaceId,
                type: 'SPENDING_ANOMALY',
                factKey: `spending-anomalies:${f.passDate}`,
                sourceEventId: f.passId,
                occurredAt: f.occurredAt,
                payload: {
                  workspaceId: f.workspaceId,
                  passDate: f.passDate,
                  count: f.count,
                  top: f.top,
                  timeZone: f.timeZone,
                },
              });
            },
          },
        }
      : {}),
    settings: {
      enabled: config.FORECASTING_ANOMALIES_ENABLED ?? true,
      lookbackDays: config.FORECASTING_ANOMALY_LOOKBACK_DAYS ?? 7,
      thresholds: {
        robustZ: dec(String(config.FORECASTING_ANOMALY_ROBUST_Z ?? 3.5)),
        minRatio: dec(String(config.FORECASTING_ANOMALY_MIN_RATIO ?? 3)),
        minSample: config.FORECASTING_ANOMALY_MIN_SAMPLE ?? 8,
        newCounterpartyPercentile: config.FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE ?? 95,
      },
      rateValidityWindowDays: input.rateValidityWindowDays,
    },
    metrics: forecastingAnomalyMetrics(),
  };
}

/** Métricas `forecast_anomaly_*` (docs/18): sin montos ni identificadores de transacciones en las etiquetas. */
export function forecastingAnomalyMetrics(): NonNullable<AnomalyRuntimeOptions['metrics']> {
  const counters = otelCounters('@pf/forecasting');
  const histograms = otelHistograms('@pf/forecasting');
  return {
    evaluated: (count) => {
      if (count > 0) counters.increment(ANOMALY_METRICS.evaluated, {}, count);
    },
    notRated: (count) => {
      if (count > 0) counters.increment(ANOMALY_METRICS.notRated, {}, count);
    },
    flagged: (reason, count) => counters.increment(ANOMALY_METRICS.flagged, { reason }, count),
    decided: (decision) => counters.increment(ANOMALY_METRICS.decided, { decision }),
    passDuration: (seconds) => histograms.record(ANOMALY_METRICS.passDuration, seconds, {}),
  };
}
