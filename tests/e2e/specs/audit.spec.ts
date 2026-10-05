import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { W1, bff, env, newUserPage, sessionTokens, migratorDb } from '../src/helpers.js';

/** Filas de auditoría de W1 como `pf_app` con contexto RLS (el owner de la tabla tampoco las ve: RLS forzada). */
async function auditRowsOfW1(userId: string): Promise<Record<string, unknown>[]> {
  const db = new Client({ connectionString: env()['DATABASE_URL']! });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
      userId,
      W1,
    ]);
    const { rows } = await db.query(
      `SELECT action, actor_user_id, user_agent, client_ip_hash, to_jsonb(a)::text AS dump
         FROM audit.audit_log a ORDER BY occurred_at, id`,
    );
    await db.query('ROLLBACK');
    return rows;
  } finally {
    await db.end();
  }
}

test.describe('pista de auditoría (audit/audit-trail)', () => {
  test('[TC-AUDIT-HISTORY-001] el OWNER edita el workspace y ve el cambio en su pestaña Historial', async ({
    browser,
  }) => {
    const { context, page } = await newUserPage(browser, 'owner', '/configuracion');
    const name = page.locator('input[name="name"]');
    await expect(name).toHaveValue('W1 Personal Demo');
    const history = page.getByTestId('audit-history');
    await expect(history.getByRole('heading', { name: 'Historial de cambios' })).toBeVisible();
    try {
      await name.fill('W1 Auditada');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(page.getByRole('status')).toHaveText('Cambios guardados.');
      const last = history.locator('li[data-action="identity.workspace.settings_changed"]').last();
      await expect(last).toContainText('Configuración modificada');
      await expect(last).toContainText('por ti');
      await expect(last.locator('tr[data-field="name"]')).toHaveText(/NombreW1 Personal DemoW1 Auditada/);
    } finally {
      // Deja W1 como la sembró la Minimal Seed (otras suites lo esperan); la corrección es otro registro.
      const current = await bff(page, 'GET', `/api/bff/v1/workspaces/${W1}`);
      if (current.body?.['name'] !== 'W1 Personal Demo') {
        const restored = await bff(page, 'PATCH', `/api/bff/v1/workspaces/${W1}`, {
          body: { name: 'W1 Personal Demo' },
          contentType: 'application/merge-patch+json',
          headers: { 'if-match': `"${String(current.body?.['version'])}"` },
        });
        expect(restored.status).toBe(200);
      }
      await context.close();
    }
  });

  test('[TC-AUDIT-ACCESS-001] VIEWER no ve el Historial y el log de auditoría le responde 403 INSUFFICIENT_ROLE', async ({
    browser,
  }) => {
    const viewer = await newUserPage(browser, 'viewer', '/configuracion');
    await expect(viewer.page.locator('input[name="name"]')).toHaveValue('W1 Personal Demo');
    await expect(viewer.page.getByTestId('audit-history')).toHaveCount(0);
    const denied = await bff(viewer.page, 'GET', `/api/bff/v1/workspaces/${W1}/audit-log`);
    expect(denied.status).toBe(403);
    expect(denied.body?.['code']).toBe('INSUFFICIENT_ROLE');
    await viewer.context.close();
  });

  test('[TC-AUDIT-SESSION-001] login y logout reales quedan auditados con user agent y HMAC de IP, sin tokens', async ({
    browser,
  }) => {
    const { context, page } = await newUserPage(browser, 'editor');
    const me = await bff(page, 'GET', '/api/bff/v1/me');
    const userId = String(me.body?.['id']);
    const db = await migratorDb();
    let accessToken: string;
    try {
      accessToken = (await sessionTokens(db)).tokens.accessToken;
    } finally {
      await db.end();
    }
    const userAgent = await page.evaluate(() => navigator.userAgent);
    // "Cerrar sesión" vive en el menú de la cuenta de la barra superior (AppFrame).
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect
      .poll(async () => (await auditRowsOfW1(userId)).some((r) => r['action'] === 'identity.session.ended'))
      .toBe(true);
    // Las dos últimas de este usuario son las de esta sesión (otras suites pueden haber dejado sesiones abiertas).
    const rows = (await auditRowsOfW1(userId))
      .filter((r) => r['actor_user_id'] === userId && String(r['action']).startsWith('identity.session.'))
      .slice(-2);
    expect(rows.map((r) => r['action'])).toEqual(['identity.session.started', 'identity.session.ended']);
    for (const r of rows) {
      expect(r['user_agent']).toBe(userAgent);
      expect((r['client_ip_hash'] as Buffer).length).toBe(32);
      expect(String(r['dump'])).not.toContain(accessToken);
      expect(String(r['dump'])).not.toContain('pfos_sid');
    }
    await context.close();
  });
});
