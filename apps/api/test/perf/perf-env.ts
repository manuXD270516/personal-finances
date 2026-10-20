import type { Dependencies } from '../support/global-setup.js';
import { baseEnv } from '../support/harness.js';

/**
 * Cuotas por minuto (lecturas, escrituras y operaciones costosas) de TODA instancia de la API que levanta un benchmark
 * (fix-nightly-pipeline, decisión 5). Quedan por encima del número de solicitudes de cualquier suite: el benchmark mide
 * latencia, no la política de cuotas (esa la cubren los tests de API, TC-PLATFORM-API-*). Son variables de test: no
 * cambian los valores por defecto del producto ni `config-reference.md`.
 */
export const PERF_RATE_LIMITS = {
  RATE_LIMIT_READS_PER_MIN: '1000000',
  RATE_LIMIT_WRITES_PER_MIN: '1000000',
  RATE_LIMIT_COSTLY_PER_MIN: '1000000',
} as const;

/**
 * Entorno de la API (y de los runtimes que reciben `apiConfig`) para los benchmarks `*.perf.ts`: `baseEnv` con las
 * cuotas relajadas. Todas las suites configuran la API a través de esta función (directamente, o con `PERF_RATE_LIMITS`
 * en `apiEnv` de `startHarness`); el test de política del pipeline rechaza una suite que no lo haga (TC-PLATFORM-PIPELINE-019).
 */
export function perfApiEnv(
  deps: Dependencies,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return baseEnv(deps, { ...PERF_RATE_LIMITS, ...overrides });
}
