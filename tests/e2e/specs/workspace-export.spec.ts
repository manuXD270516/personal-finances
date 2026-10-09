import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { api, go, newFinanceUser, openAccount } from '../src/finance.js';
import { appUrl, createKeycloakUser, login } from '../src/helpers.js';

/**
 * Exportar e importar un workspace desde la app (openspec add-workspace-export, tareas 6/7; FR-IDENTITY-016/017):
 * el OWNER exporta con reautenticación reciente, descarga el ZIP (cifrado en reposo, en claro al descargar), lo
 * importa a un workspace NUEVO con identificadores nuevos y los mismos saldos, y elimina el archivo exportado.
 */
test.describe('Exportación e importación del workspace (identity/workspace-portability)', () => {
  test('[TC-IDENTITY-EXPORT-001] [TC-IDENTITY-EXPORT-005] [TC-IDENTITY-EXPORT-008] [TC-IDENTITY-EXPORT-011] [TC-IDENTITY-RESTORE-001] [TC-IDENTITY-RESTORE-002] exportar, descargar, importar a un workspace nuevo y eliminar el archivo', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const { context, page, W, workspaceId } = await newFinanceUser(browser, 'xport');
    const account = await openAccount(page, W, 'Caja Origen', 'CASH', 'BOB', '1234.56');

    // Exportar con confirmación (el login es reciente: no pide reautenticación).
    await go(page, '/configuracion');
    await expect(page.getByTestId('export-panel')).toBeVisible();
    await page.getByTestId('export-request').click();
    await page.getByTestId('export-request-confirm').getByRole('button', { name: 'Sí, exportar' }).click();
    const item = page.getByTestId('export-item').first();
    await expect(item).toHaveAttribute('data-status', 'READY', { timeout: 120_000 });
    // El aviso de "listo" no lleva cifras ni datos financieros.
    const notice = page.getByTestId('export-ready-notice');
    await expect(notice).toContainText('Tu exportación está lista');
    expect(await notice.innerText()).not.toMatch(/1234|Caja Origen/u);

    // Descarga: ZIP real (el bucket lo guarda cifrado; aquí llega descifrado y verificado).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-download').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pfos-export-.*\.zip$/u);
    const file = testInfo.outputPath('export.zip');
    await download.saveAs(file);
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(bytes.includes(Buffer.from('manifest.json'))).toBe(true);

    // Importar: SIEMPRE un workspace nuevo, con identificadores nuevos y los mismos saldos.
    await page.getByTestId('import-file').setInputFiles({
      name: 'export.zip',
      mimeType: 'application/zip',
      buffer: bytes,
    });
    await page.getByTestId('import-submit').click();
    await expect(page.getByTestId('import-open')).toBeVisible({ timeout: 180_000 });
    const me = await api(page, 'GET', '/me');
    const memberships = me['memberships'] as { workspaceId: string; workspaceName: string }[];
    expect(memberships).toHaveLength(2);
    const restored = memberships.find((m) => m.workspaceId !== workspaceId)!;
    expect(restored.workspaceName).toContain('(restaurado)');
    const restoredAccounts = (await api(page, 'GET', `/workspaces/${restored.workspaceId}/accounts`))[
      'data'
    ] as { id: string; name: string; balance: { amount: string; currency: string } }[];
    expect(restoredAccounts.map((a) => [a.name, a.balance.amount, a.balance.currency])).toContainEqual([
      'Caja Origen',
      '1234.56',
      'BOB',
    ]);
    expect(restoredAccounts.map((a) => a.id)).not.toContain(account);
    // El original no cambió.
    expect((await api(page, 'GET', `${W}/accounts/${account}`))['balance']).toEqual({
      amount: '1234.56',
      currency: 'BOB',
    });

    // Eliminar el archivo antes de que venza: la descarga posterior responde 410.
    await page.getByTestId('export-discard').click();
    await page.getByTestId('export-discard-confirm').getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.getByTestId('export-item').first()).toHaveAttribute('data-status', 'DISCARDED');
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    await context.close();
  });

  test('[TC-IDENTITY-EXPORT-001] [TC-IDENTITY-EXPORT-011] reautenticar fuerza las credenciales de nuevo aunque haya sesión del IdP y vuelve a la configuración', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const username = `reauth-${randomUUID().slice(0, 8)}`;
    const password = `Pw-${randomUUID()}`;
    await createKeycloakUser(username, password);
    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    await login(page, username, password);
    await page.goto(new URL('/api/bff/auth/login?reauth=1&returnTo=%2Fconfiguracion', appUrl()).href);
    // `prompt=login`: Keycloak vuelve a pedir credenciales pese a la sesión SSO vigente.
    await expect(page).toHaveURL(/\/realms\/pfos\/protocol\/openid-connect\/auth/);
    await expect(page.locator('#password')).toBeVisible();
    // Con sesión SSO, Keycloak ya conoce al usuario y solo pide la contraseña.
    if ((await page.locator('#username').count()) > 0) await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('#kc-login').click();
    await expect(page).toHaveURL(/\/configuracion$/u);
    await expect(page.getByTestId('export-panel')).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});
