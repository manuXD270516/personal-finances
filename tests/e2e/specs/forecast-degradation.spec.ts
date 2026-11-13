import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, todayLaPaz } from '../src/finance.js';
import { prepareForecastHistory } from '../src/forecast-history.js';
import { serviceHealth, setMlService } from '../src/stack.js';

/**
 * Degradación del servicio de pronósticos (openspec add-ml-forecasting-service, tarea 8.6; forecast/expense-forecasting
 * «Pronóstico opcional y aislado del núcleo» y «Reintentos y falla de una corrida»). El stack E2E corre con el perfil
 * `ml` y `FORECASTING_MAX_ATTEMPTS=1` (los reintentos acortados por configuración: el valor por omisión espera 5 min × 3^(n−1)).
 * Un workspace con historia obtiene un pronóstico con el servicio real; luego se DETIENE `ml-forecasting`: el núcleo
 * (registrar un gasto, Home, calendario, reportes y periodos) sigue respondiendo, la corrida solicitada termina
 * `FAILED` con el motivo «servicio no disponible» y la vista conserva el último pronóstico marcado como desactualizado
 * con el estado del servicio visible. El servicio se vuelve a arrancar al terminar.
 */
test.describe('Con el servicio de pronósticos caído el núcleo responde y la vista informa la falla (forecast/expense-forecasting)', () => {
  test.afterAll(async () => {
    await setMlService('start');
  });

  test('[TC-FORECAST-SERVICE-001] [TC-FORECAST-SERVICE-029] con ml-forecasting detenido el núcleo responde, la corrida termina FAILED y se muestra el último pronóstico marcado', async ({
    browser,
  }) => {
    test.setTimeout(1_500_000);
    const { page, W } = await newFinanceUser(browser, 'fc-degradation');
    const { account, category } = await prepareForecastHistory(page, W);

    // 1. Con el servicio arriba: una corrida real publica el pronóstico vigente.
    await api(page, 'POST', `${W}/forecasts`);
    await expect
      .poll(async () => (await api(page, 'GET', `${W}/forecasts/latest?horizon=3`))['status'], {
        timeout: 600_000,
        intervals: [5_000],
      })
      .toBe('AVAILABLE');
    const before = await api(page, 'GET', `${W}/forecasts/latest?horizon=3`);
    expect(before['stale']).toBe(false);
    const generatedAt = String(before['generatedAt']);

    const liquid = async () => {
      const summary = await api(page, 'GET', `${W}/reports/summary`);
      const bobRow = (
        summary['byCurrency'] as { currency: string; liquidBalance: { amount: string } }[]
      ).find((r) => r.currency === 'BOB');
      return BigInt(bobRow!.liquidBalance.amount.replace('.', ''));
    };
    const balanceBefore = await liquid();

    // 2. Se detiene el servicio: los demás servicios del stack siguen healthy (TC-PLATFORM-MLSERVICE-001, parcial).
    await setMlService('stop');
    const health = await serviceHealth();
    expect(health['ml-forecasting']?.state).not.toBe('running');
    for (const svc of ['finance-api', 'finance-worker', 'finance-web', 'postgres'])
      expect(health[svc]?.health, svc).toBe('healthy');

    // 3. El núcleo responde igual: registrar un gasto, Home, calendario de flujo de caja, reportes y periodos.
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: account,
      amount: bob('150.00'),
      splits: [{ amount: bob('150.00'), categoryId: category }],
    });
    // El saldo líquido del Home baja exactamente 150.00 BOB (en centavos, sin pasar por `number`).
    expect(balanceBefore - (await liquid())).toBe(15000n);
    await api(page, 'GET', `${W}/reports/cash-flow-calendar?horizon=30`);
    await api(page, 'GET', `${W}/periods?limit=100`);
    await go(page, '/');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await go(page, '/flujo-de-caja');
    await expect(page.getByTestId('cash-flow-page')).toBeVisible();

    // 4. Una corrida manual con el servicio caído termina FAILED («servicio no disponible») tras los intentos configurados.
    await api(page, 'POST', `${W}/forecasts`);
    await expect
      .poll(
        async () => {
          const latest = await api(page, 'GET', `${W}/forecasts/latest?horizon=3`);
          return (latest['lastAttempt'] as { status: string } | null)?.status;
        },
        { timeout: 300_000, intervals: [5_000] },
      )
      .toBe('FAILED');
    const after = await api(page, 'GET', `${W}/forecasts/latest?horizon=3`);
    expect(after['status']).toBe('AVAILABLE');
    expect(after['stale']).toBe(true);
    expect(after['generatedAt']).toBe(generatedAt);
    expect((after['lastAttempt'] as { failureReason: string }).failureReason).toBe('SERVICE_UNAVAILABLE');
    expect((after['series'] as unknown[]).length).toBeGreaterThan(0);

    // 5. La vista lo informa: último pronóstico con el aviso de desactualizado y el estado del servicio con su motivo.
    await go(page, '/pronosticos');
    await expect(page.getByTestId('forecast-stale')).toBeVisible();
    await expect(page.getByTestId('forecast-series-card')).toBeVisible();
    await expect(page.getByTestId('forecast-service-status')).toBeVisible();
    await expect(page.getByTestId('forecast-service-enabled')).toContainText('Habilitado');
    await expect(page.getByTestId('forecast-service-last')).toContainText('fallida');
    await expect(page.getByTestId('forecast-service-reason')).toContainText('el servicio no está disponible');
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }));
    expect(serious, JSON.stringify(serious)).toEqual([]);

    // El estado también se lee en inglés y portugués.
    await go(page, '/en/pronosticos');
    await expect(page.getByTestId('forecast-service-reason')).toContainText('the service is unavailable');
    await go(page, '/pt/pronosticos');
    await expect(page.getByTestId('forecast-service-reason')).toContainText('o serviço não está disponível');
  });

  test('[TC-FORECAST-SERVICE-002] un workspace sin corridas ve el estado del servicio habilitado y sin corridas', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { page } = await newFinanceUser(browser, 'fc-status-none');
    await go(page, '/pronosticos');
    await expect(page.getByTestId('forecast-service-status')).toBeVisible();
    await expect(page.getByTestId('forecast-service-enabled')).toContainText('Habilitado');
    await expect(page.getByTestId('forecast-service-never')).toBeVisible();
  });
});
