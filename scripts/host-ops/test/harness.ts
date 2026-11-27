import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio (este archivo está en scripts/host-ops/test). */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export const readRepo = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

function which(tool: string): string | null {
  const probe = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

/**
 * Los scripts del host son bash para Linux: necesitan `bash`, `flock` y `jq` (en CI los trae el runner de Ubuntu). En Windows y
 * donde falte alguno, las pruebas de comportamiento se saltan y la verificación queda en CI (design.md, decisión 10).
 */
export const HOST_TOOLS_AVAILABLE =
  process.platform !== 'win32' && ['bash', 'flock', 'jq', 'awk', 'xargs'].every((t) => which(t) !== null);

const REAL_DATE = which('date') ?? '/usr/bin/date';

/** Instante inicial por omisión de los sandboxes: 2026-12-02T09:03:00Z (día 2 del mes, hora del drill). */
export const DEFAULT_NOW = '2026-12-02T09:03:00Z';
export const epoch = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export const HEARTBEAT = 'https://hc.example.test/ping/abc123';
export const PG_IMAGE = `ghcr.io/manuxd270516/pfos-postgres@sha256:${'3'.repeat(64)}`;
export const GIB = 1024 ** 3;

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface HeartbeatCall {
  /** Ruta tras la URL base del heartbeat: `/pfos-drill`, `/pfos-drill/fail`... */
  slug: string;
  body: string | null;
}

/** Entorno de prueba: directorios temporales, dobles al frente del PATH y reloj controlado. */
export class Sandbox {
  readonly dir = mkdtempSync(join(tmpdir(), 'pf-host-ops-'));
  readonly etc = join(this.dir, 'etc');
  readonly state = join(this.dir, 'var');
  readonly bin = join(this.dir, 'bin');
  readonly callsFile = join(this.dir, 'calls.log');

  constructor(now: string = DEFAULT_NOW) {
    for (const d of [this.etc, this.state, this.bin, join(this.dir, 'cfg'), join(this.dir, 'state')]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(this.callsFile, '');
    writeFileSync(join(this.dir, 'state', 'clock'), `${epoch(now)}\n`);
    copyFileSync(join(FIXTURES, 'common.sh'), join(this.bin, 'common.sh'));
    for (const name of readdirSync(FIXTURES)) {
      if (name === 'common.sh') continue;
      const target = join(this.bin, name.replace(/\.sh$/, ''));
      copyFileSync(join(FIXTURES, name), target);
      chmodSync(target, 0o755);
    }
    writeFileSync(
      join(this.etc, 'pfos.env'),
      `PF_BACKUP_HEARTBEAT_URL=${HEARTBEAT}\nPF_DOMAIN_APP=app.example.test\nPF_DOMAIN_AUTH=auth.example.test\n`,
    );
    writeFileSync(join(this.etc, 'pgbackrest.env'), 'PGBACKREST_REPO1_S3_BUCKET=prod-bucket\n');
    writeFileSync(
      join(this.etc, 'pgbackrest-restore.env'),
      'PGBACKREST_REPO1_S3_BUCKET=prod-bucket\nPGBACKREST_REPO1_S3_KEY=ficticia-solo-lectura\n',
    );
    writeFileSync(
      join(this.state, 'release.env'),
      `PFOS_RELEASE_SHA=${'a'.repeat(40)}\nPFOS_POSTGRES_IMAGE=${PG_IMAGE}\n`,
    );
  }

  /** Valor que el doble devuelve para la clave (ver fixtures/*.sh). */
  set(key: string, value: string | number): this {
    writeFileSync(join(this.dir, 'cfg', key), String(value));
    return this;
  }

  /** Marca un recurso del drill como existente, como si lo hubiera dejado una corrida interrumpida. */
  leftover(kind: 'volume' | 'network' | 'container', name: string): this {
    writeFileSync(join(this.dir, 'state', `${kind}-${name}`), '');
    return this;
  }

  exists(kind: 'volume' | 'network' | 'container', name: string): boolean {
    return existsSync(join(this.dir, 'state', `${kind}-${name}`));
  }

  file(relative: string, content: string): this {
    writeFileSync(join(this.dir, relative), content);
    return this;
  }

  get env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${this.bin}:${process.env.PATH ?? ''}`,
      FAKE_DIR: this.dir,
      FAKE_CALLS: this.callsFile,
      REAL_DATE,
      PFOS_ETC_DIR: this.etc,
      PFOS_STATE_DIR: this.state,
      PFOS_REPO_DIR: ROOT,
      PFOS_DOCKER_DIR: '/var/lib/docker',
    };
  }

  run(script: string, args: string[]): RunResult {
    const r = spawnSync('bash', [join(ROOT, script), ...args], {
      env: this.env,
      encoding: 'utf8',
      timeout: 50_000,
    });
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  }

  /** Igual que `run` pero sin bloquear el proceso de la prueba (para esperar un lock tomado por otro). */
  runAsync(script: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn('bash', [join(ROOT, script), ...args], { env: this.env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }));
    });
  }

  calls(): string[] {
    return readFileSync(this.callsFile, 'utf8').split('\n').filter(Boolean);
  }

  /** Llamadas cuyo texto cumple el patrón, en orden. */
  callsMatching(pattern: RegExp): string[] {
    return this.calls().filter((c) => pattern.test(c));
  }

  /** Índice (en el registro de llamadas) de la primera que cumple el patrón; -1 si no hay. */
  indexOf(pattern: RegExp): number {
    return this.calls().findIndex((c) => pattern.test(c));
  }

  heartbeats(): HeartbeatCall[] {
    return this.callsMatching(/^curl /).map((line) => {
      const url = /(https:\/\/hc\.example\.test\/ping\/abc123\/\S+)/.exec(line)?.[1] ?? '';
      const body = /--data-raw (.*) https:\/\/hc\.example\.test/.exec(line)?.[1] ?? null;
      return { slug: url.replace(HEARTBEAT, ''), body };
    });
  }

  drillsLog(): string[] {
    const file = join(this.state, 'drills.log');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
