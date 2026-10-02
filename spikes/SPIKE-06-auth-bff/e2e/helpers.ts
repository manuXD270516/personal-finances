import { createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

process.loadEnvFile('.env');
export const E = process.env as Record<string, string>;
export const APP = 'http://localhost:61600';
export const API = 'http://127.0.0.1:61680';
export const WS_DEMO = '01999a7c-0000-7000-8000-00000000d3e0';
export const WS_OTHER = '01999a7c-0000-7000-8000-0000000000ff';
export const TOKEN_ENDPOINT = `${E.OIDC_ISSUER}/protocol/openid-connect/token`;
export type User = 'owner' | 'editor' | 'viewer' | 'outsider';
export const pw = (u: User) => E[`E2E_${u.toUpperCase()}_PASSWORD`]!;

export const valkey = new Redis(E.VALKEY_URL!);

/** Lee y descifra la sesión del store (solo el test tiene la clave; replica web/lib/session.ts). */
export async function readSession(sid: string) {
  const k = `pfos:sess:${createHash('sha256').update(sid).digest('base64url')}`;
  const blob = await valkey.get(k);
  if (!blob) return null;
  const [, iv, ct, tag] = blob.split('.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(E.SESSION_ENC_KEY!, 'base64'), Buffer.from(iv!, 'base64url'));
  d.setAAD(Buffer.from(k));
  d.setAuthTag(Buffer.from(tag!, 'base64url'));
  const json = Buffer.concat([d.update(Buffer.from(ct!, 'base64url')), d.final()]).toString('utf8');
  return { key: k, raw: blob, data: JSON.parse(json) as { accessToken: string; refreshToken: string; idToken: string; refreshCount: number; accessTokenExpiresAt: number } };
}

export async function sidOf(ctx: BrowserContext): Promise<string> {
  const c = (await ctx.cookies(APP)).find((c) => c.name === '__Host-pfos_sid');
  if (!c) throw new Error('sin cookie de sesión');
  return c.value;
}

/** Login real contra la UI de Keycloak. */
export async function login(page: Page, user: User) {
  await page.goto('/app');
  await expect(page).toHaveURL(/localhost:61681\/realms\/pfos\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(pw(user));
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(`${APP}/app`);
  await expect(page.getByTestId('ready')).toHaveText('listo');
}

export async function newUserPage(browser: Browser, user: User) {
  const context = await browser.newContext({ baseURL: APP });
  const page = await context.newPage();
  await login(page, user);
  return { context, page };
}

/** fetch desde el JS de la página (como lo haría la app), con CSRF salvo que se indique lo contrario. */
export async function bff(page: Page, method: string, path: string, opts: { body?: unknown; csrf?: boolean; contentType?: string } = {}) {
  return page.evaluate(
    async ({ method, path, opts }) => {
      const s = await (await fetch('/api/bff/session')).json();
      const headers: Record<string, string> = { 'Content-Type': opts.contentType ?? 'application/json' };
      if (opts.csrf !== false) headers['X-CSRF-Token'] = s.csrfToken;
      const r = await fetch(path, { method, headers, body: opts.body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(opts.body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { method, path, opts },
  );
}

/** Token real de Keycloak para tests directos contra la API (cliente e2e con direct grant). */
export async function directToken(user: User, client: 'e2e' | 'noaud' = 'e2e') {
  const id = client === 'e2e' ? E.E2E_CLIENT_ID! : E.E2E_NOAUD_CLIENT_ID!;
  const secret = client === 'e2e' ? E.E2E_CLIENT_SECRET! : E.E2E_NOAUD_CLIENT_SECRET!;
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: id, client_secret: secret, username: user, password: pw(user), scope: 'openid' }),
  });
  const j = (await r.json()) as { access_token: string };
  if (!j.access_token) throw new Error(`sin token: ${JSON.stringify(j)}`);
  return j.access_token;
}

export const jwtPayload = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

export function evidence(name: string, data: unknown) {
  mkdirSync('evidence', { recursive: true });
  writeFileSync(`evidence/${name}.json`, JSON.stringify(data, null, 2));
}
