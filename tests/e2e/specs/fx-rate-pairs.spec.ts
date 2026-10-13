import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, expectNoHorizontalScroll, go, newFinanceUser } from '../src/finance.js';

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

/**
 * Configuración → Tasas automáticas (add-crypto-rate-providers 6.1; TC-FX-PROVIDER-021, TC-FX-PROVIDER-025): la lista
 * de pares por defecto, cambiarla a personalizada quitando un par (el OWNER/EDITOR), volver a la lista por defecto,
 * sin violaciones serias de accesibilidad y sin scroll horizontal en móvil. No consulta ningún provider cripto: hasta
 * que exista un adapter con términos verificados (ADR-0029) no hay fuente real ni simulada de precios cripto.
 */
test.describe('Pares de tasa automáticos (fx/market-rate-providers)', () => {
  test('[TC-FX-PROVIDER-021] [TC-FX-PROVIDER-025] el OWNER pasa de la lista por defecto a una personalizada y vuelve a la por defecto', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'pares-tasa');
    await go(page, '/configuracion');
    const panel = page.getByTestId('rate-pairs');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('rate-pair-row')).toHaveCount(2);
    await expect(panel.locator('[data-pair="USD/BOB"]')).toBeVisible();
    await expect(panel.locator('[data-pair="USDT/BOB"]')).toBeVisible();
    await expect(page.getByTestId('rate-pairs-save')).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);

    // Lista personalizada sin USD/BOB: el sistema deja de registrarlo; el resto queda igual.
    await page.getByTestId('rate-pairs-mode-CUSTOM').check();
    await panel.locator('[data-pair="USD/BOB"]').getByTestId('rate-pair-remove').click();
    await expect(panel.getByTestId('rate-pair-row')).toHaveCount(1);
    await page.getByTestId('rate-pairs-save').click();
    await expect(page.getByTestId('rate-pairs-notice')).toHaveText('Lista de pares guardada.');
    const custom = await api(page, 'GET', `${W}/fx-rate-pairs`);
    expect(custom['mode']).toBe('CUSTOM');
    expect((custom['pairs'] as { base: string; quote: string }[]).map((p) => `${p.base}/${p.quote}`)).toEqual(
      ['USDT/BOB'],
    );
    expect(custom['version']).toBe(2);

    // Volver a la lista por defecto: se deriva de nuevo de las monedas habilitadas.
    await go(page, '/configuracion');
    await expect(page.getByTestId('rate-pairs-mode-CUSTOM')).toBeChecked();
    await page.getByTestId('rate-pairs-mode-DEFAULT').check();
    await page.getByTestId('rate-pairs-save').click();
    await expect(page.getByTestId('rate-pairs-notice')).toHaveText('Lista de pares guardada.');
    const back = await api(page, 'GET', `${W}/fx-rate-pairs`);
    expect(back['mode']).toBe('DEFAULT');
    expect((back['pairs'] as unknown[]).length).toBe(2);

    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/configuracion');
    await expect(page.getByTestId('rate-pairs')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
