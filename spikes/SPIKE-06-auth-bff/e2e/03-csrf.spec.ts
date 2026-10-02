import { test, expect } from '@playwright/test';
import { APP, bff, evidence, login, WS_DEMO } from './helpers';

const TX = `/api/bff/workspaces/${WS_DEMO}/transactions`;

test('CSRF: SameSite=Lax + Origin + Content-Type JSON + X-CSRF-Token', async ({ page, context }) => {
  await login(page, 'owner');
  const csrf: string = await page.evaluate(async () => (await (await fetch('/api/bff/session')).json()).csrfToken);
  const results: Record<string, unknown> = {};

  // Control positivo
  const ok = await bff(page, 'POST', TX, { body: { description: 'legit', amount: '10' } });
  expect(ok.status).toBe(201);
  results.positiveControl = ok.status;

  // a) Sin X-CSRF-Token (mismo origen, cookie presente)
  const noToken = await bff(page, 'POST', TX, { body: { description: 'x', amount: '1' }, csrf: false });
  expect(noToken).toMatchObject({ status: 403, body: { code: 'CSRF_TOKEN_INVALID' } });
  results.missingCsrfToken = `${noToken.status} ${noToken.body.code}`;

  // b) Cookie válida + token válido pero Origin ajeno (p. ej. bypass de SameSite desde un subdominio hermano)
  const forged = await context.request.post(`${APP}${TX}`, {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: { description: 'x', amount: '1' },
  });
  expect(forged.status()).toBe(403);
  results.foreignOrigin = `${forged.status()} ${(await forged.json()).code}`;

  // c) Sin Origin ni Sec-Fetch-Site (cliente no navegador con la cookie robada no basta)
  const noOrigin = await context.request.post(`${APP}${TX}`, {
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    data: { description: 'x', amount: '1' },
  });
  expect(noOrigin.status()).toBe(403);
  results.missingOrigin = `${noOrigin.status()} ${(await noOrigin.json()).code}`;

  // d) text/plain (lo único que un <form> cross-site puede mandar con "JSON")
  const plain = await bff(page, 'POST', TX, { body: { description: 'x', amount: '1' }, contentType: 'text/plain' });
  expect(plain.status).toBe(415);
  results.textPlain = `${plain.status} ${plain.body.code}`;

  // e) Ataque real cross-site: 127.0.0.1:61600 es OTRO sitio respecto de localhost:61600
  const attacker = await context.newPage();
  await attacker.goto('http://127.0.0.1:61600/evil');
  const [req] = await Promise.all([
    attacker.waitForRequest((r) => r.url().endsWith('/transactions') && r.method() === 'POST'),
    attacker.getByTestId('attack').click(),
  ]);
  const resp = await req.response();
  const reqHeaders = await req.allHeaders();
  const cookieSent = (reqHeaders['cookie'] ?? '').includes('__Host-pfos_sid');
  expect(cookieSent).toBe(false); // SameSite=Lax: el navegador no adjunta la cookie en POST cross-site
  expect(resp!.status()).toBe(403); // y aun así el BFF lo corta por Origin
  results.crossSiteFormPost = { status: resp!.status(), body: await resp!.json(), origin: reqHeaders['origin'], secFetchSite: reqHeaders['sec-fetch-site'], cookieSent };

  // Ninguna transacción del ataque llegó a la API
  const list = await bff(page, 'GET', TX);
  const descs = (list.body.items as Array<{ description: string }>).map((t) => t.description);
  expect(descs).not.toContain('csrf-attack');
  expect(descs.filter((d) => d === 'x')).toEqual([]);
  results.transactionsAfterAttacks = descs;

  evidence('03-csrf', results);
});
