import { defineConfig, devices } from '@playwright/test';

// E2E en Chromium (y un subconjunto en WebKit) por https contra el stack Compose desechable `pfos-e2e` (modo B, Keycloak real). El global setup levanta
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
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    // Insumo del resumen de duración por proyecto del job e2e (src/duration-summary.ts, TC-PLATFORM-PIPELINE-044).
    ['json', { outputFile: 'playwright-results.json' }],
  ],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    // El stack de E2E va por https con una autoridad interna efímera (perfil `tls`, change add-e2e-https, D516):
    // el navegador no puede confiar en ella sin tocar el sistema (WebKit en Linux), así que se ignora el error de
    // certificado. Es configuración del cliente de pruebas; la cookie de sesión y la aplicación no cambian.
    ignoreHTTPSErrors: true,
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
      testIgnore: [/notifications\.spec\.ts$/, /(inp|navigation)\.spec\.ts$/],
      dependencies: ['alerts'],
      use: { browserName: 'chromium' },
    },
    // WebKit (D509, D516, TC-PLATFORM-WEBUI-019/020): subconjunto de la suite sobre el mismo stack https y después de
    // `chromium` (un solo stack, workers: 1). Sin dependencia de `alerts`: no espera la cadena de notificaciones.
    {
      name: 'webkit',
      testMatch: /(app-shell|a11y|transactions|auth|content-security-policy)\.spec\.ts$/,
      dependencies: ['chromium'],
      // Corre sobre el stack ya cargado por toda la suite de Chromium (colas con miles de trabajos pendientes, ver `alerts`)
      // y con un motor más lento por pantalla: cinco minutos por test (en Windows, sobre el stack cargado, el test largo de `transactions` pasó de 180 s; en Linux CI WebKit completo tarda 3,4 min).
      timeout: 300_000,
      use: { ...devices['Desktop Safari'], browserName: 'webkit' },
    },
    // Medición informativa de INP y de la navegación entre secciones (adopt-client-navigation) con un extracto sintético de 2 000 filas (refine-data-tables): proyecto propio, solo
    // Chromium (Event Timing no es fiable en otros motores en CI) y al final, para poder excluirlo del job de PR si
    // alarga el job `e2e` (límite de 40 min). Local: `playwright test --project=inp --no-deps`.
    {
      name: 'inp',
      testMatch: /(inp|navigation)\.spec\.ts$/,
      dependencies: ['chromium'],
      use: { browserName: 'chromium' },
    },
  ],
});
