import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz, userCategories } from '../src/finance.js';
import { importSyntheticCsv } from '../src/import-fixture.js';

/**
 * Rendimiento percibido y legibilidad (openspec refine-perceived-performance, lote L7 de docs/78; capability
 * platform/web-interface; D500): transiciones en el mismo documento, consultas en pausa con la pestaña oculta, prioridad
 * baja de las consultas de fondo, explicaciones accesibles (`InfoTip`), legibilidad de títulos y ayudas, diseño con el
 * tamaño de texto del sistema y campos que crecen. Datos ficticios; un usuario nuevo por prueba. Chromium (el
 * subconjunto de WebKit no incluye este spec).
 */

const SHOT_PHONE = { width: 360, height: 800 } as const;
const SHOT_DESKTOP = { width: 1280, height: 800 } as const;

interface VtWindow {
  __pfVt?: { started: number; durations: number[] };
}

/** Cuenta y mide las transiciones: envuelve `document.startViewTransition` sin cambiar su comportamiento. */
async function installTransitionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as VtWindow;
    w.__pfVt = { started: 0, durations: [] };
    const original = document.startViewTransition?.bind(document);
    if (!original) return;
    document.startViewTransition = ((cb?: () => void) => {
      const t0 = performance.now();
      w.__pfVt!.started += 1;
      const transition = original(cb);
      void transition.finished.finally(() => w.__pfVt!.durations.push(Math.round(performance.now() - t0)));
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const transitionsStarted = (page: Page) =>
  page.evaluate(() => (window as unknown as VtWindow).__pfVt?.started ?? 0);

/** Simula una pestaña oculta o visible: `document.hidden`/`visibilityState` y el evento `visibilitychange`. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Dos gastos y un ingreso: el filtro «Gastos» deja dos de las tres filas. */
async function threeExpenses(page: Page, W: string, bank: string): Promise<void> {
  const [salary] = await userCategories(page, W, 'INCOME');
  await api(page, 'POST', `${W}/transactions`, {
    kind: 'INCOME',
    transactionDate: todayLaPaz(),
    accountId: bank,
    amount: bob('300.00'),
    description: 'Sueldo',
    splits: [{ amount: bob('300.00'), categoryId: salary!.id }],
  });
  for (const [description, amount] of [
    ['Supermercado Norte', '45.00'],
    ['Taxi', '12.50'],
  ] as const) {
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob(amount),
      description,
    });
  }
}

test.describe('Transiciones al cambiar de pestaña o de filtro (M-28)', () => {
  test('[TC-PLATFORM-PERCEIVED-001] el cambio de pestaña del detalle de un préstamo de 12000.00 BOB dura ≤ 300 ms y conserva el foco', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-tab');
    await installTransitionProbe(page);
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '20000.00');
    const loan = await api(page, 'POST', `${W}/loans`, {
      name: 'Préstamo de 12000',
      principal: { amount: '12000.00', currency: 'BOB' },
      annualRate: '0.115',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      termInstallments: 12,
      method: 'FRENCH',
      disbursementDate: '2026-10-15',
      firstDueDate: '2026-11-15',
      account: { create: { name: 'Préstamo 12000' } },
      disbursementAccountId: bank,
      paymentAccountId: bank,
    });
    await go(page, `/debts/${String(loan['id'])}`);
    const second = page.getByRole('tab').nth(1);
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await second.click();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => transitionsStarted(page)).toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as VtWindow).__pfVt!.durations.length))
      .toBe(1);
    const [duration] = await page.evaluate(() => (window as unknown as VtWindow).__pfVt!.durations);
    expect(duration).toBeLessThanOrEqual(300);
    await expect(second).toBeFocused();
    for (const size of [SHOT_PHONE, SHOT_DESKTOP]) {
      await page.setViewportSize(size);
      await page.screenshot({ path: testInfo.outputPath(`pestanas-${size.width}.png`) });
    }
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-002] con movimiento reducido el filtro «Gastos» cambia la lista sin transición', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-reducido');
    await installTransitionProbe(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500.00');
    await threeExpenses(page, W, bank);
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();
    await page.locator('select[name="kind"]').selectOption('EXPENSE');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    expect(await transitionsStarted(page)).toBe(0);
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-002] con movimiento permitido el mismo filtro sí usa una transición', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-permitido');
    await installTransitionProbe(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500.00');
    await threeExpenses(page, W, bank);
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row')).toHaveCount(3);
    await page.locator('select[name="kind"]').selectOption('EXPENSE');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    expect(await transitionsStarted(page)).toBeGreaterThanOrEqual(1);
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-003] sin soporte de transiciones el filtro «Gastos» muestra solo los gastos', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-sin-soporte');
    await page.addInitScript(() => {
      delete (Document.prototype as unknown as Record<string, unknown>)['startViewTransition'];
    });
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500.00');
    await threeExpenses(page, W, bank);
    await go(page, '/transacciones');
    expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('undefined');
    await expect(page.getByTestId('transaction-row')).toHaveCount(3);
    await page.locator('select[name="kind"]').selectOption('EXPENSE');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    for (const row of await page.getByTestId('transaction-row').all())
      await expect(row).toHaveAttribute('data-kind', 'EXPENSE');
    await context.close();
  });
});

test.describe('Consultas en pausa con la pestaña oculta (M-31)', () => {
  test('[TC-PLATFORM-PERCEIVED-006] [TC-PLATFORM-PERCEIVED-007] el import de 2 000 filas no consulta su estado 30 s con la pestaña oculta y al volver muestra el resultado', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(900_000);
    const { context, page, W } = await newFinanceUser(browser, 'perc-import');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500000.00');
    await importSyntheticCsv(page, bank, testInfo.outputPath('extracto-sintetico.csv'), 2000);
    const statusPolls: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === 'GET' && /\/imports\/[0-9a-f-]{36}$/.test(pathname))
        statusPolls.push(pathname);
    });
    await page.getByTestId('import-approve').click();
    await page.getByTestId('import-approve-confirm').waitFor();
    await page.getByTestId('import-approve-confirm').getByRole('button').last().click();
    // Una consulta puede estar en vuelo en el instante de ocultar: se deja asentar antes de contar.
    await setHidden(page, true);
    await page.waitForTimeout(1500);
    const before = statusPolls.length;
    await page.waitForTimeout(30_000);
    expect(statusPolls.length).toBe(before);

    // El import termina con la pestaña oculta (se espera por la API, no por la página).
    await expect
      .poll(
        async () => {
          const list = (await api(page, 'GET', `${W}/imports?accountId=${bank}&limit=1`))['data'] as {
            status: string;
          }[];
          return list[0]?.status;
        },
        { timeout: 600_000, intervals: [5000] },
      )
      .toBe('COMPLETED');
    expect(statusPolls.length).toBe(before);

    // Al volver a ser visible consulta enseguida y muestra el import terminado con sus 2 000 filas.
    await setHidden(page, false);
    await expect.poll(() => statusPolls.length, { timeout: 3000 }).toBeGreaterThan(before);
    await expect(page.getByTestId('import-result')).toBeVisible();
    await expect(page.getByTestId('result-rows')).toHaveText('2000');
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-008] Pronósticos en segundo plano no consulta la corrida hasta que el OWNER la mira', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'perc-pronostico');
    const runPolls: string[] = [];
    // La corrida se simula en el borde (la prueba mide el sondeo de la página, no el servicio de pronósticos).
    await page.route(/\/api\/bff\/v1\/workspaces\/[^/]+\/forecasts(\/[0-9a-f-]{36})?$/, async (route) => {
      const request = route.request();
      if (request.method() === 'POST')
        return route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }),
        });
      if (/\/forecasts\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname)) {
        runPolls.push(request.url());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'RUNNING' }),
        });
      }
      return route.continue();
    });
    await go(page, '/pronosticos');
    await expect(page.getByTestId('forecast-none')).toBeVisible();
    await setHidden(page, true);
    await page.getByTestId('forecast-run').first().click();
    await expect(page.getByTestId('forecast-run-pending')).toBeVisible();
    await page.waitForTimeout(8000); // más de tres intervalos de 2,5 s
    expect(runPolls).toHaveLength(0);
    await setHidden(page, false);
    await expect.poll(() => runPolls.length, { timeout: 3000 }).toBeGreaterThanOrEqual(1);
    await context.close();
  });
});

test.describe('Consultas de fondo con prioridad baja (M-31)', () => {
  async function priorities(page: Page, urlPart: string): Promise<string[]> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const seen: string[] = [];
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.request.url.includes(urlPart)) seen.push(String(event.request.initialPriority));
    });
    return seen;
  }

  test('[TC-PLATFORM-PERCEIVED-009] el contador de notificaciones sin leer sale con prioridad baja', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'perc-prio-bell');
    const seen = await priorities(page, '/notifications/unread-count');
    await go(page, '/');
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p === 'Low')).toBe(true);
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-010] la búsqueda «supermercado» en Transacciones no sale con prioridad baja', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-prio-busqueda');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500.00');
    await threeExpenses(page, W, bank);
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();
    const seen = await priorities(page, 'q=supermercado');
    await page.getByLabel('Buscar', { exact: true }).first().fill('supermercado');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p !== 'Low')).toBe(true);
    await context.close();
  });
});

test.describe('Explicaciones accesibles sin depender del puntero (M-09)', () => {
  test('[TC-PLATFORM-PERCEIVED-011] la explicación de una conciliada sin extracto se abre con Enter y Escape devuelve el foco al botón', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-infotip');
    const cash = await openAccount(page, W, 'Caja BOB', 'CASH', 'BOB', '500.00');
    const spend = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'CLEARED',
      transactionDate: todayLaPaz(),
      accountId: cash,
      amount: bob('80.00'),
      description: 'Compra en efectivo',
    });
    await go(page, `/transacciones/${String(spend['id'])}`);
    await page.getByTestId('reconcile-without-statement').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sí, marcar como conciliada' }).click();
    await expect(page.getByTestId('tx-without-statement').first()).toBeVisible();
    await go(page, `/transacciones?cuenta=${cash}&sinExtracto=1`);
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);

    const info = page.getByRole('button', { name: /Más información sobre/ });
    const explanation = page.getByText(
      'queda pendiente de revisión hasta que una conciliación posterior la coteje',
    );
    await expect(explanation).toBeHidden();
    // Llega con Tab (desde el inicio de la página) y abre con Enter.
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press('Tab');
      if (await info.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(info).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(explanation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explanation).toBeHidden();
    await expect(info).toBeFocused();
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-012] a 360 px el toque en el botón de información de una tasa de cambio abre la explicación', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-tasa');
    await page.setViewportSize(SHOT_PHONE);
    const usd = await openAccount(page, W, 'Caja USD', 'CASH', 'USD', '1000.00');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await api(page, 'POST', `${W}/conversions`, {
      transactionDate: todayLaPaz(),
      sourceAccountId: usd,
      targetAccountId: bank,
      sourceAmount: { amount: '100.00', currency: 'USD' },
      targetAmount: { amount: '690.00', currency: 'BOB' },
      quotedRate: { base: 'USD', quote: 'BOB', value: '6.90' },
      executedAt: new Date(Date.now() - 600_000).toISOString(),
    });
    await go(page, '/fx');
    const observation = page.getByTestId('rate-observation').first();
    await expect(observation).toBeVisible();
    const info = page.getByRole('button', { name: /Más información sobre «Conversión»/ }).first();
    const explanation = page.getByText('Observación de una conversión propia', { exact: false }).first();
    await expect(explanation).toBeHidden();
    await info.click();
    await expect(explanation).toBeVisible();
    const box = (await info.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await page.screenshot({ path: testInfo.outputPath('tasa-360.png') });
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-014] la tabla alternativa del reporte de gastos muestra el valor exacto del mes (1.234,56 BOB)', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-reporte');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '5000.00');
    const [food] = await (async () => {
      const r = await api(page, 'GET', `${W}/categories?kind=EXPENSE&limit=200`);
      return (r['data'] as { id: string; systemCode: string | null; parentId: string | null }[]).filter(
        (c) => c.systemCode === null && !c.parentId,
      );
    })();
    const today = todayLaPaz();
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('1234.56'),
      splits: [{ amount: bob('1234.56'), categoryId: food!.id }],
    });
    await go(
      page,
      `/reportes/ingresos-gastos?from=${today.slice(0, 8)}01&to=${today}&grouping=CALENDAR_MONTH`,
    );
    const view = page.getByTestId('report-income-expenses');
    await expect(view.getByTestId('report-chart')).toBeVisible();
    // Valor exacto del punto en la tabla alternativa, con el formato de montos de los reportes.
    await expect(view.getByTestId('ie-row').first()).toContainText('1.234,56 BOB');
    await context.close();
  });
});

test.describe('Legibilidad y tamaño de texto (M-23, M-24)', () => {
  test('[TC-PLATFORM-PERCEIVED-016] a 360 px los títulos declaran el reparto equilibrado de líneas', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'perc-titulo');
    await page.setViewportSize(SHOT_PHONE);
    await go(page, '/reportes/gastos-por-categoria');
    const wrap = await page
      .locator('h1')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el) as CSSStyleDeclaration & { textWrapStyle?: string };
        return style.textWrapStyle ?? style.getPropertyValue('text-wrap');
      });
    expect(wrap).toContain('balance');
    await page.screenshot({ path: testInfo.outputPath('titulo-360.png') });
    await page.setViewportSize(SHOT_DESKTOP);
    await page.screenshot({ path: testInfo.outputPath('titulo-1280.png') });
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-017] a 1280 px ningún texto de ayuda de Mis preferencias pasa de 70ch', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'perc-ayuda');
    await page.setViewportSize(SHOT_DESKTOP);
    await go(page, '/preferencias');
    const helps = page.locator('.pf-help');
    await expect(helps.first()).toBeVisible();
    const widths = await helps.evaluateAll((nodes) =>
      nodes.map((el) => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:70ch';
        el.appendChild(probe);
        const limit = probe.getBoundingClientRect().width;
        probe.remove();
        return { width: el.getBoundingClientRect().width, limit };
      }),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w.width).toBeLessThanOrEqual(w.limit + 0.5);
    await context.close();
  });

  test('[TC-PLATFORM-PERCEIVED-018] [TC-PLATFORM-PERCEIVED-019] con el texto al 200 % Transacciones usa el diseño angosto sin desplazamiento horizontal y el monto no se parte', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-texto');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('12345.67'),
      description: 'Gasto grande',
    });
    await page.setViewportSize(SHOT_DESKTOP);
    // Tamaño de fuente estándar del navegador en 32 px (el doble de 16): imita el ajuste de texto sin inyectar estilos (CSP).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    // Diseño angosto: el botón del menú lateral (solo visible bajo 48em) aparece aunque la ventana mida 1280 px.
    await expect(page.locator('.pf-nav-toggle')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // El monto queda en una sola línea (todos los rectángulos del texto comparten la misma altura de línea).
    const lines = await page
      .getByTestId('transaction-row')
      .filter({ hasText: 'Gasto grande' })
      .evaluate((row) => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (/12\.345,67/.test(node.textContent ?? '')) {
            const range = document.createRange();
            range.selectNodeContents(node);
            return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
          }
        }
        return -1;
      });
    expect(lines).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('texto-200.png') });
    await context.close();
  });
});

test.describe('Campos de texto que crecen con su contenido (M-05)', () => {
  test('[TC-PLATFORM-PERCEIVED-020] un motivo de anulación de seis líneas crece sin desplazamiento interno y respeta el tope', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'perc-motivo');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500.00');
    const spend = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('80.00'),
      description: 'Compra a anular',
    });
    await go(page, `/transacciones/${String(spend['id'])}`);
    await page.getByRole('button', { name: 'Anular' }).click();
    const dialog = page.getByRole('alertdialog');
    const reason = dialog.getByLabel('Motivo');
    const heightOf = () => reason.evaluate((el) => el.getBoundingClientRect().height);
    const empty = await heightOf();
    await reason.fill(['línea 1', 'línea 2', 'línea 3', 'línea 4', 'línea 5', 'línea 6'].join('\n'));
    const grown = await heightOf();
    expect(grown).toBeGreaterThan(empty);
    // Sin desplazamiento interno con seis líneas y bajo el tope de 12 líneas.
    expect(await reason.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const lineHeight = await reason.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(grown).toBeLessThanOrEqual(lineHeight * 12 + 40);
    // Pasadas las 12 líneas el campo deja de crecer y se desplaza por dentro.
    await reason.fill(Array.from({ length: 30 }, (_, i) => `línea ${i + 1}`).join('\n'));
    const capped = await heightOf();
    expect(capped).toBeLessThanOrEqual(lineHeight * 12 + 40);
    expect(await reason.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('motivo.png') });
    await context.close();
  });
});
