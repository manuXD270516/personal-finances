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
  userCategories,
} from '../src/finance.js';
import { bff } from '../src/helpers.js';

/**
 * Intereses y cargos de una tarjeta (openspec add-card-interest-ledger-portions 7.3; TC-DEBT-CARD-043, -047, -048, -049 y
 * TC-REPORTING-REPORTS-058): "Visa Oro" con un estado de cuenta emitido y un saldo facturado del banco 4,80 BOB mayor que
 * el del sistema. La UI propone registrar la diferencia como cargo; el usuario la reparte en 4,00 de interés y 0,80 de
 * seguro, la diferencia con el banco queda en cero, el reporte de comisiones lo cuenta como "tarjetas" y, al anularlo con
 * un motivo, el cargo desaparece del estado de cuenta y del reporte y la deuda vuelve a su valor.
 *
 * Las fechas se calculan desde "hoy" en America/La_Paz: cierre 3 días atrás y vencimiento dentro de 10 días, de modo que el
 * ciclo cerrado se emite al registrar la tarjeta (el job `debt.card-daily` corre cada minuto en este stack).
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
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

async function eventually<T>(
  page: Page,
  read: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() > deadline) throw new Error('el efecto no llegó a tiempo');
    await page.waitForTimeout(1500);
  }
}

interface StatementRow {
  id: string | null;
  version: number | null;
  closingDate: string;
  charges?: { id: string; total: { amount: string } }[];
}

test.describe('Intereses y cargos de la tarjeta (debt/credit-cards)', () => {
  test('[TC-DEBT-CARD-043] [TC-DEBT-CARD-047] [TC-DEBT-CARD-048] [TC-DEBT-CARD-049] [TC-REPORTING-REPORTS-058] registrar la diferencia con el banco como cargo, verlo en el reporte de comisiones y anularlo', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'cargos');
    const today = todayLaPaz();
    await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const visa = await openAccount(page, W, 'Visa Oro', 'CREDIT_CARD', 'BOB');
    const [food] = await userCategories(page, W, 'EXPENSE');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: plusDays(today, -10),
      accountId: visa,
      amount: bob('1200.00'),
      description: 'Compra con tarjeta',
      splits: [{ amount: bob('1200.00'), categoryId: food!.id }],
    });
    const closing = plusDays(today, -3);
    const card = await api(page, 'POST', `${W}/credit-cards`, {
      name: 'Visa Oro',
      accounts: [
        { accountId: visa, creditLimit: bob('15000.00'), minimumRule: { type: 'PERCENT', percent: '5.00' } },
      ],
      statementDay: Number(closing.slice(8)),
      dueDay: Number(plusDays(today, 10).slice(8)),
    });
    const cardId = String(card['id']);
    const statementsOf = async () =>
      (await api(page, 'GET', `${W}/credit-cards/${cardId}/statements`))['data'] as StatementRow[];
    const issued = (await eventually(page, statementsOf, (list) => list.some((s) => s.id !== null))).find(
      (s) => s.id !== null,
    )!;

    // El banco informa 4,80 más que el sistema.
    const patched = await bff(
      page,
      'PATCH',
      `/api/bff/v1${W}/credit-cards/${cardId}/statements/${issued.id}`,
      {
        body: { reportedBilledBalance: bob('1204.80') },
        contentType: 'application/json',
        headers: { 'if-match': `"${String(issued.version)}"` },
      },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    // La UI propone registrar la diferencia como cargo y el usuario la reparte en componentes.
    await go(page, `/debts/tarjetas/${cardId}?statementId=${String(issued.id)}`);
    const proposal = page.getByTestId('charge-proposal');
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('4,80 BOB');
    await proposal.getByTestId('charge-proposal-use').click();
    const form = page.getByTestId('charge-form');
    await expect(form.getByTestId('charge-date')).toHaveValue(closing);
    await form.getByTestId('charge-interest').fill('4,00');
    await form.getByTestId('charge-insurance').fill('0,80');
    await expect(form.getByTestId('charge-total')).toHaveText('Total del cargo: 4,80 BOB');
    expect(await seriousViolations(page)).toEqual([]);
    await form.getByTestId('charge-save').click();

    const row = page.getByTestId('charge-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('charge-row-total')).toHaveText('4,80 BOB');
    await expect(page.getByTestId('statement-reported-difference')).toHaveText('Sin diferencia');
    await expect(page.getByTestId('charge-proposal')).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // La deuda subió 4,80 y el cargo es un gasto administrado por la tarjeta con una porción por componente.
    const charges = (await api(page, 'GET', `${W}/credit-cards/${cardId}/charges`))['items'] as {
      id: string;
      transactionId: string;
      version: number;
    }[];
    expect(charges).toHaveLength(1);
    const tx = await api(page, 'GET', `${W}/transactions/${charges[0]!.transactionId}`);
    expect(tx).toMatchObject({ kind: 'EXPENSE', debtRole: 'CARD_CHARGE', debtCardId: cardId });
    expect((tx['splits'] as { amount: { amount: string } }[]).map((s) => s.amount.amount).sort()).toEqual([
      '0.80',
      '4.00',
    ]);
    await go(page, `/transacciones/${charges[0]!.transactionId}`);
    await expect(page.getByTestId('tx-card-charge')).toBeVisible();
    await expect(page.getByTestId('tx-card-charge-link')).toHaveText('Visa Oro');

    // El reporte de comisiones lo cuenta en "tarjetas".
    await go(page, '/reportes/comisiones');
    const fees = (await api(page, 'GET', `${W}/reports/fees?from=${plusDays(today, -30)}&to=${today}`)) as {
      months: { byType: { type: string; amount: { consolidated: { amount: string } } }[] }[];
    };
    const cardAmounts = fees.months
      .flatMap((m) => m.byType)
      .filter((b) => b.type === 'CARD')
      .map((b) => b.amount.consolidated.amount)
      .filter((amount) => amount !== '0.00');
    expect(cardAmounts).toEqual(['4.80']);
    await expect(page.getByTestId('report-fees')).toContainText('4,80 BOB');

    // Anular el cargo con un motivo: desaparece del estado de cuenta y del reporte.
    await go(page, `/debts/tarjetas/${cardId}?statementId=${String(issued.id)}`);
    await page.getByTestId('charge-void').click();
    const panel = page.getByTestId('charge-void-panel');
    await expect(panel.getByRole('button', { name: 'Anular cargo' })).toBeDisabled();
    await panel.getByTestId('charge-void-reason').fill('monto equivocado');
    await panel.getByRole('button', { name: 'Anular cargo' }).click();
    await expect(
      page.locator(`[data-statement-id="${String(issued.id)}"]`).getByTestId('charges-empty'),
    ).toBeVisible();
    const after = await eventually(
      page,
      async () =>
        (await api(page, 'GET', `${W}/credit-cards/${cardId}/charges?status=VOIDED`))['items'] as {
          voidReason: string;
        }[],
      (list) => list.length === 1,
    );
    expect(after[0]!.voidReason).toBe('monto equivocado');
    const feesAfter = (await api(
      page,
      'GET',
      `${W}/reports/fees?from=${plusDays(today, -30)}&to=${today}`,
    )) as { months: { byType: { type: string; amount: { consolidated: { amount: string } } }[] }[] };
    expect(
      feesAfter.months
        .flatMap((m) => m.byType)
        .filter((b) => b.type === 'CARD')
        .every((b) => b.amount.consolidated.amount === '0.00'),
    ).toBe(true);
    await context.close();
  });
});
