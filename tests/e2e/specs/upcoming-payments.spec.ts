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
 * Próximos pagos (openspec add-upcoming-payments, tareas 6 y 7.2; TC-REPORTING-UPCOMING-013, -016, -017, -018, -019):
 * sin compromisos ni pendientes las tarjetas Q4/Q8 del Home dicen que no hay datos y ofrecen crear un compromiso (sin
 * ceros sustitutos); con cinco definiciones mensuales y un gasto pendiente la tarjeta Q8 muestra 5 de 6 pagos de la
 * semana con "y 1 pago más" y el enlace a `/pagos-proximos`; la vista completa totaliza (sin sumar el pago variable),
 * muestra el saldo proyectado rotulado como proyección y el indicador de pagos sorpresa; al aprobar un pago sale de la
 * lista en la siguiente consulta. Sin violaciones serias de axe y sin scroll horizontal en móvil.
 */

const plusDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

/** Los periodos los crea el worker de forma asíncrona (docs/33 D64): el comprometido necesita el del día de hoy. */
async function waitForPeriods(page: Page, W: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const periods = (await api(page, 'GET', `${W}/periods?limit=100`))['data'] as unknown[];
    if (periods.length > 0) return;
    if (Date.now() > deadline) throw new Error('los periodos no llegaron a tiempo');
    await page.waitForTimeout(1500);
  }
}

test.describe('Próximos pagos (reporting/cash-flow-calendar)', () => {
  test('[TC-REPORTING-UPCOMING-017] [TC-REPORTING-UPCOMING-018] [TC-REPORTING-UPCOMING-019] sin compromisos las tarjetas piden crear uno; con seis pagos en la semana la tarjeta Q8 muestra cinco y la vista completa totaliza, proyecta el saldo y refleja al instante un pago aprobado', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'proximos');
    const bank = await openAccount(page, W, 'Banco proximos', 'BANK', 'BOB', '5000.00');
    await waitForPeriods(page, W);
    const today = todayLaPaz();

    // Sin definiciones ni pendientes: Q4 y Q8 dicen que no hay datos y ofrecen crear un compromiso, sin 0,00.
    await go(page, '/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    for (const q of ['Q4', 'Q8']) {
      const card = page.getByTestId(`question-${q}`);
      await expect(card).toHaveAttribute('data-status', 'NO_DATA');
      await expect(card.getByTestId('action-hint')).toHaveAttribute('data-action', 'CREATE_COMMITMENT');
      await expect(card.getByRole('link', { name: /Crea un compromiso recurrente/ })).toHaveAttribute(
        'href',
        /\/recurring$/,
      );
      await expect(card).not.toContainText(/\d+,\d{2}/);
    }

    // Cinco definiciones mensuales (una sin monto) y un gasto pendiente de hace dos días: seis pagos en 7 días.
    const monthly = (amount: unknown, offset: number) => ({
      accountId: bank,
      amount,
      schedule: { cadence: 'MONTHLY', startDate: plusDays(today, offset) },
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    const define = (name: string, amount: unknown, offset: number) =>
      api(page, 'POST', `${W}/recurring`, { name, kind: 'EXPENSE', template: monthly(amount, offset) });
    await define('Internet', { type: 'FIXED', amount: bob('199.00') }, 2);
    await define('Luz', { type: 'ESTIMATED', amount: bob('180.00') }, 3);
    await define('Gimnasio', { type: 'MIN_MAX', min: bob('150.00'), max: bob('200.00') }, 4);
    await define('Agua', { type: 'VARIABLE' }, 5);
    await define('Spotify', { type: 'FIXED', amount: bob('40.00') }, 6);
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'PENDING',
      transactionDate: plusDays(today, -2),
      accountId: bank,
      amount: bob('300.00'),
      description: 'Cena',
    });

    // Home: Q8 lista cinco ítems (pendiente primero, por fecha), indica 1 más y enlaza a la vista completa; Q4 con total.
    await go(page, '/');
    const q8 = page.getByTestId('question-Q8');
    await expect(q8.getByTestId('upcoming-item')).toHaveCount(5);
    await expect(q8.getByTestId('upcoming-item').first()).toContainText('Cena');
    await expect(q8.getByTestId('upcoming-more')).toHaveText('y 1 pago más');
    await expect(q8).not.toContainText('NOT_AVAILABLE_IN_PHASE');
    await expect(page.getByTestId('question-Q4').getByTestId('committed-total')).toContainText(/\d/);
    expect(await seriousViolations(page)).toEqual([]);
    await q8.getByTestId('upcoming-full-link').click();
    await expect(page.getByTestId('upcoming-page')).toBeVisible();
    await expect(page).toHaveURL(/\/pagos-proximos$/);

    // Vista completa de 7 días: 300 + 199 + 180 + 200 (máximo del rango) + 40 = 919; el pago variable no suma.
    await page.getByTestId('upcoming-days').selectOption('7');
    await expect(page.getByTestId('upcoming-row')).toHaveCount(6);
    await expect(page.getByTestId('upcoming-total-consolidated')).toHaveText('919,00 BOB');
    await expect(page.getByTestId('upcoming-without-amount')).toContainText('1 pago sin monto');
    await expect(page.getByTestId('upcoming-table')).toContainText('Monto variable');
    await expect(page.getByTestId('upcoming-table')).toContainText('150,00 BOB a 200,00 BOB');
    await expect(page.getByTestId('upcoming-table')).toContainText('180,00 BOB (estimado)');

    // Saldo proyectado: 5.000,00 contable menos 300,00 pendiente, rotulado como proyección.
    const projected = page.getByTestId('projected-balances');
    await expect(projected).toContainText('Proyección: saldo contable más ingresos pendientes');
    const row = projected.locator('[data-testid="projected-row"]', { hasText: 'Banco proximos' });
    await expect(row).toContainText('5.000,00 BOB');
    await expect(row.getByTestId('projected-amount')).toHaveText('4.700,00 BOB');

    // Indicador de pagos sorpresa del periodo (sin ninguno) y su limitación.
    await expect(page.getByTestId('surprise-count')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('surprise-note')).toContainText('Solo se detectan los pagos vinculados');
    expect(await seriousViolations(page)).toEqual([]);

    // Aprobar "Internet" (monto real 205,50) y consultar de inmediato: sale de la lista y el total baja.
    const occurrences = (await api(page, 'GET', `${W}/recurring/occurrences?days=7&limit=100`))['data'] as {
      id: string;
      definitionName: string;
    }[];
    const internet = occurrences.find((o) => o.definitionName === 'Internet')!;
    await api(page, 'POST', `${W}/recurring/occurrences/${internet.id}/materialize`, {
      amount: bob('205.50'),
    });
    await go(page, '/pagos-proximos');
    await page.getByTestId('upcoming-days').selectOption('7');
    await expect(page.getByTestId('upcoming-row')).toHaveCount(5);
    await expect(page.getByTestId('upcoming-table')).not.toContainText('Internet');
    await expect(page.getByTestId('upcoming-total-consolidated')).toHaveText('720,00 BOB');

    // Móvil: sin scroll horizontal (NFR-USAB-006) en la vista completa y en el Home.
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/pagos-proximos');
    await expect(page.getByTestId('upcoming-page')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await go(page, '/');
    await expect(page.getByTestId('question-Q8')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
