import { defineConfig } from 'vitest/config';

// Integración del BFF contra PostgreSQL real (`iam.bff_session` con el rol `pf_bff`): reutiliza el global setup de
// apps/api, que levanta postgres:18 con Testcontainers y ejecuta el comando `migrate` real. Requiere Docker.
export default defineConfig({
  resolve: { conditions: ['@pf/source'] },
  ssr: { resolve: { conditions: ['@pf/source'] } },
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['../api/test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
