import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Metas de ahorro (openspec add-savings-goals 7.3; TC-GOALS-SAVINGS-001, -009, -012, -013, -046, -047): el owner registra
 * el fondo de emergencia con su cuenta de ahorro (aporte real) y una compra con dinero apartado en el banco (reserva), ve
 * el estado calculado en `/goals`, las reservas por cuenta y la tarjeta Q9 del Home; un workspace sin metas ofrece
 * crear la primera sin mostrar 0 %.
 */
const plusDays = (from: string, days: number): string => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

test.describe('Metas de ahorro (goals/savings-goals)', () => {
  test('[TC-GOALS-SAVINGS-001] [TC-GOALS-SAVINGS-009] [TC-GOALS-SAVINGS-012] [TC-GOALS-SAVINGS-013] [TC-GOALS-SAVINGS-046] fondo de emergencia con aporte real, compra con reserva, reservas por cuenta y Q9 del Home', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'metas');
    const banco = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '8000.00');
    const ahorro = await openAccount(page, W, 'Ahorro BOB', 'SAVINGS', 'BOB', '0.00');
    const today = todayLaPaz();

    // Q9 sin metas: ofrece crear la primera, sin 0 %.
    await go(page, '/');
    await expect(page.getByTestId('question-Q9')).toHaveAttribute('data-status', 'NO_DATA');
    await expect(page.getByTestId('home-create-goal')).toHaveAttribute('data-action', 'CREATE_GOAL');

    // Alta del fondo de emergencia por el formulario.
    await go(page, '/goals/nuevo');
    await page.getByTestId('goal-name').fill('Fondo de emergencia');
    await page.getByTestId('goal-target').fill('15000.00');
    await page.getByTestId('goal-start-date').fill(today);
    await page.getByTestId('goal-target-date-input').fill(plusDays(today, 180));
    await page.locator(`[data-testid="goal-account"][data-account-id="${ahorro}"]`).check();
    await page.getByTestId('goal-submit').click();
    await expect(page.getByTestId('goal-detail')).toHaveAttribute('data-status', 'ACTIVE');
    const goalId = page.url().match(/\/goals\/([0-9a-f-]{36})/)![1]!;

    // Aporte real de 1000.00 BOB del banco al ahorro: la transferencia nace con origen GOAL.
    await page.getByTestId('goal-contribute').click();
    await page.getByTestId('contribute-fund-REAL').check();
    await page.getByTestId('goal-contribute-amount').fill('1000.00');
    await page.getByTestId('goal-contribute-source').selectOption(banco);
    await page.getByTestId('goal-contribute-destination').selectOption(ahorro);
    await page.getByTestId('goal-contribute-form-submit').click();
    await expect(page.getByTestId('goal-remaining')).toContainText('14.000,00');
    const goal = await api(page, 'GET', `${W}/goals/${goalId}`);
    expect((goal['progress'] as { percent: string }).percent).toBe('6.67');
    const movements = (await api(page, 'GET', `${W}/goals/${goalId}/movements`))['data'] as {
      transactionId: string;
    }[];
    const tx = await api(page, 'GET', `${W}/transactions/${movements[0]!.transactionId}`);
    expect(tx['source']).toBe('GOAL');

    // Compra con dinero apartado en la cuenta corriente: reserva sin ledger.
    const laptop = await api(page, 'POST', `${W}/goals`, {
      name: 'Laptop',
      type: 'PURCHASE',
      target: bob('9000.00'),
      priority: 2,
    });
    const reserved = await api(page, 'POST', `${W}/goals/${laptop['id']}/contributions`, {
      fund: 'EARMARK',
      amount: bob('2000.00'),
      sourceAccountId: banco,
    });
    expect((reserved as { fund: string }).fund).toBe('EARMARK');

    // Listado con el estado calculado.
    await go(page, '/goals');
    await expect(page.getByTestId('goal-row')).toHaveCount(2);
    const row = page.locator('[data-testid="goal-row"][data-name="Fondo de emergencia"]');
    await expect(row.getByTestId('goal-progress-text')).toContainText('6,67');
    await expect(row.getByTestId('goal-status')).toBeVisible();

    // Reservas por cuenta: el banco tiene 2000.00 reservados de 7000.00.
    await go(page, '/goals/reservas');
    const bankRow = page.locator(`[data-testid="reservation-row"][data-account-id="${banco}"]`);
    await expect(bankRow.getByTestId('reservation-reserved')).toContainText('2.000,00');
    await expect(bankRow.getByTestId('reservation-available')).toContainText('5.000,00');

    // Home: tarjeta Q9 con ambas metas; Q5 sigue sin estar disponible.
    await go(page, '/');
    await expect(page.getByTestId('question-Q9')).toHaveAttribute('data-status', 'AVAILABLE');
    await expect(page.getByTestId('home-goal')).toHaveCount(2);

    await context.close();
  });
});
