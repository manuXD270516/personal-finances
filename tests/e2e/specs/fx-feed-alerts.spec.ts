import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser } from '../src/finance.js';
import { FxProviderSim, minutesAgo, pastDays, triggerPoll } from '../src/fx-sim.js';
import { env } from '../src/helpers.js';

/**
 * Alertas de tasas con providers SIMULADOS (add-rate-feed-alerts 7.1; TC-NOTIFICATIONS-FX-008): un servidor HTTP local del
 * harness hace de paralelo.bo y bo.dolarapi.com (nunca la red real) y cada ciclo de consulta lo dispara la prueba. El
 * reloj del stack no se puede adelantar: la obsolescencia se provoca con un provider que publica una tasa de hace 25 h
 * (el episodio se mide sobre la vigencia de la última tasa aceptada, no sobre el reloj del job). Escenario: caída y
 * obsolescencia (alerta con enlace al estado por par), recuperación (aviso) y una muestra anómala que se confirma desde
 * el enlace de su notificación; axe sin violaciones serias en la bandeja y en Configuración.
 */
const sim = new FxProviderSim();
const HISTORY = pastDays(6, 2).map((day) => ({ day, value: '12.02' }));

interface Status {
  provider: 'PARALELO_BO' | 'DOLARAPI_BO';
  lastAttemptAt: string | null;
}

async function statuses(page: Page, W: string): Promise<Status[]> {
  return (await api(page, 'GET', `${W}/fx-providers/status`))['data'] as Status[];
}

/** Dispara un ciclo y espera a que ambos providers registren un intento nuevo. */
async function poll(page: Page, W: string): Promise<void> {
  const before = await statuses(page, W);
  const at = (list: Status[], p: Status['provider']) =>
    list.find((s) => s.provider === p)?.lastAttemptAt ?? null;
  await triggerPoll();
  await expect
    .poll(
      async () => {
        const now = await statuses(page, W);
        return (['PARALELO_BO', 'DOLARAPI_BO'] as const).every(
          (p) => at(now, p) !== null && at(now, p) !== at(before, p),
        );
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toBe(true);
}

interface Note {
  id: string;
  type: string;
  title: string;
  severity: string;
  link: { kind: string; fxRateId?: string };
  params: { base?: string; quote?: string; value?: string };
}

async function notes(page: Page, W: string, type: string): Promise<Note[]> {
  const list = (await api(page, 'GET', `${W}/notifications?limit=100`))['data'] as Note[];
  return list.filter((n) => n.type === type);
}

const titleOf = (n: Note[], pair: string) =>
  n.find((x) => `${x.params.base}/${x.params.quote}` === pair)?.title;

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

const mailpitApi = (): string => `http://${env()['PF_BIND_ADDR']}:${env()['PF_MAILPIT_UI_PORT']}/api/v1`;

/** Emails de Mailpit para `address` con su texto (el despacho SMTP es asíncrono: se reintenta hasta que llegan). */
async function mailsTo(address: string): Promise<{ subject: string; text: string; html: string }[]> {
  const list = (await (await fetch(`${mailpitApi()}/messages?limit=200`)).json()) as {
    messages: { ID: string; Subject: string; To: { Address: string }[] }[];
  };
  return Promise.all(
    list.messages
      .filter((m) => m.To.some((t) => t.Address === address))
      .map(async (m) => {
        const full = (await (await fetch(`${mailpitApi()}/message/${m.ID}`)).json()) as {
          Text: string;
          HTML: string;
        };
        return { subject: m.Subject, text: full.Text, html: full.HTML };
      }),
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('Alertas de tasas con providers simulados (notifications/alerts)', () => {
  test.beforeAll(async () => {
    await sim.start();
  });
  test.afterAll(async () => {
    await sim.stop();
  });

  test('[TC-NOTIFICATIONS-FX-008] [TC-NOTIFICATIONS-FX-001] [TC-NOTIFICATIONS-FX-003] [TC-NOTIFICATIONS-FX-004] obsolescencia, recuperación y muestra anómala confirmada desde el enlace de su notificación', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    // Los providers solo publican una tasa de hace 25 h (y la casa de respaldo está caída): más de 24 h sin tasa fresca.
    sim.paralelo = { rate: { median: '12.02', at: minutesAgo(25 * 60) }, history: HISTORY };
    sim.dolarapi = { binance: null, oficial: { compra: '12', venta: '12', at: minutesAgo(60) } };
    const { context, page, W } = await newFinanceUser(browser, 'fxfa');
    await poll(page, W);

    // Alerta de obsolescencia (una por par, sin repetirse) en el centro de notificaciones.
    await expect
      .poll(async () => (await notes(page, W, 'FX_RATE_FEED_STALE')).length, { timeout: 60_000 })
      .toBe(2);
    const stale = await notes(page, W, 'FX_RATE_FEED_STALE');
    expect(titleOf(stale, 'USDT/BOB')).toBe('USDT/BOB lleva más de 24 horas sin tasa automática');
    expect(stale.every((n) => n.severity === 'WARNING' && n.link.kind === 'FX_FEED_STATUS')).toBe(true);
    await poll(page, W);
    expect(await notes(page, W, 'FX_RATE_FEED_STALE')).toHaveLength(2);

    // Email sin opt-in de detalles: no lleva valores, monedas ni providers y enlaza a la app autenticada (FR-NOTIFY-006).
    const address = String((await api(page, 'GET', '/me'))['email']);
    await expect
      .poll(
        async () =>
          (await mailsTo(address)).filter(
            (m) => m.subject === 'Una tasa automática lleva horas sin actualizarse',
          ).length,
        { timeout: 90_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThanOrEqual(1);
    const mail = (await mailsTo(address)).find(
      (m) => m.subject === 'Una tasa automática lleva horas sin actualizarse',
    )!;
    const body = `${mail.subject}\n${mail.text}\n${mail.html}`.replace(/https?:\/\/\S+/g, '');
    for (const secret of ['USDT', 'BOB', 'USD', '12.02', '12,02', 'paralelo'])
      expect(body).not.toContain(secret);
    expect(mail.text).toMatch(/\/notificaciones\/[0-9a-f-]{36}/);

    await go(page, '/notificaciones');
    const item = page
      .getByTestId('notification-item')
      .filter({ hasText: 'USDT/BOB lleva más de 24 horas sin tasa automática' });
    await expect(item).toHaveCount(1);
    expect(await seriousViolations(page)).toEqual([]);
    await item.getByTestId('notification-title').click();
    await page.getByTestId('notification-open-resource').click();
    // Configuración → Tasas automáticas: el par con el episodio abierto lo muestra.
    await expect(page.getByTestId('rate-pairs')).toBeVisible();
    await expect(
      page.locator('[data-testid="rate-pair-row"][data-pair="USDT/BOB"]').getByTestId('rate-pair-episode'),
    ).toContainText('Aviso de obsolescencia');
    expect(await seriousViolations(page)).toEqual([]);

    // Recuperación: el provider vuelve con una tasa fresca.
    sim.paralelo = { rate: { median: '12.05', at: minutesAgo(3) }, history: HISTORY };
    await poll(page, W);
    await expect
      .poll(async () => (await notes(page, W, 'FX_RATE_FEED_RECOVERED')).length, { timeout: 60_000 })
      .toBe(2);
    const recovered = await notes(page, W, 'FX_RATE_FEED_RECOVERED');
    expect(titleOf(recovered, 'USDT/BOB')).toBe('USDT/BOB volvió a tener tasa automática');
    expect(recovered.every((n) => n.severity === 'INFO')).toBe(true);
    await poll(page, W);
    expect(await notes(page, W, 'FX_RATE_FEED_RECOVERED')).toHaveLength(2);

    // Muestra anómala: 12.05 → 13.50 (+12 %) queda retenida y avisa una sola vez.
    sim.paralelo = { rate: { median: '13.50', at: minutesAgo(1) }, history: HISTORY };
    await poll(page, W);
    await expect
      .poll(async () => (await notes(page, W, 'FX_RATE_ANOMALY_RETAINED')).length, { timeout: 60_000 })
      .toBe(2);
    const held = (await notes(page, W, 'FX_RATE_ANOMALY_RETAINED')).find((n) => n.params.base === 'USDT')!;
    expect(held.link.kind).toBe('FX_RATE');
    await poll(page, W);
    expect(await notes(page, W, 'FX_RATE_ANOMALY_RETAINED')).toHaveLength(2);

    // Desde el enlace de la notificación se llega a la muestra y se confirma con un motivo.
    await go(page, '/notificaciones');
    await page
      .getByTestId('notification-item')
      .filter({ hasText: 'USDT/BOB' })
      .filter({ hasText: 'retenida' })
      .first()
      .getByTestId('notification-title')
      .click();
    await page.getByTestId('notification-open-resource').click();
    const sample = page.locator(`[data-testid="anomaly"][data-rate-id="${held.link.fxRateId}"]`);
    await expect(sample).toBeVisible();
    await sample.getByLabel('Motivo').fill('Movimiento real del mercado');
    await sample.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('fx-providers').getByRole('status')).toContainText('Anomalía confirmada');
    const latest = (await api(page, 'GET', `${W}/fx-rates/latest?base=USDT&quote=BOB`))['rate'] as {
      value: string;
    };
    expect(latest.value).toMatch(/^13\.5/);
    await poll(page, W);
    expect(await notes(page, W, 'FX_RATE_ANOMALY_RETAINED')).toHaveLength(2);
    await context.close();
  });
});
