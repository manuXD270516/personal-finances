import type { Page } from '@playwright/test';
import { api, bob, openAccount, todayLaPaz } from './finance.js';

/**
 * Workspace personal (no demo) con 8 meses de gasto en una categoría y dos recurrentes. Se prepara por API: el worker
 * del stack no lee los workspaces demo (PF002 preexistente con el directorio de workspaces).
 */
export async function prepareForecastHistory(
  page: Page,
  W: string,
): Promise<{ account: string; category: string }> {
  const account = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
  const group = String(
    (await api(page, 'POST', `${W}/category-groups`, { name: 'Vida diaria', kind: 'EXPENSE' }))['id'],
  );
  const category = String(
    (await api(page, 'POST', `${W}/categories`, { groupId: group, name: 'Restaurantes' }))['id'],
  );
  const [y, m] = todayLaPaz().split('-').map(Number) as [number, number];
  await api(page, 'POST', `${W}/periods`, { through: `${y + 1}-12-31` });
  for (let i = 8; i >= 1; i -= 1) {
    const idx = y * 12 + (m - 1) - i;
    const date = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-10`;
    // Tercio del gasto mensual de la serie sintética (900, 925, … BOB), como string decimal con dos cifras.
    const third = ((900 + (8 - i) * 25) / 3).toFixed(2);
    for (const day of ['10', '17', '24']) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: `${date.slice(0, 8)}${day}`,
        accountId: account,
        amount: bob(third),
        splits: [{ amount: bob(third), categoryId: category }],
      });
    }
  }
  const next = y * 12 + m;
  const start = `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, '0')}-10`;
  for (const [name, kind, amount] of [
    ['Alquiler', 'EXPENSE', '2500.00'],
    ['Sueldo', 'INCOME', '8000.00'],
  ] as const) {
    await api(page, 'POST', `${W}/recurring`, {
      name,
      kind,
      template: {
        accountId: account,
        amount: { type: 'FIXED', amount: bob(amount) },
        ...(kind === 'EXPENSE' ? { categoryId: category } : {}),
        schedule: { cadence: 'MONTHLY', startDate: start },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
  }
  return { account, category };
}
