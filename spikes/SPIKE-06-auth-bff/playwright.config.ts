import { defineConfig } from '@playwright/test';

process.loadEnvFile('.env');

// Requiere `pnpm deps:up` (Keycloak + Valkey) y `pnpm web:build` previos.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'evidence/playwright-results.json' }]],
  use: { headless: true, baseURL: 'http://localhost:61600', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node --env-file=.env --import tsx api/src/main.ts',
      url: 'http://127.0.0.1:61680/health',
      reuseExistingServer: true,
      stdout: 'pipe',
      timeout: 60_000,
    },
    {
      command: 'node scripts/with-env.mjs next start web -p 61600',
      url: 'http://localhost:61600/',
      reuseExistingServer: true,
      stdout: 'pipe',
      timeout: 60_000,
    },
  ],
});
