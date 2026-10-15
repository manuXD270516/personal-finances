import { dec } from '@pf/shared-kernel';
import {
  AssetClassPolicy,
  DEFAULT_STABLECOIN_CODES,
  isCryptoProviderId,
  isInstitutionProviderId,
  providerDescriptor,
  type AnomalyThresholds,
  type FxRateProvider,
  type ValuationPolicy,
} from '../domain/index.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_TIMEOUT_MS = 30_000;

/** Variables `FX_*` tal como llegan del contrato de configuración (texto; la semántica la valida FX). */
export interface FxProviderEnv {
  readonly FX_PROVIDER_PRIMARY?: string;
  readonly FX_PROVIDER_FALLBACK?: string;
  readonly FX_PROVIDER_OFFICIAL?: string;
  readonly FX_POLL_INTERVAL?: string;
  readonly FX_STALE_AFTER_PARALLEL?: string;
  readonly FX_STALE_AFTER_OFFICIAL?: string;
  readonly FX_STALE_AFTER_FALLBACK?: string;
  readonly FX_MANUAL_FALLBACK_MAX_AGE?: string;
  readonly FX_ANOMALY_THRESHOLD_PCT?: string;
  readonly FX_PROVIDER_TIMEOUT?: string;
  readonly FX_BACKFILL_ENABLED?: string;
  // add-crypto-rate-providers (D225, D228, D229)
  readonly FX_PROVIDER_CRYPTO_PRIMARY?: string;
  readonly FX_PROVIDER_CRYPTO_FALLBACK?: string;
  readonly FX_STALE_AFTER_MARKET?: string;
  readonly FX_STALE_AFTER_MARKET_FALLBACK?: string;
  readonly FX_ANOMALY_THRESHOLD_VOLATILE_PCT?: string;
  readonly FX_STABLECOIN_CODES?: string;
  readonly FX_CRYPTO_HISTORY_FROM?: string;
  // add-rate-feed-alerts (D233)
  readonly FX_FEED_STALE_ALERT_AFTER?: string;
  // add-exchange-house-rate-providers (design.md decisión 11)
  readonly FX_PROVIDER_INSTITUTION_RATES?: string;
  readonly FX_INSTITUTION_RATES_INTERVAL?: string;
  readonly FX_STALE_AFTER_INSTITUTION?: string;
}

/** Configuración validada de los providers (design.md decisión 5). */
export interface FxProviderSettings {
  readonly primary: FxRateProvider | null;
  readonly fallback: FxRateProvider | null;
  readonly official: FxRateProvider | null;
  readonly pollIntervalMs: number;
  /** Cron de 5 campos derivado del intervalo (`*\/15 * * * *`). */
  readonly pollCron: string;
  readonly staleAfterParallelMs: number;
  readonly staleAfterOfficialMs: number;
  /** Umbral propio del provider de respaldo de `PARALLEL` (bo.dolarapi.com publica con ~2 h de retraso). */
  readonly staleAfterFallbackMs: number;
  /** Antigüedad máxima de una manual de OTRO tipo en el último recurso de la valoración (docs/31 D34). */
  readonly manualFallbackMaxAgeMs: number;
  readonly anomalyThresholdPct: string;
  readonly timeoutMs: number;
  readonly backfillEnabled: boolean;
  /** `FX_PROVIDER_CONFIG_INVALID`: los providers no se inician y el estado informa el error. */
  readonly configError: string | null;
  /** Provider cripto principal (`CRYPTO_<NOMBRE>` con términos verificados) o `null` (`none`). */
  readonly cryptoPrimary: FxRateProvider | null;
  /** Provider cripto de respaldo, de otro operador, o `null`. */
  readonly cryptoFallback: FxRateProvider | null;
  /** Obsolescencia de `MARKET` del principal cripto (60 min, D228) y propia del respaldo cripto (60 min). */
  readonly staleAfterMarketMs: number;
  readonly staleAfterMarketFallbackMs: number;
  /** Umbral de anomalía de la cripto volátil (10 %, D228); `anomalyThresholdPct` es el de fiat y estables (5 %). */
  readonly anomalyThresholdVolatilePct: string;
  /** Criptomonedas tratadas como estables (`USDT`): umbral de fiat y pivote natural. */
  readonly stablecoinCodes: readonly string[];
  /** Inicio (`YYYY-MM-DD`, UTC) del histórico de cierres cripto de la instalación (D229; FR-FX-015). */
  readonly cryptoHistoryFrom: string;
  /**
   * Error de configuración SOLO de los providers cripto (provider sin verificación de términos registrada, duración o
   * umbral inválidos): los providers cripto quedan deshabilitados y el estado informa `FX_PROVIDER_CONFIG_INVALID`;
   * los de tasa paralela y el resto del sistema siguen funcionando.
   */
  readonly cryptoConfigError: string | null;
  /** Ids de providers cripto nombrados por la configuración (también si no pudieron habilitarse). */
  readonly cryptoRequested: readonly FxRateProvider[];
  /**
   * Tiempo sin tasa aceptada de ningún provider a partir del cual un par configurado abre un episodio de obsolescencia
   * (`FX_FEED_STALE_ALERT_AFTER`, 6 h; D233). Nunca menor que el intervalo de polling ni que los umbrales de
   * obsolescencia de `PARALLEL` y `MARKET`.
   */
  readonly feedStaleAlertAfterMs: number;
  /**
   * Provider de tasas por institución (`INSTRATE_<NOMBRE>` con términos verificados) o `null` (`none`, el default hasta
   * que exista una fuente verificada; add-exchange-house-rate-providers).
   */
  readonly institutionProvider: FxRateProvider | null;
  /**
   * Cada cuánto se consulta el provider por institución (`FX_INSTITUTION_RATES_INTERVAL`, 60 min; mínimo 60 s). El ciclo
   * de `fx.poll-market-rates` corre con `FX_POLL_INTERVAL`: el provider se consulta en el primer ciclo con al menos este
   * tiempo desde su último intento (nunca más seguido que el ciclo).
   */
  readonly institutionPollIntervalMs: number;
  /** Antigüedad a partir de la cual una tasa por institución está obsoleta (`FX_STALE_AFTER_INSTITUTION`, 72 h). */
  readonly staleAfterInstitutionMs: number;
  /**
   * Error de configuración SOLO del provider por institución (sin verificación de términos registrada, fuente
   * rechazada, duración inválida): queda deshabilitado con `FX_PROVIDER_CONFIG_INVALID` y no envía solicitudes; los
   * providers de tasa paralela, oficial y cripto siguen funcionando.
   */
  readonly institutionConfigError: string | null;
  /** Ids de providers por institución nombrados por la configuración (también si no pudieron habilitarse). */
  readonly institutionRequested: readonly FxRateProvider[];
}

export const DEFAULT_FX_PROVIDER_ENV: Required<FxProviderEnv> = {
  FX_PROVIDER_PRIMARY: 'paralelo_bo',
  FX_PROVIDER_FALLBACK: 'dolarapi_bo',
  FX_PROVIDER_OFFICIAL: 'dolarapi_bo',
  FX_POLL_INTERVAL: '15m',
  FX_STALE_AFTER_PARALLEL: '60m',
  FX_STALE_AFTER_OFFICIAL: '48h',
  FX_STALE_AFTER_FALLBACK: '180m',
  FX_MANUAL_FALLBACK_MAX_AGE: '24h',
  FX_ANOMALY_THRESHOLD_PCT: '5',
  FX_PROVIDER_TIMEOUT: '10s',
  FX_BACKFILL_ENABLED: 'true',
  // Hasta que exista un provider cripto verificado (ADR-0029) el default es `none`.
  FX_PROVIDER_CRYPTO_PRIMARY: 'none',
  FX_PROVIDER_CRYPTO_FALLBACK: 'none',
  FX_STALE_AFTER_MARKET: '60m',
  FX_STALE_AFTER_MARKET_FALLBACK: '60m',
  FX_ANOMALY_THRESHOLD_VOLATILE_PCT: '10',
  FX_STABLECOIN_CODES: 'USDT',
  FX_CRYPTO_HISTORY_FROM: '2020-01-01',
  FX_FEED_STALE_ALERT_AFTER: '6h',
  // Hasta que exista una fuente verificada por institución el default es `none` (sin solicitudes a ninguna fuente).
  FX_PROVIDER_INSTITUTION_RATES: 'none',
  FX_INSTITUTION_RATES_INTERVAL: '60m',
  FX_STALE_AFTER_INSTITUTION: '72h',
};

const PROVIDER_VALUES: Readonly<Record<string, FxRateProvider | null>> = {
  paralelo_bo: 'PARALELO_BO',
  dolarapi_bo: 'DOLARAPI_BO',
  none: null,
};

/** `30s`, `15m`, `48h` → ms (`null` si el formato no es válido). */
export function parseDuration(value: string): number | null {
  const m = /^(\d{1,6})(s|m|h)$/.exec(value.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1] as string, 10);
  return n * (m[2] === 's' ? 1000 : m[2] === 'm' ? MINUTE_MS : HOUR_MS);
}

/**
 * Intervalo → cron de 5 campos. Solo intervalos que dividen la hora (1–30 min) o múltiplos de hora que dividen el
 * día: así cada ciclo dura exactamente el intervalo (un `*\/45` dispararía a :00 y :45).
 */
export function pollCronFor(intervalMs: number): string | null {
  if (intervalMs % MINUTE_MS !== 0) return null;
  const minutes = intervalMs / MINUTE_MS;
  if (minutes >= 1 && minutes < 60 && 60 % minutes === 0)
    return minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    if (hours === 1) return '0 * * * *';
    if (hours <= 24 && 24 % hours === 0) return hours === 24 ? '0 0 * * *' : `0 */${hours} * * *`;
  }
  return null;
}

const disabled = (
  base: Omit<FxProviderSettings, 'primary' | 'fallback' | 'official' | 'configError'>,
  error: string,
) => ({
  ...base,
  primary: null,
  fallback: null,
  official: null,
  // Una configuración general inválida detiene todos los providers, también los cripto y los de instituciones.
  cryptoPrimary: null,
  cryptoFallback: null,
  institutionProvider: null,
  configError: error,
});

/**
 * Provider cripto de una variable: `none` o un id `CRYPTO_<NOMBRE>` registrado cuya verificación de términos de uso
 * esté registrada como `VERIFIED` con su fecha y su ADR (NFR-COMP-007, RISK-023; D225). Cualquier otro caso es un error
 * de configuración que deshabilita solo a los providers cripto.
 */
function cryptoProvider(name: string, value: string, errors: string[]): FxRateProvider | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return null;
  const id = v.toUpperCase();
  if (!isCryptoProviderId(id)) {
    errors.push(`${name} must be none or a verified crypto provider id (CRYPTO_<NAME>)`);
    return null;
  }
  const descriptor = providerDescriptor(id);
  if (!descriptor || descriptor.kind !== 'CRYPTO') {
    errors.push(`${name}: provider ${id} has no registered adapter and terms verification (ADR-0029)`);
    return null;
  }
  const { terms } = descriptor;
  if (terms.status !== 'VERIFIED' || !terms.verifiedOn || !terms.adr) {
    errors.push(
      `${name}: provider ${id} cannot be enabled, its terms of use are ${terms.status === 'REJECTED' ? 'rejected' : 'not verified'} (NFR-COMP-007)`,
    );
    return null;
  }
  return id;
}

/**
 * Provider por institución de una variable: `none` o un id `INSTRATE_<NOMBRE>` registrado cuya verificación de términos
 * de uso esté registrada como `VERIFIED` con su fecha y su ADR (NFR-COMP-007, RISK-023). Sin ella NO se habilita ni se
 * envía ninguna solicitud a la fuente: el error deshabilita solo a los providers por institución.
 */
function institutionProvider(name: string, value: string, errors: string[]): FxRateProvider | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return null;
  const id = v.toUpperCase();
  if (!isInstitutionProviderId(id)) {
    errors.push(`${name} must be none or a verified institution rates provider id (INSTRATE_<NAME>)`);
    return null;
  }
  const descriptor = providerDescriptor(id);
  if (!descriptor || descriptor.kind !== 'INSTITUTION') {
    errors.push(`${name}: provider ${id} has no registered adapter and terms verification (NFR-COMP-007)`);
    return null;
  }
  const { terms } = descriptor;
  if (terms.status !== 'VERIFIED' || !terms.verifiedOn || !terms.adr) {
    errors.push(
      `${name}: provider ${id} cannot be enabled, its terms of use are ${terms.status === 'REJECTED' ? 'rejected' : 'not verified'} (NFR-COMP-007)`,
    );
    return null;
  }
  return id;
}

/**
 * Valida las variables `FX_*` (design.md decisión 5). Un error NO detiene el proceso: deja los providers
 * deshabilitados con `configError` (`FX_PROVIDER_CONFIG_INVALID` en el estado) y el resto del worker/API sigue.
 */
export function parseFxProviderSettings(env: FxProviderEnv = {}): FxProviderSettings {
  const raw = { ...DEFAULT_FX_PROVIDER_ENV, ...stripUndefined(env) };
  const errors: string[] = [];
  const provider = (name: keyof FxProviderEnv, allowed: readonly string[]) => {
    const v = raw[name].trim().toLowerCase();
    if (!allowed.includes(v)) {
      errors.push(`${name} must be one of ${allowed.join(', ')}`);
      return null;
    }
    return PROVIDER_VALUES[v] ?? null;
  };
  const primary = provider('FX_PROVIDER_PRIMARY', ['paralelo_bo', 'dolarapi_bo', 'none']);
  const fallback = provider('FX_PROVIDER_FALLBACK', ['dolarapi_bo', 'paralelo_bo', 'none']);
  const official = provider('FX_PROVIDER_OFFICIAL', ['dolarapi_bo', 'none']);
  if (primary !== null && primary === fallback)
    errors.push('FX_PROVIDER_FALLBACK must differ from FX_PROVIDER_PRIMARY');

  const duration = (name: keyof FxProviderEnv) => {
    const ms = parseDuration(raw[name]);
    if (ms === null || ms <= 0) errors.push(`${name} must be a duration like 30s, 15m or 48h`);
    return ms ?? 0;
  };
  const pollIntervalMs = duration('FX_POLL_INTERVAL');
  let pollCron = '';
  if (pollIntervalMs > 0 && pollIntervalMs < MINUTE_MS) {
    errors.push('FX_POLL_INTERVAL must be at least 60 seconds (1m)');
  } else if (pollIntervalMs > 0) {
    const cron = pollCronFor(pollIntervalMs);
    if (cron === null) errors.push('FX_POLL_INTERVAL must divide the hour (1m–30m) or the day (1h–24h)');
    else pollCron = cron;
  }
  const staleAfterParallelMs = duration('FX_STALE_AFTER_PARALLEL');
  const staleAfterOfficialMs = duration('FX_STALE_AFTER_OFFICIAL');
  const staleAfterFallbackMs = duration('FX_STALE_AFTER_FALLBACK');
  const manualFallbackMaxAgeMs = duration('FX_MANUAL_FALLBACK_MAX_AGE');
  const timeoutMs = duration('FX_PROVIDER_TIMEOUT');
  if (timeoutMs > MAX_TIMEOUT_MS) errors.push('FX_PROVIDER_TIMEOUT must be at most 30s');
  const feedStaleAlertAfterMs = duration('FX_FEED_STALE_ALERT_AFTER');
  const threshold = raw.FX_ANOMALY_THRESHOLD_PCT.trim();
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(threshold) || dec(threshold).lte(0)) {
    errors.push('FX_ANOMALY_THRESHOLD_PCT must be a decimal > 0');
  }
  const backfill = raw.FX_BACKFILL_ENABLED.trim().toLowerCase();
  if (!['true', 'false'].includes(backfill)) errors.push('FX_BACKFILL_ENABLED must be true or false');

  // Providers cripto (add-crypto-rate-providers): su error deshabilita solo a los cripto.
  const cryptoErrors: string[] = [];
  let cryptoPrimary = cryptoProvider(
    'FX_PROVIDER_CRYPTO_PRIMARY',
    raw.FX_PROVIDER_CRYPTO_PRIMARY,
    cryptoErrors,
  );
  let cryptoFallback = cryptoProvider(
    'FX_PROVIDER_CRYPTO_FALLBACK',
    raw.FX_PROVIDER_CRYPTO_FALLBACK,
    cryptoErrors,
  );
  if (cryptoPrimary !== null && cryptoPrimary === cryptoFallback) {
    cryptoErrors.push('FX_PROVIDER_CRYPTO_FALLBACK must differ from FX_PROVIDER_CRYPTO_PRIMARY');
  }
  const cryptoDuration = (name: keyof FxProviderEnv) => {
    const ms = parseDuration(raw[name]);
    if (ms === null || ms <= 0) cryptoErrors.push(`${name} must be a duration like 30s, 15m or 48h`);
    return ms ?? 0;
  };
  const staleAfterMarketMs = cryptoDuration('FX_STALE_AFTER_MARKET');
  const staleAfterMarketFallbackMs = cryptoDuration('FX_STALE_AFTER_MARKET_FALLBACK');
  const volatileThreshold = raw.FX_ANOMALY_THRESHOLD_VOLATILE_PCT.trim();
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(volatileThreshold) || dec(volatileThreshold).lte(0)) {
    cryptoErrors.push('FX_ANOMALY_THRESHOLD_VOLATILE_PCT must be a decimal > 0');
  }
  const stablecoinCodes = raw.FX_STABLECOIN_CODES.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c !== '');
  if (stablecoinCodes.length === 0 || !stablecoinCodes.every((c) => /^[A-Z0-9]{2,16}$/.test(c))) {
    cryptoErrors.push('FX_STABLECOIN_CODES must be a comma-separated list of currency codes');
  }
  const historyFrom = raw.FX_CRYPTO_HISTORY_FROM.trim();
  if (!isCalendarDate(historyFrom)) {
    cryptoErrors.push('FX_CRYPTO_HISTORY_FROM must be a date like 2020-01-01');
  }
  // El umbral de alerta no puede ser menor que el intervalo de polling ni que la obsolescencia de la valoración del
  // tipo automático (PARALLEL / MARKET): alertaría de tasas que la valoración aún considera frescas (design.md dec. 1).
  const alertFloorMs = Math.max(
    pollIntervalMs,
    staleAfterParallelMs,
    staleAfterFallbackMs,
    staleAfterMarketMs,
    staleAfterMarketFallbackMs,
  );
  if (feedStaleAlertAfterMs > 0 && feedStaleAlertAfterMs < alertFloorMs) {
    errors.push(
      'FX_FEED_STALE_ALERT_AFTER must not be shorter than FX_POLL_INTERVAL nor than the FX_STALE_AFTER_PARALLEL / FX_STALE_AFTER_FALLBACK / FX_STALE_AFTER_MARKET thresholds',
    );
  }
  // Provider por institución (add-exchange-house-rate-providers): su error deshabilita solo a ese provider.
  const institutionErrors: string[] = [];
  let institutionProviderId = institutionProvider(
    'FX_PROVIDER_INSTITUTION_RATES',
    raw.FX_PROVIDER_INSTITUTION_RATES,
    institutionErrors,
  );
  const institutionDuration = (name: keyof FxProviderEnv) => {
    const ms = parseDuration(raw[name]);
    if (ms === null || ms <= 0) institutionErrors.push(`${name} must be a duration like 30s, 15m or 72h`);
    return ms ?? 0;
  };
  const institutionPollIntervalMs = institutionDuration('FX_INSTITUTION_RATES_INTERVAL');
  if (institutionPollIntervalMs > 0 && institutionPollIntervalMs < MINUTE_MS) {
    institutionErrors.push('FX_INSTITUTION_RATES_INTERVAL must be at least 60 seconds (1m)');
  }
  const staleAfterInstitutionMs = institutionDuration('FX_STALE_AFTER_INSTITUTION');
  // Una tasa por institución se publica una vez por día hábil: un umbral menor que lo que tarda el ciclo en consultar la
  // fuente la marcaría obsoleta antes de poder renovarse.
  const institutionFloorMs = Math.max(pollIntervalMs, institutionPollIntervalMs);
  if (staleAfterInstitutionMs > 0 && staleAfterInstitutionMs < institutionFloorMs) {
    institutionErrors.push(
      'FX_STALE_AFTER_INSTITUTION must not be shorter than FX_POLL_INTERVAL nor than FX_INSTITUTION_RATES_INTERVAL',
    );
  }
  const institutionConfigError = institutionErrors.length > 0 ? institutionErrors.join('; ') : null;
  if (institutionConfigError) institutionProviderId = null;
  const institutionRequested = [raw.FX_PROVIDER_INSTITUTION_RATES]
    .map((v) => v.trim().toUpperCase())
    .filter((v): v is FxRateProvider => isInstitutionProviderId(v));

  const cryptoRequested = [raw.FX_PROVIDER_CRYPTO_PRIMARY, raw.FX_PROVIDER_CRYPTO_FALLBACK]
    .map((v) => v.trim().toUpperCase())
    .filter((v): v is FxRateProvider => isCryptoProviderId(v));
  const cryptoConfigError = cryptoErrors.length > 0 ? cryptoErrors.join('; ') : null;
  if (cryptoConfigError) {
    cryptoPrimary = null;
    cryptoFallback = null;
  }

  const base = {
    pollIntervalMs,
    pollCron,
    staleAfterParallelMs: staleAfterParallelMs || 60 * MINUTE_MS,
    staleAfterOfficialMs: staleAfterOfficialMs || 48 * HOUR_MS,
    staleAfterFallbackMs: staleAfterFallbackMs || 180 * MINUTE_MS,
    manualFallbackMaxAgeMs: manualFallbackMaxAgeMs || 24 * HOUR_MS,
    anomalyThresholdPct: errors.length === 0 ? dec(threshold).toFixed() : '5',
    timeoutMs: timeoutMs || 10_000,
    backfillEnabled: backfill === 'true',
    cryptoPrimary,
    cryptoFallback,
    staleAfterMarketMs: staleAfterMarketMs || 60 * MINUTE_MS,
    staleAfterMarketFallbackMs: staleAfterMarketFallbackMs || 60 * MINUTE_MS,
    anomalyThresholdVolatilePct: cryptoConfigError === null ? dec(volatileThreshold).toFixed() : '10',
    stablecoinCodes: cryptoConfigError === null ? stablecoinCodes : [...DEFAULT_STABLECOIN_CODES],
    cryptoHistoryFrom: cryptoConfigError === null ? historyFrom : '2020-01-01',
    cryptoConfigError,
    cryptoRequested: [...new Set(cryptoRequested)],
    feedStaleAlertAfterMs: feedStaleAlertAfterMs || 6 * HOUR_MS,
    institutionProvider: institutionProviderId,
    institutionPollIntervalMs: institutionPollIntervalMs || 60 * MINUTE_MS,
    staleAfterInstitutionMs: staleAfterInstitutionMs || 72 * HOUR_MS,
    institutionConfigError,
    institutionRequested: [...new Set(institutionRequested)],
  };
  if (errors.length > 0) return disabled(base, errors.join('; '));
  return { ...base, primary, fallback, official, configError: null };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function stripUndefined(env: FxProviderEnv): Partial<Record<keyof FxProviderEnv, string>> {
  const out: Partial<Record<keyof FxProviderEnv, string>> = {};
  for (const k of Object.keys(DEFAULT_FX_PROVIDER_ENV) as (keyof FxProviderEnv)[]) {
    const v = env[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Providers habilitados en algún rol (únicos), en orden principal → respaldo → oficial → cripto principal → cripto
 * respaldo → por institución.
 */
export function enabledProviders(s: FxProviderSettings): FxRateProvider[] {
  return [
    ...new Set(
      [s.primary, s.fallback, s.official, s.cryptoPrimary, s.cryptoFallback, s.institutionProvider].filter(
        (p): p is FxRateProvider => p !== null,
      ),
    ),
  ];
}

/** Providers cripto habilitados, principal primero. */
export function enabledCryptoProviders(s: FxProviderSettings): FxRateProvider[] {
  return [...new Set([s.cryptoPrimary, s.cryptoFallback].filter((p): p is FxRateProvider => p !== null))];
}

/** Umbrales de anomalía por clase de activo (D228). */
export function anomalyThresholdsOf(s: FxProviderSettings): AnomalyThresholds {
  return { fiatStablePct: s.anomalyThresholdPct, volatilePct: s.anomalyThresholdVolatilePct };
}

/** Política de clases de activo derivada de `FX_STABLECOIN_CODES`. */
export function assetClassPolicyOf(s: FxProviderSettings): AssetClassPolicy {
  return new AssetClassPolicy(s.stablecoinCodes);
}

/** Política de valoración derivada de la configuración (roles, obsolescencia por tipo y umbral del respaldo). */
export function valuationPolicyOf(s: FxProviderSettings): ValuationPolicy {
  return {
    roles: {
      PARALLEL: { primary: s.primary, fallback: s.fallback },
      OFFICIAL: { primary: s.official, fallback: null },
      // Precios cripto (D225, D226): solo con providers cripto habilitados.
      ...(s.cryptoPrimary !== null || s.cryptoFallback !== null
        ? { MARKET: { primary: s.cryptoPrimary, fallback: s.cryptoFallback } }
        : {}),
      // Compra y venta por institución: solo con el provider habilitado; valoran únicamente si el par las prefiere.
      ...(s.institutionProvider !== null
        ? {
            BANK_BUY: { primary: s.institutionProvider, fallback: null },
            BANK_SELL: { primary: s.institutionProvider, fallback: null },
          }
        : {}),
    },
    staleAfterMs: {
      PARALLEL: s.staleAfterParallelMs,
      OFFICIAL: s.staleAfterOfficialMs,
      MARKET: s.staleAfterMarketMs,
      ...(s.institutionProvider !== null
        ? { BANK_BUY: s.staleAfterInstitutionMs, BANK_SELL: s.staleAfterInstitutionMs }
        : {}),
    },
    // Solo el provider con rol de respaldo de PARALLEL / MARKET (StalenessPolicy.thresholdFor).
    fallbackStaleAfterMs: {
      PARALLEL: s.staleAfterFallbackMs,
      ...(s.cryptoFallback !== null ? { MARKET: s.staleAfterMarketFallbackMs } : {}),
    },
    // Último recurso con manuales de otro tipo (docs/31 D34): antigüedad máxima y desvío = umbral de anomalía.
    manualFallbackMaxAgeMs: s.manualFallbackMaxAgeMs,
    manualFallbackMaxDeviationPct: s.anomalyThresholdPct,
  };
}

/** Configuración por defecto (design.md decisión 5). */
export const DEFAULT_FX_PROVIDER_SETTINGS: FxProviderSettings = parseFxProviderSettings();
