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
 * Riesgo de exceder un presupuesto (openspec add-budget-overrun-risk, tarea 7.2; TC-REPORTING-INSIGHT-012, -018,
 * TC-NOTIFICATIONS-BUDGETRISK-001): un workspace propio con un plan del periodo en curso y una línea «Restaurantes» con tope
 * 3.000,00 BOB cuyo gastado, al ritmo del periodo, lo supera antes de fin de mes. El plan muestra el indicador «Probable»
 * con la proyección, la fecha estimada y la base; la tarjeta de Q5 del Home lista la línea con su enlace al plan; las cifras del
 * plan no cambian; las preferencias muestran el tipo apagado por omisión. Sin violaciones serias de axe ni scroll horizontal.
 */
const REFERENCE = 3000;

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test.describe('Riesgo de exceder un presupuesto (reporting/predictive-insights)', () => {
  test('[TC-REPORTING-INSIGHT-012] [TC-REPORTING-INSIGHT-018] [TC-NOTIFICATIONS-BUDGETRISK-001] el plan muestra el riesgo de la línea, la tarjeta de Q5 la lista y las cifras del plan no cambian', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { page, W } = await newFinanceUser(browser, 'riesgo');
    const account = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
    const group = String(
      (await api(page, 'POST', `${W}/category-groups`, { name: 'Vida diaria', kind: 'EXPENSE' }))['id'],
    );
    const category = String(
      (await api(page, 'POST', `${W}/categories`, { groupId: group, name: 'Restaurantes' }))['id'],
    );
    const today = todayLaPaz();
    const [y] = today.split('-').map(Number) as [number];
    await api(page, 'POST', `${W}/periods`, { through: `${y + 1}-12-31` });
    const periods = (await api(page, 'GET', `${W}/periods?limit=100`))['data'] as {
      id: string;
      label: string;
      periodStart: string;
      periodEnd: string;
    }[];
    const period = periods.find((p) => p.periodStart <= today && today <= p.periodEnd)!;
    const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
    const elapsed = (day(today) - day(period.periodStart)) / 86_400_000 + 1;
    const total = (day(period.periodEnd) - day(period.periodStart)) / 86_400_000 + 1;
    // Gastado a mitad de camino entre el ritmo justo y el tope: la proyección lineal lo supera sin haberlo excedido.
    const spent = Math.round(REFERENCE * ((elapsed / total + 1) / 2));
    test.skip(
      elapsed < 7 || elapsed >= total,
      'el riesgo por ritmo necesita entre 7 días transcurridos y el penúltimo día',
    );

    const plan = await api(page, 'POST', `${W}/budgets`, { periodId: period.id, source: { kind: 'EMPTY' } });
    await api(page, 'POST', `${W}/budgets/${String(plan['id'])}/lines`, {
      target: { kind: 'CATEGORY', id: category },
      kind: 'MAXIMUM',
      planned: bob(`${REFERENCE}.00`),
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: period.periodStart,
      accountId: account,
      amount: bob(`${spent}.00`),
      splits: [{ amount: bob(`${spent}.00`), categoryId: category }],
    });

    const risk = await api(page, 'GET', `${W}/periods/${period.id}/budget-risk`);
    const line = (
      risk['lines'] as { level: string; estimatedDate: string; projected: { amount: string } }[]
    )[0]!;
    expect(line.level).toBe('LIKELY');

    // El plan: indicador con texto, proyección, fecha estimada y base; las cifras del plan son las de siempre.
    await go(page, `/planificacion/presupuestos?periodo=${period.label}`);
    await expect(page.getByTestId('budget-lines-table')).toBeVisible();
    const indicator = page.getByTestId('line-risk');
    await expect(indicator).toHaveAttribute('data-level', 'LIKELY');
    await expect(page.getByTestId('line-risk-level')).toContainText('Probable');
    await expect(page.getByTestId('line-risk-projection')).toContainText('Proyección');
    await expect(page.getByTestId('line-risk-date')).toContainText('exceso estimado alrededor del');
    await expect(page.getByTestId('line-risk-basis')).toContainText('según el ritmo del periodo');
    await expect(page.getByTestId('line-actual')).toContainText(`${spent}`.replace(/(\d)(\d{3})$/, '$1.$2'));
    await expect(page.getByTestId('budget-risk-legend')).toBeVisible();
    const violations = await seriousViolations(page);
    expect(violations, JSON.stringify(violations)).toEqual([]);

    // Q5 del Home: la línea en riesgo con su enlace al plan.
    await go(page, '/');
    const card = page.getByTestId('budget-risk-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('budget-risk-link')).toHaveText('Restaurantes');
    await expect(card.getByTestId('budget-risk-sentence')).toContainText('superaría su tope alrededor del');
    await expect(card.getByTestId('budget-risk-link')).toHaveAttribute(
      'href',
      /planificacion\/presupuestos\?periodo=/,
    );
    const homeViolations = await seriousViolations(page);
    expect(homeViolations, JSON.stringify(homeViolations)).toEqual([]);

    // Preferencias: el aviso llega apagado en los dos canales.
    await go(page, '/preferencias');
    await expect(page.getByTestId('pref-BUDGET_OVERRUN_RISK-inApp')).not.toBeChecked();
    await expect(page.getByTestId('pref-BUDGET_OVERRUN_RISK-email')).not.toBeChecked();

    // Móvil: sin scroll horizontal en el plan.
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, `/planificacion/presupuestos?periodo=${period.label}`);
    await expect(page.getByTestId('budget-lines-table')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.context().close();
  });
});
