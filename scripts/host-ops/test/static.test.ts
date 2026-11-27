import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ROOT, readRepo } from './harness.js';

const SYSTEMD = 'deploy/host/systemd';

interface ComposeService {
  configs?: ({ source: string; target?: string } | string)[];
}
interface ComposeFile {
  services?: Record<string, ComposeService>;
  configs?: Record<string, { file?: string; content?: string }>;
}

/** Fuentes de configs de cada servicio, mezclando el compose base y el de producción (los dos archivos que usa el host). */
function configSources(): Map<string, string[]> {
  const base = parseYaml(readRepo('deploy/compose/compose.yaml'), { logLevel: 'error' }) as ComposeFile;
  const prod = parseYaml(readRepo('deploy/compose/compose.prod.yaml'), { logLevel: 'error' }) as ComposeFile;
  const out = new Map<string, string[]>();
  for (const file of [base, prod]) {
    for (const [name, service] of Object.entries(file.services ?? {})) {
      const sources = (service.configs ?? []).map((c) => (typeof c === 'string' ? c : c.source));
      out.set(name, [...(out.get(name) ?? []), ...sources]);
    }
  }
  return out;
}

describe('compose.prod.yaml: clave privada de las conexiones', () => {
  it('[TC-PLATFORM-HOSTOPS-006] solo finance-worker monta /etc/pfos/connection-credentials.keys en /run/pfos/connection-credentials.keys', () => {
    const prod = parseYaml(readRepo('deploy/compose/compose.prod.yaml'), {
      logLevel: 'error',
    }) as ComposeFile;
    expect(prod.configs?.['connection-credentials-keys']).toEqual({
      file: '/etc/pfos/connection-credentials.keys',
    });

    const worker = prod.services?.['finance-worker']?.configs ?? [];
    expect(worker).toContainEqual({
      source: 'connection-credentials-keys',
      target: '/run/pfos/connection-credentials.keys',
    });

    const withKey = [...configSources()].filter(([, sources]) =>
      sources.includes('connection-credentials-keys'),
    );
    expect(withKey.map(([name]) => name)).toEqual(['finance-worker']);
    expect(configSources().get('finance-api') ?? []).not.toContain('connection-credentials-keys');
    expect(configSources().get('finance-web') ?? []).not.toContain('connection-credentials-keys');
  });

  it('[TC-PLATFORM-HOSTOPS-006] la plantilla del host documenta la variable del worker y el archivo de /etc/pfos que la alimenta', () => {
    const example = readRepo('deploy/host/etc-pfos/pfos.env.example');
    expect(example).toMatch(
      /^# CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE=\/run\/pfos\/connection-credentials\.keys$/m,
    );
    expect(example).toContain('/etc/pfos/connection-credentials.keys');
  });
});

describe('unidades systemd del host (add-host-restore-drill)', () => {
  const read = (name: string): string => readFileSync(join(ROOT, SYSTEMD, name), 'utf8');

  it('el drill mensual corre el día 2 a las 09:00 UTC sobre el template pfos-backup@drill', () => {
    const t = read('pfos-restore-drill.timer');
    expect(t).toMatch(/^OnCalendar=\*-\*-02 09:00:00 UTC$/m);
    expect(t).toMatch(/^Unit=pfos-backup@drill\.service$/m);
    expect(t).toMatch(/^Persistent=true$/m);
    expect(t).toMatch(/^RandomizedDelaySec=5min$/m);
  });

  it('la verificación corre los miércoles a las 11:00 UTC y la limpieza de imágenes los sábados a las 11:00 UTC', () => {
    const v = read('pfos-backup-verify.timer');
    expect(v).toMatch(/^OnCalendar=Wed \*-\*-\* 11:00:00 UTC$/m);
    expect(v).toMatch(/^Unit=pfos-backup@verify\.service$/m);
    const p = read('pfos-image-prune.timer');
    expect(p).toMatch(/^OnCalendar=Sat \*-\*-\* 11:00:00 UTC$/m);
    expect(p).toMatch(/^Unit=pfos-image-prune\.service$/m);
    for (const t of [v, p]) {
      expect(t).toMatch(/^Persistent=true$/m);
      expect(t).toMatch(/^RandomizedDelaySec=5min$/m);
    }
  });

  it('la limpieza de imágenes es un servicio oneshot de 30 min que llama a pfos-backup.sh image-prune', () => {
    const s = read('pfos-image-prune.service');
    expect(s).toMatch(/^Type=oneshot$/m);
    expect(s).toMatch(/^TimeoutStartSec=30min$/m);
    expect(s).toMatch(
      /^ExecStart=\/bin\/bash \/opt\/pfos\/repo\/deploy\/host\/pfos-backup\.sh image-prune$/m,
    );
  });

  it('el template de backup deja 2 h al drill (tope de recuperación de 90 min)', () => {
    expect(read('pfos-backup@.service')).toMatch(/^TimeoutStartSec=2h$/m);
  });

  it('pfos-deploy.sh habilita todos los timers que hay en deploy/host/systemd (ninguno queda sin instalar)', () => {
    const deploy = readRepo('deploy/host/pfos-deploy.sh');
    const from = deploy.indexOf('systemctl enable');
    const enable = deploy.slice(from, deploy.indexOf('>/dev/null', from));
    const timers = readdirSync(join(ROOT, SYSTEMD)).filter((f) => f.endsWith('.timer'));
    expect(timers.length).toBeGreaterThanOrEqual(8);
    for (const timer of timers) expect(enable, timer).toContain(timer);
  });

  it('cada timer apunta a una unidad que existe (template pfos-backup@ o un .service propio)', () => {
    const services = new Set(readdirSync(join(ROOT, SYSTEMD)).filter((f) => f.endsWith('.service')));
    for (const timer of readdirSync(join(ROOT, SYSTEMD)).filter((f) => f.endsWith('.timer'))) {
      const unit = /^Unit=(.+)$/m.exec(read(timer))?.[1] ?? '';
      const template = unit.replace(/@[^.]+\./, '@.');
      expect(services.has(unit) || services.has(template), `${timer} → ${unit}`).toBe(true);
    }
  });
});

describe('plantilla de la clave de solo lectura', () => {
  it('pgbackrest-restore.env.example declara repo1 y repo2 completos, sin secretos reales, y nombra la clave de solo lectura', () => {
    const text = readRepo('deploy/host/etc-pfos/pgbackrest-restore.env.example');
    for (const repo of [1, 2]) {
      for (const key of ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_KEY', 'S3_KEY_SECRET', 'CIPHER_PASS']) {
        expect(text).toMatch(new RegExp(`^PGBACKREST_REPO${repo}_${key}=__set__$`, 'm'));
      }
    }
    expect(text).toMatch(/solo lectura/i);
    expect(text).toContain('b2_restore_key_id');
    expect(text).toContain('PGBACKREST_REPO1_PATH=/pgbackrest/poc/pitr');
    for (const l of text.split('\n').filter((line) => /^[A-Z0-9_]+=/.test(line)))
      expect(l).toMatch(/=__set__$/);
  });
});

describe('shellcheck de los scripts del host', () => {
  const hasShellcheck = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' }).status === 0;

  it.skipIf(!hasShellcheck)('pfos-backup.sh y pfos-deploy.sh pasan shellcheck (severidad warning)', () => {
    const r = spawnSync(
      'shellcheck',
      ['-x', '-S', 'warning', 'deploy/host/pfos-backup.sh', 'deploy/host/pfos-deploy.sh'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
