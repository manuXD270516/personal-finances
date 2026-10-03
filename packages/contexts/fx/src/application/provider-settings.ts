import { dec } from '@pf/shared-kernel';
import type { FxRateProvider, ValuationPolicy } from '../domain/index.js';

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
  readonly FX_ANOMALY_THRESHOLD_PCT?: string;
  readonly FX_PROVIDER_TIMEOUT?: string;
  readonly FX_BACKFILL_ENABLED?: string;
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
  readonly anomalyThresholdPct: string;
  readonly timeoutMs: number;
  readonly backfillEnabled: boolean;
  /** `FX_PROVIDER_CONFIG_INVALID`: los providers no se inician y el estado informa el error. */
  readonly configError: string | null;
}

export const DEFAULT_FX_PROVIDER_ENV: Required<FxProviderEnv> = {
  FX_PROVIDER_PRIMARY: 'paralelo_bo',
  FX_PROVIDER_FALLBACK: 'dolarapi_bo',
  FX_PROVIDER_OFFICIAL: 'dolarapi_bo',
  FX_POLL_INTERVAL: '15m',
  FX_STALE_AFTER_PARALLEL: '60m',
  FX_STALE_AFTER_OFFICIAL: '48h',
  FX_ANOMALY_THRESHOLD_PCT: '5',
  FX_PROVIDER_TIMEOUT: '10s',
  FX_BACKFILL_ENABLED: 'true',
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
  configError: error,
});

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
  const timeoutMs = duration('FX_PROVIDER_TIMEOUT');
  if (timeoutMs > MAX_TIMEOUT_MS) errors.push('FX_PROVIDER_TIMEOUT must be at most 30s');
  const threshold = raw.FX_ANOMALY_THRESHOLD_PCT.trim();
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(threshold) || dec(threshold).lte(0)) {
    errors.push('FX_ANOMALY_THRESHOLD_PCT must be a decimal > 0');
  }
  const backfill = raw.FX_BACKFILL_ENABLED.trim().toLowerCase();
  if (!['true', 'false'].includes(backfill)) errors.push('FX_BACKFILL_ENABLED must be true or false');

  const base = {
    pollIntervalMs,
    pollCron,
    staleAfterParallelMs: staleAfterParallelMs || 60 * MINUTE_MS,
    staleAfterOfficialMs: staleAfterOfficialMs || 48 * HOUR_MS,
    anomalyThresholdPct: errors.length === 0 ? dec(threshold).toFixed() : '5',
    timeoutMs: timeoutMs || 10_000,
    backfillEnabled: backfill === 'true',
  };
  if (errors.length > 0) return disabled(base, errors.join('; '));
  return { ...base, primary, fallback, official, configError: null };
}

function stripUndefined(env: FxProviderEnv): Partial<Record<keyof FxProviderEnv, string>> {
  const out: Partial<Record<keyof FxProviderEnv, string>> = {};
  for (const k of Object.keys(DEFAULT_FX_PROVIDER_ENV) as (keyof FxProviderEnv)[]) {
    const v = env[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/** Providers habilitados en algún rol (únicos), en orden principal → respaldo → oficial. */
export function enabledProviders(s: FxProviderSettings): FxRateProvider[] {
  return [...new Set([s.primary, s.fallback, s.official].filter((p): p is FxRateProvider => p !== null))];
}

/** Política de valoración derivada de la configuración (roles y obsolescencia por tipo). */
export function valuationPolicyOf(s: FxProviderSettings): ValuationPolicy {
  return {
    roles: {
      PARALLEL: { primary: s.primary, fallback: s.fallback },
      OFFICIAL: { primary: s.official, fallback: null },
    },
    staleAfterMs: { PARALLEL: s.staleAfterParallelMs, OFFICIAL: s.staleAfterOfficialMs },
  };
}

/** Configuración por defecto (design.md decisión 5). */
export const DEFAULT_FX_PROVIDER_SETTINGS: FxProviderSettings = parseFxProviderSettings();
