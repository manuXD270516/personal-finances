import { defineConfig, devices } from '@playwright/test';

// E2E en Chromium contra el stack Compose desechable `pfos-e2e` (modo B, Keycloak real). El global setup levanta
// el stack (imágenes de producción), aplica migraciones y la Minimal Seed, y lo baja al final (docs/16 §5).
//   pnpm test:e2e                       stack nuevo, una corrida
//   PF_E2E_KEEP_STACK=1 pnpm test:e2e   deja el stack arriba; luego PF_E2E_ENV_FILE=<ruta> reutiliza ese stack
export default defineConfig({
  testDir: 'specs',
  globalSetup: './src/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    locale: 'es-BO',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
