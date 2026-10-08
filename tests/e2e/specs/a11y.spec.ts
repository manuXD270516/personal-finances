import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz, userCategories } from '../src/finance.js';

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
  // add-custom-fields 6.1: pestaña Campos personalizados (lista, formulario de definición).
  { path: '/clasificacion?vista=campos', name: 'Clasificación: campos personalizados' },
  { path: '/fx?vista=proveedores', name: 'FX: proveedores' },
  // add-workspace-identity 8.4: preferencias personales y alta de workspace.
  { path: '/preferencias', name: 'Mis preferencias' },
  { path: '/workspaces/nuevo', name: 'Nuevo espacio de trabajo' },
  // add-financial-periods 7.3: calendario financiero (lista, marcas y selector de periodo).
  { path: '/planificacion/periodos', name: 'Periodos financieros' },
  // add-budgets 7.3: presupuestos del periodo (la versión con plan y línea la analiza budgets.spec.ts).
  { path: '/planificacion/presupuestos', name: 'Presupuestos' },
  // add-budget-templates 7.1: templates de presupuesto (la versión con datos y borrador la analiza templates.spec.ts).
  { path: '/planificacion/templates', name: 'Templates de presupuesto' },
  // add-month-closing 7.3: cierre de mes sin periodo en la ruta (la versión con periodo, checklist y reporte la analiza
  // month-closing.spec.ts) y la política de cierre dentro de /configuracion.
  { path: '/planificacion/cierre', name: 'Cierre de mes' },
  // add-alerts 7.1: bandeja de notificaciones (la versión con datos y el detalle los analiza notifications.spec.ts).
  { path: '/notificaciones', name: 'Notificaciones' },
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
    // Un gasto categorizado para que el Home analice "Este mes" con el top de categorías (barras y variación, D50).
    const [food] = await userCategories(page, W, 'EXPENSE');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('120.00'),
      splits: [{ amount: bob('120.00'), categoryId: food!.id }],
    });

    // Custom fields (add-custom-fields 6.1): de transacción (selección y decimal) y de cuenta, para que los formularios y
    // listados los rendericen completos al analizar nueva transacción, nueva cuenta, registro y clasificación.
    for (const field of [
      {
        key: 'centro_costo',
        label: 'Centro de costo',
        dataType: 'SELECT',
        target: 'TRANSACTION',
        options: [
          { key: 'casa', label: 'Casa' },
          { key: 'oficina', label: 'Oficina' },
        ],
      },
      { key: 'litros', label: 'Litros', dataType: 'DECIMAL', target: 'TRANSACTION' },
      { key: 'sucursal', label: 'Sucursal', dataType: 'TEXT', target: 'ACCOUNT' },
    ])
      await api(page, 'POST', `${W}/custom-fields`, field);

    const found: Record<string, Awaited<ReturnType<typeof seriousViolations>>> = {};
    for (const p of PAGES) {
      await go(page, p.path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      // El Home se analiza ya cargado, con la comparación por categoría resuelta (no el esqueleto).
      if (p.path === '/') {
        await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
      }
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
    // Recorrido de una categoría en su detalle (docs/31 D52, tarea 9.6): pestaña Recorrido + exportar.
    await page
      .locator('[data-testid="category"]:visible')
      .first()
      .getByRole('tab', { name: 'Recorrido' })
      .click();
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    const categoryLifecycle = await seriousViolations(page);
    if (categoryLifecycle.length > 0)
      found['Clasificación con recorrido de categoría (/clasificacion)'] = categoryLifecycle;
    // Reconciliación (add-reconciliation 6.1): formulario de inicio, sesión en curso con diferencia y diálogo de ajuste,
    // pestaña Recorrido de la sesión, detalle de cuenta con el indicador y conciliación sin extracto en una transacción.
    await go(page, `/cuentas/${bank}/reconciliar`);
    await expect(page.getByTestId('reconciliation-start')).toBeVisible();
    const recStart = await seriousViolations(page);
    if (recStart.length > 0) found['Reconciliar: inicio (/cuentas/{id}/reconciliar)'] = recStart;
    await api(page, 'POST', `${W}/reconciliations`, {
      accountId: bank,
      statementDate: todayLaPaz(),
      statementBalance: '900.00',
    });
    await go(page, `/cuentas/${bank}/reconciliar`);
    await expect(page.getByTestId('reconciliation-summary')).toBeVisible();
    await expect(page.getByTestId('rec-difference')).toHaveAttribute('data-state', 'NEGATIVE');
    const recSession = await seriousViolations(page);
    if (recSession.length > 0) found['Reconciliar: sesión en curso'] = recSession;
    await page.getByTestId('finish-reconciliation').click();
    await expect(page.getByTestId('adjustment-panel')).toBeVisible();
    const recAdjustment = await seriousViolations(page);
    if (recAdjustment.length > 0) found['Reconciliar: diálogo de ajuste'] = recAdjustment;
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    const recLifecycle = await seriousViolations(page);
    if (recLifecycle.length > 0) found['Reconciliar: recorrido de la sesión'] = recLifecycle;
    await go(page, `/cuentas/${bank}`);
    await expect(page.getByTestId('reconciliation-indicator')).toBeVisible();
    const indicator = await seriousViolations(page);
    if (indicator.length > 0) found['Detalle de cuenta con indicador de reconciliación'] = indicator;
    const cleared = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'CLEARED',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('10.00'),
      description: 'Sin extracto a11y',
    });
    await go(page, `/transacciones/${String(cleared['id'])}`);
    await page.getByTestId('reconcile-without-statement').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    const withoutDialog = await seriousViolations(page);
    if (withoutDialog.length > 0) found['Transacción: confirmar conciliada sin extracto'] = withoutDialog;
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sí, marcar como conciliada' }).click();
    await expect(page.getByTestId('tx-without-statement').first()).toBeVisible();
    const flagged = await seriousViolations(page);
    if (flagged.length > 0) found['Transacción conciliada sin extracto (marca)'] = flagged;
    await go(page, `/transacciones?cuenta=${bank}&sinExtracto=1`);
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    const flaggedList = await seriousViolations(page);
    if (flaggedList.length > 0) found['Transacciones: filtro conciliadas sin extracto'] = flaggedList;
    expect(found).toEqual({});
    await context.close();
  });
});
