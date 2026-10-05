import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { W1, W2, bff, newUserPage } from '../src/helpers.js';

/**
 * Pantallas de identidad (add-workspace-identity 8.4 / 9.2): selector del workspace activo, configuración del
 * workspace con `If-Match` y preferencias personales que cambian el idioma de la UI; aislamiento entre workspaces a
 * través del BFF (URL y cuerpo manipulados). Las pruebas que editan configuración usan un usuario nuevo con su
 * workspace personal: W1/W2 de la Minimal Seed no se modifican (otras suites los esperan tal cual).
 */

interface AccountRef {
  readonly id: string;
  readonly name: string;
}

/** Cuenta "W2 Bank" con 5000.00 BOB en W2 (docs/29), creada una sola vez por stack (idempotente entre corridas). */
async function ensureW2Bank(page: Page): Promise<string> {
  const existing = await api(page, 'GET', `/workspaces/${W2}/accounts?limit=200`);
  const found = (existing['data'] as AccountRef[]).find((a) => a.name === 'W2 Bank');
  if (found) return found.id;
  return openAccount(page, `/workspaces/${W2}`, 'W2 Bank', 'BANK', 'BOB', '5000.00');
}

async function accountsOf(page: Page, workspaceId: string): Promise<AccountRef[]> {
  return (await api(page, 'GET', `/workspaces/${workspaceId}/accounts?limit=200`))['data'] as AccountRef[];
}

/** Ids de workspace en la ruta de las peticiones de negocio que el navegador envía al BFF. */
function businessWorkspaceIds(urls: readonly string[]): string[] {
  return urls
    .map((u) => /\/api\/bff\/v1\/workspaces\/([0-9a-f-]{36})(?:[/?]|$)/.exec(new URL(u).pathname)?.[1])
    .filter((id): id is string => Boolean(id));
}

test.describe('workspace activo, configuración y preferencias (identity/workspace-membership, identity/authentication)', () => {
  test('[TC-IDENTITY-WORKSPACE-008] cambiar el workspace activo muestra solo datos del workspace elegido', async ({
    browser,
  }) => {
    const { context, page } = await newUserPage(browser, 'owner');
    const w2Bank = await ensureW2Bank(page);
    if ((await accountsOf(page, W1)).length === 0)
      await openAccount(
        page,
        `/workspaces/${W1}`,
        `W1 Caja ${randomUUID().slice(0, 6)}`,
        'CASH',
        'BOB',
        '10.00',
      );
    const w1Accounts = await accountsOf(page, W1);

    await go(page, '/cuentas');
    const selector = page.getByTestId('workspace-selector');
    await selector.selectOption(W1);
    await expect(selector).toHaveValue(W1);
    await expect(
      page.locator(`[data-testid="account-row"][data-account-id="${w1Accounts[0]!.id}"]`),
    ).toBeVisible();

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/bff/v1/workspaces/')) requests.push(r.url());
    });
    await selector.selectOption(W2);
    await expect(selector).toHaveValue(W2);
    await expect(page.getByTestId('active-role')).toHaveText('Tu rol: Propietario');
    const row = page.locator(`[data-testid="account-row"][data-account-id="${w2Bank}"]`);
    await expect(row.getByTestId('account-name')).toHaveText('W2 Bank');
    await expect(row.getByTestId('account-balance')).toHaveText('5.000,00 BOB');
    for (const a of w1Accounts) await expect(page.locator(`[data-account-id="${a.id}"]`)).toHaveCount(0);

    // Toda petición de negocio lleva el id de W2 en la ruta: el servidor nunca infiere el workspace.
    const ids = businessWorkspaceIds(requests);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids), requests.join(' | ')).toEqual(new Set([W2]));

    // La elección vive en la sesión del BFF: otra pantalla sigue en W2.
    await go(page, '/configuracion');
    await expect(page.locator('input[name="name"]')).toHaveValue('W2 Other Demo');
    await context.close();
  });

  test('[TC-IDENTITY-WORKSPACE-003] el OWNER edita la configuración; un guardado concurrente da 412 y se recarga la versión vigente', async ({
    browser,
  }) => {
    const { context, page, workspaceId, W } = await newFinanceUser(browser, 'ajustes');
    await go(page, '/configuracion');
    const form = page.getByTestId('workspace-settings-form');
    await expect(form.locator('input[name="name"]')).not.toHaveValue('');
    await expect(form.getByLabel('Idioma y formato')).toHaveValue('es-BO');
    await expect(form.getByLabel('Zona horaria')).toHaveValue('America/La_Paz');

    // Validación en el cliente: zona no IANA y día 29 no viajan a la API.
    await form.getByLabel('Zona horaria').fill('GMT-4 Bolivia');
    await form.getByLabel('Día de inicio del mes financiero').fill('29');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(
      form.getByText('No es una zona horaria IANA válida (por ejemplo America/La_Paz).'),
    ).toBeVisible();
    await expect(form.getByText('Elige un día entre 1 y 28.')).toBeVisible();
    await form.getByLabel('Zona horaria').fill('America/La_Paz');

    // Otra pestaña guarda antes (misma versión que tiene el formulario abierto).
    const current = await api(page, 'GET', W);
    await api(
      page,
      'PATCH',
      W,
      { name: 'Renombrado en otra pestaña' },
      { 'if-match': `"${String(current['version'])}"` },
    );

    await form.locator('input[name="name"]').fill('Finanzas personales');
    await form.getByLabel('Día de inicio del mes financiero').fill('5');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    const alert = form.locator('p[role="alert"]');
    await expect(alert).toHaveAttribute('data-error-code', 'PRECONDITION_FAILED');
    await expect(alert).toHaveText(
      'Este registro cambió desde que lo abriste. Recarga para ver la versión actual antes de guardar.',
    );
    expect((await api(page, 'GET', W))['fiscalMonthStartDay']).toBe(1);

    await form.getByTestId('reload-latest').click();
    await expect(form.getByTestId('settings-notice')).toHaveText(
      'Se cargó la versión actual. Revisa los valores y vuelve a guardar.',
    );
    await expect(form.locator('input[name="name"]')).toHaveValue('Renombrado en otra pestaña');

    await form.locator('input[name="name"]').fill('Finanzas personales');
    await form.getByLabel('Día de inicio del mes financiero').fill('5');
    await form.getByLabel('Reserva mínima de liquidez (BOB)').fill('1.500,00');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByTestId('settings-notice')).toHaveText('Cambios guardados.');
    const saved = await api(page, 'GET', W);
    expect(saved).toMatchObject({
      id: workspaceId,
      name: 'Finanzas personales',
      fiscalMonthStartDay: 5,
      locale: 'es-BO',
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
    });
    // El selector refleja el nombre nuevo (sesión recargada).
    await expect(page.getByTestId('workspace-selector').locator('option:checked')).toHaveText(
      'Finanzas personales',
    );
    // Un segundo guardado sin cambios no envía nada.
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByTestId('settings-notice')).toHaveText('No hay cambios para guardar.');
    expect((await api(page, 'GET', W))['version']).toBe(saved['version']);
    await context.close();
  });

  test('[TC-IDENTITY-AUTH-008] cambiar el locale de las preferencias cambia el idioma de la interfaz', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'idioma');
    await go(page, '/preferencias');
    const form = page.getByTestId('preferences-form');
    await expect(form.getByRole('heading', { name: 'Mis preferencias' })).toBeVisible();
    await form.getByLabel('Idioma', { exact: true }).selectOption('en-US');
    await form.getByLabel('Zona horaria').fill('America/Sao_Paulo');
    await form.getByRole('button', { name: 'Guardar preferencias' }).click();

    await expect(page).toHaveURL(/\/en\/preferencias$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const en = page.getByTestId('preferences-form');
    await expect(en.getByRole('heading', { name: 'My preferences' })).toBeVisible();
    await expect(en.getByTestId('preferences-notice')).toHaveText('Preferences saved.');
    await expect(en.getByLabel('Language', { exact: true })).toHaveValue('en-US');
    await expect(en.getByLabel('Time zone')).toHaveValue('America/Sao_Paulo');
    const me = await bff(page, 'GET', '/api/bff/v1/me');
    expect(me.body).toMatchObject({ locale: 'en-US', timezone: 'America/Sao_Paulo' });

    // Las rutas sin prefijo conservan el idioma elegido.
    await go(page, '/cuentas');
    await expect(page).toHaveURL(/\/en\/cuentas$/);

    // Volver a español (es-BO) devuelve la interfaz a las rutas sin prefijo.
    await go(page, '/en/preferencias');
    await page.getByTestId('preferences-form').getByLabel('Language', { exact: true }).selectOption('es-BO');
    await page.getByTestId('preferences-form').getByRole('button', { name: 'Save preferences' }).click();
    await expect(page).toHaveURL(/\/preferencias$/);
    await expect(page).not.toHaveURL(/\/en\//);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByTestId('preferences-notice')).toHaveText('Preferencias guardadas.');
    await context.close();
  });
});

test.describe('aislamiento entre workspaces a través del BFF (security/access-control)', () => {
  test('[TC-SECURITY-ISOLATION-001] un recurso de otro workspace es indistinguible de uno inexistente (ruta, cuerpo y barrido de operaciones)', async ({
    browser,
  }) => {
    const owner = await newUserPage(browser, 'owner');
    const w2Bank = await ensureW2Bank(owner.page);
    const w2Txs = (
      await api(owner.page, 'GET', `/workspaces/${W2}/transactions?accountId=${w2Bank}&limit=50`)
    )['data'] as { id: string }[];
    const w2Tx = w2Txs[0]?.id;
    const before = await api(owner.page, 'GET', `/workspaces/${W2}/accounts/${w2Bank}`);
    const secrets = ['W2 Bank', 'W2 Other Demo', w2Bank, W2, ...(w2Tx ? [w2Tx] : [])];
    // Datos de W2 en la respuesta que el cliente no envió (Problem Details puede repetir la ruta pedida en `instance`).
    const leaks = (body: unknown, sent: unknown) =>
      secrets.filter((s) => JSON.stringify(body ?? null).includes(s) && !JSON.stringify(sent).includes(s));

    // Ruta: la cuenta de W2 pedida bajo W1 responde igual que una inexistente.
    const viaRoute = await bff(owner.page, 'GET', `/api/bff/v1/workspaces/${W1}/accounts/${w2Bank}`);
    const missing = await bff(owner.page, 'GET', `/api/bff/v1/workspaces/${W1}/accounts/${randomUUID()}`);
    expect(viaRoute.status).toBe(404);
    expect(viaRoute.body?.['code']).toBe('RESOURCE_NOT_FOUND');
    expect(missing.status).toBe(404);
    expect(missing.body?.['code']).toBe('RESOURCE_NOT_FOUND');
    expect(leaks(viaRoute.body, `${W1}/accounts/${w2Bank}`)).toEqual([]);
    expect(JSON.stringify(viaRoute.body)).not.toContain('5000');
    expect(Object.keys(viaRoute.body ?? {}).sort()).toEqual(Object.keys(missing.body ?? {}).sort());

    // URL manipulada en la UI: con W1 activo, el detalle de la cuenta de W2 muestra "no encontrado" sin sus datos.
    await owner.page.getByTestId('workspace-selector').selectOption(W1);
    await expect(owner.page.getByTestId('workspace-selector')).toHaveValue(W1);
    await go(owner.page, `/cuentas/${w2Bank}`);
    await expect(owner.page.locator('p[role="alert"]').first()).toHaveAttribute(
      'data-error-code',
      'RESOURCE_NOT_FOUND',
    );
    const main = owner.page.locator('main');
    await expect(main).not.toContainText('W2 Bank');
    await expect(main).not.toContainText('5.000,00');

    // Cuerpo: un EDITOR de W1 registra un gasto en W1 con la cuenta de W2 ⇒ 422 y no se registra nada.
    const editor = await newUserPage(browser, 'editor');
    const description = `Aislamiento ${randomUUID().slice(0, 8)}`;
    const viaBody = await bff(editor.page, 'POST', `/api/bff/v1/workspaces/${W1}/transactions`, {
      body: {
        kind: 'EXPENSE',
        transactionDate: todayLaPaz(),
        accountId: w2Bank,
        amount: bob('75.00'),
        description,
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(viaBody.status).toBe(422);
    expect(viaBody.body?.['code']).toBe('REFERENCE_NOT_FOUND');
    expect(leaks(viaBody.body, w2Bank)).toEqual([]);
    const w1Recent = (await api(editor.page, 'GET', `/workspaces/${W1}/transactions?limit=200`))['data'] as {
      description?: string;
    }[];
    expect(w1Recent.some((t) => t.description === description)).toBe(false);
    const after = await api(owner.page, 'GET', `/workspaces/${W2}/accounts/${w2Bank}`);
    expect(after['version']).toBe(before['version']);
    expect(JSON.stringify(after['balance'] ?? after)).toBe(JSON.stringify(before['balance'] ?? before));

    // Barrido de operaciones del contrato con ids de W2 bajo la ruta de W1: siempre 403/404/422, nunca datos de W2.
    const W = `/api/bff/v1/workspaces/${W1}`;
    const ops: { method: string; path: string; body?: unknown; patch?: boolean; idem?: boolean }[] = [
      { method: 'GET', path: `${W}/accounts/${w2Bank}/lifecycle` },
      { method: 'PATCH', path: `${W}/accounts/${w2Bank}`, body: { name: 'Hackeada' }, patch: true },
      { method: 'POST', path: `${W}/accounts/${w2Bank}/archive`, body: {}, idem: true },
      { method: 'POST', path: `${W}/accounts/${w2Bank}/reactivate`, idem: true },
      {
        method: 'POST',
        path: `${W}/transfers`,
        body: {
          transactionDate: todayLaPaz(),
          fromAccountId: w2Bank,
          toAccountId: w2Bank,
          amount: bob('1.00'),
        },
        idem: true,
      },
      ...(w2Tx
        ? [
            { method: 'GET', path: `${W}/transactions/${w2Tx}` },
            { method: 'GET', path: `${W}/transactions/${w2Tx}/history` },
            { method: 'GET', path: `${W}/transactions/${w2Tx}/lifecycle` },
            {
              method: 'PATCH',
              path: `${W}/transactions/${w2Tx}`,
              body: { description: 'Hack' },
              patch: true,
            },
            { method: 'POST', path: `${W}/transactions/${w2Tx}/void`, body: { reason: 'Hack' }, idem: true },
          ]
        : []),
    ];
    const results: Record<string, { status: number; leaks: string[] }> = {};
    for (const op of ops) {
      const r = await bff(editor.page, op.method, op.path, {
        ...(op.body === undefined ? {} : { body: op.body }),
        ...(op.patch ? { contentType: 'application/merge-patch+json' } : {}),
        headers: {
          ...(op.method === 'GET' ? {} : { 'if-match': '"1"' }),
          ...(op.idem ? { 'idempotency-key': randomUUID() } : {}),
        },
      });
      results[`${op.method} ${op.path.replace(W, '{W1}')}`] = { status: r.status, leaks: leaks(r.body, op) };
    }
    for (const [op, r] of Object.entries(results)) {
      expect([403, 404, 422], `${op} → ${r.status}`).toContain(r.status);
      expect(r.leaks, op).toEqual([]);
    }
    // W2 Bank sigue intacta tras el barrido.
    expect((await api(owner.page, 'GET', `/workspaces/${W2}/accounts/${w2Bank}`))['version']).toBe(
      before['version'],
    );
    await editor.context.close();
    await owner.context.close();
  });
});
