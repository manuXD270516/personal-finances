import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, go, newFinanceUser, todayLaPaz } from '../src/finance.js';

/**
 * Periodos financieros (openspec add-financial-periods 7.3): un workspace nuevo recibe sus periodos de forma
 * asíncrona (consumidor de `identity.WorkspaceCreated.v1`, docs/33 D64): el actual `ACTIVE` y 3 `DRAFT`. Cambiar el
 * día de inicio a 25 en Configuración recalcula los `DRAFT` (consumidor de `WorkspaceSettingsChanged`) y aparece el
 * periodo de transición. Selector de periodo por defecto en el periodo de hoy (zona del workspace).
 */
const rows = (page: Page) => page.getByTestId('period-row');

/** Etiqueta `YYYY-MM` desplazada `n` meses. */
function shift(label: string, n: number): string {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Recarga la pantalla hasta que se cumpla `check` (los periodos los crea el worker en segundo plano). */
async function eventually(page: Page, check: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await go(page, '/planificacion/periodos');
    await expect(page.getByRole('heading', { level: 1, name: 'Periodos financieros' })).toBeVisible();
    await expect(page.getByText('Cargando periodos…')).toHaveCount(0);
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('los periodos no llegaron a tiempo');
    await page.waitForTimeout(1500);
  }
}

test.describe('Periodos financieros', () => {
  test('[TC-PLANNING-AUTOCREATE-001] [TC-PLANNING-FISCALDAY-001] workspace nuevo: actual ACTIVE y 3 DRAFT; con día de inicio 25 aparece el periodo de transición', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'periodos');
    const today = todayLaPaz();
    // Día de inicio 1: la etiqueta del periodo actual es el mes de hoy.
    const current = today.slice(0, 7);
    await eventually(page, async () => (await rows(page).count()) === 4);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator(`[data-testid="period-row"][data-label="${current}"]`)).toHaveAttribute(
      'data-status',
      'ACTIVE',
    );
    for (const n of [1, 2, 3]) {
      await expect(
        page.locator(`[data-testid="period-row"][data-label="${shift(current, n)}"]`),
      ).toHaveAttribute('data-status', 'DRAFT');
    }
    // La fila de hoy se marca como actual y el selector la elige por defecto.
    await expect(page.locator(`[data-testid="period-row"][data-label="${current}"]`)).toHaveAttribute(
      'aria-current',
      'date',
    );
    const selector = page.getByLabel('Periodo', { exact: true });
    await expect(selector.locator('option:checked')).toContainText('(actual)');
    await expect(page.getByTestId('period-transition')).toHaveCount(0);
    // Ningún DRAFT futuro se puede activar todavía (su fecha de inicio no llegó).
    await expect(page.getByRole('button', { name: /^Activar el periodo/ })).toHaveCount(0);

    await go(page, '/configuracion');
    const form = page.getByTestId('workspace-settings-form');
    await expect(form.locator('input[name="name"]')).not.toHaveValue('');
    await form.getByLabel('Día de inicio del mes financiero').fill('25');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByTestId('settings-notice')).toHaveText('Cambios guardados.');

    await eventually(page, async () => (await page.getByTestId('period-transition').count()) === 1);
    const transition = page.locator(`[data-testid="period-row"][data-label="${shift(current, 1)}"]`);
    await expect(transition.getByTestId('period-transition')).toHaveText('Transición');
    await expect(transition).toHaveAttribute('data-status', 'DRAFT');
    // El periodo actual no cambia (día 1); el de transición termina el día 24 del mes siguiente a su inicio.
    const [y, m] = shift(current, 2).split('-');
    await expect(transition).toContainText(`– 24/${m}/${y}`);
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
