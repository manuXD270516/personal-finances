import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Suscripciones (openspec add-subscriptions 7.3; TC-COMMITMENTS-SUBS-033): se registran dos suscripciones (BOB y USD
 * con tasa paralela), el listado y la vista de costo muestran el total en moneda base, y el job diario emite el
 * recordatorio de renovación a la bandeja (asíncrono: el worker corre el job cada minuto en el stack e2e).
 */
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 2000));
  }
}

test.describe('Suscripciones', () => {
  test('[TC-COMMITMENTS-SUBS-033] se registran suscripciones, se ve el costo en moneda base y llega el recordatorio de renovación', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'suscripciones');
    const bank = await openAccount(page, W, 'Banco suscripciones', 'BANK', 'BOB', '5000.00');
    const visa = await openAccount(page, W, 'Visa USD', 'BANK', 'USD', '500.00');
    await api(page, 'POST', `${W}/fx-rates`, {
      base: 'USD',
      quote: 'BOB',
      value: '10.00',
      rateType: 'PARALLEL',
      asOf: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    const provider = String((await api(page, 'POST', `${W}/counterparties`, { name: 'Streamly' }))['id']);
    const renewal = addDays(todayLaPaz(), 1);

    const gym = await api(page, 'POST', `${W}/subscriptions`, {
      counterpartyId: provider,
      name: 'Gimnasio',
      price: bob('100.00'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: renewal,
      paymentAccountId: bank,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });
    expect(gym['status']).toBe('ACTIVE');
    await api(page, 'POST', `${W}/subscriptions`, {
      counterpartyId: provider,
      name: 'Streamly Premium',
      price: { amount: '10.00', currency: 'USD' },
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: addDays(todayLaPaz(), 20),
      paymentAccountId: visa,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });

    // Listado y costo: 100 BOB + 10 USD x 10 = 200 BOB al mes, 2.400 BOB al año.
    await go(page, '/recurring/suscripciones');
    await expect(page.getByTestId('subscription-row')).toHaveCount(2);
    await expect(page.getByTestId('cost-total-monthly')).toContainText('200,00');
    await expect(page.getByTestId('cost-total-annual')).toContainText('2.400,00');

    // El job diario emite el recordatorio de la renovación de mañana (una sola vez) a la bandeja.
    const reminder = await until(async () => {
      const r = await api(page, 'GET', `${W}/notifications?limit=50`);
      const items = (r['data'] as { type: string }[]).filter((n) => n.type === 'SUBSCRIPTION_RENEWAL');
      return items.length > 0 ? items : undefined;
    });
    expect(reminder).toHaveLength(1);

    await context.close();
  });
});
