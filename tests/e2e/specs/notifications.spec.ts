import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, expectNoHorizontalScroll, go, todayLaPaz } from '../src/finance.js';
import { appUrl, bff, createKeycloakUser, env, login } from '../src/helpers.js';

/**
 * Alertas (openspec add-alerts 7.1): presupuesto "Restaurantes" de 600,00 BOB y gastos hasta el 91,7 %. El worker
 * procesa el hecho (asíncrono): notificación in-app (campana, bandeja), UN solo email en Mailpit sin montos ni nombres,
 * y el enlace del email exige sesión (login y luego la notificación). Verifica además el destino del enlace (línea
 * resaltada y aviso "ya no existe"), las preferencias, accesibilidad (axe) y viewport móvil.
 */
const mailpitApi = (): string => `http://${env()['PF_BIND_ADDR']}:${env()['PF_MAILPIT_UI_PORT']}/api/v1`;

interface MailSummary {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

async function mailsTo(address: string): Promise<{ summary: MailSummary; text: string; html: string }[]> {
  const list = (await (await fetch(`${mailpitApi()}/messages?limit=200`)).json()) as {
    messages: MailSummary[];
  };
  const mine = list.messages.filter((m) => m.To.some((t) => t.Address === address));
  return Promise.all(
    mine.map(async (summary) => {
      const full = (await (await fetch(`${mailpitApi()}/message/${summary.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      return { summary, text: full.Text, html: full.HTML };
    }),
  );
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

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

test.describe('Alertas', () => {
  test('[TC-NOTIFICATIONS-INAPP-001] [TC-NOTIFICATIONS-EMAIL-001] [TC-NOTIFICATIONS-EMAIL-003] [TC-NOTIFICATIONS-EMAIL-004] [TC-NOTIFICATIONS-INAPP-005] umbral del 90 %: campana, bandeja, un solo email sin montos, enlace con login y línea resaltada o ausente', async ({
    browser,
  }) => {
    const username = `alertas-${randomUUID().slice(0, 8)}`;
    const password = `Pw-${randomUUID()}`;
    await createKeycloakUser(username, password);
    const address = `${username}@demo.pfos.test`;
    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    await login(page, username, password);
    const me = await bff(page, 'GET', '/api/bff/v1/me');
    const workspaceId = (me.body?.['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const W = `/workspaces/${workspaceId}`;

    // Presupuesto: "Restaurantes" (catálogo inicial) con máximo de 600,00 BOB en el periodo actual.
    const categories = await api(page, 'GET', `${W}/categories?limit=200`);
    const restaurants = (categories['data'] as { id: string; name: string }[]).find(
      (c) => c.name === 'Restaurantes',
    )!;
    expect(restaurants).toBeDefined();
    const today = todayLaPaz();
    const periods = await until(async () => {
      const r = await api(page, 'GET', `${W}/periods?limit=100`);
      const data = r['data'] as { id: string; label: string; periodStart: string; periodEnd: string }[];
      return data.length > 0 ? data : undefined;
    });
    const period = periods.find((p) => p.periodStart <= today && today <= p.periodEnd)!;
    const budget = await api(page, 'POST', `${W}/budgets`, { periodId: period.id });
    const line = await api(page, 'POST', `${W}/budgets/${String(budget['id'])}/lines`, {
      target: { kind: 'CATEGORY', id: restaurants.id },
      kind: 'MAXIMUM',
      planned: bob('600.00'),
    });
    const bank = String(
      (
        await api(page, 'POST', `${W}/accounts`, {
          name: 'Banco alertas',
          type: 'BANK',
          currency: 'BOB',
          openingBalance: { amount: bob('5000.00'), date: today },
        })
      )['id'],
    );
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: bank,
      amount: bob('550.00'),
      splits: [{ amount: bob('550.00'), categoryId: restaurants.id }],
    });

    // Un único email (asíncrono: outbox → umbral → NOTIFY → despacho SMTP → Mailpit), con el asunto en español.
    const mails = await until(async () => {
      const m = await mailsTo(address);
      return m.length > 0 ? m : undefined;
    });
    await page.waitForTimeout(4000);
    const settled = await mailsTo(address);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.summary.Subject).toBe('Tienes una alerta de presupuesto');
    const stripUrls = (v: string) => v.replace(/https?:\/\/\S+/g, '');
    for (const content of [
      settled[0]!.summary.Subject,
      stripUrls(settled[0]!.text),
      stripUrls(settled[0]!.html),
    ]) {
      for (const forbidden of ['Restaurantes', '550', '600', 'BOB']) expect(content).not.toContain(forbidden);
    }
    expect(settled[0]!.text).toContain('alcanzó el 90 %');
    const link = /https?:\/\/\S+\/notificaciones\/[0-9a-f-]{36}/.exec(settled[0]!.text)?.[0];
    expect(link, 'el email enlaza a /notificaciones/{id}').toBeDefined();
    expect(new URL(link!).search).toBe('');
    expect(mails).toHaveLength(1);

    // Campana y bandeja (in-app con detalles).
    await go(page, '/');
    await expect(page.getByTestId('notification-unread-count')).toHaveText('1');
    await go(page, '/notificaciones');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const item = page.getByTestId('notification-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('notification-title')).toContainText('Restaurantes');
    await expect(item.getByTestId('notification-body')).toContainText('550,00 de 600,00 BOB');
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // El enlace del email sin sesión: pide iniciar sesión y luego muestra la notificación.
    const fresh = await browser.newContext({ baseURL: appUrl() });
    const anon = await fresh.newPage();
    const target = new URL(link!);
    await login(anon, username, password, `${target.pathname}`);
    await expect(anon).toHaveURL(new RegExp(`${target.pathname}$`));
    await expect(anon.getByTestId('notification-detail')).toBeVisible();
    await expect(anon.getByTestId('notification-title')).toContainText('Restaurantes');
    expect(await seriousViolations(anon)).toEqual([]);

    // Abrir el recurso: la línea queda resaltada en el plan del periodo.
    await anon.getByTestId('notification-open-resource').click();
    await expect(anon.getByRole('heading', { level: 1, name: 'Presupuestos' })).toBeVisible();
    await expect(anon.locator('tr[data-highlighted="true"]')).toHaveCount(1);
    await expect(anon.getByTestId('budget-line-missing')).toHaveCount(0);

    // La línea desaparece del plan: el enlace lleva al plan con el aviso "ya no existe".
    await api(page, 'DELETE', `${W}/budgets/${String(budget['id'])}/lines/${String(line['id'])}`);
    await go(anon, `${target.pathname}`);
    await anon.getByTestId('notification-open-resource').click();
    await expect(anon.getByTestId('budget-line-missing')).toBeVisible();
    await expect(anon.locator('tr[data-highlighted="true"]')).toHaveCount(0);
    await fresh.close();

    // Marcar como leída desde la bandeja baja el contador a cero.
    await go(page, '/notificaciones');
    const read = page.getByTestId('notification-item').getByTestId('notification-mark-read');
    if (await read.count()) await read.click();
    await go(page, '/');
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0);
    await context.close();
  });

  test('[TC-NOTIFICATIONS-PREFS-001] [TC-NOTIFICATIONS-PREFS-003] las preferencias llegan activadas por defecto, se guardan y quedan auditadas', async ({
    browser,
  }) => {
    const username = `alertas-pref-${randomUUID().slice(0, 8)}`;
    const password = `Pw-${randomUUID()}`;
    await createKeycloakUser(username, password);
    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    await login(page, username, password);
    const me = await bff(page, 'GET', '/api/bff/v1/me');
    const workspaceId = (me.body?.['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const W = `/workspaces/${workspaceId}`;

    await go(page, '/preferencias');
    const panel = page.getByTestId('notification-preferences');
    await expect(panel).toBeVisible();
    for (const id of ['BUDGET_THRESHOLD', 'MONTH_CLOSE_PENDING'])
      for (const channel of ['inApp', 'email'])
        await expect(page.getByTestId(`pref-${id}-${channel}`)).toBeChecked();
    await expect(page.getByTestId('pref-include-details')).not.toBeChecked();
    await expect(page.getByTestId('pref-privacy-warning')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByTestId('pref-BUDGET_THRESHOLD-email').uncheck();
    await page.getByTestId('notification-preferences-save').click();
    await expect(page.getByTestId('notification-preferences-notice')).toBeVisible();
    const saved = await api(page, 'GET', `${W}/notification-preferences`);
    expect(
      (saved['types'] as { type: string; email: boolean }[]).find((t) => t.type === 'BUDGET_THRESHOLD')!
        .email,
    ).toBe(false);
    expect(saved['version']).toBe(2);
    const audit = await api(page, 'GET', `${W}/audit-log?limit=50`);
    expect(
      (audit['data'] as { action: string }[]).some((e) => e.action === 'notifications.preferences.updated'),
    ).toBe(true);
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/preferencias');
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
