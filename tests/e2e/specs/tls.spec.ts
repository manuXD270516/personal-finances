import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:tls';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { env, sidOf } from '../src/helpers.js';
import { E2E_PROJECT, ROOT } from '../src/stack.js';

/**
 * Stack de E2E por HTTPS (change add-e2e-https, D516): las tres URL públicas, la autoridad efímera del proxy y la
 * subida directa sin contenido mixto. Solo en Chromium: WebKit corre el subconjunto de `playwright.config.ts`.
 */
const execFileAsync = promisify(execFile);

const pdf = (label: string): Buffer => {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 20 100 Td (${label}) Tj ET`));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
      'latin1',
    ),
    Buffer.from(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
};

test.describe('stack de E2E por HTTPS (platform/local-environment)', () => {
  test('[TC-PLATFORM-STACK-009] las URL públicas del .env desechable son https://localhost con el puerto TLS y el login termina con sesión', async ({
    browser,
  }) => {
    const e = env();
    const expected: Record<string, string> = {
      WEB_PUBLIC_URL: e['PF_WEB_TLS_PORT']!,
      OIDC_PUBLIC_BASE_URL: e['PF_KEYCLOAK_TLS_PORT']!,
      OBJECT_STORAGE_PUBLIC_ENDPOINT: e['PF_OBJECT_STORAGE_TLS_PORT']!,
    };
    for (const [key, port] of Object.entries(expected)) {
      expect(e[key], key).toBe(`https://localhost:${port}`);
      expect(port, key).toMatch(/^[34]\d{4}$/);
    }
    // Lo que se deriva por interpolación sigue el mismo esquema (issuer, redirect URI del realm, CORS).
    expect(e['OIDC_ISSUER_URL']).toBe(`${e['OIDC_PUBLIC_BASE_URL']}/realms/pfos`);
    expect(e['OBJECT_STORAGE_CORS_ORIGINS']).toBe(e['WEB_PUBLIC_URL']);

    const { context, page } = await newFinanceUser(browser, 'tls-login');
    expect(page.url().startsWith(`${e['WEB_PUBLIC_URL']}/`)).toBe(true);
    expect((await sidOf(context)).length).toBeGreaterThan(20);
    await context.close();
  });

  test('[TC-PLATFORM-STACK-010] el proxy sirve un certificado de su autoridad interna efímera, sin volúmenes y sin claves en el repositorio', async () => {
    const e = env();
    const root = process.env['NODE_EXTRA_CA_CERTS'];
    expect(root, 'el global setup debe fijar NODE_EXTRA_CA_CERTS con la raíz del proxy').toBeTruthy();
    expect(process.env['NODE_TLS_REJECT_UNAUTHORIZED']).not.toBe('0');

    // La cadena se valida de verdad contra la raíz copiada del proxy (sin rejectUnauthorized: false).
    for (const key of ['PF_WEB_TLS_PORT', 'PF_KEYCLOAK_TLS_PORT', 'PF_OBJECT_STORAGE_TLS_PORT']) {
      const cert = await new Promise<{ authorized: boolean; issuer: string }>((resolve, reject) => {
        const socket = connect(
          {
            host: e['PF_BIND_ADDR'],
            port: Number(e[key]),
            servername: 'localhost',
            ca: readFileSync(root!),
            rejectUnauthorized: true,
          },
          () => {
            const peer = socket.getPeerCertificate();
            resolve({ authorized: socket.authorized, issuer: String(peer.issuer?.CN ?? '') });
            socket.end();
          },
        );
        socket.on('error', reject);
      });
      expect(cert.authorized, key).toBe(true);
      expect(cert.issuer, key).toMatch(/Caddy Local Authority/);
    }

    // La autoridad y los certificados viven en memoria: ningún volumen con nombre, solo `tmpfs` y el Caddyfile.
    const container = `${E2E_PROJECT}-tls-proxy-1`;
    const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{json .Mounts}}', container]);
    const mounts = JSON.parse(stdout) as { Type: string; Destination: string }[];
    expect(mounts.filter((m) => m.Type === 'volume')).toEqual([]);
    const tmpfs = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{json .HostConfig.Tmpfs}}',
      container,
    ]);
    expect(Object.keys(JSON.parse(tmpfs.stdout) as Record<string, string>)).toEqual(
      expect.arrayContaining(['/data', '/config']),
    );
    const volumes = await execFileAsync('docker', [
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `label=com.docker.compose.project=${E2E_PROJECT}`,
    ]);
    expect(volumes.stdout, 'ningún volumen del proyecto es de la autoridad').not.toMatch(/caddy/);

    // Nada versionado: ni claves privadas en los archivos del proxy ni excepciones nuevas en gitleaks.
    const tracked = execFileSync('git', ['ls-files', 'deploy/compose'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(tracked.filter((f) => /\.(crt|pem|key)$/.test(f))).toEqual([]);
    for (const file of tracked) {
      expect(readFileSync(`${ROOT}/${file}`, 'utf8'), file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
    expect(readFileSync(`${ROOT}/.gitleaks.toml`, 'utf8')).not.toMatch(/caddy|Caddyfile|tls-proxy/i);
  });

  test('[TC-PLATFORM-STACK-011] la subida directa de un documento va por https al puerto TLS de archivos, sin contenido mixto ni violaciones de CSP', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const filesOrigin = new URL(env()['OBJECT_STORAGE_PUBLIC_ENDPOINT']!).origin;
    const { context, page, W } = await newFinanceUser(browser, 'tls-subida');
    const problems: string[] = [];
    const uploads: { url: string; method: string; status: number }[] = [];
    page.on('console', (msg) => {
      if (/mixed content|content security policy|refused to|blocked/i.test(msg.text()))
        problems.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.url().startsWith(filesOrigin) && res.request().method() === 'PUT')
        uploads.push({ url: res.url(), method: res.request().method(), status: res.status() });
    });
    page.on('requestfailed', (req) => {
      if (req.url().startsWith('http://')) problems.push(`petición http fallida: ${req.url()}`);
    });

    const caja = await openAccount(page, W, 'Caja TLS', 'CASH', 'BOB', '500.00');
    const expense = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: todayLaPaz(),
      accountId: caja,
      amount: bob('20.00'),
      description: 'Compra TLS',
    });
    await go(page, `/transacciones/${String(expense['id'])}`);
    const section = page.getByTestId('attachments');
    await section.getByTestId('attachment-file').setInputFiles({
      name: 'comprobante-tls.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('Comprobante TLS 20.00'),
    });
    await expect(section.getByTestId('attachment-item')).toHaveCount(1, { timeout: 60_000 });

    expect(uploads.length).toBeGreaterThan(0);
    for (const u of uploads) {
      expect(u.url.startsWith('https://localhost:'), u.url).toBe(true);
      expect(u.status, u.url).toBeLessThan(300);
    }
    expect(problems).toEqual([]);
    await context.close();
  });
});
