import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Cimientos de accesibilidad de la interfaz (openspec refine-web-accessibility-foundations, capability
 * platform/web-interface; docs/78 y docs/79 D500–D512): foco al primer error y resumen de errores, validación de montos
 * al salir del campo, confirmaciones modales con `<dialog>`, confirmaciones en línea que devuelven el foco, movimiento
 * reducido, colores forzados y pestañas en una sola fila. Datos ficticios; un usuario nuevo por prueba.
 */

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

/** Solicitudes de escritura hacia la API que salen de la página (para comprobar que NO se envió nada). */
function recordWrites(page: Page, pathPart: string): string[] {
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(pathPart)) sent.push(r.url());
  });
  return sent;
}

test.describe('Foco al primer error y resumen de errores (platform/web-interface)', () => {
  test('[TC-PLATFORM-WEBUI-001] un gasto enviado sin monto ni cuenta deja el foco en el primer campo inválido', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'webui-gasto');
    await go(page, '/transacciones/nueva');
    const sent = recordWrites(page, '/transactions');
    const form = page.getByTestId('transaction-form');
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();

    const account = form.locator('select[name="accountId"]');
    const amount = form.locator('input[name="amount"]');
    await expect(account).toBeFocused();
    for (const field of [account, amount]) {
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      const describedBy = (await field.getAttribute('aria-describedby'))!;
      const message = page.locator(`[id="${describedBy.split(' ')[0]}"]`);
      await expect(message).toBeVisible();
      // El mensaje no es región viva (se anuncia al enfocar el campo, no dos veces).
      expect(
        await message.evaluate((el) => el.closest('[aria-live], [role="alert"], [role="status"]') === null),
      ).toBe(true);
    }
    expect(sent).toEqual([]);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-002] una transferencia con la misma cuenta enfoca el destino y no se envía', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-transf');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await go(page, `/transferencias/nueva?origen=${bank}&destino=${bank}`);
    const sent = recordWrites(page, '/transfers');
    const form = page.getByTestId('transfer-form');
    // Las cuentas se cargan después del primer render: se espera a que el origen quede elegido.
    await expect(form.locator('select[name="fromAccountId"]')).toHaveValue(bank);
    await form.locator('input[name="amount"]').fill('100.00');
    await form.locator('button[type="submit"]').click();

    const target = form.locator('select[name="toAccountId"]');
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByTestId('field-error').filter({ hasText: 'distintos' })).toBeVisible();
    expect(sent).toEqual([]);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-003] [TC-PLATFORM-WEBUI-004] el alta de préstamo con tres errores muestra el resumen con el foco y sus enlaces llevan al campo', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-prestamo');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    await go(page, '/debts/nuevo');
    await page.getByTestId('loan-name').fill('Vehículo');
    await page.getByTestId('loan-term').fill('24');
    await page.getByTestId('loan-disbursement-date').fill('2026-10-15');
    await page.getByTestId('loan-new-account-name').fill('Préstamo vehicular');
    await page.getByTestId('loan-disbursement-account').selectOption(bank);
    await page.getByTestId('loan-payment-account').selectOption(bank);
    await page.getByTestId('loan-submit').click();

    const summary = page.getByTestId('loan-form-error-summary');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('heading')).toHaveText('Hay 3 errores');
    await expect(summary.getByRole('link')).toHaveCount(3);
    // Está al inicio del formulario (antes del primer campo).
    expect(
      await summary.evaluate((el) => {
        const first = el.closest('form')!.querySelector('input, select, textarea')!;
        return Boolean(el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    expect(await seriousViolations(page)).toEqual([]);

    // TC-004: activar con Enter el enlace "Tasa" lleva el foco al campo, que muestra su mensaje.
    await summary.getByRole('link', { name: /^Tasa/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('loan-rate')).toBeFocused();
    await expect(page.getByTestId('loan-rate')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('loan-rate')).toHaveAccessibleDescription(/Es obligatorio/);
    await context.close();
  });
});

test.describe('Validación del monto al salir del campo (platform/web-interface)', () => {
  const ERROR = /USDT admite hasta 6 decimales/;

  test('[TC-PLATFORM-WEBUI-005] [TC-PLATFORM-WEBUI-006] [TC-PLATFORM-WEBUI-007] error de escala al salir, corrección mientras escribe y obligatorio sin tocar', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-monto');
    const usdt = await openAccount(page, W, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '10.000000');
    await go(page, `/transacciones/nueva?cuenta=${usdt}`);
    const sent = recordWrites(page, '/transactions');
    const form = page.getByTestId('transaction-form');
    const amount = form.getByLabel('Monto (USDT)');

    // TC-007: entrar y salir con Tab sin escribir no muestra error; el obligatorio aparece al enviar.
    await amount.focus();
    await page.keyboard.press('Tab');
    await expect(form.getByTestId('field-error')).toHaveCount(0);
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true');

    // TC-005: 10.1234567 al salir del campo.
    await amount.fill('10.1234567');
    await page.keyboard.press('Tab');
    await expect(form.getByTestId('field-error').filter({ hasText: ERROR })).toBeVisible();
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);

    // TC-006: borrar el último dígito sin salir del campo limpia el mensaje y el estado inválido.
    await amount.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await expect(amount).toHaveValue('10.123456');
    await expect(form.getByTestId('field-error').filter({ hasText: ERROR })).toHaveCount(0);
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true');

    // TC-007: con el monto vacío y sin tocar, el error de obligatorio llega al enviar.
    await go(page, `/transacciones/nueva?cuenta=${usdt}`);
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(form.getByTestId('field-error').filter({ hasText: 'Ingresa un monto' })).toBeVisible();
    await context.close();
  });
});

test.describe('Confirmaciones modales y en línea (platform/web-interface)', () => {
  test('[TC-PLATFORM-WEBUI-008] [TC-PLATFORM-WEBUI-009] anular un gasto abre un diálogo modal con el foco en Cancelar y Escape lo cierra devolviendo el foco', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-anular');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const tx = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('60.00'),
      description: 'Compra de prueba',
    });
    await go(page, `/transacciones/${String(tx['id'])}`);
    const trigger = page.getByRole('button', { name: 'Anular', exact: true });
    await trigger.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('¿Anular esta transacción?');
    const cancel = dialog.getByRole('button', { name: 'Cancelar' });
    await expect(cancel).toBeFocused();
    // «Cancelar» precede a la acción de anular en el orden del DOM (y de tabulación).
    expect(
      await dialog.evaluate((d) => {
        const buttons = [...d.querySelectorAll('button')];
        return (
          buttons.findIndex((b) => b.textContent === 'Cancelar') <
          buttons.findIndex((b) => /anular/i.test(b.textContent ?? ''))
        );
      }),
    ).toBe(true);
    // El resto de la página no es alcanzable con el teclado: el foco queda dentro del diálogo (o fuera de la página,
    // en la interfaz del navegador, lo que deja `body` como elemento activo).
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => {
          const open = document.querySelector('dialog[open]');
          const active = document.activeElement;
          return Boolean(open && active && (active === document.body || open.contains(active)));
        }),
      ).toBe(true);
    }
    expect(await seriousViolations(page)).toEqual([]);

    // TC-009: Escape cierra, devuelve el foco a «Anular» y no cambia nada.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-status', 'POSTED');
    expect(JSON.stringify(await api(page, 'GET', `${W}/accounts/${bank}`))).toContain('940.00');
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-011] cancelar la pausa de una suscripción devuelve el foco a «Pausar»', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-pausa');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '5000.00');
    const provider = String((await api(page, 'POST', `${W}/counterparties`, { name: 'Streamly' }))['id']);
    const sub = await api(page, 'POST', `${W}/subscriptions`, {
      counterpartyId: provider,
      name: 'Gimnasio',
      price: bob('100.00'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: todayLaPaz(),
      paymentAccountId: bank,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });
    await go(page, `/recurring/suscripciones/${String(sub['id'])}`);
    await page.getByTestId('pause-subscription').click();

    const panel = page.getByTestId('pause-panel');
    await expect(panel).toHaveAttribute('role', 'alertdialog');
    const buttons = panel.getByRole('button');
    await expect(buttons.first()).toHaveText('Cancelar');
    await expect(buttons.first()).toBeFocused();
    await buttons.first().click();

    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('pause-subscription')).toBeFocused();
    const current = await api(page, 'GET', `${W}/subscriptions/${String(sub['id'])}`);
    expect(current['status']).toBe('ACTIVE');
    await context.close();
  });
});

test.describe('Movimiento reducido (platform/web-interface)', () => {
  /** Home con las respuestas del workspace demoradas para que se vean los esqueletos de carga. */
  async function openSlowHome(page: Page, delayMs: number) {
    await page.route('**/api/bff/v1/workspaces/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.continue();
    });
    await page.goto('/');
    const skeleton = page.locator('.pf-home-skel').first();
    await expect(skeleton).toBeAttached({ timeout: 30_000 });
    return skeleton;
  }

  test('[TC-PLATFORM-WEBUI-012] con movimiento reducido los esqueletos del Home no se animan', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'webui-reduce');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const skeleton = await openSlowHome(page, 4_000);
    const name = await skeleton.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-013] sin preferencia de movimiento los esqueletos del Home se animan', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'webui-motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const skeleton = await openSlowHome(page, 4_000);
    const name = await skeleton.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).not.toBe('none');
    await context.close();
  });
});

test.describe('Colores forzados y pestañas (platform/web-interface)', () => {
  test('[TC-PLATFORM-WEBUI-015] con colores forzados el ítem actual de la navegación tiene borde y los demás no', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'webui-forzados');
    await page.emulateMedia({ forcedColors: 'active' });
    await go(page, '/transacciones');
    const links = page.locator('.pf-nav-link');
    const current = page.locator('.pf-nav-link[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Transacciones');
    const width = (loc: typeof current) =>
      loc.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderInlineStartWidth));
    expect(await width(current)).toBeGreaterThan(0);
    const others = await links.evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute('aria-current') !== 'page')
        .map((el) => Number.parseFloat(getComputedStyle(el).borderInlineStartWidth)),
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((w) => w === 0)).toBe(true);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-016] [TC-PLATFORM-WEBUI-017] las pestañas del préstamo ocupan una fila a 360 px, no cambian de ancho y Fin deja la última visible', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'webui-pestanas');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const loan = await api(page, 'POST', `${W}/loans`, {
      name: 'Vehículo',
      principal: bob('50000.00'),
      annualRate: '0.115',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      termInstallments: 24,
      method: 'FRENCH',
      disbursementDate: '2026-10-15',
      firstDueDate: '2026-11-15',
      account: { create: { name: 'Préstamo vehicular' } },
      disbursementAccountId: bank,
      paymentAccountId: bank,
      disburseNow: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, `/debts/${String(loan['id'])}`);
    const list = page.getByRole('tablist');
    const all = page.getByRole('tab');
    await expect(all.first()).toBeVisible();
    expect(await all.count()).toBeGreaterThanOrEqual(2);

    const geometry = () =>
      all.evaluateAll((els) =>
        els.map((el) => ({ top: (el as HTMLElement).offsetTop, width: el.getBoundingClientRect().width })),
      );
    // La fila de pestañas no ensancha la página (ítem de rejilla con `min-width: 0`).
    expect(
      await list.evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth),
    ).toBe(true);
    const before = await geometry();
    expect(new Set(before.map((g) => g.top)).size).toBe(1);
    expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');

    await all.nth(1).click();
    await expect(all.nth(1)).toHaveAttribute('aria-selected', 'true');
    const after = await geometry();
    expect(after.map((g) => Math.round(g.width))).toEqual(before.map((g) => Math.round(g.width)));
    expect(
      await all.nth(1).evaluate((el) => Number.parseFloat(getComputedStyle(el).borderBlockEndWidth)),
    ).toBeGreaterThan(0);

    // TC-017: Fin en la fila selecciona, enfoca y deja visible la última pestaña.
    await all.nth(0).click();
    await all.nth(0).focus();
    await page.keyboard.press('End');
    const last = all.last();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport({ ratio: 0.99 });
    await context.close();
  });
});
