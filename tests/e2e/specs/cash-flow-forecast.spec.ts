import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser } from '../src/finance.js';

/**
 * Pronóstico de flujo de caja sobre el dataset Demo v2 (openspec add-cash-flow-forecast, tarea 7.2; checklist de
 * aceptación del Home SM-05). El OWNER carga la demo desde la configuración (como `demo-data.spec.ts`), abre el Home
 * (las nueve preguntas con cifras, Q8 con el saldo más bajo y el riesgo de 30 días, Q7 con la variación por categoría),
 * navega el calendario de 30 días (cambia horizonte y moneda) y omite una ocurrencia para ver el cambio de inmediato.
 */

interface CalendarEvent {
  id: string;
  date: string;
  source: 'OCCURRENCE' | 'PENDING';
  kind: string;
  name: string | null;
  overdue: boolean;
  managedBy: string | null;
  amount: { amount: string; currency: string } | null;
  sourceRef: { context: string; id: string };
}
interface CalendarCurrency {
  currency: string;
  endBalance: { amount: string; currency: string };
  lowest: { amount: { amount: string; currency: string }; date: string };
  series: { date: string }[];
}
interface Calendar {
  horizonDays: number;
  currencies: CalendarCurrency[];
  events: CalendarEvent[];
}

/** Decimal (escala ≤ 2 en BOB/USD) a unidades mínimas exactas: solo para comparar saldos en la prueba. */
const cents = (amount: string): bigint => {
  const negative = amount.startsWith('-');
  const [int = '0', frac = ''] = amount.replace('-', '').split('.');
  const value = BigInt(`${int}${frac.padEnd(2, '0').slice(0, 2)}`);
  return negative ? -value : value;
};

async function loadDemo(page: Page): Promise<void> {
  await go(page, '/configuracion');
  await page.getByTestId('demo-load').click();
  await expect(page.getByTestId('demo-load-confirm')).toBeVisible();
  await page.getByTestId('demo-load-confirm').getByRole('button', { name: 'Sí, cargar' }).click();
  await expect(page.getByTestId('demo-data-status')).toContainText('Datos de demostración listos', {
    timeout: 240_000,
  });
  await page.getByTestId('demo-open').click();
  await expect(page.getByTestId('demo-indicator')).toBeVisible();
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

test.describe('Pronóstico de flujo de caja con el dataset Demo v2 (reporting/cash-flow-calendar, reporting/dashboard)', () => {
  test('[TC-REPORTING-FORECAST-030] [TC-REPORTING-FORECAST-020] el Home responde las nueve preguntas con cifras, el calendario de 30 días se navega y omitir una ocurrencia se ve de inmediato', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const { context, page } = await newFinanceUser(browser, 'forecast');
    await loadDemo(page);
    // El workspace demo es el activo: el resto de la prueba lee y escribe ahí.
    const me = await api(page, 'GET', '/me');
    const demo = (me['memberships'] as { workspaceId: string; isDemo: boolean }[]).find((m) => m.isDemo)!;
    const W = `/workspaces/${demo.workspaceId}`;

    // ── TC-030: las nueve tarjetas del Home con cifras (ninguna «no disponible» ni «sin datos»).
    await go(page, '/');
    await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
    for (const question of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q8', 'Q9']) {
      await expect(page.locator(`[data-question="${question}"]`).first(), question).toHaveAttribute(
        'data-status',
        'AVAILABLE',
      );
    }
    await expect(page.getByTestId('question-not-available')).toHaveCount(0);
    await expect(page.locator('[data-testid$="-no-data"]')).toHaveCount(0);
    await expect(page.getByTestId('spendable-amount')).toBeVisible();
    await expect(page.getByTestId('spendable-horizon')).toBeVisible();

    // Q8: saldo más bajo esperado de 30 días con su fecha, el riesgo y el enlace al calendario.
    const q8 = page.getByTestId('cash-flow-q8');
    await expect(q8).toBeVisible();
    await expect(q8.getByTestId('cash-flow-q8-risk')).toBeVisible();
    await expect(q8.getByTestId('cash-flow-q8-lowest')).toContainText(/\d/);
    await expect(q8.getByTestId('cash-flow-link')).toHaveAttribute('href', /\/flujo-de-caja/);

    // Q7: cada categoría del top informa su variación (valor, sentido favorable o desfavorable y % o «nuevo»).
    const directions = page.getByTestId('top-category-direction');
    await expect(directions.first()).toBeVisible();
    expect(await directions.count()).toBeGreaterThan(0);
    await expect(directions.first()).toHaveText(/^(favorable|desfavorable|sin cambio)$/);
    await expect(page.getByTestId('top-category-delta').first()).toContainText(/\d/);

    // ── Calendario de 30 días navegable desde Q8.
    await q8.getByTestId('cash-flow-link').click();
    await expect(page.getByTestId('cash-flow-page')).toHaveAttribute('data-horizon', '30');
    await expect(page.getByTestId('cash-flow-chart').first()).toBeVisible();
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(31);
    await expect(page.getByTestId('cash-flow-risk-card')).toBeVisible();
    await expect(page.getByTestId('cash-flow-lowest')).toContainText(/\d/);
    // Las atribuciones de las tasas están siempre visibles cuando la respuesta las trae.
    const calendar = (await api(
      page,
      'GET',
      `${W}/reports/cash-flow-calendar?horizon=30`,
    )) as unknown as Calendar;
    expect(calendar.horizonDays).toBe(30);
    expect(calendar.currencies.length).toBeGreaterThan(0);
    expect(calendar.currencies[0]!.series).toHaveLength(31);

    const violations = await seriousViolations(page);
    expect(violations, JSON.stringify(violations)).toEqual([]);

    // Horizonte: 7 → 8 puntos; 90 → 91; vuelta a 30 → 31.
    await page.getByTestId('cash-flow-horizon-7').check();
    await expect(page.getByTestId('cash-flow-page')).toHaveAttribute('data-horizon', '7');
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(8);
    await page.getByTestId('cash-flow-horizon-90').check();
    await expect(page.getByTestId('cash-flow-page')).toHaveAttribute('data-horizon', '90');
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(91);
    await expect(page).toHaveURL(/horizonte=90/);
    await page.getByTestId('cash-flow-horizon-30').check();
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(31);

    // Moneda: el demo tiene cuentas líquidas en BOB y USD; cambiar de moneda muestra la otra.
    if (calendar.currencies.length > 1) {
      const other = calendar.currencies.map((c) => c.currency).find((c) => c !== 'BOB') ?? 'USD';
      await page.getByTestId(`cash-flow-currency-${other}`).check();
      await expect(page.getByTestId('cash-flow-currency')).toHaveAttribute('data-currency', other);
      await expect(page).toHaveURL(new RegExp(`moneda=${other}`));
      await page.getByTestId('cash-flow-currency-BOB').check();
      await expect(page.getByTestId('cash-flow-currency')).toHaveAttribute('data-currency', 'BOB');
    }
    // El enlace de la notificación de riesgo (?horizonte=<n>&moneda=<código>) abre esa selección.
    await go(page, '/flujo-de-caja?horizonte=60&moneda=BOB');
    await expect(page.getByTestId('cash-flow-page')).toHaveAttribute('data-horizon', '60');
    await expect(page.getByTestId('cash-flow-currency')).toHaveAttribute('data-currency', 'BOB');
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(61);

    // ── TC-020: omitir una ocurrencia de gasto del horizonte de 30 días y ver el cambio de inmediato.
    const target = calendar.events.find(
      (e) =>
        e.source === 'OCCURRENCE' &&
        e.kind === 'EXPENSE' &&
        !e.overdue &&
        e.managedBy === 'USER' &&
        e.amount !== null &&
        e.name !== null,
    );
    expect(target, 'una ocurrencia de gasto del demo en los próximos 30 días').toBeTruthy();
    const currency = calendar.currencies.find((c) => c.currency === target!.amount!.currency)!;
    expect(currency).toBeTruthy();

    await go(page, `/flujo-de-caja?moneda=${currency.currency}`);
    await expect(
      page.getByTestId('cash-flow-event').filter({ hasText: target!.name! }).first(),
    ).toBeVisible();
    const endBefore = (await page.getByTestId('cash-flow-end').locator('strong').innerText()).trim();

    await go(page, `/recurring/occurrences/${target!.sourceRef.id}`);
    await page
      .getByRole('group', { name: 'Acciones de la definición' })
      .getByRole('button', { name: 'Omitir', exact: true })
      .click();
    await page.getByTestId('skip-panel').getByRole('button', { name: 'Omitir', exact: true }).click();
    await expect(page.getByTestId('skip-panel')).toHaveCount(0);

    // Lectura inmediata (D117): el evento ya no está y el saldo final subió exactamente el monto omitido.
    const after = (await api(
      page,
      'GET',
      `${W}/reports/cash-flow-calendar?horizon=30`,
    )) as unknown as Calendar;
    expect(after.events.map((e) => e.id)).not.toContain(target!.id);
    const endAfter = after.currencies.find((c) => c.currency === currency.currency)!.endBalance.amount;
    expect(cents(endAfter) - cents(currency.endBalance.amount)).toBe(cents(target!.amount!.amount));

    await go(page, `/flujo-de-caja?moneda=${currency.currency}`);
    const sameDay = page
      .getByTestId('cash-flow-event')
      .filter({ hasText: target!.name! })
      .filter({ has: page.locator(`a[href$="/recurring/occurrences/${target!.sourceRef.id}"]`) });
    await expect(sameDay).toHaveCount(0);
    await expect(page.getByTestId('cash-flow-end').locator('strong')).not.toHaveText(endBefore);
    await context.close();
  });
});
