import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { defineConfig } from 'vitest/config';
import { orderPerfSuites } from './test/perf/suite-order.js';

// Benchmarks nightly (docs/23 §5.5): PostgreSQL 18 real por Testcontainers (mismo global-setup que integración) + Large
// Seed + API en proceso. No corre en `pnpm test` ni en `pnpm test:integration`: `pnpm perf:bench` (job nightly `perf`).
//
// Orden determinista de los archivos (investigate-perf-under-load 5.2): el de Vitest por defecto depende de la caché de
// duraciones y fallos; `PERF_SUITE_ORDER` (test/perf/suite-order.ts) lo fija y documenta la razón.
class PerfSuiteSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return orderPerfSuites(files, (f) => f.moduleId);
  }
}

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['test/perf/**/*.perf.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 4 * 3_600_000,
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: PerfSuiteSequencer },
  },
});
