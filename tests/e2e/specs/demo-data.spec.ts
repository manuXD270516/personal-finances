import { expect, test } from '@playwright/test';
import { api, go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Datos de demostración desde la app (openspec add-demo-data, tarea 7.2; ADR-0026): el OWNER carga la demo desde la
 * configuración del workspace, ve el indicador persistente y el selector etiquetado, abre el demo con datos y lo
 * limpia; su workspace real no cambia en ningún momento.
 */
test.describe('Datos de demostración (identity/demo-data)', () => {
  test('[TC-IDENTITY-DEMO-001] [TC-IDENTITY-DEMO-003] [TC-IDENTITY-DEMO-004] [TC-IDENTITY-DEMO-014] cargar, ver el indicador, usar y limpiar la demo sin tocar el workspace real', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W, workspaceId } = await newFinanceUser(browser, 'demo');
    // TC-003: el primer login no crea ningún workspace demo.
    const me0 = await api(page, 'GET', '/me');
    expect((me0['memberships'] as { isDemo: boolean }[]).map((m) => m.isDemo)).toEqual([false]);
    const real = await openAccount(page, W, 'Banco Real', 'BANK', 'BOB', '1500.00');

    // TC-001: cargar desde la configuración (con confirmación) y esperar la carga.
    await go(page, '/configuracion');
    await page.getByTestId('demo-load').click();
    await expect(page.getByTestId('demo-load-confirm')).toBeVisible();
    await page.getByTestId('demo-load-confirm').getByRole('button', { name: 'Sí, cargar' }).click();
    await expect(page.getByTestId('demo-data-status')).toContainText('Datos de demostración listos', {
      timeout: 240_000,
    });
    // TC-004: el selector etiqueta el workspace demo.
    await expect(
      page.getByTestId('workspace-selector').locator('option', { hasText: '(demostración)' }),
    ).toHaveCount(1);
    await page.getByTestId('demo-open').click();
    await expect(page.getByTestId('demo-indicator')).toBeVisible();
    await expect(page.getByTestId('demo-indicator')).toContainText('Datos de demostración');

    // El indicador es persistente: Home y Cuentas del demo (con datos ficticios).
    await go(page, '/');
    await expect(page.getByTestId('demo-indicator')).toBeVisible();
    await go(page, '/cuentas');
    await expect(page.getByTestId('demo-indicator')).toBeVisible();
    await expect(page.getByText('Banco Andino Demo — Cuenta corriente')).toBeVisible();

    // TC-014: el workspace real no cambió.
    const account = await api(page, 'GET', `${W}/accounts/${real}`);
    expect(account['balance']).toEqual({ amount: '1500.00', currency: 'BOB' });
    const realList = await api(page, 'GET', `${W}/accounts`);
    expect((realList['data'] as unknown[]).length).toBe(1);

    // Limpiar desde la configuración del demo: vuelve al workspace real y el demo desaparece.
    await go(page, '/configuracion');
    await page.getByTestId('demo-cleanup').click();
    await page.getByTestId('demo-cleanup-confirm').getByRole('button', { name: 'Sí, limpiar' }).click();
    await expect(page.getByTestId('demo-indicator')).toHaveCount(0, { timeout: 30_000 });
    const me1 = await api(page, 'GET', '/me');
    expect((me1['memberships'] as { workspaceId: string }[]).map((m) => m.workspaceId)).toEqual([
      workspaceId,
    ]);
    expect((await api(page, 'GET', `${W}/accounts/${real}`))['balance']).toEqual({
      amount: '1500.00',
      currency: 'BOB',
    });
    await context.close();
  });
});
