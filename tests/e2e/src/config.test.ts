import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../playwright.config.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/pr.yml'), 'utf8');
const e2eJob = /^ {2}e2e:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n)/m.exec(workflow)?.[1] ?? '';

describe('proyecto webkit y job e2e (add-e2e-https)', () => {
  const projects = config.projects ?? [];
  const webkit = projects.find((p) => p.name === 'webkit');

  it('[TC-PLATFORM-WEBUI-019] el proyecto webkit corre app-shell, a11y, transactions, auth y content-security-policy', () => {
    expect(webkit, 'proyecto webkit').toBeDefined();
    const match = webkit!.testMatch as RegExp;
    for (const spec of ['app-shell', 'a11y', 'transactions', 'auth', 'content-security-policy'])
      expect(match.test(`specs/${spec}.spec.ts`), spec).toBe(true);
    expect(match.test('specs/notifications.spec.ts')).toBe(false);
    expect(match.test('specs/accounts.spec.ts')).toBe(false);
    expect(webkit!.use?.browserName).toBe('webkit');
    // Sin la cadena de notificaciones: no depende de `alerts`; corre después de chromium.
    expect(webkit!.dependencies).toEqual(['chromium']);
  });

  it('[TC-PLATFORM-WEBUI-019] el stack se sirve por https: los navegadores ignoran el certificado de la autoridad efímera', () => {
    expect(config.use?.ignoreHTTPSErrors).toBe(true);
  });

  it('[TC-PLATFORM-PIPELINE-044] WebKit corre dentro del job e2e (mismo nombre, 40 minutos) y no existe un job nuevo para él', () => {
    expect(e2eJob).toMatch(/timeout-minutes: 40\b/);
    expect(e2eJob).toMatch(/playwright install --with-deps chromium webkit/);
    expect(e2eJob).toMatch(/duration-summary\.ts/);
    expect(workflow).not.toMatch(/^ {2}(e2e-webkit|webkit):/m);
    // El nombre del job (el check obligatorio) no cambia: sin `name:` propio en el job e2e.
    expect(e2eJob).not.toMatch(/^ {4}name:/m);
  });
});

describe('proxy TLS del stack de E2E (add-e2e-https)', () => {
  const image = (file: string): string | undefined =>
    /image: (caddy:[\w.-]+@sha256:[a-f0-9]{64})/.exec(readFileSync(resolve(ROOT, file), 'utf8'))?.[1];

  it('[TC-PLATFORM-STACK-009] el tls-proxy usa la misma imagen y digest de Caddy que producción (Renovate los actualiza juntos)', () => {
    const dev = image('deploy/compose/compose.yaml');
    expect(dev).toBeDefined();
    expect(dev).toBe(image('deploy/compose/compose.prod.yaml'));
    const caddyfile = readFileSync(resolve(ROOT, 'deploy/compose/caddy/Caddyfile.e2e'), 'utf8').replace(
      /^\s*#.*$/gm,
      '',
    );
    expect(caddyfile).toContain('local_certs');
    expect(caddyfile).toContain('skip_install_trust');
    expect(caddyfile).not.toMatch(/Strict-Transport-Security/i);
  });
});
