import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    // NFR-MAINT-002 (add-ledger-core 2.5): solo con `--coverage` (`pnpm test:coverage`, job nightly `mutation`).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 95, branches: 90 },
    },
  },
});
