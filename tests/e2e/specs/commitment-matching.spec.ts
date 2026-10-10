import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Coincidencias sugeridas (openspec add-commitment-matching 7.1; TC-COMMITMENTS-MATCH-001, -006, -008):
 *
 * - Se registra a mano el pago del "Internet" y el consumidor del worker propone la coincidencia (asíncrono: se espera
 *   por la API); en `/recurring` la pestaña "Coincidencias por revisar" muestra el contador y la tarjeta con su
 *   confianza en texto; el aviso del detalle de la transacción ofrece las mismas acciones; se confirma con el teclado
 *   y la ocurrencia queda vinculada por sugerencia y sale del comprometido.
 * - Se descarta la sugerencia del "Gimnasio", se edita el gasto y no vuelve a proponerse.
 *
 * Nada se vincula solo: mientras el usuario no confirma, la ocurrencia sigue sin resolver.
 */
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
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

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

interface Suggestion {
  id: string;
  status: string;
  confidence: string;
  occurrence: { definitionName: string; id: string } | null;
  transaction: { id: string } | null;
}

const suggestionsOf = async (page: Page, W: string, query: string): Promise<Suggestion[]> =>
  (await api(page, 'GET', `${W}/recurring/match-suggestions?limit=100&${query}`))['data'] as Suggestion[];

async function waitForPeriods(page: Page, W: string, timeoutMs = 60_000): Promise<void> {
  await until(async () => {
    const periods = (await api(page, 'GET', `${W}/periods?limit=100`))['data'] as unknown[];
    return periods.length > 0 ? true : undefined;
  }, timeoutMs);
}

test.describe('Coincidencias sugeridas', () => {
  test('[TC-COMMITMENTS-MATCH-001] [TC-COMMITMENTS-MATCH-006] [TC-COMMITMENTS-MATCH-008] el pago registrado a mano se sugiere, se confirma con el teclado y se descarta otra sugerencia para siempre', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'coincidencias');
    const bank = await openAccount(page, W, 'Banco coincidencias', 'BANK', 'BOB', '8000.00');
    await waitForPeriods(page, W);
    const today = todayLaPaz();
    const due = addDays(today, 1);
    const template = (amount: string) => ({
      accountId: bank,
      amount: { type: 'FIXED', amount: bob(amount) },
      schedule: { cadence: 'MONTHLY', startDate: due },
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    const internet = await api(page, 'POST', `${W}/recurring`, {
      name: 'Internet',
      kind: 'EXPENSE',
      template: template('199.00'),
    });
    const gym = await api(page, 'POST', `${W}/recurring`, {
      name: 'Gimnasio',
      kind: 'EXPENSE',
      template: template('120.00'),
    });

    // Los pagos se registran por fuera del flujo de aprobación.
    const internetTx = String(
      (
        await api(page, 'POST', `${W}/transactions`, {
          kind: 'EXPENSE',
          transactionDate: today,
          accountId: bank,
          amount: bob('199.00'),
          description: 'Débito de Internet',
        })
      )['id'],
    );
    const gymTx = String(
      (
        await api(page, 'POST', `${W}/transactions`, {
          kind: 'EXPENSE',
          transactionDate: today,
          accountId: bank,
          amount: bob('120.00'),
          description: 'Cuota del gimnasio',
        })
      )['id'],
    );

    // El consumidor del worker propone las coincidencias (asíncrono).
    const proposed = await until(async () => {
      const list = await suggestionsOf(page, W, 'status=PROPOSED');
      return list.length >= 2 ? list : undefined;
    });
    const internetSuggestion = proposed.find((s) => s.occurrence?.definitionName === 'Internet')!;
    const gymSuggestion = proposed.find((s) => s.occurrence?.definitionName === 'Gimnasio')!;
    expect(internetSuggestion.confidence).toBe('HIGH');
    // Nada se vinculó solo.
    for (const def of [internet, gym]) {
      const occs = (await api(page, 'GET', `${W}/recurring/${String(def['id'])}/occurrences?limit=50`))[
        'data'
      ] as { transactionId: string | null }[];
      expect(occs.every((o) => o.transactionId === null)).toBe(true);
    }

    // Pestaña "Coincidencias por revisar" con contador y confianza en texto.
    await go(page, '/recurring');
    const tab = page.getByRole('tab', { name: /^Coincidencias por revisar/ });
    await expect(tab).toContainText('(2)');
    await tab.click();
    const cards = page.getByTestId('match-suggestion');
    await expect(cards).toHaveCount(2);
    const internetCard = cards.filter({ hasText: 'Internet' });
    await expect(internetCard.getByTestId('match-confidence')).toContainText('Confianza alta');
    await expect(internetCard).toContainText('Mismo monto');
    await expect(internetCard).toContainText('1 día de diferencia con el vencimiento');
    expect(await seriousViolations(page)).toEqual([]);

    // El detalle de la transacción avisa y ofrece las mismas acciones.
    await go(page, `/transacciones/${gymTx}`);
    const notice = page.getByTestId('matches-notice');
    await expect(notice).toContainText('Esto parece el pago de Gimnasio');
    expect(await seriousViolations(page)).toEqual([]);

    // Descartar la del Gimnasio desde el aviso: no vuelve aunque se edite el gasto.
    await notice.getByRole('button', { name: /^Descartar la coincidencia con Gimnasio/ }).click();
    await expect(page.getByTestId('matches-notice')).toHaveCount(0);
    const current = await api(page, 'GET', `${W}/transactions/${gymTx}`);
    await api(
      page,
      'PATCH',
      `${W}/transactions/${gymTx}`,
      { description: 'Cuota del gimnasio (editada)' },
      { 'if-match': `"${String(current['version'])}"` },
    );
    // Una edición financiera compatible (121,00 BOB) reevalúa el gasto en el worker: el par descartado no revive.
    const edited = await api(page, 'GET', `${W}/transactions/${gymTx}`);
    await api(
      page,
      'PATCH',
      `${W}/transactions/${gymTx}`,
      { amount: bob('121.00') },
      { 'if-match': `"${String(edited['version'])}"` },
    );
    await page.waitForTimeout(8_000);
    const dismissed = await suggestionsOf(page, W, 'status=DISMISSED');
    expect(dismissed.map((s) => s.id)).toEqual([gymSuggestion.id]);

    // Confirmar la del Internet con el teclado desde la pestaña.
    await go(page, '/recurring');
    await page.getByRole('tab', { name: /^Coincidencias por revisar/ }).click();
    await expect(page.getByTestId('match-suggestion')).toHaveCount(1);
    const confirm = page.getByRole('button', { name: /^Confirmar la coincidencia con Internet/ });
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('recurring-status')).toContainText('Vinculaste Internet');
    await expect(page.getByTestId('match-suggestion')).toHaveCount(0);

    // La ocurrencia quedó vinculada por sugerencia y salió del comprometido.
    const linked = (
      (await api(page, 'GET', `${W}/recurring/${String(internet['id'])}/occurrences?limit=50`))['data'] as {
        status: string;
        matchedBy: string | null;
        transactionId: string | null;
      }[]
    )[0]!;
    expect(linked).toMatchObject({ status: 'MATCHED', matchedBy: 'SUGGESTION', transactionId: internetTx });
    const confirmed = await suggestionsOf(page, W, 'status=CONFIRMED');
    expect(confirmed.map((s) => s.id)).toEqual([internetSuggestion.id]);
    const committed = await api(page, 'GET', `${W}/recurring/committed`);
    const names = (committed['items'] as { name: string | null }[]).map((i) => i.name);
    expect(names).not.toContain('Internet');
    expect(names).toContain('Gimnasio');

    // La del Gimnasio no volvió a aparecer tras la edición del gasto.
    expect(await suggestionsOf(page, W, 'status=PROPOSED')).toEqual([]);
    expect(
      await suggestionsOf(page, W, `transactionId=${gymTx}&status=PROPOSED,DISMISSED,EXPIRED`),
    ).toHaveLength(1);
    await context.close();
  });
});
