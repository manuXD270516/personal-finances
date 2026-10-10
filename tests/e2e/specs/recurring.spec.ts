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
 * Pagos recurrentes (openspec add-recurrence-engine 8.1; TC-COMMITMENTS-RECUR-021, -023, -031, -034, -036):
 *
 * - Prueba 1: se crea "Internet" mensual en aprobación pendiente por la UI; el worker la pasa a "Próxima/Atrasada" y
 *   aparece en Por aprobar (con el contador de la sidebar); se aprueba con el monto real (gasto POSTED de 205,50) y sale
 *   de la bandeja; al anular el gasto el consumidor la libera y vuelve a la bandeja.
 * - Prueba 2: "Alquiler" se revisa "desde enero" (versión 2 sin tocar la historia) y la tarjeta "Comprometido del periodo"
 *   suma alquiler + máximo del gimnasio (rango) + gasto pendiente e informa el pago sin monto.
 *
 * Las ocurrencias pasan a "próxima" y se liberan por procesos en segundo plano (worker y consumidores): las esperas
 * recargan la pantalla hasta que el efecto aparece.
 */
const TRAY = '[data-testid="occurrences-tray"]';

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

/** Abre `/recurring` en la pestaña Por aprobar y recarga hasta que `check` se cumpla. */
async function eventuallyInTray(
  page: Page,
  check: () => Promise<boolean>,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await go(page, '/recurring');
    await page.getByRole('tab', { name: /^Por aprobar/ }).click();
    await expect(page.locator(`${TRAY} [aria-busy="true"]`)).toHaveCount(0);
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('la bandeja no llegó al estado esperado a tiempo');
    await page.waitForTimeout(1500);
  }
}

const trayRow = (page: Page, name: string) =>
  page.locator(`${TRAY} [data-testid="occurrence-row"][data-name="${name}"]`);

interface OccurrenceRow {
  id: string;
  definitionName: string;
  status: string;
  transactionId: string | null;
}

async function occurrencesOf(page: Page, W: string, name: string): Promise<OccurrenceRow[]> {
  const r = await api(page, 'GET', `${W}/recurring/occurrences?days=90&limit=100`);
  const all = (r['data'] as OccurrenceRow[]).filter((o) => o.definitionName === name);
  const done = await api(page, 'GET', `${W}/recurring/occurrences?status=MATERIALIZED&limit=100`);
  return [...all, ...(done['data'] as OccurrenceRow[]).filter((o) => o.definitionName === name)];
}

test.describe('Pagos recurrentes', () => {
  test('[TC-COMMITMENTS-RECUR-021] [TC-COMMITMENTS-RECUR-023] [TC-COMMITMENTS-RECUR-031] "Internet" mensual en aprobación pendiente: por aprobar, se aprueba con el monto real y al anular el gasto se libera', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'recurrentes');
    await openAccount(page, W, 'Banco recurrentes', 'BANK', 'BOB', '5000.00');
    const today = todayLaPaz();

    // Alta por la UI: estimado 199,00 BOB, mensual desde hoy, aprobación pendiente (por omisión).
    await go(page, '/recurring');
    await expect(page.getByRole('heading', { level: 1, name: 'Pagos recurrentes' })).toBeVisible();
    await page.getByRole('tab', { name: 'Definiciones' }).click();
    await page.getByTestId('new-definition').click();
    const form = page.getByTestId('definition-form');
    await form.getByLabel('Nombre', { exact: true }).fill('Internet');
    await form.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Banco recurrentes (BOB)' });
    await form.getByLabel('Tipo de monto').selectOption('ESTIMATED');
    await form.getByLabel('Monto (BOB)').fill('199,00');
    await form.getByLabel('Fecha de inicio').fill(today);
    // Vista previa de las próximas 6 fechas, calculada en el cliente.
    await expect(form.locator('[data-testid="preview-dates"] li')).toHaveCount(6);
    await expect(form.getByLabel('Aprobación pendiente')).toBeChecked();
    await form.getByTestId('definition-submit').click();
    await expect(page.getByTestId('recurring-status')).toContainText('Creaste «Internet»');
    await expect(page.locator('[data-testid="definition-row"][data-name="Internet"]')).toHaveAttribute(
      'data-status',
      'ACTIVE',
    );

    // El worker la pasa a próxima/atrasada: aparece en Por aprobar y en el contador de la sidebar.
    await eventuallyInTray(page, async () => (await trayRow(page, 'Internet').count()) === 1);
    expect(['DUE', 'OVERDUE']).toContain(await trayRow(page, 'Internet').getAttribute('data-status'));
    await expect(page.getByTestId('recurring-approval-count')).toHaveText('1');
    expect(await seriousViolations(page)).toEqual([]);

    // Aprobar con el monto real: crea el gasto POSTED y sale de la bandeja.
    await trayRow(page, 'Internet')
      .getByRole('button', { name: /^Aprobar Internet/ })
      .click();
    const panel = page.getByTestId('approve-panel');
    await expect(panel).toBeFocused();
    await panel.getByLabel('Monto real (BOB)').fill('205,50');
    await panel.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(page.getByTestId('recurring-status')).toContainText('Aprobaste Internet');
    await expect(trayRow(page, 'Internet')).toHaveCount(0);

    const [materialized] = await occurrencesOf(page, W, 'Internet').then((all) =>
      all.filter((o) => o.status === 'MATERIALIZED'),
    );
    expect(materialized?.transactionId).toBeTruthy();
    const expense = await api(page, 'GET', `${W}/transactions/${String(materialized!.transactionId)}`);
    expect(expense['status']).toBe('POSTED');
    expect(expense['source']).toBe('RECURRING');
    expect(expense['amount']).toEqual(bob('205.50'));

    // Anular el gasto libera la ocurrencia (consumidor `commitments.transaction-voided`): vuelve a la bandeja.
    await api(
      page,
      'POST',
      `${W}/transactions/${String(expense['id'])}/void`,
      { reason: 'Cobro duplicado' },
      { 'if-match': `"${String(expense['version'])}"` },
    );
    await eventuallyInTray(page, async () => (await trayRow(page, 'Internet').count()) === 1);
    expect(['DUE', 'OVERDUE']).toContain(await trayRow(page, 'Internet').getAttribute('data-status'));
    const released = await api(page, 'GET', `${W}/recurring/occurrences/${materialized!.id}`);
    expect(released['transactionId']).toBeNull();
    expect(['DUE', 'OVERDUE']).toContain(released['status']);

    // Detalle de la ocurrencia (enlace de las notificaciones) con su recorrido.
    await go(page, `/recurring/occurrences/${materialized!.id}`);
    await expect(page.getByTestId('occurrence-detail')).toBeVisible();
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    expect(await seriousViolations(page)).toEqual([]);
    await context.close();
  });

  test('[TC-COMMITMENTS-RECUR-034] [TC-COMMITMENTS-RECUR-036] "Alquiler" revisado desde enero: versión 2 sin tocar la historia y el comprometido del periodo suma ocurrencias y pendientes', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'comprometido');
    const bank = await openAccount(page, W, 'Banco alquiler', 'BANK', 'BOB', '20000.00');
    await waitForPeriods(page, W);
    const today = todayLaPaz();
    const template = (amount: unknown) => ({
      accountId: bank,
      amount,
      schedule: { cadence: 'MONTHLY', startDate: today },
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    const rent = await api(page, 'POST', `${W}/recurring`, {
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: template({ type: 'FIXED', amount: bob('3500.00') }),
    });
    await api(page, 'POST', `${W}/recurring`, {
      name: 'Gimnasio',
      kind: 'EXPENSE',
      template: template({ type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') }),
    });
    await api(page, 'POST', `${W}/recurring`, {
      name: 'Taxi',
      kind: 'EXPENSE',
      template: template({ type: 'VARIABLE' }),
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'PENDING',
      transactionDate: today,
      accountId: bank,
      amount: bob('250.00'),
      description: 'Gasto pendiente manual',
    });

    // 3.500 (alquiler) + 180 (máximo del rango) + 250 (pendiente) = 3.930; el taxi no suma y se informa.
    await go(page, '/recurring');
    const card = page.getByTestId('committed-card');
    await expect(card.getByTestId('committed-total')).toHaveText('3.930,00 BOB');
    await expect(card.getByTestId('committed-by-currency')).toContainText('3.930,00 BOB');
    await expect(card.getByTestId('committed-without-amount')).toContainText('1 pago sin monto');
    await expect(card).toHaveAttribute('data-complete', 'true');
    await card.getByText(/^Ver el desglose/).click();
    await expect(card.getByTestId('committed-breakdown')).toContainText('Alquiler');
    await expect(card.getByTestId('committed-breakdown')).toContainText('Gasto pendiente');

    // "Cambiar esta y las siguientes" desde enero del año próximo: versión 2, la historia no cambia.
    const nextJanuary = `${Number(today.slice(0, 4)) + 1}-01-01`;
    await page.getByRole('tab', { name: 'Definiciones' }).click();
    await page
      .locator('[data-testid="definition-row"][data-name="Alquiler"]')
      .getByTestId('definition-link')
      .click();
    await expect(page.getByTestId('definition-detail')).toBeVisible();
    await expect(page.getByTestId('version-row')).toHaveCount(1);
    await page.getByTestId('revise-definition').click();
    const revise = page.getByTestId('definition-form');
    await revise.getByLabel('Aplicar desde').fill(nextJanuary);
    await revise.getByLabel('Monto (BOB)').fill('3800,00');
    await revise.getByTestId('definition-submit').click();
    const result = page.getByTestId('revision-result');
    await expect(result).toContainText('versión 2');
    await expect(result).toContainText('reescritas:');
    await expect(page.getByTestId('version-row')).toHaveCount(2);
    await expect(page.locator('[data-testid="version-row"][data-version-no="2"]')).toContainText(
      '3.800,00 BOB',
    );
    await expect(page.locator('[data-testid="version-row"][data-version-no="1"]')).toContainText(
      '3.500,00 BOB',
    );
    const revised = await api(page, 'GET', `${W}/recurring/${String(rent['id'])}`);
    expect(revised['currentVersionNo']).toBe(2);

    // El periodo de hoy conserva la versión 1 del alquiler: el comprometido no cambia.
    await go(page, '/recurring');
    await expect(page.getByTestId('committed-total')).toHaveText('3.930,00 BOB');

    // Recorrido de la definición: crear y revisar.
    await go(page, `/recurring/${String(rent['id'])}`);
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    await expect(page.getByTestId('lifecycle-timeline')).toContainText('Cambiar esta y las siguientes');

    expect(await seriousViolations(page)).toEqual([]);
    // Móvil: sin scroll horizontal (NFR-USAB-006).
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/recurring');
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
