import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
} from '../src/finance.js';
import { W1, bff, newUserPage } from '../src/helpers.js';

/**
 * Vista global de auditoría por la UI (openspec add-global-audit-view 6.1 y 7.2; FR-AUDIT-006, FR-AUDIT-005): filtrar
 * por actor y exportar CSV como OWNER (TC-AUDIT-GLOBAL-001, -003), el EDITOR consulta pero no exporta y el VIEWER no
 * accede (TC-AUDIT-GLOBAL-002), el rechazo de un VIEWER aparece como evento de seguridad (TC-AUDIT-GLOBAL-004, -006).
 * Sin violaciones serias de axe ni desborde horizontal.
 */
async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test.describe('Auditoría global', () => {
  test('[TC-AUDIT-GLOBAL-001] [TC-AUDIT-GLOBAL-003] [TC-AUDIT-GLOBAL-008] el OWNER filtra por actor y por acción, abre el detalle con el diff y exporta el CSV', async ({
    browser,
  }) => {
    const { context, page, W, workspaceId } = await newFinanceUser(browser, 'audit-global');
    const bank = await openAccount(page, W, 'Banco auditoría', 'BANK', 'BOB', '1000.00');
    for (const [amount, description] of [
      ['45.90', '=SUM(A1)'],
      ['150.00', 'Compra dos'],
    ] as const) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: todayLaPaz(),
        accountId: bank,
        amount: bob(amount),
        description,
      });
    }

    await go(page, '/configuracion');
    await page.getByTestId('audit-open').click();
    await expect(page.getByRole('heading', { name: 'Auditoría', level: 1 })).toBeVisible();
    const rows = page.getByTestId('audit-row');
    await expect(rows.first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);

    // Actor: "Solo mis cambios" + acción exacta ⇒ solo los dos gastos registrados por este usuario.
    await page.getByRole('button', { name: 'Solo mis cambios' }).click();
    await page.getByLabel('Acción', { exact: true }).fill('transactions.transaction.created');
    await page.getByTestId('audit-apply').click();
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row).toHaveAttribute('data-action', 'transactions.transaction.created');
      await expect(row).toContainText('Tú');
    }

    // Detalle: el diff con montos por locale (es-BO) y los enlaces a la operación y al historial del elemento.
    await rows.first().getByTestId('audit-toggle').click();
    const detail = page.getByTestId('audit-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('table')).toBeVisible();
    await expect(detail.getByTestId('audit-link-operation')).toHaveAttribute(
      'href',
      /\/configuracion\/auditoria\?correlationId=/,
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Exportar CSV con los mismos filtros (solo OWNER): UTF-8 con BOM, instante con desfase, fila por registro.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('audit-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^audit-${workspaceId}-.*\\.csv$`));
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.toString('utf8').slice(1);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'occurredAt,actorType,actorId,actorName,origin,action,category,aggregateType,aggregateId,aggregateVersion,reason,correlationId,changes',
    );
    expect(lines).toHaveLength(3);
    // fix-phase-2-gaps: la columna actorName trae el nombre visible del usuario que hizo el cambio.
    expect(lines[1]!.split(',')[3]).not.toBe('');
    expect(csv).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-04:00/);
    // La descripción "=SUM(A1)" sale neutralizada.
    expect(csv).toContain("description:  → '=SUM(A1)");

    // Móvil (360 px): sin desborde horizontal.
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-AUDIT-GLOBAL-002] [TC-AUDIT-GLOBAL-003] el EDITOR consulta pero no exporta; el VIEWER no accede', async ({
    browser,
  }) => {
    const editor = await newUserPage(browser, 'editor', '/configuracion/auditoria');
    await expect(editor.page.getByTestId('audit-filters')).toBeVisible();
    await expect(editor.page.getByTestId('audit-export')).toHaveCount(0);
    await expect(editor.page.getByTestId('audit-export-owner-only')).toBeVisible();
    // La API también lo rechaza: exportar es solo del OWNER.
    const denied = await bff(editor.page, 'GET', `/api/bff/v1/workspaces/${W1}/audit-log/export?format=csv`);
    expect(denied.status).toBe(403);
    expect(denied.body?.['code']).toBe('INSUFFICIENT_ROLE');
    await editor.context.close();

    const viewer = await newUserPage(browser, 'viewer', '/configuracion/auditoria');
    await expect(viewer.page.getByTestId('audit-log-denied')).toBeVisible();
    await expect(viewer.page.getByTestId('audit-filters')).toHaveCount(0);
    const list = await bff(viewer.page, 'GET', `/api/bff/v1/workspaces/${W1}/audit-log`);
    expect(list.status).toBe(403);
    expect(list.body?.['code']).toBe('INSUFFICIENT_ROLE');
    await viewer.context.close();
  });

  test('[TC-AUDIT-GLOBAL-004] [TC-AUDIT-GLOBAL-006] el rechazo de un VIEWER queda como evento de seguridad y se ve en la categoría Seguridad', async ({
    browser,
  }) => {
    const viewer = await newUserPage(browser, 'viewer');
    const attempt = await bff(viewer.page, 'POST', `/api/bff/v1/workspaces/${W1}/transactions`, {
      body: { kind: 'EXPENSE', amount: bob('45.90'), description: 'Compra' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(attempt.status).toBe(403);
    expect(attempt.body?.['code']).toBe('INSUFFICIENT_ROLE');
    await viewer.context.close();

    const owner = await newUserPage(browser, 'owner', '/configuracion/auditoria?category=SECURITY');
    const denied = owner.page.locator(
      '[data-testid="audit-row"][data-action="security.authorization.denied"]',
    );
    await expect(denied.first()).toBeVisible();
    await expect(denied.first()).toContainText('Acceso denegado');
    await expect(denied.first().getByTestId('audit-chip-security')).toBeVisible();
    // La vista de seguridad no mezcla cambios de datos financieros.
    await expect(owner.page.locator('[data-testid="audit-row"][data-category="DATA"]')).toHaveCount(0);
    await denied.first().getByTestId('audit-toggle').click();
    const detail = owner.page.getByTestId('audit-detail');
    await expect(detail).toContainText('createTransaction');
    await expect(detail).toContainText('INSUFFICIENT_ROLE');
    await expect(detail).not.toContainText('45.90');
    await expect(detail).not.toContainText('Compra');
    expect(await seriousViolations(owner.page)).toEqual([]);
    await owner.context.close();
  });
});
