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
 * Sugerencias de reglas por la UI (openspec add-rule-suggestions 7.2; TC-RULES-SUGGEST-026): el EDITOR clasifica a mano
 * tres gastos de Tigo, ve la sugerencia con su evidencia y confianza, la prueba (sin efectos), la acepta con otro nombre
 * desde el editor prellenado y aplica la regla a lo existente con el dry-run. Sin violaciones serias de axe ni desborde
 * horizontal a 360 px.
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

test.describe('Sugerencias de reglas (rules/rule-engine)', () => {
  test('[TC-RULES-SUGGEST-026] clasificar a mano 3 gastos iguales, ver la sugerencia, probarla, aceptarla con otro nombre y aplicarla a lo existente', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'sugerencias');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    const servicios = await categoryId(page, W, 'Servicios básicos');
    const today = todayLaPaz();
    // Tres recargas clasificadas a mano y una sin categoría (la que la regla completará).
    for (const [i, amount] of ['20.00', '35.00', '50.00'].entries()) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: today,
        accountId: bank,
        amount: bob(amount),
        description: `TIGO MONEY RECARGA 7771234${i}`,
        splits: [{ amount: bob(amount), categoryId: servicios }],
      });
    }
    const sinCategoria = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('25.00'),
      description: 'TIGO MONEY RECARGA 70000000',
      applyRules: false,
    });

    // La sugerencia aparece con su patrón, apoyo, confianza (texto e icono) y evidencia.
    await go(page, '/reglas');
    await page.getByRole('tab', { name: 'Sugerencias' }).click();
    const card = page.getByTestId('suggestion-card');
    await expect(card).toHaveCount(1);
    await expect(page.getByTestId('suggestion-pattern')).toContainText('tigo money recarga');
    await expect(page.getByTestId('suggestion-summary')).toContainText('Servicios básicos');
    await expect(page.getByTestId('suggestion-support')).toContainText('3 de 3 transacciones');
    await expect(page.getByTestId('suggestion-confidence')).toContainText('Media');
    await expect(page.getByTestId('suggestion-confidence')).toContainText('100,00 %');
    await page.getByTestId('suggestion-evidence').locator('summary').click();
    await expect(page.getByTestId('suggestion-evidence-item')).toHaveCount(3);
    expect(await seriousViolations(page)).toEqual([]);

    // Probar: 4 coincidencias, completaría 1 (la sin categoría) y nada cambia.
    await page.getByTestId('suggestion-test').click();
    await expect(page.getByTestId('suggestion-preview-counts')).toContainText(
      '4 coincidencias: completaría 1',
    );
    await expect(page.getByTestId('suggestion-preview-row')).toHaveCount(4);
    expect(((await api(page, 'GET', `${W}/rules`))['data'] as unknown[]).length).toBe(0);
    const still = await api(page, 'GET', `${W}/transactions/${sinCategoria['id'] as string}`);
    expect((still['splits'] as { categoryOrigin: string }[])[0]!.categoryOrigin).toBe('SYSTEM_DEFAULT');
    expect(await seriousViolations(page)).toEqual([]);

    // Aceptar…: el editor llega prellenado; se guarda con otro nombre.
    await page.getByTestId('suggestion-accept').click();
    await expect(page.getByTestId('rule-suggestion-notice')).toBeVisible();
    await expect(page.getByTestId('condition-value').first()).toHaveValue('tigo money recarga');
    await page.getByTestId('rule-name').fill('Recargas Tigo');
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('rule-submit').click();

    // Crear la regla no reclasifica nada: vuelve a «Ejecutar» solo con esa regla.
    await expect(page.getByTestId('run-only-rule')).toContainText('Recargas Tigo');
    const rules = (await api(page, 'GET', `${W}/rules`))['data'] as {
      id: string;
      name: string;
      version: number;
      fromSuggestion: { suggestionId: string } | null;
    }[];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: 'Recargas Tigo', version: 1 });
    expect(rules[0]!.fromSuggestion?.suggestionId).toMatch(/^[0-9a-f]{64}$/u);
    const unchanged = await api(page, 'GET', `${W}/transactions/${sinCategoria['id'] as string}`);
    expect((unchanged['splits'] as { categoryOrigin: string }[])[0]!.categoryOrigin).toBe('SYSTEM_DEFAULT');

    // Aplicar a lo existente con el dry-run: solo la sin categoría cambia.
    await page.getByTestId('run-submit').click();
    await expect(page.getByTestId('run-counts')).toContainText('4 transacciones evaluadas; 1 cambiarían');
    await expect(page.getByTestId('dry-run-row')).toHaveCount(1);
    await page.getByTestId('run-apply').click();
    await expect(page.getByTestId('run-summary')).toContainText('Se aplicaron 1 transacciones');
    const applied = await api(page, 'GET', `${W}/transactions/${sinCategoria['id'] as string}`);
    expect((applied['splits'] as { categoryId: string; categoryOrigin: string }[])[0]).toMatchObject({
      categoryId: servicios,
      categoryOrigin: 'RULE',
    });

    // La sugerencia aceptada ya no se muestra.
    await go(page, '/reglas');
    await page.getByRole('tab', { name: 'Sugerencias' }).click();
    await expect(page.getByTestId('suggestions-empty')).toBeVisible();

    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/reglas');
    await page.getByRole('tab', { name: 'Sugerencias' }).click();
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
