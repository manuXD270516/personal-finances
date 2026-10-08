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
  // `alerts` corre PRIMERO y sobre el stack recién sembrado: su cadena asíncrona (transacción → umbral → NOTIFY → SMTP)
  // atraviesa colas de eventos que consumen ~2 trabajos/s por cola (concurrencia 1, polling 0,5 s). Las demás specs
  // dejan miles de trabajos pendientes en esas colas (un test de la suite generaba >1 000 en minutos) y, detrás de ese
  // atraso, el hecho del test llegaba tras el timeout de 90 s (add-alerts, CI run 37826960722).
  projects: [
    { name: 'alerts', testMatch: /notifications\.spec\.ts$/, use: { browserName: 'chromium' } },
    {
      name: 'chromium',
      testIgnore: /notifications\.spec\.ts$/,
      dependencies: ['alerts'],
      use: { browserName: 'chromium' },
    },
  ],
});
