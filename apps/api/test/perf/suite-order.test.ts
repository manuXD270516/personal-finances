import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { orderPerfSuites, PERF_SUITE_ORDER } from './suite-order.js';

describe('orden determinista de las suites de perf (investigate-perf-under-load 5.2)', () => {
  it('[TC-PLATFORM-PIPELINE-024] PERF_SUITE_ORDER lista exactamente los archivos *.perf.ts, sin repetidos', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.perf.ts'));
    expect([...PERF_SUITE_ORDER].sort()).toEqual([...files].sort());
    expect(new Set(PERF_SUITE_ORDER).size).toBe(PERF_SUITE_ORDER.length);
  });

  it('[TC-PLATFORM-PIPELINE-025] nightly va primero, las suites de latencia después, y commitments, throughput e imports al final', () => {
    const idx = (n: string) => PERF_SUITE_ORDER.indexOf(`${n}.perf.ts`);
    expect(idx('nightly')).toBe(0);
    const latency = [
      'spendable',
      'goals',
      'budget-suggestions',
      'rules',
      'loan-simulator',
      'upcoming-payments',
      'subscriptions',
      'forecast',
    ];
    for (const s of latency) expect(idx(s)).toBeLessThan(idx('commitments'));
    expect(idx('commitments')).toBeLessThan(idx('throughput'));
    expect(idx('throughput')).toBeLessThan(idx('imports'));
    expect(idx('imports')).toBe(PERF_SUITE_ORDER.length - 1);
  });

  it('[TC-PLATFORM-PIPELINE-024] el orden no depende del orden de entrada (la caché de duraciones de Vitest no lo altera)', () => {
    const paths = PERF_SUITE_ORDER.map((n) => `/repo/apps/api/test/perf/${n}`);
    const shuffled = [
      paths[5]!,
      paths[0]!,
      paths[9]!,
      paths[2]!,
      paths[7]!,
      paths[1]!,
      paths[6]!,
      paths[3]!,
      paths[8]!,
      paths[4]!,
      paths[10]!,
      paths[11]!,
      paths[12]!,
    ];
    expect(orderPerfSuites(shuffled, (p) => p)).toEqual(paths);
    expect(orderPerfSuites([...paths].reverse(), (p) => p)).toEqual(paths);
  });

  it('[TC-PLATFORM-PIPELINE-024] un archivo que no figura en la lista va al final por nombre, nunca se descarta', () => {
    const out = orderPerfSuites(
      ['/x/zeta.perf.ts', '/x/imports.perf.ts', '/x/alfa.perf.ts', '/x/nightly.perf.ts'],
      (p) => p,
    );
    expect(out).toEqual(['/x/nightly.perf.ts', '/x/imports.perf.ts', '/x/alfa.perf.ts', '/x/zeta.perf.ts']);
  });

  it('[TC-FORECAST-SERVICE-028] forecast.perf.ts mide la corrida con el servicio real, con el umbral de 300 s de NFR-PERF-012 y dentro de la lista de suites', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const suite = readFileSync(`${dir}forecast.perf.ts`, 'utf8');
    expect(PERF_SUITE_ORDER).toContain('forecast.perf.ts');
    expect(suite).toMatch(/const BUDGET_MS = 300_000;/u);
    expect(suite).toContain('[TC-FORECAST-SERVICE-028]');
    // Servicio REAL (imagen finance-ml por Testcontainers o un servicio indicado por el entorno), nunca un doble.
    expect(suite).toMatch(/GenericContainer\(ML_IMAGE\)/u);
    expect(suite).toContain('FORECAST_PERF_SERVICE_URL');
    expect(suite).toMatch(/runForecastRunner\(forecasting,/u);
    expect(suite).toMatch(/expect\(elapsed\)\.toBeLessThanOrEqual\(BUDGET_MS\)/u);
  });
});
