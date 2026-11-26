import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { PgBoss } from 'pg-boss';
import { api, bob, openAccount, todayLaPaz } from './finance.js';
import { env } from './helpers.js';

/** Fecha `YYYY-MM-DD` de La Paz desplazada `days` días (negativo = hacia atrás) desde hoy. */
export function shiftDays(days: number, from = todayLaPaz()): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Los 12 gastos de «Restaurantes» de TC-FORECAST-ANOMALY-001: mediana 80.00 y MAD 7.50. */
export const RESTAURANT_HISTORY = [
  '60.00',
  '65.00',
  '70.00',
  '75.00',
  '78.00',
  '80.00',
  '80.00',
  '82.00',
  '85.00',
  '90.00',
  '95.00',
  '100.00',
] as const;

/**
 * Workspace personal (no demo: el worker del stack no lee los demo) con la historia de «Restaurantes» preparada por API y un
 * gasto de 304.00 BOB de ayer, que la detección diaria marca como atípico (3,8 veces la mediana). Devuelve los ids.
 */
export async function prepareAnomalyHistory(
  page: Page,
  W: string,
): Promise<{ account: string; category: string; atypical: string }> {
  const account = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
  const group = String(
    (await api(page, 'POST', `${W}/category-groups`, { name: 'Vida diaria', kind: 'EXPENSE' }))['id'],
  );
  const category = String(
    (await api(page, 'POST', `${W}/categories`, { groupId: group, name: 'Restaurantes' }))['id'],
  );
  const [y] = todayLaPaz().split('-').map(Number) as [number];
  await api(page, 'POST', `${W}/periods`, { through: `${y + 1}-12-31` });
  const spend = async (date: string, amount: string): Promise<string> =>
    String(
      (
        await api(page, 'POST', `${W}/transactions`, {
          kind: 'EXPENSE',
          transactionDate: date,
          accountId: account,
          amount: bob(amount),
          splits: [{ amount: bob(amount), categoryId: category }],
        })
      )['id'],
    );
  // Un gasto cada ~20 días de los últimos 8 meses (todos antes de la ventana de evaluación de 7 días).
  for (const [i, amount] of RESTAURANT_HISTORY.entries()) await spend(shiftDays(-20 - i * 18), amount);
  const atypical = await spend(shiftDays(-1), '304.00');
  return { account, category, atypical };
}

/**
 * Dispara el trabajo diario `forecasting.schedule` (detección de gastos atípicos y corridas programadas) como lo haría su cron:
 * el stack E2E lo deja en su horario diario, así la prueba lo pide cuando sus datos están listos. Rol de la app (`pf_app`).
 */
export async function triggerAnomalyPass(): Promise<void> {
  const boss = new PgBoss({
    connectionString: env()['DATABASE_URL']!,
    schema: 'pgboss',
    migrate: false,
    supervise: false,
    schedule: false,
    max: 1,
  });
  await boss.start();
  try {
    const id = await boss.send('forecasting.schedule', {
      v: 1,
      correlationId: randomUUID(),
      traceContext: {},
      payload: { trigger: 'manual' },
    });
    if (!id) throw new Error('pg-boss no aceptó el job del trabajo diario');
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
}
