import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Client } from 'pg';
import { SessionCipher, parseSessionKeys } from '../../../apps/web/src/bff/session-crypto.js';
import { readEnv } from './stack.js';

export type SeedUser = 'owner' | 'editor' | 'viewer' | 'outsider';

/** IDs fijos de la Minimal Seed (apps/api/src/seed/run-seed.ts, docs/29 §2.1). */
export const W1 = '0199a000-0000-7000-8000-00000000a001';
export const W2 = '0199a000-0000-7000-8000-00000000a002';
export const SESSION_COOKIE = '__Host-pfos_sid';
export const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

let cached: Record<string, string> | undefined;
export const env = (): Record<string, string> => (cached ??= readEnv());
export const appUrl = (): string => env()['WEB_PUBLIC_URL']!;
export const issuer = (): string => env()['OIDC_ISSUER_URL']!;
export const passwordOf = (user: string): string => env()[`PF_DEV_KC_${user.toUpperCase()}_PASSWORD`]!;

/** Login real en la UI de Keycloak a partir de una página protegida (el BFF redirige al IdP). */
export async function login(
  page: Page,
  user: string,
  password = passwordOf(user),
  path = '/',
): Promise<void> {
  await page.goto(new URL(path, appUrl()).href);
  await expect(page).toHaveURL(/\/realms\/pfos\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page.getByTestId('ready')).toBeAttached({ timeout: 30_000 });
}

export async function newUserPage(browser: Browser, user: string, path = '/') {
  const context = await browser.newContext({ baseURL: appUrl() });
  const page = await context.newPage();
  await login(page, user, passwordOf(user), path);
  return { context, page };
}

export async function sidOf(context: BrowserContext): Promise<string> {
  const c = (await context.cookies(appUrl())).find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('sin cookie de sesión');
  return c.value;
}

/** `fetch` desde el JS de la página (como lo hace la app), con el token CSRF de `/api/bff/session`. */
export async function bff(
  page: Page,
  method: string,
  path: string,
  options: { body?: unknown; contentType?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return page.evaluate(
    async ({ method, path, options }) => {
      const s = (await (await fetch('/api/bff/session')).json()) as { csrfToken?: string };
      const headers: Record<string, string> = { 'x-csrf-token': s.csrfToken ?? '', ...options.headers };
      if (options.body !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
      const r = await fetch(path, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
    },
    { method, path, options },
  );
}

/** Conexión del dueño de las migraciones (solo el test inspecciona `iam.bff_session`). */
export async function migratorDb(): Promise<Client> {
  const client = new Client({ connectionString: env()['DATABASE_MIGRATOR_URL']! });
  await client.connect();
  return client;
}

/** Tokens reales de la sesión, descifrados con la clave del `.env` desechable (para compararlos con lo observado). */
export async function sessionTokens(db: Client): Promise<{
  raw: string;
  tokens: { accessToken: string; refreshToken?: string; idToken?: string };
}> {
  const { rows } = await db.query<{ id: string; tokens_enc: Buffer }>(
    `SELECT id, tokens_enc FROM iam.bff_session WHERE kind = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw new Error('sin sesión activa en iam.bff_session');
  const cipher = new SessionCipher(parseSessionKeys(env()['BFF_SESSION_ENC_KEY']!));
  return {
    raw: row.tokens_enc.toString('utf8'),
    tokens: JSON.parse(cipher.decrypt(row.tokens_enc, `${row.id}:tokens`)) as {
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
    },
  };
}

/** Usuario nuevo en el realm vía la API de administración de Keycloak (credenciales del `.env` desechable). */
export async function createKeycloakUser(username: string, password: string): Promise<void> {
  const base = env()['OIDC_PUBLIC_BASE_URL']!;
  const tokenRes = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'pfos-admin',
      password: env()['PF_DEV_KEYCLOAK_ADMIN_PASSWORD']!,
    }),
  });
  const { access_token: adminToken } = (await tokenRes.json()) as { access_token: string };
  const res = await fetch(`${base}/admin/realms/pfos/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@demo.pfos.test`,
      emailVerified: true,
      enabled: true,
      firstName: 'Nuevo',
      lastName: 'Demo',
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  if (res.status !== 201) throw new Error(`no se pudo crear el usuario de Keycloak (${res.status})`);
}
