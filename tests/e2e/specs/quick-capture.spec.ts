import { AxeBuilder } from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bff, newUserPage } from '../src/helpers.js';
import {
  accountRow,
  api,
  bob,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Alta rápida y región de avisos (openspec add-quick-capture, lote L2 de docs/78; decisiones D502, D508 y D510 de
 * docs/79): monto primero con foco, registrar y seguir con «Deshacer · Ver», cuenta recordada en el dispositivo, acceso
 * «＋ Registrar» y región de avisos persistente. Datos ficticios; un usuario nuevo por prueba. El tiempo lo controla
 * `page.clock` y la fecha de negocio queda fija en 2026-11-25 (America/La_Paz).
 */

/** 2026-11-25 12:00 en America/La_Paz (UTC−4). */
const FIXED_NOW = new Date('2026-11-25T16:00:00Z');
const FIXED_DATE = '2026-11-25';

const form = (page: Page) => page.getByTestId('transaction-form');
const amountField = (page: Page) => form(page).locator('input[name="amount"]');
const notices = (page: Page) => page.getByTestId('notice');
const region = (page: Page) => page.getByRole('region', { name: 'Avisos' });
const noticeOf = (page: Page, text: string) => notices(page).filter({ hasText: text });

/** Reloj controlado (el tiempo sigue corriendo; `fastForward` lo adelanta) y apertura del alta. */
async function openNew(page: Page, query = ''): Promise<void> {
  await go(page, `/transacciones/nueva${query}`);
  await expect(form(page)).toBeVisible();
}
async function fixClock(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_NOW });
}

/** Registra con «Registrar» y devuelve cuántas interacciones usó el usuario (monto, categoría, enviar). */
async function record(page: Page, amount: string, category?: string): Promise<number> {
  let interactions = 0;
  await amountField(page).fill(amount);
  interactions += 1;
  if (category) {
    await form(page).getByLabel('Categoría de la parte 1').selectOption({ label: category });
    interactions += 1;
  }
  await form(page).getByRole('button', { name: 'Registrar', exact: true }).click();
  interactions += 1;
  return interactions;
}

const balanceOf = async (page: Page, name: string): Promise<Locator> => {
  await go(page, '/cuentas');
  return accountRow(page, name).getByTestId('account-balance');
};

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

/** Id de la transacción a la que apunta el enlace «Ver» de un aviso. */
async function viewHrefId(notice: Locator): Promise<string> {
  const href = await notice.getByRole('link', { name: 'Ver', exact: true }).getAttribute('href');
  return href!.split('/transacciones/')[1]!.split('?')[0]!;
}

test.describe('Alta rápida: monto primero, registrar y seguir, deshacer (transactions/transaction-recording)', () => {
  test('[TC-TRANSACTIONS-QUICK-001] a 360 px el alta empieza por el monto con foco, teclado decimal y tecla siguiente', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-foco');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await openNew(page, `?cuenta=${bank}`);

    const amount = amountField(page);
    await expect(amount).toBeFocused();
    await expect(amount).toHaveAttribute('inputmode', 'decimal');
    await expect(amount).toHaveAttribute('enterkeyhint', 'next');
    // El orden del DOM es el visual: el monto es el primer control del formulario y precede a la cuenta y a la fecha.
    const names = await form(page)
      .locator('input, select, textarea, button')
      .evaluateAll((els) => els.map((e) => e.getAttribute('name') ?? e.tagName.toLowerCase()));
    expect(names[0]).toBe('amount');
    expect(names.indexOf('accountId')).toBeGreaterThan(names.indexOf('amount'));
    expect(names.indexOf('transactionDate')).toBeGreaterThan(names.indexOf('accountId'));
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-002] la edición de un gasto conserva el orden y no mueve el foco al monto', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-edicion');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const created = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('120.00'),
      description: 'Compra de prueba',
    });
    await go(page, `/transacciones/${String(created['id'])}`);
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(form(page)).toBeVisible();
    // Ningún campo del formulario toma el foco al abrir la edición.
    const insideForm = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="transaction-form"]') !== null,
    );
    expect(insideForm).toBe(false);
    // Orden de edición intacto: cuenta, monto y fecha en la primera fila.
    const names = await form(page)
      .locator('input[name], select[name]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('name')));
    expect(names.slice(0, 4)).toEqual(['kind', 'kind', 'kind', 'kind']);
    expect(names.slice(4)).toEqual(['accountId']);
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-003] [TC-TRANSACTIONS-QUICK-004] [TC-TRANSACTIONS-QUICK-005] dos gastos seguidos dejan 925.00 BOB; «Registrar e ir al detalle» y «Ver» abren el detalle', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-seguir');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const [food, transport] = await userCategories(page, W, 'EXPENSE');
    const keys: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/workspaces\/[^/]+\/transactions$/.test(r.url()))
        keys.push(r.headers()['idempotency-key'] ?? '');
    });
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    const url = page.url();

    const first = await record(page, '45,00', food!.name);
    const notice = noticeOf(page, 'Gasto de Bs 45,00 registrado');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Deshacer' })).toBeVisible();
    await expect(notice.getByRole('link', { name: 'Ver', exact: true })).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(amountField(page)).toHaveValue('');
    await expect(amountField(page)).toBeFocused();
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue(bank);
    await expect(form(page).locator('input[name="transactionDate"]')).toHaveValue(FIXED_DATE);

    const second = await record(page, '30,00', transport!.name);
    await expect(noticeOf(page, 'Gasto de Bs 30,00 registrado')).toBeVisible();
    // Dos solicitudes, dos claves de idempotencia distintas; con categoría elegida, 3 interacciones por gasto (≤ 4).
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(Math.max(first, second)).toBeLessThanOrEqual(4);
    await expect(await balanceOf(page, 'Banco BOB')).toHaveText('925,00 BOB');

    // «Registrar e ir al detalle» (TC-004): comportamiento anterior con ?aviso=registrada.
    await openNew(page, `?cuenta=${bank}`);
    await amountField(page).fill('10,00');
    await form(page).getByRole('button', { name: 'Registrar e ir al detalle' }).click();
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    expect(page.url()).toMatch(/\/transacciones\/[0-9a-f-]+\?aviso=registrada$/);
    await expect(page.getByTestId('tx-amount')).toContainText('−10,00 BOB');
    await expect(await balanceOf(page, 'Banco BOB')).toHaveText('915,00 BOB');

    // «Ver» (TC-005): abre el detalle y la nueva página no trae el aviso.
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    const toView = noticeOf(page, 'Gasto de Bs 45,00 registrado');
    await expect(toView).toBeVisible();
    await toView.getByRole('link', { name: 'Ver', exact: true }).click();
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    await expect(page.getByTestId('tx-amount')).toContainText('−45,00 BOB');
    await expect(region(page)).toBeAttached();
    await expect(notices(page)).toHaveCount(0);
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-006] [TC-TRANSACTIONS-QUICK-009] «Deshacer» anula con reversa y devuelve el saldo a 1000.00 BOB, también tras 10 minutos', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-deshacer');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    const notice = noticeOf(page, 'Gasto de Bs 45,00 registrado');
    await expect(notice).toBeVisible();
    const id = await viewHrefId(notice);

    // Sin límite de tiempo (D508): a los 10 minutos el aviso y su «Deshacer» siguen ahí.
    await page.clock.fastForward('10:00');
    await expect(notice.getByRole('button', { name: 'Deshacer' })).toBeVisible();

    const voidRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/void'));
    await notice.getByRole('button', { name: 'Deshacer' }).click();
    const sent = await voidRequest;
    expect(sent.headers()['if-match']).toBe('"1"');
    expect(sent.headers()['idempotency-key']).toBeTruthy();
    expect(sent.postDataJSON()).toEqual({ reason: 'Deshecho desde el aviso de registro' });

    await expect(noticeOf(page, 'Registro anulado')).toBeVisible();
    await expect(notices(page).getByRole('button', { name: 'Deshacer' })).toHaveCount(0);
    await expect(notices(page).getByRole('link', { name: 'Ver', exact: true })).toBeVisible();
    const voided = await api(page, 'GET', `${W}/transactions/${id}`);
    expect(voided['status']).toBe('VOIDED');
    await expect(await balanceOf(page, 'Banco BOB')).toHaveText('1.000,00 BOB');
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-007] si la API rechaza la anulación con PERIOD_CLOSED, el aviso muestra el mensaje del catálogo y el gasto sigue posteado', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-cerrado');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    const notice = notices(page).first();
    await expect(notice).toContainText('Gasto de Bs 45,00 registrado');
    const id = await viewHrefId(notice);

    // El stack E2E solo tiene el periodo actual (no hay un periodo terminado que cerrar): la respuesta 409 de la API se
    // simula en la red; el rechazo real lo cubren las pruebas de integración de `voidTransaction`.
    await page.route(/\/transactions\/[^/]+\/void$/, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({ code: 'PERIOD_CLOSED', status: 409, title: 'Periodo cerrado' }),
      }),
    );
    await notice.getByRole('button', { name: 'Deshacer' }).click();
    await expect(notice).toContainText('El mes de esa fecha está cerrado');
    await expect(notice.getByRole('link', { name: 'Ver', exact: true })).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Deshacer' })).toHaveCount(0);
    const still = await api(page, 'GET', `${W}/transactions/${id}`);
    expect(still['status']).toBe('POSTED');
    await expect(await balanceOf(page, 'Banco BOB')).toHaveText('955,00 BOB');
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-008] un doble clic en «Deshacer» envía una sola anulación y no muestra errores', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-doble');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const voids: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/void'))
        voids.push(r.headers()['idempotency-key'] ?? '');
    });
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    const notice = noticeOf(page, 'Gasto de Bs 45,00 registrado');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Deshacer' }).dblclick();
    await expect(noticeOf(page, 'Registro anulado')).toBeVisible();
    expect(voids).toHaveLength(1);
    await expect(notices(page).locator('[role="alert"]')).toHaveCount(0);
    await expect(notices(page)).toHaveCount(1);
    await expect(notices(page).first()).not.toContainText('transición');
    await expect(await balanceOf(page, 'Banco BOB')).toHaveText('1.000,00 BOB');
    await context.close();
  });
});

test.describe('Cuenta recordada en el dispositivo (transactions/transaction-recording)', () => {
  test('[TC-TRANSACTIONS-QUICK-010] [TC-TRANSACTIONS-QUICK-011] la siguiente alta preselecciona la última cuenta del workspace y el enlace tiene prioridad', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-cuenta');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const usd = await openAccount(page, W, 'Caja USD', 'CASH', 'USD', '100.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    await expect(noticeOf(page, 'Gasto de Bs 45,00 registrado')).toBeVisible();

    // Sin ?cuenta=: la recordada.
    await openNew(page);
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue(bank);
    // Con ?cuenta= (como «Registrar movimiento» del detalle de la cuenta): el enlace manda.
    await go(page, `/cuentas/${usd}`);
    await page.getByRole('link', { name: 'Registrar movimiento' }).click();
    await expect(form(page)).toBeVisible();
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue(usd);

    // Otro workspace del mismo usuario: ninguna cuenta preseleccionada.
    const created = await bff(page, 'POST', '/api/bff/v1/workspaces', {
      body: { name: `Segundo ${randomBytes(3).toString('hex')}`, baseCurrency: 'BOB' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(created.status).toBe(201);
    const select = await bff(page, 'PUT', '/api/bff/session', {
      body: { activeWorkspaceId: created.body?.['id'] },
    });
    expect(select.status).toBe(200);
    await openNew(page);
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue('');
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-012] una cuenta recordada que se archivó no se preselecciona y el alta funciona sin localStorage', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-archivada');
    const temp = await openAccount(page, W, 'Caja temporal', 'CASH', 'BOB', '10.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${temp}`);
    await record(page, '10,00');
    await expect(noticeOf(page, 'Gasto de Bs 10,00 registrado')).toBeVisible();
    const version = (await api(page, 'GET', `${W}/accounts/${temp}`))['version'];
    await api(page, 'POST', `${W}/accounts/${temp}/archive`, {}, { 'if-match': `"${String(version)}"` });
    await openNew(page);
    await expect(form(page).locator('select[name="accountId"]')).toHaveValue('');

    // localStorage que lanza (navegación privada): el alta funciona igual y registra.
    const other = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('denegado', 'SecurityError');
        },
      });
    });
    await openNew(page, `?cuenta=${other}`);
    await record(page, '5,00');
    await expect(noticeOf(page, 'Gasto de Bs 5,00 registrado')).toBeVisible();
    await expect(amountField(page)).toBeFocused();
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-013] recordar la cuenta no envía PATCH /me ni cambia la versión del perfil', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-perfil');
    const accounts = [
      await openAccount(page, W, 'Cuenta A', 'BANK', 'BOB', '100.00'),
      await openAccount(page, W, 'Cuenta B', 'BANK', 'BOB', '100.00'),
      await openAccount(page, W, 'Cuenta C', 'BANK', 'BOB', '100.00'),
    ];
    const profileWrites: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && /\/api\/bff\/v1\/me$/.test(r.url())) profileWrites.push(r.url());
    });
    const before = (await bff(page, 'GET', '/api/bff/v1/me')).body?.['version'];
    await fixClock(page);
    for (const account of accounts) {
      await openNew(page, `?cuenta=${account}`);
      await record(page, '10,00');
      await expect(noticeOf(page, 'Gasto de Bs 10,00 registrado')).toBeVisible();
    }
    expect(profileWrites).toEqual([]);
    expect((await bff(page, 'GET', '/api/bff/v1/me')).body?.['version']).toBe(before);
    await context.close();
  });
});

test.describe('Región de avisos de la sesión (platform/web-interface)', () => {
  test('[TC-PLATFORM-WEBUI-021] el aviso sigue visible a los 5 minutos, no mueve el foco y se cierra con «Cerrar»', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-aviso');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    const notice = noticeOf(page, 'Gasto de Bs 45,00 registrado');
    await expect(region(page).getByTestId('notice')).toHaveCount(1);
    // El foco quedó en el monto, no en el aviso.
    await expect(amountField(page)).toBeFocused();
    await page.clock.fastForward('05:00');
    await expect(region(page).getByTestId('notice')).toHaveCount(1);
    await expect(notice).toBeVisible();
    await expect(amountField(page)).toBeFocused();
    expect(await seriousViolations(page)).toEqual([]);

    await notice.getByRole('button', { name: 'Cerrar' }).click();
    await expect(notices(page)).toHaveCount(0);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-022] con ariaNotify, el aviso se anuncia una sola vez en inglés', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-aria');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await page.addInitScript(() => {
      const spy: string[] = [];
      (window as unknown as { __notified: string[] }).__notified = spy;
      Object.defineProperty(document, 'ariaNotify', {
        configurable: true,
        value: (message: string) => spy.push(message),
      });
    });
    await fixClock(page);
    await go(page, `/en/transacciones/nueva?cuenta=${bank}`);
    await page.locator('input[name="amount"]').fill('45,00');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(notices(page)).toHaveCount(1);
    const notified = await page.evaluate(() => (window as unknown as { __notified: string[] }).__notified);
    expect(notified).toEqual(['Expense of Bs 45,00 recorded. Actions available']);
    // Con ariaNotify no existe el respaldo role="status".
    await expect(page.getByRole('region', { name: 'Notices' }).getByRole('status')).toHaveCount(0);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-022] sin ariaNotify, el role="status" de la región contiene el texto una sola vez', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-status');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await page.addInitScript(() => {
      delete (Document.prototype as unknown as { ariaNotify?: unknown }).ariaNotify;
    });
    await fixClock(page);
    await go(page, `/en/transacciones/nueva?cuenta=${bank}`);
    expect(await page.evaluate(() => 'ariaNotify' in document)).toBe(false);
    await page.locator('input[name="amount"]').fill('45,00');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(notices(page)).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Notices' }).getByRole('status')).toHaveText(
      'Expense of Bs 45,00 recorded. Actions available',
    );
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-023] al recargar la página la región queda vacía y no se guarda nada de avisos', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-recarga');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    await record(page, '45,00');
    await expect(notices(page)).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('ready')).toBeAttached({ timeout: 30_000 });
    await expect(region(page)).toBeAttached();
    await expect(notices(page)).toHaveCount(0);
    const keys = await page.evaluate(() => [
      ...Object.keys(window.sessionStorage),
      ...Object.keys(window.localStorage),
    ]);
    expect(keys.filter((k) => /aviso|notice/i.test(k))).toEqual([]);
    await context.close();
  });

  test('[TC-PLATFORM-WEBUI-024] con cuatro registros seguidos la región muestra solo los tres más recientes', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'quick-limite');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    await fixClock(page);
    await openNew(page, `?cuenta=${bank}`);
    for (const amount of ['10,00', '20,00', '30,00', '40,00']) {
      await record(page, amount);
      await expect(noticeOf(page, `Gasto de Bs ${amount} registrado`)).toBeVisible();
      await expect(amountField(page)).toHaveValue('');
    }
    await expect(notices(page)).toHaveCount(3);
    await expect(notices(page).locator('.pf-notice-text')).toHaveText([
      'Gasto de Bs 20,00 registrado',
      'Gasto de Bs 30,00 registrado',
      'Gasto de Bs 40,00 registrado',
    ]);
    // El gasto de 10,00 sigue registrado y se puede anular desde su detalle.
    const list = await api(page, 'GET', `${W}/transactions?limit=50`);
    const rows = list['data'] as { id: string; status: string; amount: { amount: string } }[];
    const ten = rows.find((r) => r.amount.amount === '10.00');
    expect(ten?.status).toBe('POSTED');
    await go(page, `/transacciones/${ten!.id}`);
    await expect(page.getByRole('button', { name: 'Anular' })).toBeVisible();
    await context.close();
  });
});

test.describe('Acceso «＋ Registrar» de la barra superior (transactions/transaction-recording)', () => {
  test('[TC-TRANSACTIONS-QUICK-014] el EDITOR ve «Registrar», con objetivo de 44 px, y abre el alta con foco en el monto', async ({
    browser,
  }) => {
    const { context, page } = await newUserPage(browser, 'editor', '/planificacion/presupuestos');
    const banner = page.getByRole('banner');
    const link = banner.getByRole('link', { name: 'Registrar', exact: true });
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/\/transacciones\/nueva$/);
    await expect(form(page)).toBeVisible();
    await expect(amountField(page)).toBeFocused();
    await expect(banner.getByRole('link', { name: 'Registrar', exact: true })).toHaveCount(0);
    await context.close();
  });

  test('[TC-TRANSACTIONS-QUICK-015] el VIEWER no ve el acceso «Registrar»', async ({ browser }) => {
    const { context, page } = await newUserPage(browser, 'viewer', '/transacciones');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'Registrar', exact: true })).toHaveCount(
      0,
    );
    await context.close();
  });
});
