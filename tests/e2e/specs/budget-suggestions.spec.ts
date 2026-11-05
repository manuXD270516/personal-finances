import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Sugerencias de presupuesto desde el historial (openspec add-historical-budgets 7.2, TC-PLANNING-HISTBUDGET-020 y
 * -028): con tres meses de gasto real en tres categorías y un plan del periodo actual, se piden sugerencias con N = 3, se
 * excluye un periodo de una línea desde su explicación, se edita un monto, se confirman dos de tres líneas y se ve el
 * indicador "sugerido desde el historial" y el historial del plan. Verifica accesibilidad (axe) y el viewport móvil.
 */
const PATH = '/planificacion/presupuestos';

interface PeriodRow {
  id: string;
  label: string;
}

/** Etiqueta `YYYY-MM` desplazada `n` meses. */
function shift(label: string, n: number): string {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Los periodos retroactivos los crea el worker de forma asíncrona tras los asientos: espera a los pedidos. */
async function waitForPeriods(page: Page, W: string, labels: readonly string[], timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const periods = (await api(page, 'GET', `${W}/periods?limit=100`))['data'] as PeriodRow[];
    if (labels.every((l) => periods.some((p) => p.label === l))) return periods;
    if (Date.now() > deadline) throw new Error('los periodos retroactivos no llegaron a tiempo');
    await page.waitForTimeout(1500);
  }
}

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

test.describe('Sugerencias de presupuesto desde el historial', () => {
  test('[TC-PLANNING-HISTBUDGET-020] [TC-PLANNING-HISTBUDGET-028] pedir sugerencias, excluir un periodo, editar un monto, confirmar dos de tres líneas y ver el indicador y el historial', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'sugerencias');
    const current = todayLaPaz().slice(0, 7);
    const months = [shift(current, -3), shift(current, -2), shift(current, -1)];
    const account = String(
      (
        await api(page, 'POST', `${W}/accounts`, {
          name: 'Banco sugerencias',
          type: 'BANK',
          currency: 'BOB',
          openingBalance: { amount: bob('20000.00'), date: `${shift(current, -4)}-01` },
        })
      )['id'],
    );
    const [a, b, c] = (await userCategories(page, W, 'EXPENSE')).slice(0, 3) as [
      { id: string; name: string },
      { id: string; name: string },
      { id: string; name: string },
    ];
    const spent: Record<string, readonly [string, string, string]> = {
      [a.id]: ['300.00', '310.00', '290.00'],
      [b.id]: ['100.00', '100.00', '100.00'],
      [c.id]: ['50.00', '70.00', '60.00'],
    };
    for (const category of [a, b, c]) {
      for (const [i, month] of months.entries()) {
        const amount = spent[category.id]![i]!;
        await api(page, 'POST', `${W}/transactions`, {
          kind: 'EXPENSE',
          transactionDate: `${month}-15`,
          accountId: account,
          amount: bob(amount),
          splits: [{ amount: bob(amount), categoryId: category.id }],
        });
      }
    }
    const periods = await waitForPeriods(page, W, [...months, current]);
    const currentPeriod = periods.find((p) => p.label === current)!;
    const plan = await api(page, 'POST', `${W}/budgets`, { periodId: currentPeriod.id });
    for (const [category, planned] of [
      [a, '600.00'],
      [b, '150.00'],
      [c, '80.00'],
    ] as const) {
      await api(page, 'POST', `${W}/budgets/${String(plan['id'])}/lines`, {
        target: { kind: 'CATEGORY', id: category.id },
        kind: 'MAXIMUM',
        planned: bob(planned),
      });
    }

    await go(page, PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Presupuestos' })).toBeVisible();
    await page.getByTestId('period-selector').selectOption({ value: currentPeriod.id });
    await expect(page.getByTestId('budget-lines-table')).toBeVisible();

    // 1. Pedir sugerencias con N = 3: nada se aplica ni se elige solo.
    await page.getByTestId('suggest-open').click();
    await expect(page.getByTestId('suggestions-panel')).toBeVisible();
    await page.getByTestId('suggestions-periods').fill('3');
    await page.getByTestId('suggestions-calculate').click();
    await expect(page.getByTestId('suggestions-table')).toBeVisible();
    await expect(page.getByTestId('suggestion-line')).toHaveCount(3);
    await expect(page.getByTestId('suggestion-pick')).toHaveCount(3);
    for (const pick of await page.getByTestId('suggestion-pick').all()) await expect(pick).not.toBeChecked();
    const rowOf = (id: string) => page.locator(`[data-testid="suggestion-line"][data-target-id="${id}"]`);
    await expect(rowOf(a.id)).toContainText('300,00 BOB');

    // 2. Accesibilidad y viewport móvil de la pantalla con la vista previa.
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 3. Excluir el primer periodo de la línea A desde su explicación: la sugerencia pasa al promedio de los otros dos.
    await rowOf(a.id).locator('summary').click();
    await expect(rowOf(a.id).getByTestId('explanation-period')).toHaveCount(3);
    await rowOf(a.id).getByTestId('period-exclude').first().click();
    await expect(rowOf(a.id)).toContainText('300,00 BOB'); // (310 + 290) / 2
    await rowOf(a.id).locator('summary').click();
    await expect(rowOf(a.id).locator('[data-status="USER_EXCLUDED"]')).toHaveCount(1);

    // 4. Elegir A y B (no C) y escribir a mano el monto de B.
    await rowOf(a.id).getByTestId('suggestion-pick').check();
    await rowOf(b.id).getByTestId('suggestion-pick').check();
    await rowOf(b.id).getByTestId('suggestion-amount').fill('120,00');
    await page.getByTestId('suggestions-review').click();
    await expect(page.getByTestId('suggestions-summary')).toContainText('2 líneas');
    await page.getByTestId('suggestions-confirm').click();
    await expect(page.getByTestId('suggestions-done')).toBeVisible();
    await page.getByTestId('suggestions-close').click();

    // 5. El plan: A y B con el indicador, C intacta; el historial registra las dos líneas con un identificador común.
    const lineRow = (id: string) =>
      page.locator(`[data-testid="budget-lines-table"] tr[data-target-id="${id}"]`);
    await expect(lineRow(a.id).getByTestId('line-history-basis')).toContainText(
      'Sugerido desde el historial',
    );
    await expect(lineRow(b.id).getByTestId('line-history-basis')).toBeVisible();
    await expect(lineRow(c.id).getByTestId('line-history-basis')).toHaveCount(0);
    await expect(lineRow(b.id).getByTestId('line-planned')).toContainText('120,00 BOB');
    await expect(lineRow(c.id).getByTestId('line-planned')).toContainText('80,00 BOB');
    const after = await api(page, 'GET', `${W}/budgets/${String(plan['id'])}`);
    const lines = after['lines'] as {
      target: { id: string };
      historyBasis: Record<string, unknown> | null;
    }[];
    expect(lines.find((l) => l.target.id === b.id)?.historyBasis).toMatchObject({
      suggested: bob('100.00'),
      applied: bob('120.00'),
    });
    expect(lines.find((l) => l.target.id === c.id)?.historyBasis).toBeNull();
    const trail = (await api(page, 'GET', `${W}/budgets/${String(plan['id'])}/history`))['data'] as {
      action: string;
      changes: { field: string; after: unknown }[];
    }[];
    const operations = trail
      .filter((e) => e.changes.some((x) => x.field === 'historyBasis'))
      .map((e) => e.changes.find((x) => x.field === 'operationId')?.after);
    expect(operations).toHaveLength(2);
    expect(new Set(operations).size).toBe(1);
    expect(await seriousViolations(page)).toEqual([]);
    await context.close();
  });
});
