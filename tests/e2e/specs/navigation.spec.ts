import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, bob, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import {
  applyPhoneProfile,
  armNavigation,
  clearPhoneProfile,
  installNavigationProbe,
  MEDIAN_RUNS,
  navigationReport,
  readNavigation,
  type NavProfile,
  type NavSample,
} from '../src/navigation-timing.js';

/**
 * Medición INFORMATIVA de la navegación entre secciones (change adopt-client-navigation, etapa 1;
 * TC-PLATFORM-CLIENTNAV-001 y -002) contra los 2.5 s de NFR-PERF-004: del clic al contenido propio de la sección de
 * destino y a su mayor pintura de contenido (LCP), en escritorio y en un teléfono modesto («Fast 4G» y CPU ×4 por CDP),
 * como mediana de 3 corridas. Datos ficticios. Adjunta el informe y lo imprime; NO falla por el valor medido.
 * Solo Chromium (LCP y CDP no son fiables en otros motores). Local: `playwright test --project=inp --no-deps`.
 * `PF_NAV_RUNS` cambia el número de corridas por destino (por omisión 3).
 */
const RUNS = Number(process.env['PF_NAV_RUNS'] ?? MEDIAN_RUNS);

interface Destination {
  readonly name: string;
  /** Página de la que sale el clic. */
  readonly from: string;
  /** Selector que indica que la página de origen ya está lista para hacer clic. */
  readonly ready: string;
  /** Enlace que se pulsa. */
  readonly link: (page: Page) => ReturnType<Page['locator']>;
  /** Contenido propio de la sección de destino (no `ready`, que es del marco). */
  readonly content: string;
}

const primaryNav = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal' });

const DESTINATIONS: readonly Destination[] = [
  {
    name: 'Inicio → Transacciones',
    from: '/',
    ready: '[data-testid="dashboard"]',
    link: (page) => primaryNav(page).getByRole('link', { name: 'Transacciones', exact: true }),
    content: '[data-testid="transaction-row"]',
  },
  {
    name: 'Inicio → Presupuestos',
    from: '/',
    ready: '[data-testid="dashboard"]',
    link: (page) => page.locator('a[href$="/planificacion/presupuestos"]').first(),
    content: '#budgets-title',
  },
  {
    name: 'Inicio → Reportes',
    from: '/',
    ready: '[data-testid="dashboard"]',
    link: (page) => primaryNav(page).getByRole('link', { name: 'Reportes', exact: true }),
    content: '[data-testid="reports-catalog"]',
  },
  {
    name: 'Lista → detalle de gasto',
    from: '/transacciones',
    ready: '[data-testid="transaction-row"]',
    link: (page) => page.locator('[data-testid="transaction-row"] a[href*="/transacciones/"]').first(),
    content: '[data-testid="transaction-detail"]',
  },
];

/** Un usuario nuevo con una cuenta y un gasto de 45.00 BOB; mide cada destino RUNS veces en el perfil dado. */
async function measureProfile(browser: Browser, profile: NavProfile): Promise<NavSample[]> {
  const { context, page, W } = await newFinanceUser(browser, `nav-${profile}`);
  await installNavigationProbe(page);
  const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '5000.00');
  await api(page, 'POST', `${W}/transactions`, {
    kind: 'EXPENSE',
    transactionDate: todayLaPaz(),
    accountId: bank,
    amount: bob('45.00'),
    description: 'Supermercado Norte',
  });
  const cdp = profile === 'phone' ? await applyPhoneProfile(page) : undefined;
  const samples: NavSample[] = [];
  try {
    for (const destination of DESTINATIONS) {
      // Una pasada de calentamiento (no se cuenta) deja las cachés de HTTP en el estado de quien ya navegó la app.
      for (let run = 0; run <= RUNS; run += 1) {
        await page.goto(destination.from);
        await page.locator(destination.ready).first().waitFor({ timeout: 120_000 });
        await armNavigation(page, destination.content);
        await destination.link(page).click();
        await page.locator(destination.content).first().waitFor({ timeout: 120_000 });
        const reading = await readNavigation(page);
        if (run > 0) samples.push({ destination: destination.name, profile, ...reading });
      }
    }
  } finally {
    if (cdp) await clearPhoneProfile(cdp);
    await context.close();
  }
  return samples;
}

test('[TC-PLATFORM-CLIENTNAV-001] [TC-PLATFORM-CLIENTNAV-002] navegación de Inicio a Transacciones, Presupuestos, Reportes y el detalle de un gasto de 45.00 BOB, en escritorio y en teléfono modesto', async ({
  browser,
}, testInfo) => {
  test.setTimeout(Number(process.env['PF_NAV_TIMEOUT'] ?? 1_800_000));
  const desktop = await measureProfile(browser, 'desktop');
  const phone = await measureProfile(browser, 'phone');
  const report = navigationReport([...desktop, ...phone]);
  console.log(report.text);
  console.log(`[nav] samples ${JSON.stringify([...desktop, ...phone])}`);
  console.log(
    report.exceeded.length > 0
      ? `[nav] teléfono modesto por encima de 2.5 s en: ${report.exceeded.join(', ')}`
      : '[nav] teléfono modesto dentro de 2.5 s en todos los destinos',
  );
  await testInfo.attach('navegacion', {
    body: JSON.stringify({ rows: report.rows, samples: [...desktop, ...phone] }, null, 2),
    contentType: 'application/json',
  });
  // Informativo: solo se comprueba que el informe tiene los destinos y perfiles (nunca el valor medido).
  expect(report.rows).toHaveLength(DESTINATIONS.length * 2);
});
