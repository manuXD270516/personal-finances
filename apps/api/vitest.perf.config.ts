import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { defineConfig } from 'vitest/config';
import { orderSuites, parseExperiment } from './test/perf/experiment-env.js';

// Benchmarks nightly (docs/23 §5.5): PostgreSQL 18 real por Testcontainers (mismo global-setup que integración) + Large
// Seed + API en proceso. No corre en `pnpm test` ni en `pnpm test:integration`: `pnpm perf:bench` (job nightly `perf`).
//
// Rama de experimentos de investigate-perf-under-load (no se fusiona): `PF_PERF_SUITES` (lista de archivos `*.perf.ts`,
// separados por coma) corre solo esas suites y EN ESE ORDEN (E2/E3 necesitan `nightly` antes que `spendable`).
const experiment = parseExperiment(process.env);

class ListedOrderSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return experiment.suites.length === 0
      ? super.sort(files)
      : orderSuites(files, experiment.suites, (f) => f.moduleId);
  }
}

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include:
      experiment.suites.length > 0
        ? experiment.suites.map((s) => `test/perf/${s}`)
        : ['test/perf/**/*.perf.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 4 * 3_600_000,
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: ListedOrderSequencer },
  },
});
