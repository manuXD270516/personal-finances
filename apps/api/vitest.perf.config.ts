import { defineConfig } from 'vitest/config';

// Benchmarks nightly (docs/23 §5.5): PostgreSQL 18 real por Testcontainers (mismo global-setup que integración) + Large
// Seed + API en proceso. No corre en `pnpm test` ni en `pnpm test:integration`: `pnpm perf:bench` (job nightly `perf`).
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['test/perf/**/*.perf.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 4 * 3_600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
