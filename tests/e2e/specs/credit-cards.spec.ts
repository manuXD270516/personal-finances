import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  accountRow,
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Tarjetas de crédito (openspec add-credit-cards 7.1 y 7.2; TC-DEBT-CARD-001, -015, -017, -018, -032):
 *
 * - Exit criterion de Phase 4 (7.1): "Visa Oro" se registra por el asistente de la UI sobre una cuenta `credit_card` con
 *   una compra de 1.200,00 BOB; el último ciclo cerrado ya está emitido (vence en 10 días) y se paga con una transferencia
 *   desde "Banco BOB" que el formulario sugiere ("Total para no generar intereses"). El pago NO es gasto: el gasto del
 *   mes, el ahorro y el patrimonio no cambian y el estado de cuenta queda pagado.
 * - Plan de pago (7.2): activarlo con una transferencia recurrente "Pago Visa" activa hacia la tarjeta se rechaza y la UI
 *   dice cuál terminar; tras terminarla se activa, los dos pagos del plan aparecen en Próximos pagos (el del ciclo emitido
 *   con el monto exacto y el del ciclo abierto como estimado) y la ocurrencia del estado emitido se aprueba por el monto
 *   exacto, que deja el estado de cuenta pagado.
 *
 * Las fechas se calculan desde "hoy" en America/La_Paz: cierre 3 días atrás y vencimiento dentro de 10 días, de modo que el
 * ciclo cerrado se emite al registrar la tarjeta (el job `debt.card-daily` corre cada minuto en este stack y es la red de
 * seguridad) sin depender del reloj real.
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

/** Cierre 3 días atrás (día del mes) y vencimiento en 10 días. */
function calendar(today: string) {
  return {
    statementDay: Number(plusDays(today, -3).slice(8)),
    dueDay: Number(plusDays(today, 10).slice(8)),
    dueDate: plusDays(today, 10),
  };
}

/** Espera (recargando datos por la API) a que `check` se cumpla: los efectos entre contextos son asíncronos. */
async function eventually<T>(
  page: Page,
  read: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 60_000,
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
  accountId: string;
  status: string;
  dueDate: string;
  remainingNoInterest: { amount: string };
  noInterestPayment: { amount: string };
  minimumDue: { amount: string };
}

const statementsOf = async (page: Page, W: string, cardId: string): Promise<StatementRow[]> =>
  (await api(page, 'GET', `${W}/credit-cards/${cardId}/statements`))['data'] as StatementRow[];

const cardInput = (accountId: string, today: string, over: Record<string, unknown> = {}) => ({
  name: 'Visa Oro',
  accounts: [
    {
      accountId,
      creditLimit: bob('15000.00'),
      minimumRule: { type: 'PERCENT', percent: '5.00' },
    },
  ],
  statementDay: calendar(today).statementDay,
  dueDay: calendar(today).dueDay,
  ...over,
});

test.describe('Tarjetas de crédito (debt/credit-cards)', () => {
  test('[TC-DEBT-CARD-001] [TC-DEBT-CARD-015] registrar Visa Oro, ver su estado de cuenta emitido y pagarlo con una transferencia desde Banco BOB: no es gasto y el estado queda pagado', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'tarjeta');
    const today = todayLaPaz();
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const visa = await openAccount(page, W, 'Visa Oro', 'CREDIT_CARD', 'BOB');
    const [food] = await userCategories(page, W, 'EXPENSE');
    const [salary] = await userCategories(page, W, 'INCOME');

    // Ingreso y gasto del mes para que el Home tenga gasto y ahorro; la compra de 1.200,00 BOB con la tarjeta cae en el
    // ciclo ya cerrado (hace 10 días).
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'INCOME',
      transactionDate: today,
      accountId: bank,
      amount: bob('5000.00'),
      splits: [{ amount: bob('5000.00'), categoryId: salary!.id }],
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('100.00'),
      splits: [{ amount: bob('100.00'), categoryId: food!.id }],
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: plusDays(today, -10),
      accountId: visa,
      amount: bob('1200.00'),
      description: 'Compra con tarjeta',
      splits: [{ amount: bob('1200.00'), categoryId: food!.id }],
    });

    // Pestaña Tarjetas vacía y alta por el asistente en pasos (accesible, sin violaciones serias).
    await go(page, '/debts?vista=tarjetas');
    await expect(page.getByTestId('cards-empty')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('new-card').click();
    await expect(page.getByTestId('card-form-page')).toBeVisible();
    await expect(page.getByTestId('card-step-title')).toHaveText('Cuentas');
    await page.getByTestId('card-name').fill('Visa Oro');
    await page.getByTestId(`card-account-${visa}`).check();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('card-next').click();
    await expect(page.getByTestId('card-step-title')).toHaveText('Límites y pago mínimo');
    await page.getByTestId('card-limit-BOB').fill('15000');
    await page.getByTestId('card-percent-BOB').fill('5');
    await page.getByTestId('card-floor-BOB').fill('50');
    await page.getByTestId('card-next').click();
    await expect(page.getByTestId('card-step-title')).toHaveText('Cierre, vencimiento y alertas');
    // Un día fuera de rango no deja avanzar.
    await page.getByTestId('card-statement-day').fill('32');
    await page.getByTestId('card-due-day').fill(String(calendar(today).dueDay));
    await page.getByTestId('card-next').click();
    await expect(page.getByTestId('field-error').first()).toBeVisible();
    await page.getByTestId('card-statement-day').fill(String(calendar(today).statementDay));
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('card-next').click();
    await expect(page.getByTestId('card-step-title')).toHaveText('Plan de pago (opcional)');
    await page.getByTestId('card-submit').click();

    // Detalle: la tarjeta ya emitió el estado de cuenta del último cierre.
    await expect(page.getByTestId('card-detail')).toBeVisible();
    const cardId = page.url().match(/\/debts\/tarjetas\/([0-9a-f-]{36})/)![1]!;
    await expect(page.getByTestId('open-cycle')).toHaveAttribute('data-currency', 'BOB');
    await expect(page.getByTestId('detail-balance')).toHaveText('1.200,00 BOB');
    await expect(page.getByTestId('utilization-text')).toContainText('8,00 %');
    await expect(page.getByTestId('utilization-bar')).toHaveAttribute('role', 'progressbar');
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('tab', { name: 'Estados de cuenta' }).click();
    const issued = page.locator('[data-testid="statement"][data-status="ISSUED"]');
    await expect(issued).toHaveCount(1);
    await expect(issued.getByTestId('statement-no-interest')).toHaveText('1.200,00 BOB');
    await expect(issued.getByTestId('statement-minimum')).toHaveText('60,00 BOB');
    await expect(issued.getByTestId('statement-status')).toContainText('Emitido');
    expect(await seriousViolations(page)).toEqual([]);

    // Listado: utilización en texto y barra, próximo vencimiento y lo que falta.
    await go(page, '/debts?vista=tarjetas');
    const item = page.locator('[data-testid="card-item"][data-name="Visa Oro"]');
    await expect(item.getByTestId('card-used')).toHaveText('1.200,00 BOB');
    await expect(item.getByTestId('card-missing')).toContainText('1.200,00 BOB');
    await expect(item.getByTestId('card-next-due')).toHaveText(
      calendar(today).dueDate.split('-').reverse().join('/'),
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Antes del pago: gasto del mes, ahorro y patrimonio del Home.
    await go(page, '/');
    const before = {
      expense: await page.getByTestId('expense-amount').innerText(),
      savings: await page.getByTestId('savings-amount').innerText(),
      netWorth: await page.getByTestId('net-worth-amount').innerText(),
    };

    // Pagar desde Banco BOB: el formulario reconoce la tarjeta y sugiere el total sin intereses.
    await go(page, `/transferencias/nueva?pagoTarjeta=1&origen=${bank}&destino=${visa}`);
    const pay = page.getByTestId('transfer-form');
    await expect(pay.getByTestId('card-payment-label')).toHaveText('Pago de tarjeta');
    await expect(pay.getByTestId('card-suggest-minimum')).toContainText('60,00 BOB');
    await pay.getByTestId('card-suggest-noInterest').click();
    await expect(pay.getByLabel('Monto (BOB)')).toHaveValue('1200.00');
    expect(await seriousViolations(page)).toEqual([]);
    await pay.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-kind', 'TRANSFER');

    // El estado de cuenta queda pagado (API y UI) y lo que falta es cero.
    const paid = await eventually(
      page,
      () => statementsOf(page, W, cardId),
      (rows) => rows.some((s) => s.id !== null && s.status === 'PAID'),
    );
    expect(paid.find((s) => s.id !== null)!.remainingNoInterest.amount).toBe('0.00');
    await go(page, `/debts/tarjetas/${cardId}`);
    await page.getByRole('tab', { name: 'Estados de cuenta' }).click();
    // Los ciclos anteriores sin saldo también salen `PAID` (se calculan en lectura): el emitido es el más reciente.
    const latestPaid = page.locator('[data-testid="statement"][data-status="PAID"]').first();
    await expect(latestPaid.getByTestId('statement-status')).toContainText('Pagado');

    // Exit criterion: pagar la tarjeta no es gasto; ni el gasto del mes, ni el ahorro, ni el patrimonio cambian.
    await go(page, '/');
    await expect(page.getByTestId('expense-amount')).toHaveText(before.expense);
    await expect(page.getByTestId('savings-amount')).toHaveText(before.savings);
    await expect(page.getByTestId('net-worth-amount')).toHaveText(before.netWorth);
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Banco BOB').getByTestId('account-balance')).toHaveText('13.700,00 BOB');
    await expect(accountRow(page, 'Visa Oro').getByTestId('account-balance')).toHaveText('Adeuda 0,00 BOB');
    await context.close();
  });

  test('[TC-DEBT-CARD-017] [TC-DEBT-CARD-018] [TC-DEBT-CARD-032] activar el plan de pago con "Pago Visa" activo se rechaza y se indica cuál terminar; tras terminarla se activa, los pagos aparecen en Próximos pagos (estimado y exacto) y se aprueba el del estado emitido por el monto exacto', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'plan');
    const today = todayLaPaz();
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const visa = await openAccount(page, W, 'Visa Oro', 'CREDIT_CARD', 'BOB');
    const [food] = await userCategories(page, W, 'EXPENSE');
    const purchase = (date: string, amount: string) =>
      api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: date,
        accountId: visa,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: food!.id }],
      });
    // 1.200,00 en el ciclo ya cerrado (emitido) y 300,00 de hoy en el ciclo abierto (base del estimado).
    await purchase(plusDays(today, -10), '1200.00');
    await purchase(today, '300.00');

    // La transferencia recurrente que el owner ya tenía cargada a mano hacia la tarjeta.
    const manual = await api(page, 'POST', `${W}/recurring`, {
      name: 'Pago Visa',
      kind: 'TRANSFER',
      template: {
        accountId: bank,
        toAccountId: visa,
        amount: { type: 'FIXED', amount: bob('500.00') },
        schedule: { cadence: 'MONTHLY', startDate: plusDays(today, 5) },
        materialization: { mode: 'PENDING_APPROVAL' },
      },
    });
    const card = await api(page, 'POST', `${W}/credit-cards`, cardInput(visa, today));
    const cardId = String(card['id']);

    // Activar el plan por la UI: 409 con la definición a terminar.
    await go(page, `/debts/tarjetas/${cardId}`);
    await page.getByRole('tab', { name: 'Plan de pago' }).click();
    const section = page.getByTestId('plan-section');
    await expect(section).toHaveAttribute('data-enabled', 'false');
    await section.getByTestId('plan-edit').click();
    await section.getByTestId('plan-source').selectOption(bank);
    await section.getByTestId('plan-save').click();
    const conflict = section.getByTestId('plan-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict.getByTestId('plan-conflict-link')).toHaveText('Pago Visa');
    await expect(conflict.getByTestId('plan-conflict-link')).toHaveAttribute(
      'href',
      new RegExp(`/recurring/${String(manual['id'])}$`),
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Terminar "Pago Visa" y volver a activar: ahora sí.
    const definition = await api(page, 'GET', `${W}/recurring/${String(manual['id'])}`);
    await api(
      page,
      'POST',
      `${W}/recurring/${String(manual['id'])}/end`,
      {},
      {
        'if-match': `"${String(definition['version'])}"`,
      },
    );
    await section.getByTestId('plan-save').click();
    await expect(page.getByTestId('card-status-message')).toHaveText('Pago automático activado.');
    await expect(page.getByTestId('plan-section')).toHaveAttribute('data-enabled', 'true');
    await expect(page.getByTestId('plan-source-name')).toHaveText('Banco BOB');
    expect(await seriousViolations(page)).toEqual([]);

    // Próximos pagos (60 días): el pago del estado emitido (exacto) y el del ciclo abierto (estimado, 300,00).
    const planned = await api(page, 'GET', `${W}/credit-cards/${cardId}`);
    const definitionId = String(
      (planned['accounts'] as { paymentPlan: { definitionId: string } }[])[0]!.paymentPlan.definitionId,
    );
    const occurrences = await eventually(
      page,
      async () =>
        (await api(page, 'GET', `${W}/recurring/${definitionId}/occurrences?limit=100`))['data'] as {
          id: string;
          kind: string;
          managedBy: string;
          dueDate: string;
          status: string;
          expected: { type: string; amount?: { amount: string } };
        }[],
      (rows) => rows.filter((o) => o.expected.amount !== undefined).length >= 2,
    );
    const open = occurrences
      .filter((o) => o.status !== 'CANCELLED')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    expect(open[0]).toMatchObject({
      kind: 'CARD_PAYMENT',
      managedBy: 'DEBT',
      dueDate: calendar(today).dueDate,
      expected: { type: 'FIXED', amount: bob('1200.00') },
    });
    expect(open[1]).toMatchObject({
      kind: 'CARD_PAYMENT',
      expected: { type: 'ESTIMATED', amount: bob('300.00') },
    });

    await go(page, '/pagos-proximos');
    await page.getByTestId('upcoming-days').selectOption('60');
    const rows = page.getByTestId('upcoming-row').filter({ has: page.getByTestId('card-payment-item') });
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByTestId('card-payment-item')).toHaveText('Pago de tarjeta · Visa Oro');
    await expect(rows.first()).toContainText('1.200,00 BOB');
    await expect(rows.first().getByTestId('card-payment-estimated')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText('300,00 BOB (estimado)');
    await expect(rows.nth(1).getByTestId('card-payment-estimated')).toBeVisible();
    await expect(rows.first().getByTestId('card-payment-link')).toHaveAttribute(
      'href',
      new RegExp(`/debts/tarjetas/${cardId}$`),
    );
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // La definición es administrada por la tarjeta: la UI no ofrece pausar ni terminar y enlaza a la tarjeta.
    await go(page, `/recurring/${definitionId}`);
    await expect(page.getByTestId('managed-by-card')).toBeVisible();
    await expect(page.getByTestId('definition-card-link')).toHaveAttribute(
      'href',
      new RegExp(`/debts/tarjetas/${cardId}$`),
    );
    await expect(page.getByTestId('pause-definition')).toHaveCount(0);
    await expect(page.getByTestId('end-definition')).toHaveCount(0);

    // La ocurrencia del estado emitido se aprueba por el monto exacto (la acción sí está permitida) y paga el estado.
    await go(page, `/recurring/occurrences/${open[0]!.id}`);
    await expect(page.getByTestId('occurrence-card-link')).toHaveAttribute(
      'href',
      new RegExp(`/debts/tarjetas/${cardId}$`),
    );
    const approved = await api(page, 'POST', `${W}/recurring/occurrences/${open[0]!.id}/materialize`, {});
    const transfer = await api(page, 'GET', `${W}/transactions/${String(approved['transactionId'])}`);
    expect(transfer['kind']).toBe('TRANSFER');
    expect(transfer['amount']).toEqual(bob('1200.00'));
    const statements = await eventually(
      page,
      () => statementsOf(page, W, cardId),
      (list) => list.some((s) => s.id !== null && s.status === 'PAID'),
    );
    expect(statements.find((s) => s.id !== null)!.remainingNoInterest.amount).toBe('0.00');
    await context.close();
  });
});
