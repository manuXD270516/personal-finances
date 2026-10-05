import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    // add-workspace-identity 4.1: cobertura del DOMINIO ≥ 90 %. Solo con `--coverage` (`pnpm test:coverage`, job
    // nightly `mutation`); el PR gate no la mide.
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/domain/index.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
