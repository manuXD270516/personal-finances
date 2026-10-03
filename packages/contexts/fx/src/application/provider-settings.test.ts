import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FX_PROVIDER_SETTINGS,
  enabledProviders,
  parseFxProviderSettings,
  pollCronFor,
  valuationPolicyOf,
} from './provider-settings.js';

describe('Configuración FX_* de providers (design.md decisión 5)', () => {
  it('[TC-FX-PROVIDER-005] defaults: paralelo.bo principal, bo.dolarapi.com respaldo y oficial, cada 15 min', () => {
    const s = DEFAULT_FX_PROVIDER_SETTINGS;
    expect([s.primary, s.fallback, s.official, s.pollCron, s.configError]).toEqual([
      'PARALELO_BO',
      'DOLARAPI_BO',
      'DOLARAPI_BO',
      '*/15 * * * *',
      null,
    ]);
    expect([s.staleAfterParallelMs, s.staleAfterOfficialMs, s.anomalyThresholdPct, s.timeoutMs]).toEqual([
      3_600_000,
      172_800_000,
      '5',
      10_000,
    ]);
    expect(enabledProviders(s)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);
    expect(valuationPolicyOf(s).roles.PARALLEL).toEqual({ primary: 'PARALELO_BO', fallback: 'DOLARAPI_BO' });
  });

  it('[TC-FX-PROVIDER-005] FX_POLL_INTERVAL=30m registra el cron */30 * * * *', () => {
    expect(parseFxProviderSettings({ FX_POLL_INTERVAL: '30m' }).pollCron).toBe('*/30 * * * *');
    expect(pollCronFor(60_000)).toBe('* * * * *');
    expect(pollCronFor(3_600_000)).toBe('0 * * * *');
    expect(pollCronFor(6 * 3_600_000)).toBe('0 */6 * * *');
    expect(pollCronFor(45 * 60_000)).toBeNull();
  });

  it('[TC-FX-PROVIDER-011] FX_POLL_INTERVAL=30s: los providers no se inician y se informa FX_PROVIDER_CONFIG_INVALID', () => {
    const s = parseFxProviderSettings({ FX_POLL_INTERVAL: '30s' });
    expect(s.configError).toMatch(/at least 60 seconds/);
    expect(enabledProviders(s)).toEqual([]);
    expect(parseFxProviderSettings({ FX_POLL_INTERVAL: '60s' }).configError).toBeNull();
  });

  it('[TC-FX-PROVIDER-014] none en todos los roles deshabilita los providers sin error de configuración', () => {
    const s = parseFxProviderSettings({
      FX_PROVIDER_PRIMARY: 'none',
      FX_PROVIDER_FALLBACK: 'none',
      FX_PROVIDER_OFFICIAL: 'none',
    });
    expect([enabledProviders(s), s.configError]).toEqual([[], null]);
  });

  it('valores inválidos: respaldo igual al principal, timeout > 30 s, umbral ≤ 0, provider desconocido', () => {
    for (const env of [
      { FX_PROVIDER_FALLBACK: 'paralelo_bo' },
      { FX_PROVIDER_TIMEOUT: '31s' },
      { FX_ANOMALY_THRESHOLD_PCT: '0' },
      { FX_PROVIDER_PRIMARY: 'binance' },
      { FX_PROVIDER_OFFICIAL: 'paralelo_bo' },
      { FX_STALE_AFTER_PARALLEL: 'una hora' },
      { FX_STALE_AFTER_FALLBACK: '3 horas' },
      { FX_MANUAL_FALLBACK_MAX_AGE: 'un día' },
      { FX_BACKFILL_ENABLED: 'yes' },
    ]) {
      expect(parseFxProviderSettings(env).configError, JSON.stringify(env)).not.toBeNull();
    }
    expect(parseFxProviderSettings({ FX_ANOMALY_THRESHOLD_PCT: '2.50' }).anomalyThresholdPct).toBe('2.5');
  });

  it('[TC-FX-PROVIDER-017] FX_STALE_AFTER_FALLBACK (por defecto 180m) es el umbral propio del respaldo de PARALLEL', () => {
    expect(DEFAULT_FX_PROVIDER_SETTINGS.staleAfterFallbackMs).toBe(10_800_000);
    expect(valuationPolicyOf(DEFAULT_FX_PROVIDER_SETTINGS).fallbackStaleAfterMs).toEqual({
      PARALLEL: 10_800_000,
    });
    const s = parseFxProviderSettings({ FX_STALE_AFTER_FALLBACK: '4h' });
    expect([s.staleAfterFallbackMs, s.configError]).toEqual([14_400_000, null]);
    // Sin respaldo configurado no hay umbral propio que aplicar.
    const none = parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none' });
    expect(valuationPolicyOf(none).roles.PARALLEL).toEqual({ primary: 'PARALELO_BO', fallback: null });
  });

  it('[TC-FX-PROVIDER-018] FX_MANUAL_FALLBACK_MAX_AGE (por defecto 24h) y desvío máximo = FX_ANOMALY_THRESHOLD_PCT', () => {
    const p = valuationPolicyOf(DEFAULT_FX_PROVIDER_SETTINGS);
    expect([p.manualFallbackMaxAgeMs, p.manualFallbackMaxDeviationPct]).toEqual([86_400_000, '5']);
    const s = parseFxProviderSettings({ FX_MANUAL_FALLBACK_MAX_AGE: '6h', FX_ANOMALY_THRESHOLD_PCT: '3' });
    expect([s.configError, valuationPolicyOf(s).manualFallbackMaxAgeMs]).toEqual([null, 21_600_000]);
    expect(valuationPolicyOf(s).manualFallbackMaxDeviationPct).toBe('3');
  });
});
