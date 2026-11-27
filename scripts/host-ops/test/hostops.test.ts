import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_TOOLS_AVAILABLE, Sandbox, epoch } from './harness.js';

const BACKUP = 'deploy/host/pfos-backup.sh';
const DEPLOY = 'deploy/host/pfos-deploy.sh';
const SHA = 'a'.repeat(40);
const d = (c: string): string => `sha256:${c.repeat(64)}`;
const API = `ghcr.io/manuxd270516/finance-api@${d('1')}`;
const WEB = `ghcr.io/manuxd270516/finance-web@${d('2')}`;
const PG = `ghcr.io/manuxd270516/pfos-postgres@${d('3')}`;
const DEPLOY_ARGS = ['deploy', SHA, API, WEB, PG];

let sb: Sandbox;
let holder: ChildProcess | undefined;
afterEach(() => {
  holder?.kill();
  holder = undefined;
  sb?.dispose();
});

/** Un proceso que toma deploy.lock, escribe su nombre y lo conserva (como lo haría el drill en curso). */
async function holdLock(name: string): Promise<void> {
  const lock = join(sb.state, 'deploy.lock');
  holder = spawn(
    'bash',
    ['-c', `exec 9<>"${lock}"; flock 9; : >"${lock}"; echo ${name} >&9; echo ready; exec sleep 60`],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  await new Promise<void>((resolve) => holder?.stdout?.once('data', () => resolve()));
}

describe.skipIf(!HOST_TOOLS_AVAILABLE)('lock compartido entre el deploy y las operaciones del host', () => {
  it('[TC-PLATFORM-HOSTOPS-001] un deploy durante el drill falla sin cambiar nada y nombra la operación en curso', async () => {
    sb = new Sandbox();
    await holdLock('drill');

    const r = sb.run(DEPLOY, DEPLOY_ARGS);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('operación del host en curso: drill');
    // Ni pull, ni compose, ni systemd: no se tocó el release actual.
    expect(sb.calls()).toEqual([]);
  });

  it('[TC-PLATFORM-HOSTOPS-001] verify espera el lock mientras corre el drill y corre al liberarse', async () => {
    sb = new Sandbox();
    await holdLock('drill');

    const started = Date.now();
    const pending = sb.runAsync(BACKUP, ['verify']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sb.callsMatching(/^docker run /)).toEqual([]); // sigue esperando
    holder?.kill();
    const r = await pending;
    expect(r.status, r.stderr).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(sb.callsMatching(/^docker run .*verify/)).toHaveLength(2);
    expect(readFileSync(join(sb.state, 'deploy.lock'), 'utf8')).toBe('verify\n');
  });

  it('[TC-PLATFORM-HOSTOPS-001] la limpieza de imágenes también tiene el lock: el deploy informa image-prune', async () => {
    sb = new Sandbox();
    await holdLock('image-prune');
    const r = sb.run(DEPLOY, ['rollback']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('operación del host en curso: image-prune');
  });

  it('[TC-PLATFORM-HOSTOPS-001] el deploy toma el lock con su nombre y lo libera al terminar', () => {
    sb = new Sandbox();
    const r = sb.run(DEPLOY, ['status']);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(sb.state, 'deploy.lock'), 'utf8')).toBe('status\n');
    const again = sb.run(DEPLOY, ['status']);
    expect(again.stderr).not.toContain('operación del host en curso');
  });
});

/** Releases en el registro: A (viejo), B (anterior, con ML) y C (actual, con ML y Keycloak: formato con varios extras). */
function releaseFixture(): { rm: string[]; kept: string[] } {
  const ref = (n: string, c: string): string => `ghcr.io/manuxd270516/${n}@${d(c)}`;
  const A = [ref('finance-api', 'a'), ref('finance-web', 'b'), ref('pfos-postgres', 'c')];
  const B = [
    ref('finance-api', 'd'),
    ref('finance-web', 'e'),
    ref('pfos-postgres', 'f'),
    ref('finance-ml', '1'),
  ];
  const C = [
    ref('finance-api', '2'),
    ref('finance-web', '3'),
    ref('pfos-postgres', '4'),
    ref('finance-ml', '5'),
    ref('pfos-keycloak', '6'),
  ];
  const rclone =
    'rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5';
  const caddy = 'caddy:2@sha256:' + '9'.repeat(64);
  const line = (n: number, refs: string[]): string =>
    `2026-11-0${n}T10:00:00Z ${String(n).repeat(40)} ${refs.join(' ')}`;
  sb.file('var/releases.log', [line(1, A), line(2, B), line(3, C)].join('\n') + '\n');
  const all = [...A, ...B, ...C, rclone, caddy];
  const idOf = (r: string): string => `sha256:img-${r.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  sb.file('cfg/image_map', all.map((r) => `${r} ${idOf(r)}`).join('\n') + '\n');
  sb.file('cfg/image_ids', all.map(idOf).join('\n') + '\n');
  // Los contenedores en marcha usan la imagen de C (api) y la de Caddy.
  sb.file('cfg/container_images', [idOf(C[0] ?? ''), idOf(caddy)].join('\n') + '\n');
  return { rm: A.map(idOf), kept: [...B, ...C, rclone, caddy].map(idOf) };
}

describe.skipIf(!HOST_TOOLS_AVAILABLE)('pfos-backup.sh image-prune (limpieza semanal de imágenes)', () => {
  it('[TC-PLATFORM-HOSTOPS-002] conserva el release actual y el anterior (formato con varios extras) y borra los más viejos sin -f', () => {
    sb = new Sandbox();
    const { rm, kept } = releaseFixture();

    const r = sb.run(BACKUP, ['image-prune']);
    expect(r.status, r.stderr).toBe(0);

    const removed = sb.callsMatching(/^docker image rm /);
    expect(removed.map((c) => c.replace('docker image rm ', '')).sort()).toEqual([...rm].sort());
    for (const id of kept) expect(removed.some((c) => c.includes(id))).toBe(false);
    expect(removed.some((c) => /\s-f\b|--force/.test(c))).toBe(false);
    expect(sb.callsMatching(/^docker image prune -f/)).toHaveLength(1);

    const beats = sb.heartbeats();
    expect(beats.map((b) => b.slug)).toEqual(['/pfos-image-prune']);
    expect(beats[0]?.body).toMatch(/^image-prune borradas=3 fallidas=0 liberado_bytes=-?\d+$/);
  });

  it('[TC-PLATFORM-HOSTOPS-002] lee también el formato viejo de releases.log (api web pg [ml]) y cuenta los borrados que fallan sin abortar', () => {
    sb = new Sandbox();
    const { rm } = releaseFixture();
    sb.file('cfg/rm_fails', `${rm[0]}\n`);

    const r = sb.run(BACKUP, ['image-prune']);
    expect(r.status, r.stderr).toBe(0);
    expect(sb.callsMatching(/^docker image rm /)).toHaveLength(3);
    expect(sb.heartbeats()[0]?.body).toMatch(/borradas=2 fallidas=1 /);
  });

  it('[TC-PLATFORM-HOSTOPS-003] sin releases.log borra solo las colgantes y lo registra', () => {
    sb = new Sandbox();
    sb.file('cfg/image_ids', 'sha256:img-1\nsha256:img-2\n');

    const r = sb.run(BACKUP, ['image-prune']);
    expect(r.status, r.stderr).toBe(0);
    expect(sb.callsMatching(/^docker image rm /)).toEqual([]);
    expect(sb.callsMatching(/^docker image prune -f/)).toHaveLength(1);
    expect(r.stderr).toContain('releases.log');
    expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-image-prune']);
  });

  it('[TC-PLATFORM-HOSTOPS-003] con releases.log vacío tampoco borra imágenes referenciadas', () => {
    sb = new Sandbox();
    sb.file('var/releases.log', '');
    sb.file('cfg/image_ids', 'sha256:img-1\n');

    const r = sb.run(BACKUP, ['image-prune']);
    expect(r.status, r.stderr).toBe(0);
    expect(sb.callsMatching(/^docker image rm /)).toEqual([]);
  });
});

function checkSandbox(opts: { df: string[]; archive?: 'ok' | 'fail'; ageSeconds?: number }): void {
  sb = new Sandbox();
  const now = epoch('2026-12-02T09:03:00Z');
  const stop = now - (opts.ageSeconds ?? 3600);
  sb.set(
    'info_json',
    JSON.stringify([{ backup: [{ label: 'x', info: { size: 1 }, timestamp: { start: stop - 60, stop } }] }]),
  );
  sb.set('pgbackrest_check_exit', opts.archive === 'fail' ? 1 : 0);
  sb.file('cfg/df_table', ['Use% Mounted on', ...opts.df].join('\n') + '\n');
}

describe.skipIf(!HOST_TOOLS_AVAILABLE)(
  'pfos-backup.sh check (verificación horaria con alerta de disco)',
  () => {
    it('[TC-PLATFORM-HOSTOPS-004] con el disco al 83 % y el archivado al día falla el heartbeat y nombra el punto de montaje y el porcentaje', () => {
      checkSandbox({ df: [' 83% /', ' 83% /', ' 83% /'] });
      const r = sb.run(BACKUP, ['check']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/disco \/ al 83 %/);
      expect(r.stderr).not.toContain('archivado');
      const beats = sb.heartbeats();
      expect(beats.map((b) => b.slug)).toEqual(['/pfos-check/fail']);
      expect(beats[0]?.body).toContain('disco');
    });

    it('[TC-PLATFORM-HOSTOPS-004] con el disco al 79 % y todo lo demás sano avisa éxito', () => {
      checkSandbox({ df: [' 79% /', ' 79% /', ' 79% /'] });
      const r = sb.run(BACKUP, ['check']);
      expect(r.status, r.stderr).toBe(0);
      expect(sb.heartbeats().map((b) => b.slug)).toEqual(['/pfos-check']);
    });

    it('[TC-PLATFORM-HOSTOPS-004] exactamente 80 % no alerta y 81 % sí', () => {
      checkSandbox({ df: [' 80% /'] });
      expect(sb.run(BACKUP, ['check']).status).toBe(0);
      sb.dispose();
      checkSandbox({ df: [' 81% /'] });
      expect(sb.run(BACKUP, ['check']).status).not.toBe(0);
    });

    it('[TC-PLATFORM-HOSTOPS-004] con el disco al 95 % y el archivado caído el aviso nombra las dos causas', () => {
      checkSandbox({ df: [' 95% /', ' 95% /', ' 95% /'], archive: 'fail' });
      const r = sb.run(BACKUP, ['check']);
      expect(r.status).not.toBe(0);
      const beats = sb.heartbeats();
      expect(beats.map((b) => b.slug)).toEqual(['/pfos-check/fail']);
      expect(beats[0]?.body).toContain('archivado de WAL');
      expect(beats[0]?.body).toContain('disco');
      expect(r.stderr).toMatch(/disco \/ al 95 %/);
    });

    it('[TC-PLATFORM-HOSTOPS-004] el mismo dispositivo se evalúa una sola vez y cada punto de montaje distinto se nombra', () => {
      checkSandbox({ df: [' 83% /', ' 83% /', ' 91% /var/lib/docker'] });
      const r = sb.run(BACKUP, ['check']);
      expect(r.status).not.toBe(0);
      expect(r.stderr.match(/disco \/ al 83 %/g)).toHaveLength(1);
      expect(r.stderr).toMatch(/disco \/var\/lib\/docker al 91 %/);
    });

    it('[TC-PLATFORM-HOSTOPS-004] un backup de más de 26 h también falla y se evalúa aunque el disco esté bien', () => {
      checkSandbox({ df: [' 10% /'], ageSeconds: 27 * 3600 });
      const r = sb.run(BACKUP, ['check']);
      expect(r.status).not.toBe(0);
      expect(sb.heartbeats()[0]?.body).toContain('antigüedad del último backup');
    });
  },
);

describe.skipIf(!HOST_TOOLS_AVAILABLE)('pfos-deploy.sh: clave privada de las conexiones (C10)', () => {
  const KEYS = (): string => join(sb.etc, 'connection-credentials.keys');
  const mode = (file: string): number => statSync(file).mode & 0o777;

  /** Deja listo lo que un deploy exitoso necesita: doble de docker/curl/git y un release previo para el rollback. */
  function deploySandbox(): void {
    sb = new Sandbox();
    sb.set('revision', SHA);
    sb.file(
      'var/releases.log',
      `2026-11-01T10:00:00Z ${'b'.repeat(40)} ${API} ${WEB} ${PG}\n2026-11-02T10:00:00Z ${SHA} ${API} ${WEB} ${PG}\n`,
    );
  }

  it('[TC-PLATFORM-HOSTOPS-005] sin el archivo, el deploy lo crea vacío con dueño 1000:1000 y modo 0400 antes de levantar el release', () => {
    deploySandbox();
    const r = sb.run(DEPLOY, DEPLOY_ARGS);
    expect(r.status, r.stdout + r.stderr).toBe(0);

    expect(existsSync(KEYS())).toBe(true);
    expect(readFileSync(KEYS(), 'utf8')).toBe('');
    expect(mode(KEYS())).toBe(0o400);
    expect(sb.callsMatching(/^install -o 1000 -g 1000 -m 0400 \/dev\/null /)).toEqual([
      `install -o 1000 -g 1000 -m 0400 /dev/null ${KEYS()}`,
    ]);
    const created = sb.indexOf(/^install -o 1000 -g 1000 -m 0400/);
    const up = sb.indexOf(/^docker compose .* up /);
    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(up);
  });

  it('[TC-PLATFORM-HOSTOPS-005] con el archivo en 0644 y una clave de prueba, el deploy deja 0400 y dueño 1000 sin cambiar el contenido', () => {
    deploySandbox();
    const content = 'k1:clave-ficticia-de-prueba-no-real\n';
    writeFileSync(KEYS(), content);
    chmodSync(KEYS(), 0o644);

    const r = sb.run(DEPLOY, DEPLOY_ARGS);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(KEYS(), 'utf8')).toBe(content);
    expect(mode(KEYS())).toBe(0o400);
    expect(sb.callsMatching(/^chown 1000:1000 /)).toEqual([`chown 1000:1000 ${KEYS()}`]);
    expect(sb.callsMatching(/^install -o 1000/)).toEqual([]);
  });

  it('[TC-PLATFORM-HOSTOPS-005] el rollback también asegura el archivo antes de levantar el release', () => {
    deploySandbox();
    const r = sb.run(DEPLOY, ['rollback']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(mode(KEYS())).toBe(0o400);
    const ensured = sb.indexOf(/^install -o 1000 -g 1000 -m 0400/);
    const up = sb.indexOf(/^docker compose .* up /);
    expect(ensured).toBeGreaterThanOrEqual(0);
    expect(ensured).toBeLessThan(up);
  });

  it('[TC-PLATFORM-HOSTOPS-005] si el origen del montaje es un directorio (lo que crea Docker si falta) aborta sin levantar nada', () => {
    deploySandbox();
    mkdirSync(KEYS());
    const r = sb.run(DEPLOY, DEPLOY_ARGS);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('es un directorio');
    expect(sb.callsMatching(/^docker compose .* up /)).toEqual([]);
  });

  it('[TC-PLATFORM-HOSTOPS-005] un deploy no registra la clave en el entorno del release ni en los logs', () => {
    deploySandbox();
    const content = 'k1:clave-ficticia-de-prueba-no-real\n';
    writeFileSync(KEYS(), content);
    const r = sb.run(DEPLOY, DEPLOY_ARGS);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(
      r.stdout + r.stderr + sb.calls().join('\n') + readFileSync(join(sb.state, 'release.env'), 'utf8'),
    ).not.toContain('clave-ficticia');
  });
});
