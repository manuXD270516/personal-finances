import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readText } from './helpers.js';

/**
 * Comando forzado SSH del cloud-init (infra/modules/lightsail-host/cloud-init.yaml.tftpl, C1 de docs/despliegue). Se extrae el
 * script del template, se le quita el escape de tofu (`$${` -> `${`) y se ejecuta con bash contra un `git` y un
 * `pfos-deploy.sh` falsos que solo registran los argumentos recibidos.
 */
const SHA = 'a'.repeat(40);
const d = (c: string): string => `sha256:${c.repeat(64)}`;
const API = `ghcr.io/manuxd270516/finance-api@${d('1')}`;
const WEB = `ghcr.io/manuxd270516/finance-web@${d('2')}`;
const PG = `ghcr.io/manuxd270516/pfos-postgres@${d('3')}`;
const ML = `ghcr.io/manuxd270516/finance-ml@${d('4')}`;
const KC = `ghcr.io/manuxd270516/pfos-keycloak@${d('5')}`;
const BASE = ['deploy', SHA, API, WEB, PG];

function extractScript(): string {
  const lines = readText('infra/modules/lightsail-host/cloud-init.yaml.tftpl').split(/\r?\n/);
  const start = lines.findIndex(
    (l: string) => l.includes('path: /usr/local/sbin/pfos-deploy') && !l.includes('sudoers'),
  );
  const bodyStart = lines.findIndex((l: string, i: number) => i > start && l.trim() === 'content: |') + 1;
  const out: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() !== '' && !line.startsWith('      ')) break;
    out.push(line.slice(6));
  }
  return out.join('\n').replaceAll('$${', '${');
}

let dir: string;
let script: string;
let argsFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pfos-forced-'));
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'deploy/host'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  argsFile = join(dir, 'args.txt');
  writeFileSync(join(dir, 'bin/git'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(dir, 'bin/git'), 0o755);
  writeFileSync(
    join(repo, 'deploy/host/pfos-deploy.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$#" "$@" > '${argsFile.replaceAll('\\', '/')}'\n`,
  );
  script = join(dir, 'pfos-deploy');
  const text = extractScript().replace('repo=/opt/pfos/repo', `repo='${repo.replaceAll('\\', '/')}'`);
  writeFileSync(script, text);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(command: string): { status: number | null; stderr: string; passed: string[] | null } {
  rmSync(argsFile, { force: true });
  const bin = join(dir, 'bin').replaceAll('\\', '/');
  const r = spawnSync('bash', [script.replaceAll('\\', '/'), command], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  let passed: string[] | null;
  try {
    passed = readFileSync(argsFile, 'utf8').split('\n').slice(1).filter(Boolean);
  } catch {
    passed = null;
  }
  return { status: r.status, stderr: r.stderr, passed };
}

const line = (...a: string[]): string => a.join(' ');

describe('comando forzado SSH del cloud-init: imágenes opcionales por lista cerrada', () => {
  it('acepta 4 argumentos y no pasa extras', () => {
    const r = run(line(...BASE));
    expect(r.status).toBe(0);
    expect(r.passed).toEqual(['deploy', SHA, API, WEB, PG]);
  });

  it('acepta 5 con finance-ml y la pasa en la 6.ª posición', () => {
    const r = run(line(...BASE, ML));
    expect(r.status).toBe(0);
    expect(r.passed).toEqual(['deploy', SHA, API, WEB, PG, ML]);
  });

  it('acepta 5 con pfos-keycloak: ML vacío en la 6.ª y keycloak en la 7.ª', () => {
    const r = run(line(...BASE, KC));
    expect(r.status).toBe(0);
    expect(r.passed).toEqual(['deploy', SHA, API, WEB, PG, KC]);
  });

  it('acepta 6 con ambas, sin importar el orden, y las normaliza (ML 6.ª, keycloak 7.ª)', () => {
    for (const extras of [
      [ML, KC],
      [KC, ML],
    ]) {
      const r = run(line(...BASE, ...extras));
      expect(r.status).toBe(0);
      expect(r.passed).toEqual(['deploy', SHA, API, WEB, PG, ML, KC]);
    }
  });

  it('rechaza un duplicado', () => {
    for (const extras of [
      [ML, ML],
      [KC, KC],
    ]) {
      const r = run(line(...BASE, ...extras));
      expect(r.status).toBe(64);
      expect(r.stderr).toContain('duplicada');
      expect(r.passed).toBeNull();
    }
  });

  it('rechaza una ref inválida (otro namespace, otra imagen, sin digest, digest corto)', () => {
    const invalid = [
      `ghcr.io/otro/finance-ml@${d('4')}`,
      `ghcr.io/manuxd270516/finance-api@${d('4')}`,
      'ghcr.io/manuxd270516/finance-ml:latest',
      `ghcr.io/manuxd270516/finance-ml@sha256:${'4'.repeat(63)}`,
      `ghcr.io/manuxd270516/finance-ml@${d('4')};id`,
    ];
    for (const bad of invalid) {
      const r = run(line(...BASE, bad));
      expect(r.status).toBe(64);
      expect(r.passed).toBeNull();
    }
    // Una válida acompañada de una inválida tampoco pasa.
    expect(run(line(...BASE, ML, 'ghcr.io/otro/x')).status).toBe(64);
  });

  it('rechaza 7 argumentos (uno de más)', () => {
    const r = run(line(...BASE, ML, KC, ML));
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('de más');
    expect(r.passed).toBeNull();
  });

  it('rollback y status no reciben argumentos', () => {
    expect(run('rollback').status).toBe(0);
    expect(run('status').status).toBe(0);
    expect(run(`status ${SHA}`).status).toBe(64);
    expect(run(`rollback ${ML}`).status).toBe(64);
  });

  it('rechaza una acción desconocida', () => {
    expect(run('exec ls').status).toBe(64);
  });
});

describe('cloud-init del host: endurecimiento del puerto 22', () => {
  const tpl = (): string => readText('infra/modules/lightsail-host/cloud-init.yaml.tftpl');
  it('limita el puerto 22 con ufw limit y conserva AllowUsers y MaxAuthTries', () => {
    expect(tpl()).toMatch(/^ {2}- ufw limit 22\/tcp$/m);
    expect(tpl()).not.toMatch(/ufw allow 22\/tcp/);
    expect(tpl()).toContain('AllowUsers ubuntu pfos-deploy');
    expect(tpl()).toContain('MaxAuthTries 3');
  });
  it('el snapshot automático queda fuera de 06:00–07:30 y del reinicio de 08:30 UTC', () => {
    expect(readText('infra/modules/lightsail-host/variables.tf')).toMatch(
      /variable "auto_snapshot_time_utc" \{[\s\S]*?default\s+=\s+"10:00"/,
    );
  });
});
