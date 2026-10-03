import { randomUUID } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { bff, createKeycloakUser, env, login } from './helpers.js';

/**
 * Apoyo de las suites financieras (cuentas, transacciones, transferencias, conversiones): usuario nuevo con su
 * workspace personal (OWNER, BOB, America/La_Paz, catálogo de categorías) y atajos de API para preparar datos que
 * la prueba no ejercita por la UI. Montos siempre como strings decimales.
 */

/** Fecha de negocio de hoy en America/La_Paz. */
export const todayLaPaz = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export const bob = (amount: string) => ({ amount, currency: 'BOB' });

export interface FinanceUser {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly workspaceId: string;
  /** `/workspaces/{id}` para `api()`. */
  readonly W: string;
}

/** Usuario nuevo de Keycloak con login real y su workspace personal recién creado. */
export async function newFinanceUser(browser: Browser, prefix: string): Promise<FinanceUser> {
  const username = `${prefix}-${randomUUID().slice(0, 8)}`;
  const password = `Pw-${randomUUID()}`;
  await createKeycloakUser(username, password);
  const context = await browser.newContext({ baseURL: env()['WEB_PUBLIC_URL']! });
  const page = await context.newPage();
  await login(page, username, password);
  const me = await bff(page, 'GET', '/api/bff/v1/me');
  const workspaceId = (me.body?.['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  return { context, page, workspaceId, W: `/workspaces/${workspaceId}` };
}

/** Llamada a la API vía BFF que debe terminar bien (2xx); POST con `Idempotency-Key`. */
export async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const r = await bff(page, method, `/api/bff/v1${path}`, {
    ...(body === undefined ? {} : { body }),
    ...(method === 'PATCH' ? { contentType: 'application/merge-patch+json' } : {}),
    headers: { ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}), ...headers },
  });
  expect(r.status, `${method} ${path} ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body ?? {};
}

export async function openAccount(
  page: Page,
  W: string,
  name: string,
  type: string,
  currency: string,
  opening?: string,
): Promise<string> {
  const body = {
    name,
    type,
    currency,
    ...(opening ? { openingBalance: { amount: { amount: opening, currency }, date: todayLaPaz() } } : {}),
  };
  return String((await api(page, 'POST', `${W}/accounts`, body))['id']);
}

export interface CategoryRef {
  readonly id: string;
  readonly name: string;
}

/** Categorías de usuario (no de sistema) de primer nivel de un tipo: su nombre es la etiqueta del selector. */
export async function userCategories(
  page: Page,
  W: string,
  kind: 'EXPENSE' | 'INCOME',
): Promise<CategoryRef[]> {
  const r = await api(page, 'GET', `${W}/categories?kind=${kind}&limit=200`);
  return (r['data'] as { id: string; name: string; systemCode: string | null; parentId: string | null }[])
    .filter((c) => c.systemCode === null && !c.parentId)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Navega a una ruta de la app y espera a que el marco autenticado esté listo. */
export async function go(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('ready')).toBeAttached({ timeout: 30_000 });
}

/** Sin scroll horizontal en el viewport actual (NFR-USAB-006). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Saldo mostrado de una cuenta en la pantalla Cuentas. */
export const accountRow = (page: Page, name: string) =>
  page
    .getByTestId('account-row')
    .filter({ has: page.getByTestId('account-name').getByText(name, { exact: true }) });
