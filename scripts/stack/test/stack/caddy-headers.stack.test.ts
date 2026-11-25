// Cabeceras del borde (openspec add-web-content-security-policy; TC-SECURITY-CSP-007 y la parte de cabeceras de -008):
// el Caddyfile REAL del repositorio con la imagen de compose.prod.yaml, delante de un doble de la web, del hostname de
// archivos y de Keycloak (otro Caddy que responde con cabeceras fijas). Red y contenedores propios `pfos-test-caddy-*`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../../src/lib/paths.js';

const SUFFIX = `${process.pid}`;
const NETWORK = `pfos-test-caddy-net-${SUFFIX}`;
const EDGE = `pfos-test-caddy-edge-${SUFFIX}`;
const UPSTREAM = `pfos-test-caddy-up-${SUFFIX}`;
const WEB_POLICY =
  "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; frame-ancestors 'none'";
const IMAGE = /image:\s*(caddy:\S+)/.exec(
  readFileSync(join(ROOT, 'deploy/compose/compose.prod.yaml'), 'utf8'),
)?.[1] as string;

function docker(args: string[], input?: string) {
  const r = spawnSync('docker', args, { encoding: 'utf8', input });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

/** Doble de los tres upstreams: un solo Caddy con los alias `finance-web`, `object-storage` y `keycloak`. */
const UPSTREAM_CADDYFILE = `{
	auto_https off
	admin off
}
:3000 {
	handle /_next/static/* {
		respond "js" 200
	}
	handle /api/health/ready {
		respond "ok" 200
	}
	handle /api/bff/v1/documents/* {
		header Content-Security-Policy "sandbox; default-src 'none'"
		respond "pdf" 200
	}
	handle /boom {
		respond "x" 500
	}
	handle {
		header Content-Security-Policy "${WEB_POLICY}"
		respond "<html></html>" 200
	}
}
:8333 {
	respond "s3" 200
}
:8080 {
	respond "openid" 200
}
`;

let hostPort = '';

function get(host: string, path: string, method = 'GET'): { status: number; headers: Map<string, string> } {
  const r = spawnSync(
    'curl',
    [
      '-s',
      '-o',
      '/dev/null',
      '-D',
      '-',
      '-X',
      method,
      '-H',
      `Host: ${host}`,
      `http://127.0.0.1:${hostPort}${path}`,
    ],
    { encoding: 'utf8' },
  );
  const headers = new Map<string, string>();
  let status = 0;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^HTTP\/[\d.]+ (\d+)/.exec(line);
    if (m) {
      status = Number(m[1]);
      headers.clear();
    } else if (line.includes(':')) {
      const i = line.indexOf(':');
      headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim());
    }
  }
  return { status, headers };
}

describe('Caddy del borde: CSP por omisión y cabeceras complementarias (add-web-content-security-policy)', () => {
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'pfos-test-caddy-'));
    writeFileSync(join(dir, 'upstream.Caddyfile'), UPSTREAM_CADDYFILE);
    docker(['network', 'create', NETWORK]);
    const up = docker([
      'run',
      '-d',
      '--name',
      UPSTREAM,
      '--network',
      NETWORK,
      '--network-alias',
      'finance-web',
      '--network-alias',
      'object-storage',
      '--network-alias',
      'keycloak',
      '-v',
      `${join(dir, 'upstream.Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      IMAGE,
    ]);
    expect(up.code, up.out).toBe(0);
    const edge = docker([
      'run',
      '-d',
      '--name',
      EDGE,
      '--network',
      NETWORK,
      '-p',
      '127.0.0.1::80',
      '-e',
      'PF_ACME_EMAIL=test@example.com',
      '-e',
      'PF_DOMAIN_APP=http://app.test',
      '-e',
      'PF_DOMAIN_FILES=http://files.test',
      '-e',
      'PF_DOMAIN_AUTH=http://auth.test',
      '-e',
      'PF_QUARANTINE_BUCKET=pfos-quarantine',
      '-v',
      `${join(ROOT, 'deploy/compose/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      IMAGE,
    ]);
    expect(edge.code, edge.out).toBe(0);
    hostPort = /:(\d+)\s*$/m.exec(docker(['port', EDGE, '80/tcp']).out)?.[1] as string;
    expect(hostPort).toBeTruthy();
    // Espera a que Caddy cargue la configuración.
    for (let i = 0; i < 40; i++) {
      if (get('app.test', '/api/health/ready').status === 200) return;
      spawnSync('node', ['-e', 'setTimeout(()=>{},500)']);
    }
    throw new Error(`Caddy no arrancó: ${docker(['logs', EDGE]).out}`);
  }, 180_000);

  afterAll(() => {
    docker(['rm', '-f', EDGE, UPSTREAM]);
    docker(['network', 'rm', NETWORK]);
  });

  it('[TC-SECURITY-CSP-007] el Caddyfile del repositorio valida con la imagen fijada', () => {
    const r = docker([
      'run',
      '--rm',
      '-e',
      'PF_ACME_EMAIL=test@example.com',
      '-e',
      'PF_DOMAIN_APP=app.example.com',
      '-e',
      'PF_DOMAIN_FILES=files.example.com',
      '-e',
      'PF_DOMAIN_AUTH=auth.example.com',
      '-e',
      'PF_QUARANTINE_BUCKET=pfos-quarantine',
      '-v',
      `${join(ROOT, 'deploy/compose/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      IMAGE,
      'caddy',
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
    ]);
    expect(r.code, r.out).toBe(0);
  });

  it('[TC-SECURITY-CSP-007] recurso estático, respuesta del BFF, error y hostname de archivos reciben la CSP por omisión', () => {
    const fallback = "default-src 'none'; frame-ancestors 'none'";
    for (const path of ['/_next/static/chunks/x.js', '/api/health/ready', '/boom'])
      expect(get('app.test', path).headers.get('content-security-policy'), path).toBe(fallback);
    const missing = get('files.test', '/no-existe');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-security-policy')).toBe(fallback);
  });

  it('[TC-SECURITY-CSP-007] no reemplaza la política con nonce de la web ni la sandbox de la descarga', () => {
    expect(get('app.test', '/es').headers.get('content-security-policy')).toBe(WEB_POLICY);
    expect(get('app.test', '/api/bff/v1/documents/1/download').headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'",
    );
  });

  it('[TC-SECURITY-CSP-007] el hostname de auth no recibe la política por omisión', () => {
    const auth = get('auth.test', '/realms/pfos/.well-known/openid-configuration');
    expect(auth.status).toBe(200);
    expect(auth.headers.has('content-security-policy')).toBe(false);
  });

  it('[TC-SECURITY-CSP-008] el Home trae Permissions-Policy con las cinco funciones deshabilitadas y COOP same-origin', () => {
    const home = get('app.test', '/');
    expect(home.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    expect(home.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(home.headers.get('strict-transport-security')).toContain('max-age=31536000');
    // El hostname de auth no las recibe: no se toca la gestión de Keycloak.
    expect(get('auth.test', '/').headers.has('permissions-policy')).toBe(false);
  });
});
