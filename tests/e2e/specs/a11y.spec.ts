import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Accesibilidad de las pantallas principales (NFR-USAB-001, WCAG 2.1 AA): axe-core sin violaciones `serious` ni
 * `critical` (add-accounts-management 7.3, add-transaction-recording 6.1, add-transfers 6.1, add-audit-trail 7.1).
 * Las páginas se analizan con datos (cuentas en BOB/USD) para que listados y formularios rendericen completos. Las
 * pestañas Proveedores de `/fx` y Etiquetas/Contrapartes de `/clasificacion` se abren por `?vista=` (add-market-rate-
 * providers 6.2, add-classification 8.1–8.2); en clasificación también se analiza el formulario de edición abierto.
 */
const PAGES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'Inicio' },
  { path: '/cuentas', name: 'Cuentas' },
  { path: '/cuentas/nueva', name: 'Nueva cuenta' },
  { path: '/transacciones', name: 'Transacciones' },
  { path: '/transacciones/nueva', name: 'Nueva transacción' },
  { path: '/transferencias/nueva', name: 'Nueva transferencia' },
  { path: '/fx', name: 'Tasas de cambio' },
  { path: '/fx/conversiones/nueva', name: 'Nueva conversión' },
  { path: '/instituciones', name: 'Instituciones' },
  { path: '/clasificacion', name: 'Clasificación' },
  // add-demo-data 6.1: configuración del workspace con el panel "Datos de demostración" (OWNER).
  { path: '/configuracion', name: 'Configuración y datos de demostración' },
  { path: '/clasificacion?vista=etiquetas', name: 'Clasificación: etiquetas' },
  { path: '/clasificacion?vista=contrapartes', name: 'Clasificación: contrapartes' },
  { path: '/fx?vista=proveedores', name: 'FX: proveedores' },
  // add-workspace-identity 8.4: preferencias personales y alta de workspace.
  { path: '/preferencias', name: 'Mis preferencias' },
  { path: '/workspaces/nuevo', name: 'Nuevo espacio de trabajo' },
];

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

test.describe('Accesibilidad (axe-core) de las pantallas principales', () => {
  test('sin violaciones serias ni críticas en Home, cuentas, transacciones, transferencias, FX, instituciones y clasificación', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'a11y');
    const bank = await openAccount(page, W, 'Banco a11y', 'BANK', 'BOB', '1000.00');
    await openAccount(page, W, 'Ahorro USD a11y', 'SAVINGS', 'USD', '100.00');

    const found: Record<string, Awaited<ReturnType<typeof seriousViolations>>> = {};
    for (const p of PAGES) {
      await go(page, p.path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      const violations = await seriousViolations(page);
      if (violations.length > 0) found[`${p.name} (${p.path})`] = violations;
    }
    // Detalle de cuenta con la pestaña Historial de auditoría (componente `AuditHistory`, add-audit-trail 7.1).
    await go(page, `/cuentas/${bank}`);
    await page.getByRole('tab', { name: 'Historial de cambios' }).click();
    await expect(page.getByTestId('audit-history')).toBeVisible();
    const detail = await seriousViolations(page);
    if (detail.length > 0) found['Detalle de cuenta con historial (/cuentas/{id})'] = detail;
    // Pestaña Recorrido (diagrama de la máquina de estados + línea de tiempo, add-lifecycle-timeline).
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    // Hay dos diagramas (horizontal y vertical); CSS muestra uno según el ancho.
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    const lifecycle = await seriousViolations(page);
    if (lifecycle.length > 0) found['Detalle de cuenta con recorrido (/cuentas/{id})'] = lifecycle;
    // Clasificación con un formulario de edición abierto (icono, color y alias) y la contraparte en edición.
    await go(page, '/clasificacion');
    await page
      .locator('[data-testid="category"]:visible')
      .first()
      .getByRole('button', { name: /^Editar/ })
      .click();
    await expect(page.locator('[data-testid="category-edit-form"]:visible')).toHaveCount(1);
    const editing = await seriousViolations(page);
    if (editing.length > 0) found['Clasificación con edición abierta (/clasificacion)'] = editing;
    expect(found).toEqual({});
    await context.close();
  });
});
