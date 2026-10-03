import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { W1, W2, bff, createKeycloakUser, login, newUserPage } from '../src/helpers.js';

test.describe('autorización por workspace a través del BFF (security/access-control)', () => {
  test('[TC-SECURITY-RBAC-003] EDITOR y VIEWER no pueden modificar la configuración del workspace (403 INSUFFICIENT_ROLE)', async ({
    browser,
  }) => {
    for (const user of ['viewer', 'editor'] as const) {
      const { context, page } = await newUserPage(browser, user, '/configuracion');
      // La lectura está permitida: el formulario carga W1 con el rol del usuario.
      await expect(page.locator('input[name="name"]')).toHaveValue('W1 Personal Demo');
      await page.locator('input[name="name"]').fill(`Cambio de ${user}`);
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      const alert = page.locator('p[role="alert"]');
      await expect(alert).toHaveText('Tu rol no permite realizar esta acción.');
      await expect(alert).toHaveAttribute('data-error-code', 'INSUFFICIENT_ROLE');
      const after = await bff(page, 'GET', `/api/bff/v1/workspaces/${W1}`);
      expect(after.body?.['name']).toBe('W1 Personal Demo');
      await context.close();
    }
  });

  test('[TC-IDENTITY-MEMBERSHIP-001] un usuario que no es miembro no puede acceder a un workspace manipulando la URL', async ({
    browser,
  }) => {
    const { context, page } = await newUserPage(browser, 'outsider');
    const read = await bff(page, 'GET', `/api/bff/v1/workspaces/${W1}`);
    expect(read.status).toBe(403);
    expect(read.body?.['code']).toBe('WORKSPACE_ACCESS_DENIED');
    expect(JSON.stringify(read.body)).not.toContain('W1 Personal Demo');
    const write = await bff(page, 'PATCH', `/api/bff/v1/workspaces/${W1}`, {
      body: { name: 'Hackeado' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': '"1"' },
    });
    expect(write.status).toBe(403);
    expect(write.body?.['code']).toBe('WORKSPACE_ACCESS_DENIED');
    // Elegir W1 como workspace activo también se rechaza (la API decide la membresía).
    const select = await bff(page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: W1 } });
    expect(select.status).toBe(403);
    const list = await bff(page, 'GET', '/api/bff/v1/workspaces');
    expect((list.body?.['data'] as { id: string }[]).map((w) => w.id)).toEqual([W2]);
    await context.close();
  });

  test('[TC-IDENTITY-WORKSPACE-001] el primer login de un usuario nuevo crea su workspace personal; uno sembrado no', async ({
    page,
    browser,
  }) => {
    const username = `nuevo-${randomBytes(4).toString('hex')}`;
    const password = randomBytes(18).toString('base64url');
    await createKeycloakUser(username, password);
    await login(page, username, password);
    const list = await bff(page, 'GET', '/api/bff/v1/workspaces');
    const data = list.body?.['data'] as Record<string, unknown>[];
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      baseCurrency: 'BOB',
      timezone: 'America/La_Paz',
      locale: 'es-BO',
      fiscalMonthStartDay: 1,
      minimumLiquidityReserve: null,
      role: 'OWNER',
    });
    await expect(page.getByTestId('workspace-selector')).toHaveValue(String(data[0]!['id']));

    // viewer está sembrado como VIEWER de W1: su login no crea workspace personal.
    const viewer = await newUserPage(browser, 'viewer');
    const viewerList = await bff(viewer.page, 'GET', '/api/bff/v1/workspaces');
    expect((viewerList.body?.['data'] as { name: string }[]).map((w) => w.name)).toEqual([
      'W1 Personal Demo',
    ]);
    await viewer.context.close();
  });
});
