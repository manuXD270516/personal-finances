import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import {
  MlForecastingServiceClient,
  type ForecastingRuntimeOptions,
} from '@pf/forecasting/interface/forecasting.module';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import type { NominalFlowQuery } from '@pf/transactions/contracts';
import type { ApiConfig, WorkerConfig } from '@pf/platform/config';

/** Variables `FORECASTING_*` que lee la composición (API y worker; las del worker son opcionales en la API). */
export type ForecastingConfig = Partial<
  Pick<ApiConfig, 'FORECASTING_ENABLED' | 'FORECASTING_STALE_DAYS' | 'REPORTING_RATE_VALIDITY_WINDOW'>
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
}): Pick<ForecastingRuntimeOptions, 'settingsOf' | 'flows' | 'categories' | 'rates'> {
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
