import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { bff, env } from '../src/helpers.js';
import { api, go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Conectar un exchange SIMULADO, sincronizar, aprobar y ver las conversiones; reemplazar la credencial y revocar
 * (openspec add-banking-providers 8.4; TC-IMPORTS-BANKING-004, -007, -011, -013, -019, -023, -024, -025). El stack se
 * levanta con `IMPORTS_PROVIDER_FAKE_ENABLED=true` (solo E2E): el proveedor `FAKE_EXCHANGE` no sale a la red. Datos
 * SINTÉTICOS; el secreto de la prueba es ficticio y la pantalla nunca lo vuelve a mostrar.
 */
const SECRET = 'sk-e2e-secreto-ficticio-que-no-debe-mostrarse';
const KEY_ID = 'AKIA-E2E-0000-a1b2';

/** Habilita BTC en el workspace (D45: el catálogo por defecto es BOB, USD y USDT) como `pf_app` con contexto RLS. */
async function enableBtc(userId: string, workspaceId: string): Promise<void> {
  const db = new Client({ connectionString: env()['DATABASE_URL']! });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      userId,
      workspaceId,
    ]);
    await db.query(
      `INSERT INTO fx.workspace_currency (workspace_id, currency_code) VALUES ($1, 'BTC') ON CONFLICT DO NOTHING`,
      [workspaceId],
    );
    await db.query('COMMIT');
  } finally {
    await db.end();
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

test.describe('Conexiones con exchanges (imports/banking-providers)', () => {
  test('[TC-IMPORTS-BANKING-004] [TC-IMPORTS-BANKING-007] [TC-IMPORTS-BANKING-019] [TC-IMPORTS-BANKING-023] [TC-IMPORTS-BANKING-024] [TC-IMPORTS-BANKING-025] [TC-IMPORTS-BANKING-013] conectar el exchange simulado, sincronizar, aprobar y ver las conversiones; revocar', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const { context, page, W, workspaceId } = await newFinanceUser(browser, 'conexiones');
    const me = (await api(page, 'GET', '/me')) as { id: string };
    await enableBtc(me.id, workspaceId);
    await openAccount(page, W, 'Exchange USDT', 'CRYPTO_WALLET', 'USDT', '0.000000');
    await openAccount(page, W, 'Exchange BTC', 'CRYPTO_WALLET', 'BTC', '0.00000000');

    try {
      await go(page, '/imports/conexiones');
      await expect(page.getByTestId('import-connections')).toBeVisible();
      await expect(page.getByTestId('connections-empty')).toBeVisible();

      // Alta: el proveedor real aparece solo si está disponible; el simulado sí (stack E2E).
      const form = page.getByTestId('connection-form');
      await form
        .getByTestId('connection-provider')
        .selectOption({ label: 'Exchange simulado (solo pruebas)' });
      await form.getByTestId('connection-name').fill('Exchange principal');
      await form.getByTestId('connection-asset').first().fill('USDT');
      await form.getByTestId('connection-account').first().selectOption({ label: 'Exchange USDT (USDT)' });
      await form.getByRole('button', { name: 'Agregar activo' }).click();
      await form.getByTestId('connection-asset').nth(1).fill('BTC');
      await form.getByTestId('connection-account').nth(1).selectOption({ label: 'Exchange BTC (BTC)' });
      await form.getByTestId('connection-key-id').fill(KEY_ID);
      await form.getByTestId('connection-secret').fill(SECRET);
      await form.getByTestId('connection-create').click();

      // Verificando → Activa: el worker comprueba que la clave es de solo lectura. La huella se ve; el secreto, nunca.
      const card = page.getByTestId('connection-item').first();
      await expect(card.getByTestId('connection-status')).toContainText('Activa', { timeout: 90_000 });
      await expect(card.getByTestId('connection-fingerprint')).toContainText('…a1b2');
      expect(await page.content()).not.toContain(SECRET);
      expect(await page.content()).not.toContain(KEY_ID);
      expect(await seriousViolations(page)).toEqual([]);

      // Primera sincronización: pide la fecha de inicio (hasta 365 días atrás).
      await expect(card.getByTestId('connection-sync')).toBeDisabled();
      await card.getByTestId('connection-sync-from').fill('2026-09-01');
      await card.getByTestId('connection-sync').click();

      // Llega a la vista previa del import (misma pantalla de revisión): 6 filas, el P2P excluido.
      await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(page.getByTestId('import-summary-counts')).toContainText('6 filas', { timeout: 120_000 });
      await expect(page.locator('[data-testid="import-row"][data-classification="INVALID"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="import-row"][data-classification="NEW"]')).toHaveCount(5);

      // Una segunda sincronización mientras esta espera aprobación se rechaza (CONNECTION_SYNC_IN_PROGRESS).
      const connectionId = String(
        ((await api(page, 'GET', `${W}/imports/connections`)) as { data: { id: string }[] }).data[0]!.id,
      );
      const second = await bff(page, 'POST', `/api/bff/v1${W}/imports/connections/${connectionId}/sync`, {
        body: { from: '2026-09-01' },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(second.status).toBe(409);
      expect(second.body?.['code']).toBe('CONNECTION_SYNC_IN_PROGRESS');

      // Aprobar: se crean 5 transacciones (conversión, depósito, retiro, comisión y recompensa); el P2P no.
      await page.getByTestId('import-approve').click();
      await page.getByRole('button', { name: 'Aprobar e importar' }).click();
      await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'COMPLETED', {
        timeout: 120_000,
      });
      const imported = (await api(page, 'GET', `${W}/transactions?limit=50`)) as { data: { kind: string }[] };
      expect(imported.data.filter((t) => t.kind === 'CONVERSION')).toHaveLength(1);
      expect(imported.data).toHaveLength(5);

      // Revocar: pide confirmación, destruye la credencial y la conexión queda revocada; lo importado se conserva.
      await go(page, '/imports/conexiones');
      const again = page.getByTestId('connection-item').first();
      await again.getByTestId('connection-revoke').click();
      await expect(page.getByTestId('connection-revoke-confirm')).toContainText(
        'Recuerda borrar también la clave',
      );
      await page.getByTestId('connection-revoke-confirm').getByRole('button', { name: 'Revocar' }).click();
      await expect(again.getByTestId('connection-status')).toContainText('Revocada');
      await expect(again.getByTestId('connection-sync')).toHaveCount(0);
      expect(await page.content()).not.toContain(SECRET);
      const after = (await api(page, 'GET', `${W}/transactions?limit=50`)) as { data: unknown[] };
      expect(after.data).toHaveLength(5);
    } finally {
      await context.close();
    }
  });
});
