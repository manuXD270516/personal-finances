import { defineConfig } from 'vitest/config';

// Integración contra PostgreSQL real (Testcontainers postgres:18): reutiliza el global setup de apps/api, que
// levanta la base y ejecuta el comando `migrate` real (dbmate + roles). Requiere Docker.
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['../../../apps/api/test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
