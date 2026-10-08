import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Templates de presupuesto (openspec add-budget-templates 7.1): se crea "Mes estándar" con dos líneas y una versión
 * publicada con nota, se marca predeterminado, un periodo nuevo nace con su plan (hook síncrono de la creación de
 * periodos), editar el plan no toca el template, y un cambio del template se propaga a los meses futuros en borrador con
 * vista previa (la línea modificada a mano se informa como conflicto y no se pisa). Verifica accesibilidad (axe) y el
 * viewport móvil sin scroll horizontal.
 */
const PATH = '/planificacion/templates';

interface PeriodRow {
  id: string;
  label: string;
  status: string;
}

/** Etiqueta `YYYY-MM` desplazada `n` meses. */
function shift(label: string, n: number): string {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

async function periodsOf(page: Page, W: string): Promise<PeriodRow[]> {
  return (await api(page, 'GET', `${W}/periods?limit=100`))['data'] as PeriodRow[];
}

/** Los periodos iniciales los crea el worker de forma asíncrona (docs/33 D64): espera al actual y 3 en borrador. */
async function waitForPeriods(page: Page, W: string, timeoutMs = 60_000): Promise<PeriodRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const periods = await periodsOf(page, W);
    if (periods.length >= 4) return periods;
    if (Date.now() > deadline) throw new Error('los periodos no llegaron a tiempo');
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

interface PlanLine {
  target: { id: string };
  planned: { amount: string } | null;
  overridden: boolean;
}

const planLine = async (page: Page, W: string, periodId: string, categoryId: string): Promise<PlanLine> => {
  const plan = await api(page, 'GET', `${W}/periods/${periodId}/budget`);
  return (plan['lines'] as PlanLine[]).find((l) => l.target.id === categoryId)!;
};

test.describe('Templates de presupuesto', () => {
  test('[TC-PLANNING-TEMPLATE-001] [TC-PLANNING-TEMPLATE-002] [TC-PLANNING-TEMPLATE-010] [TC-PLANNING-TEMPLATE-013] [TC-PLANNING-TEMPLATE-015] "Mes estándar" predeterminado: el periodo nuevo nace con su plan, editar el plan no toca el template y un cambio se propaga con vista previa', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'templates');
    const [food, transport] = await userCategories(page, W, 'EXPENSE');
    await waitForPeriods(page, W);
    const current = todayLaPaz().slice(0, 7);

    // 1. Crear el template y publicar su primera versión con dos líneas y una nota de cambio.
    await go(page, PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Templates de presupuesto' })).toBeVisible();
    await expect(page.getByTestId('planning-nav')).toBeVisible();
    await expect(page.getByTestId('templates-empty')).toBeVisible();
    await page.getByTestId('template-name').fill('Mes estándar');
    await page.getByTestId('template-create').click();
    await expect(page.getByRole('status').filter({ hasText: 'Template creado' })).toBeVisible();
    await expect(page.getByTestId('template-detail')).toBeVisible();
    await page.getByTestId('template-edit').click();
    for (const [category, amount] of [
      [food!, '600,00'],
      [transport!, '1500,00'],
    ] as const) {
      await page.getByTestId('draft-add-line').click();
      await page.getByTestId('form-target').selectOption({ label: category.name });
      await page.getByTestId('form-planned').fill(amount);
      await page.getByTestId('form-submit').click();
    }
    await expect(page.getByTestId('template-draft').getByTestId('template-line')).toHaveCount(2);
    await page.getByTestId('draft-note').fill('Inflación');
    await page.getByTestId('draft-publish').click();
    await expect(page.getByRole('status').filter({ hasText: 'Versión 2 publicada.' })).toBeVisible();
    await expect(page.getByTestId('template-version')).toHaveCount(2);
    await expect(page.locator('[data-testid="template-version"][data-version="2"]')).toContainText(
      'Inflación',
    );

    // 2. Marcarlo como predeterminado.
    await page.getByTestId('template-set-default').click();
    await expect(page.getByRole('status').filter({ hasText: 'predeterminado' })).toBeVisible();
    await expect(page.getByTestId('template-default')).toBeVisible();

    // 3. Accesibilidad y viewport móvil de la pantalla con datos.
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('template-edit').click();
    await page.getByTestId('draft-add-line').click();
    await expect(page.getByTestId('budget-line-form-add')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 4. Un periodo nuevo nace con su plan desde la última versión del predeterminado (creación síncrona del hook).
    const sixth = shift(current, 5);
    await api(page, 'POST', `${W}/periods`, { through: `${sixth}-28` });
    const all = await periodsOf(page, W);
    const fresh = all.find((p) => p.label === shift(current, 4))!;
    const freshPlan = await api(page, 'GET', `${W}/periods/${fresh.id}/budget`);
    expect(freshPlan['origin']).toBe('TEMPLATE');
    expect((freshPlan['templateVersion'] as { versionNo: number }).versionNo).toBe(2);
    await go(page, '/planificacion/presupuestos');
    await page.getByTestId('period-selector').selectOption({ value: fresh.id });
    await expect(page.getByTestId('plan-origin-info')).toContainText('Mes estándar, versión 2');
    const row = page.locator(`[data-testid="budget-lines-table"] tr[data-target-id="${food!.id}"]`);
    await expect(row.getByTestId('line-planned')).toContainText('600,00 BOB');

    // 5. Editar el plan de ese periodo no toca el template ni la versión de origen; la línea queda modificada.
    await page.getByRole('button', { name: `Editar la línea ${food!.name}` }).click();
    await page.getByTestId('form-planned').fill('650,00');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('status').filter({ hasText: 'Línea guardada.' })).toBeVisible();
    await expect(row.getByTestId('line-planned')).toContainText('650,00 BOB');
    const edited = await planLine(page, W, fresh.id, food!.id);
    expect(edited.overridden).toBe(true);
    const list = (await api(page, 'GET', `${W}/templates`))['data'] as {
      id: string;
      currentVersionNo: number;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.currentVersionNo).toBe(2);

    // 6. Los periodos en borrador anteriores reciben su plan del template (para propagar sobre ellos).
    const needPlan = all.filter((p) => [1, 2, 3].map((n) => shift(current, n)).includes(p.label));
    expect(needPlan).toHaveLength(3);
    for (const p of needPlan) {
      await api(page, 'POST', `${W}/budgets`, {
        periodId: p.id,
        source: { kind: 'TEMPLATE', templateId: list[0]!.id },
      });
    }

    // 7. Cambiar el template (Alimentación 700,00) y propagarlo a los meses futuros con vista previa.
    await go(page, PATH);
    await page.getByTestId('template-open').first().click();
    await expect(page.getByTestId('template-detail')).toBeVisible();
    await page.getByTestId('template-edit').click();
    await page.getByRole('button', { name: `Editar la línea ${food!.name}` }).click();
    await page.getByTestId('form-planned').fill('700,00');
    await page.getByTestId('form-submit').click();
    await expect(page.getByTestId('version-diff-row')).toHaveCount(1);
    await page.getByTestId('draft-propagate').click();
    await expect(page.getByTestId('propagation-preview')).toBeVisible();
    // Un conflicto (la línea modificada a mano) y un cambio por cada otro plan futuro en borrador.
    await expect(page.getByTestId('propagation-conflict')).toHaveCount(1);
    await expect(page.getByTestId('propagation-conflict')).toContainText('la modificaste a mano');
    const reached = await page.getByTestId('propagation-period').count();
    expect(reached).toBeGreaterThanOrEqual(4);
    await expect(page.getByTestId('propagation-change')).toHaveCount(reached - 1);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('propagation-confirm').click();
    await expect(page.getByTestId('propagation-done')).toBeVisible();
    await page.getByTestId('propagation-close').click();

    // 8. El template tiene la versión 3; los planes alcanzados cambian y el modificado a mano conserva su valor.
    const after = (await api(page, 'GET', `${W}/templates`))['data'] as { currentVersionNo: number }[];
    expect(after[0]!.currentVersionNo).toBe(3);
    expect((await planLine(page, W, fresh.id, food!.id)).planned!.amount).toBe('650.00');
    const sample = needPlan[0]!;
    expect((await planLine(page, W, sample.id, food!.id)).planned!.amount).toBe('700.00');
    await context.close();
  });

  test('[TC-PLANNING-TEMPLATE-014] [TC-PLANNING-TEMPLATE-018] clonar crea un template independiente y archivar lo deja fuera de uso', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'templates-clone');
    const [food] = await userCategories(page, W, 'EXPENSE');
    await api(page, 'POST', `${W}/templates`, {
      name: 'Mes estándar',
      lines: [
        {
          target: { kind: 'CATEGORY', id: food!.id },
          kind: 'MAXIMUM',
          planned: { amount: '600.00', currency: 'BOB' },
        },
      ],
    });
    await go(page, PATH);
    await page.getByTestId('template-open').first().click();
    await page.getByTestId('clone-name').fill('Mes de vacaciones');
    await page.getByTestId('clone-submit').click();
    await expect(page.getByRole('status').filter({ hasText: 'Template clonado.' })).toBeVisible();
    await expect(page.getByTestId('template-row')).toHaveCount(2);
    await page.getByTestId('template-archive').click();
    await page.getByTestId('confirm-archive-template').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Template archivado.' })).toBeVisible();
    await expect(page.getByTestId('template-unarchive')).toBeVisible();
    await expect(page.getByTestId('template-edit')).toHaveCount(0);
    await context.close();
  });
});
