import { defineConfig } from 'vitest/config';

// Integración con dependencias reales (Testcontainers: postgres:18 + SeaweedFS). Requiere Docker.
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['test/api/**/*.api.test.ts', 'test/**/*.int.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
