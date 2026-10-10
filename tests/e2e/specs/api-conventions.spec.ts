import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { appUrl, bff, login } from '../src/helpers.js';

// Convenciones de API vistas desde la UI (add-api-conventions, tarea 7.1 diferida a este change).
test.describe('convenciones de API desde la UI (platform/api-conventions)', () => {
  test('[TC-PLATFORM-API-009] doble clic en "Crear espacio" produce un único workspace y la UI lo muestra una vez', async ({
    page,
  }) => {
    await login(page, 'owner', undefined, '/workspaces/nuevo');
    const name = `Doble clic ${randomBytes(3).toString('hex')}`;
    await page.locator('input[name="name"]').fill(name);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/bff/v1/workspaces')) {
        posts.push(r.headers()['idempotency-key'] ?? '');
      }
    });
    await page.getByRole('button', { name: 'Crear espacio' }).dblclick();
    await expect(page.getByRole('status')).toHaveText(`Espacio de trabajo creado: ${name}.`);
    // Si llegaron a salir dos peticiones, comparten la Idempotency-Key del intento.
    expect(new Set(posts).size).toBe(1);
    const list = await bff(page, 'GET', '/api/bff/v1/workspaces?limit=200');
    const names = (list.body?.['data'] as { name: string }[]).map((w) => w.name);
    expect(names.filter((n) => n === name)).toHaveLength(1);
  });

  test('[TC-PLATFORM-API-014] editar en dos pestañas: la segunda recibe el mensaje en español de versión obsoleta (412)', async ({
    page,
    context,
  }) => {
    await login(page, 'owner');
    const created = await bff(page, 'POST', '/api/bff/v1/workspaces', {
      body: { name: `Pestañas ${randomBytes(3).toString('hex')}`, baseCurrency: 'BOB' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(created.status).toBe(201);
    const select = await bff(page, 'PUT', '/api/bff/session', {
      body: { activeWorkspaceId: created.body?.['id'] },
    });
    expect(select.status).toBe(200);

    const tabA = page;
    const tabB = await context.newPage();
    for (const tab of [tabA, tabB]) {
      await tab.goto(`${appUrl()}/configuracion`);
      await expect(tab.locator('input[name="name"]')).toHaveValue(String(created.body?.['name']));
    }
    await tabA.locator('input[name="name"]').fill('Editado en A');
    await tabA.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(tabA.getByRole('status')).toHaveText('Cambios guardados.');
    // Guardar un nombre nuevo recarga la sesión: la confirmación debe sobrevivir a esa recarga (no parpadear).
    await tabA.waitForLoadState('networkidle');
    await expect(tabA.getByRole('status')).toHaveText('Cambios guardados.');

    await tabB.locator('input[name="name"]').fill('Editado en B');
    await tabB.getByRole('button', { name: 'Guardar cambios' }).click();
    const alert = tabB.locator('p[role="alert"]');
    await expect(alert).toHaveAttribute('data-error-code', 'PRECONDITION_FAILED');
    await expect(alert).toHaveText(
      'Este registro cambió desde que lo abriste. Recarga para ver la versión actual antes de guardar.',
    );
    const now = await bff(tabB, 'GET', `/api/bff/v1/workspaces/${String(created.body?.['id'])}`);
    expect(now.body?.['name']).toBe('Editado en A');
  });
});
