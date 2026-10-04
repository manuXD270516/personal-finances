import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { W1, bff, newUserPage } from '../src/helpers.js';
import {
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
} from '../src/finance.js';

/**
 * Pestaña "Recorrido" (openspec add-lifecycle-timeline, tareas 6.1, 6.2 y 7.1): diagrama de la máquina de estados con
 * el camino recorrido numerado y el estado actual, más la línea de tiempo (alternativa accesible) con actor, hora de
 * La Paz y enlaces a la revisión y a los asientos; visible para VIEWER.
 */

const LA_PAZ = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/La_Paz',
});

const node = (svg: Locator, code: string) =>
  svg.locator(`[data-testid="lifecycle-node"][data-code="${code}"]`);
const edge = (svg: Locator, code: string, from: string, to: string) =>
  svg.locator(`[data-testid="lifecycle-edge"][data-code="${code}"][data-from="${from}"][data-to="${to}"]`);

async function openLifecycleTab(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Recorrido' }).click();
  await expect(page.getByRole('tab', { name: 'Recorrido' })).toHaveAttribute('aria-selected', 'true');
  const report = page.getByTestId('lifecycle-report');
  await expect(report).toBeVisible();
  return report;
}

test.describe('Recorrido del ciclo de vida (audit/lifecycle-timeline)', () => {
  test('[TC-AUDIT-LIFECYCLE-013] gasto de 80.00 BOB pendiente, contabilizado, corregido a 85.00 y anulado: diagrama numerado, actual anulada y línea de tiempo en hora de La Paz', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'recorrido');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');

    // Registrar pendiente → contabilizar → corregir el monto (revisión 2) → anular con motivo, todo por la UI.
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    const form = page.getByTestId('transaction-form');
    await form.getByLabel('Monto (BOB)').fill('80,00');
    await form.getByLabel('Descripción').fill('Gasto con recorrido');
    await form.getByLabel('Estado').selectOption('PENDING');
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('tx-status').first()).toHaveText('Pendiente');
    await page.getByRole('button', { name: 'Contabilizar' }).click();
    await expect(page.getByText('Transacción contabilizada.')).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    const edit = page.getByTestId('transaction-form');
    await edit.getByLabel('Monto (BOB)').fill('85,00');
    await edit.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByTestId('detail-revision')).toHaveText('2');
    await page.getByRole('button', { name: 'Anular' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Motivo').fill('duplicado');
    await dialog.getByRole('button', { name: 'Sí, anular' }).click();
    await expect(page.getByText('Transacción anulada.')).toBeVisible();

    const report = await openLifecycleTab(page);

    // Diagrama (escritorio: orientación horizontal; la vertical queda oculta).
    const svg = report.locator('svg[data-orientation="horizontal"]');
    await expect(svg).toBeVisible();
    await expect(report.locator('svg[data-orientation="vertical"]')).toBeHidden();
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg).toHaveAttribute('aria-describedby', 'tx-lifecycle-timeline');
    await expect(svg).toHaveAttribute(
      'aria-label',
      'Diagrama de estados: estado actual Anulada. Camino: Pendiente → Contabilizada → Contabilizada → Anulada.',
    );
    await expect(page.locator('#tx-lifecycle-timeline')).toBeVisible();
    for (const code of ['PENDING', 'POSTED', 'VOIDED'])
      await expect(node(svg, code)).toHaveAttribute('data-visited', 'true');
    for (const code of ['CLEARED', 'RECONCILED'])
      await expect(node(svg, code)).toHaveAttribute('data-visited', 'false');
    await expect(svg.locator('[data-testid="lifecycle-node"][data-current="true"]')).toHaveAttribute(
      'data-code',
      'VOIDED',
    );
    await expect(edge(svg, 'RECORD', '', 'PENDING')).toHaveAttribute('data-traversed', 'true');
    await expect(edge(svg, 'RECORD', '', 'PENDING')).toHaveAttribute('data-order', '');
    await expect(edge(svg, 'POST', 'PENDING', 'POSTED')).toHaveAttribute('data-order', '1');
    await expect(edge(svg, 'REVISE', 'POSTED', 'POSTED')).toHaveAttribute('data-order', '2');
    await expect(edge(svg, 'VOID', 'POSTED', 'VOIDED')).toHaveAttribute('data-order', '3');
    await expect(edge(svg, 'CLEAR', 'POSTED', 'CLEARED')).toHaveAttribute('data-traversed', 'false');
    await expect(edge(svg, 'RECONCILE', 'CLEARED', 'RECONCILED')).toHaveAttribute('data-traversed', 'false');

    // Línea de tiempo: registrar, contabilizar (1), revisar (2) y anular (3), con actor y hora de La Paz.
    const entries = report.getByTestId('lifecycle-entry');
    await expect(entries).toHaveCount(4);
    await expect(entries.getByTestId('lifecycle-entry-title')).toHaveText([
      'Registrar',
      '1. Contabilizar',
      '2. Revisar',
      '3. Anular',
    ]);
    await expect(entries.nth(0).getByTestId('lifecycle-entry-states')).toHaveText('— → Pendiente');
    await expect(entries.nth(3).getByTestId('lifecycle-entry-states')).toHaveText('Contabilizada → Anulada');
    await expect(entries.nth(3).getByTestId('lifecycle-entry-reason')).toHaveText('Motivo: duplicado');
    for (let i = 0; i < 4; i += 1) {
      const who = entries.nth(i).getByTestId('lifecycle-entry-who');
      await expect(who).toContainText('Tú');
      const at = await who.locator('time').getAttribute('datetime');
      await expect(who.locator('time')).toHaveText(LA_PAZ.format(new Date(at!)));
    }
    const revise = entries.nth(2);
    await expect(revise.getByTestId('lifecycle-entry-revision')).toContainText(
      'Revisión 1 → 2 · 80,00 BOB → 85,00 BOB',
    );
    await revise.getByText('ver asientos').click();
    await expect(revise.getByTestId('lifecycle-journal')).toContainText('Asiento revertido:');
    await expect(revise.getByTestId('lifecycle-journal')).toContainText('Asiento de reversa:');
    await expect(revise.getByTestId('lifecycle-journal')).toContainText('Asiento nuevo:');
    await revise.getByRole('link', { name: 'ver revisión 2' }).click();
    await expect(page).toHaveURL(/#tx-lifecycle-revision-2$/);
    await expect(page.locator('#tx-lifecycle-revision-2')).toContainText('Revisión 2 · 85,00 BOB');
    await expect(report.getByTestId('lifecycle-incomplete')).toHaveCount(0);

    // Pestañas con teclado: flecha derecha pasa a "Historial de cambios".
    await page.getByRole('tab', { name: 'Recorrido' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Historial de cambios' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Historial de cambios' })).toBeFocused();
    await expect(report).toBeHidden();

    // Recorrido de la cuenta: abrir es la entrada y la cuenta sigue activa.
    await go(page, `/cuentas/${bank}`);
    const accountReport = await openLifecycleTab(page);
    const accountSvg = accountReport.locator('svg[data-orientation="horizontal"]');
    await expect(node(accountSvg, 'ACTIVE')).toHaveAttribute('data-current', 'true');
    await expect(node(accountSvg, 'ARCHIVED')).toHaveAttribute('data-visited', 'false');
    await expect(accountReport.getByTestId('lifecycle-entry-title').first()).toHaveText('Abrir');

    // Móvil (375 px): diagrama vertical, línea de tiempo disponible y sin scroll horizontal.
    await page.setViewportSize({ width: 375, height: 812 });
    const vertical = accountReport.locator('svg[data-orientation="vertical"]');
    await expect(vertical).toBeVisible();
    await expect(accountReport.locator('svg[data-orientation="horizontal"]')).toBeHidden();
    await expect(accountReport.getByTestId('lifecycle-timeline')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-AUDIT-LIFECYCLE-006] un VIEWER ve el recorrido de un gasto que un EDITOR corrigió de 120.00 a 102.00 BOB', async ({
    browser,
  }) => {
    const editor = await newUserPage(browser, 'editor');
    const select = await bff(editor.page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: W1 } });
    expect(select.status).toBeLessThan(300);
    const W = `/workspaces/${W1}`;
    const suffix = randomUUID().slice(0, 8);
    const bank = await openAccount(editor.page, W, `Banco recorrido ${suffix}`, 'BANK', 'BOB', '1000.00');
    // La Minimal Seed no provisiona categorías en W1: se crea una propia para el split.
    const group = await api(editor.page, 'POST', `${W}/category-groups`, {
      name: `Grupo ${suffix}`,
      kind: 'EXPENSE',
    });
    const category = await api(editor.page, 'POST', `${W}/categories`, {
      groupId: String(group['id']),
      name: `Varios ${suffix}`,
    });
    const created = await api(editor.page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('120.00'),
      description: `Recorrido ${suffix}`,
      splits: [{ amount: bob('120.00'), categoryId: String(category['id']) }],
    });
    const id = String(created['id']);
    await go(editor.page, `/transacciones/${id}`);
    await editor.page.getByRole('button', { name: 'Editar' }).click();
    await editor.page.getByTestId('transaction-form').getByLabel('Monto (BOB)').fill('102,00');
    await editor.page
      .getByTestId('transaction-form')
      .getByRole('button', { name: 'Guardar cambios' })
      .click();
    await expect(editor.page.getByTestId('detail-revision')).toHaveText('2');
    await editor.context.close();

    const viewer = await newUserPage(browser, 'viewer', `/transacciones/${id}`);
    const page = viewer.page;
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    const report = await openLifecycleTab(page);
    const entries = report.getByTestId('lifecycle-entry');
    await expect(entries).toHaveCount(2);
    const revised = entries.nth(1);
    await expect(revised).toHaveAttribute('data-transition', 'REVISE');
    await expect(revised.getByTestId('lifecycle-entry-title')).toHaveText('1. Revisar');
    await expect(revised.getByTestId('lifecycle-entry-revision')).toContainText(
      'Revisión 1 → 2 · 120,00 BOB → 102,00 BOB',
    );
    // El actor es el EDITOR (no la sesión del VIEWER).
    await expect(revised.getByTestId('lifecycle-entry-who')).toContainText('Usuario …');
    await expect(
      report.locator(
        'svg[data-orientation="horizontal"] [data-testid="lifecycle-node"][data-current="true"]',
      ),
    ).toHaveAttribute('data-code', 'POSTED');
    // VIEWER: sin acciones de edición en el detalle.
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await viewer.context.close();
  });
});
