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

/**
 * Motor de reglas por la UI (openspec add-rule-engine 7.4; TC-RULES-ENGINE-001, -025, -027, -029, -037, -044, -054,
 * -057): el EDITOR crea la regla «Supermercado» con su vista previa en vivo, la ve en el listado con su estado, ejecuta el
 * dry-run sobre el historial (sin cambiar nada), lo aplica como edición masiva auditada, ve el origen por campo en el
 * detalle de la transacción y la cobertura; una regla de «gastos grandes» marca para revisión y la marca se filtra y se
 * quita. Sin violaciones serias de axe ni desborde horizontal a 360 px.
 */
async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

async function categoryId(page: Page, W: string, name: string): Promise<string> {
  const r = await api(page, 'GET', `${W}/categories?kind=EXPENSE&limit=200`);
  const hit = (r['data'] as { id: string; name: string }[]).find((c) => c.name === name);
  expect(hit, `categoría ${name}`).toBeDefined();
  return hit!.id;
}

test.describe('Reglas de clasificación (rules/rule-engine)', () => {
  test('[TC-RULES-ENGINE-001] [TC-RULES-ENGINE-025] [TC-RULES-ENGINE-027] [TC-RULES-ENGINE-029] [TC-RULES-ENGINE-037] [TC-RULES-ENGINE-044] crear la regla con vista previa, ejecutarla sobre el historial, aplicarla y ver el origen y la cobertura', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'reglas');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    const supermercado = await categoryId(page, W, 'Supermercado');
    const hogar = await categoryId(page, W, 'Hogar');
    const today = todayLaPaz();
    // Cuatro gastos «sin categoría» y dos ya en Hogar, todos de Hipermaxi.
    const sinCategoria: string[] = [];
    for (const [i, amount] of ['185.40', '60.00', '42.50', '99.90'].entries()) {
      const tx = await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: today,
        accountId: bank,
        amount: bob(amount),
        description: `HIPERMAXI SUC ${12 + i}`,
        applyRules: false,
      });
      sinCategoria.push(tx['id'] as string);
    }
    for (const amount of ['70.00', '80.00']) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: today,
        accountId: bank,
        amount: bob(amount),
        description: 'HIPERMAXI CENTRAL',
        splits: [{ amount: bob(amount), categoryId: hogar }],
      });
    }

    // Lista vacía y alta por el editor, con la vista previa en vivo.
    await go(page, '/reglas');
    await expect(page.getByTestId('rules-empty')).toBeVisible();
    await go(page, '/reglas/nueva');
    await page.getByTestId('rule-name').fill('Supermercado');
    await page.getByTestId('condition-value').fill('hipermaxi');
    await page.getByTestId('action-category').selectOption(supermercado);
    await page.getByTestId('preview-description').fill('HIPERMAXI SUC 12');
    await expect(page.getByTestId('preview-result')).toHaveAttribute('data-matched', 'true');
    await expect(page.getByTestId('preview-actions')).toContainText('Supermercado');
    await page.getByTestId('preview-description').fill('FARMACORP');
    await expect(page.getByTestId('preview-result')).toHaveAttribute('data-matched', 'false');
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('rule-submit').click();
    await expect(page.getByTestId('rule-meta')).toContainText('Activa');
    const ruleId = page.url().match(/\/reglas\/([0-9a-f-]{36})/)![1]!;
    const created = await api(page, 'GET', `${W}/rules/${ruleId}`);
    expect(created).toMatchObject({ version: 1, enabled: true, triggers: ['IMPORT', 'RETROACTIVE'] });

    // Listado: estado, disparadores y resumen.
    await go(page, '/reglas');
    const ruleRow = page.getByTestId('rule-row').filter({ hasText: 'Supermercado' });
    await expect(ruleRow).toHaveAttribute('data-status', 'ACTIVE');
    await expect(ruleRow).toContainText('Al importar');
    expect(await seriousViolations(page)).toEqual([]);

    // Dry-run sobre el historial: propone la categoría solo para los 4 sin categoría y no cambia nada.
    await page.getByRole('tab', { name: 'Ejecutar sobre el historial' }).click();
    await page.getByTestId('run-from').fill(today);
    await page.getByTestId('run-to').fill(today);
    await page.getByTestId('run-submit').click();
    await expect(page.getByTestId('run-counts')).toContainText('6 transacciones evaluadas; 4 cambiarían');
    await expect(page.getByTestId('dry-run-row')).toHaveCount(4);
    await expect(page.getByTestId('dry-run-table')).toContainText('Supermercado');
    for (const id of sinCategoria) {
      const tx = await api(page, 'GET', `${W}/transactions/${id}`);
      expect((tx['splits'] as { categoryId: string }[])[0]!.categoryId).not.toBe(supermercado);
    }
    expect(await seriousViolations(page)).toEqual([]);

    // Aplicación como edición masiva auditada.
    await page.getByTestId('run-apply').click();
    await expect(page.getByTestId('run-summary')).toContainText('Se aplicaron 4 transacciones');
    for (const id of sinCategoria) {
      const tx = await api(page, 'GET', `${W}/transactions/${id}`);
      const split = (tx['splits'] as { categoryId: string; categoryOrigin: string }[])[0]!;
      expect(split).toMatchObject({ categoryId: supermercado, categoryOrigin: 'RULE' });
    }

    // Detalle de la transacción: origen por campo.
    await go(page, `/transacciones/${sinCategoria[0]!}`);
    await expect(page.getByTestId('split-classification')).toContainText('por la regla Supermercado (v1)');
    expect(await seriousViolations(page)).toEqual([]);

    // Cobertura del día: importadas por regla = 0 (los gastos son manuales), la pantalla informa el estado vacío.
    await go(page, '/reglas');
    await page.getByRole('tab', { name: 'Cobertura' }).click();
    await page.getByTestId('coverage-from').fill(today);
    await page.getByTestId('coverage-to').fill(today);
    await page.getByTestId('coverage-submit').click();
    await expect(page.getByTestId('coverage-empty')).toBeVisible();

    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/reglas');
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-RULES-ENGINE-057] [TC-RULES-ENGINE-054] una regla marca gastos grandes para revisión, la marca se filtra y se quita sin tocar el saldo; crear una regla desde la transacción no guarda hasta confirmar', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'revision');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '5000.00');
    const today = todayLaPaz();
    const rule = await api(page, 'POST', `${W}/rules`, {
      name: 'Revisar gastos grandes',
      triggers: ['MANUAL_CREATE'],
      conditions: [
        { field: 'KIND', operator: 'equals', value: 'EXPENSE' },
        { field: 'AMOUNT', operator: 'gt', value: '2000.00', currency: 'BOB' },
      ],
      actions: [{ type: 'MARK_FOR_REVIEW' }],
    });
    const big = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('2450.00'),
      description: 'Compra grande',
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('30.00'),
      description: 'Compra chica',
    });
    expect(big).toMatchObject({ needsReview: true });
    const balance = (await api(page, 'GET', `${W}/accounts/${bank}`))['balance'];

    await go(page, '/transacciones?pendientes=1');
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await expect(page.getByTestId('needs-review-badge')).toBeVisible();
    await page.getByTestId('tx-title').click();
    await expect(page.getByTestId('review-banner')).toContainText(
      `La marcó la regla Revisar gastos grandes (v1)`,
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Crear regla desde la transacción: abre el editor prellenado y no guarda nada.
    await page.getByTestId('create-rule-from').click();
    await expect(page.getByTestId('rule-seed-notice')).toBeVisible();
    await expect(page.getByTestId('condition-value').first()).toHaveValue('compra grande');
    const before = (await api(page, 'GET', `${W}/rules`))['data'] as unknown[];
    expect(before).toHaveLength(1);
    expect((rule as { id: string }).id).toBeTruthy();

    // Quitar la marca: el saldo no cambia.
    await go(page, `/transacciones/${big['id'] as string}`);
    await page.getByTestId('review-resolve').click();
    await expect(page.getByTestId('review-banner')).toHaveCount(0);
    expect((await api(page, 'GET', `${W}/accounts/${bank}`))['balance']).toEqual(balance);
    await go(page, '/transacciones?pendientes=1');
    await expect(page.getByTestId('transaction-row')).toHaveCount(0);
    await context.close();
  });
});
