// Suite de contenedores del stack local (platform/local-environment). Proyecto Compose desechable `pfos-test`.
//   pnpm test:stack      (requiere Docker; construye/reutiliza pfos/finance-api:local y pfos/finance-web:local)
import { rmSync } from 'node:fs';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { backupDir, digest, getObjectBytes, listAllObjects } from '../../src/lib/backup.js';
import { run, serviceStates } from '../../src/lib/compose.js';
import { COMPOSE_FILE, ROOT } from '../../src/lib/paths.js';
import {
  compose,
  containerInspect,
  createTestEnv,
  http,
  overrideFile,
  pnpm,
  putObject,
  s3,
  sql,
  stateOf,
  waitUntil,
} from './harness.js';

const { ctx, env, processEnv } = createTestEnv();
const api = `http://${env['PF_BIND_ADDR']}:${env['PF_API_PORT']}`;
const web = `http://${env['PF_BIND_ADDR']}:${env['PF_WEB_PORT']}`;
const bucket = env['OBJECT_STORAGE_BUCKET']!;
const DEPS = ['keycloak', 'mailpit', 'object-storage', 'postgres'];
const APPS = ['finance-api', 'finance-web', 'finance-worker'];
const timings: Record<string, number> = {};

const running = async () =>
  (await serviceStates(ctx))
    .filter((s) => s.State === 'running')
    .map((s) => s.Service)
    .sort();

async function downVolumes(): Promise<void> {
  await compose(['*'], ['down', '--volumes', '--remove-orphans'], { mode: 'capture' }, ctx);
}

describe('stack local en contenedores (pfos-test)', () => {
  beforeAll(async () => {
    await downVolumes();
    // CI (.github/workflows/pr.yml, job stack-smoke) prueba las imágenes construidas UNA vez por el job `image`:
    // las carga con `docker load` y las inyecta con FINANCE_API_IMAGE / FINANCE_WEB_IMAGE, sin reconstruir.
    if (process.env['PF_STACK_PREBUILT_IMAGES'] === '1') return;
    const build = await pnpm('images:build', [], processEnv);
    expect(build.code, build.stderr).toBe(0);
  });

  afterAll(async () => {
    await downVolumes();
    rmSync(processEnv['PF_ENV_FILE']!, { force: true });
    process.stderr.write(`[test:stack] tiempos (ms): ${JSON.stringify(timings)}\n`);
  });

  it('[TC-PLATFORM-STACK-008] si migrate falla, finance-api y finance-worker nunca arrancan y stack:logs muestra el error', async () => {
    const result = await run(
      'docker',
      [
        'compose',
        '-p',
        ctx.project,
        '-f',
        COMPOSE_FILE,
        '-f',
        overrideFile('compose.migrate-fail.yaml'),
        '--env-file',
        ctx.envFile,
        '--profile',
        'core',
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '300',
      ],
      { mode: 'capture', env: { ...processEnv, PF_APP_ENV_FILE: ctx.envFile } },
    );
    expect(result.code).not.toBe(0);

    const migrate = await stateOf(ctx, 'migrate');
    expect(migrate?.State).toBe('exited');
    expect(migrate?.ExitCode).not.toBe(0);
    for (const svc of ['finance-api', 'finance-worker']) {
      const state = await stateOf(ctx, svc);
      expect(state?.State, svc).toBe('created');
      expect(await containerInspect(state!.Name, '{{.State.StartedAt}}')).toMatch(/^0001-01-01/);
    }

    const logs = await pnpm('stack:logs', ['migrate'], processEnv);
    expect(logs.code).toBe(0);
    expect(logs.stdout).toContain('20991231000000_tc_stack_008_broken.sql');
    expect(logs.stdout).toMatch(/syntax error/i);
    expect(logs.stdout).toContain('migrate failed');
    await downVolumes();
  });

  it('[TC-PLATFORM-STACK-007] el perfil deps levanta solo las dependencias healthy y ningún contenedor de aplicación', async () => {
    const up = await pnpm('stack:up', [], processEnv);
    expect(up.code, up.stderr + up.stdout).toBe(0);
    timings['deps_cold_up'] = up.ms;
    expect(await running()).toEqual(DEPS);
    for (const svc of DEPS) expect((await stateOf(ctx, svc))?.Health, svc).toBe('healthy');
    const all = (await serviceStates(ctx)).map((s) => s.Service);
    for (const app of [...APPS, 'migrate', 'otel-lgtm', 'valkey']) expect(all).not.toContain(app);
  });

  it('[TC-PLATFORM-STACK-001] pnpm stack:up -- --profile core deja todo healthy, migrate en 0 y las apps como non-root', async () => {
    const up = await pnpm('stack:up', ['--profile', 'core'], processEnv);
    expect(up.code, up.stderr + up.stdout).toBe(0);
    timings['core_up_on_top_of_deps'] = up.ms;
    expect(up.ms).toBeLessThan(5 * 60_000);

    expect(await running()).toEqual([...DEPS, ...APPS].sort());
    for (const svc of [...DEPS, ...APPS]) expect((await stateOf(ctx, svc))?.Health, svc).toBe('healthy');
    const migrate = await stateOf(ctx, 'migrate');
    expect(migrate?.State).toBe('exited');
    expect(migrate?.ExitCode).toBe(0);

    expect(await http(`${api}/health/ready`)).toEqual({
      status: 200,
      body: { status: 'ready', checks: { postgres: 'up', 'object-storage': 'up' }, failing: [] },
    });
    expect((await http(`${api}/health/live`)).status).toBe(200);
    expect((await http(`${web}/api/health/ready`)).status).toBe(200);

    for (const svc of APPS) {
      const name = (await stateOf(ctx, svc))!.Name;
      const uid = await run('docker', ['exec', name, 'id', '-u'], { mode: 'capture' });
      expect(uid.stdout.trim(), svc).not.toBe('0');
      expect(await containerInspect(name, '{{.Config.User}}'), svc).toBe('node:node');
    }
    // core sin observability no inicia telemetría (TC-PLATFORM-STACK-007, escenario "Observabilidad opcional").
    expect((await serviceStates(ctx)).map((s) => s.Service)).not.toContain('otel-lgtm');
  });

  it('[TC-PLATFORM-STACK-002] con postgres u object-storage caídos /health/ready = 503 (live 200) y se recupera sin reiniciar finance-api', async () => {
    const apiName = (await stateOf(ctx, 'finance-api'))!.Name;
    const startedAt = await containerInspect(apiName, '{{.State.StartedAt}}');
    for (const dependency of ['postgres', 'object-storage']) {
      const name = (await stateOf(ctx, dependency))!.Name;
      await run('docker', ['stop', name], { mode: 'capture' });
      const down = await waitUntil(async () => {
        const r = await http(`${api}/health/ready`);
        return r.status === 503 ? r : undefined;
      });
      expect(down.body).toMatchObject({ status: 'not_ready', failing: [dependency] });
      expect(JSON.stringify(down.body)).not.toContain(env['PF_DEV_DB_APP_PASSWORD']!);
      expect((await http(`${api}/health/live`)).status).toBe(200);

      await run('docker', ['start', name], { mode: 'capture' });
      await waitUntil(
        async () => ((await http(`${api}/health/ready`)).status === 200 ? true : undefined),
        120_000,
      );
    }
    expect(await containerInspect(apiName, '{{.State.StartedAt}}')).toBe(startedAt);
  });

  it('[TC-PLATFORM-STACK-006] SIGTERM al worker a mitad de un job: el job termina dentro del período de gracia y no se toman jobs nuevos', async () => {
    const post = async (key: string) => {
      const res = await fetch(`${api}/internal/platform/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, durationMs: 5000 }),
      });
      expect(res.status).toBe(202);
      return ((await res.json()) as { jobId: string }).jobId;
    };
    const jobState = async (id: string) =>
      (await sql(ctx, `SELECT state FROM pgboss.job WHERE id = '${id}'`))[0];
    const effects = async (key: string) =>
      Number((await sql(ctx, `SELECT count(*) FROM platform.diagnostic_probe WHERE key = '${key}'`))[0]);

    const first = await post('sigterm-in-flight');
    await waitUntil(async () => ((await jobState(first)) === 'active' ? true : undefined), 30_000, 100);

    const workerName = (await stateOf(ctx, 'finance-worker'))!.Name;
    const stopStarted = Date.now();
    const stopping = compose(['*'], ['stop', 'finance-worker'], { mode: 'capture' }, ctx); // SIGTERM (grace 45 s)
    await new Promise((r) => setTimeout(r, 700));
    const second = await post('sigterm-after-signal');
    const stopped = await stopping;
    timings['worker_stop_with_job_in_flight'] = Date.now() - stopStarted;
    expect(stopped.code).toBe(0);

    expect(await containerInspect(workerName, '{{.State.ExitCode}}')).toBe('0');
    expect(timings['worker_stop_with_job_in_flight']).toBeLessThan(45_000);
    // El job en curso terminó (efecto confirmado exactamente una vez) antes de salir…
    expect(await jobState(first)).toBe('completed');
    expect(await effects('sigterm-in-flight')).toBe(1);
    // …y el encolado tras la señal no se tomó: sigue en cola, sin efecto.
    expect(await jobState(second)).toBe('created');
    expect(await effects('sigterm-after-signal')).toBe(0);

    const logs = await run('docker', ['logs', workerName], { mode: 'capture' });
    const lines = (logs.stdout + logs.stderr).split(/\r?\n/);
    const shutdownAt = lines.findIndex((l) => l.includes('"shutdown started"'));
    const completedAt = lines.findIndex((l) => l.includes(first) && l.includes('"job completed"'));
    expect(shutdownAt).toBeGreaterThanOrEqual(0);
    expect(completedAt).toBeGreaterThan(shutdownAt);
    expect(lines.some((l) => l.includes('"shutdown completed"'))).toBe(true);

    const restart = await compose(
      ['*'],
      ['up', '-d', '--wait', '--no-deps', 'finance-worker'],
      { mode: 'capture' },
      ctx,
    );
    expect(restart.code, restart.stderr).toBe(0);
    await waitUntil(async () => ((await jobState(second)) === 'completed' ? true : undefined), 60_000);
    expect(await effects('sigterm-after-signal')).toBe(1);
    expect(await effects('sigterm-in-flight')).toBe(1);
  });

  it('[TC-PLATFORM-STACK-004] backup:local y restore:local devuelven base y object storage al estado respaldado', async () => {
    const client = s3(env);
    try {
      await putObject(client, bucket, 'ws/tc-004/a.txt', 'contenido A');
      await putObject(client, bucket, 'ws/tc-004/b.txt', 'contenido B');
      const fingerprint = async () => {
        const tables = await sql(
          ctx,
          `SELECT 'platform.seed_run=' || (SELECT count(*) FROM platform.seed_run)
           UNION ALL SELECT 'platform.diagnostic_probe=' || (SELECT count(*) FROM platform.diagnostic_probe)
           UNION ALL SELECT 'schema_migrations=' || (SELECT string_agg(version, ',' ORDER BY version) FROM public.schema_migrations)`,
        );
        const objects: Record<string, string> = {};
        for (const { key } of await listAllObjects(client, bucket)) {
          objects[key] = digest(await getObjectBytes(client, bucket, key), 'sha256');
        }
        return { tables, objects };
      };
      const before = await fingerprint();
      expect(Object.keys(before.objects)).toEqual(
        expect.arrayContaining(['ws/tc-004/a.txt', 'ws/tc-004/b.txt']),
      );

      const backup = await pnpm('backup:local', ['--name=tc-stack-004'], processEnv);
      expect(backup.code, backup.stderr + backup.stdout).toBe(0);
      timings['backup_local'] = backup.ms;
      const id = /backup (\S+) listo/.exec(backup.stdout)?.[1];
      expect(id).toBeDefined();

      // Cambios posteriores al backup: fila nueva, objeto borrado, objeto modificado y objeto nuevo.
      await sql(ctx, `INSERT INTO platform.diagnostic_probe (key, job_id) VALUES ('after-backup', 'n/a')`);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'ws/tc-004/a.txt' }));
      await putObject(client, bucket, 'ws/tc-004/b.txt', 'contenido B modificado');
      await putObject(client, bucket, 'ws/tc-004/c.txt', 'nuevo');
      expect(await fingerprint()).not.toEqual(before);

      const restore = await pnpm('restore:local', [id!, '--yes'], processEnv);
      expect(restore.code, restore.stderr + restore.stdout).toBe(0);
      timings['restore_local'] = restore.ms;

      expect(await fingerprint()).toEqual(before);
      // La app sigue operativa con la base restaurada (roles, grants y pg-boss intactos).
      expect((await http(`${api}/health/ready`)).status).toBe(200);
      for (const svc of APPS) expect((await stateOf(ctx, svc))?.Health, svc).toBe('healthy');
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'ws/tc-004/' }));
      expect((page.Contents ?? []).map((o) => o.Key).sort()).toEqual(['ws/tc-004/a.txt', 'ws/tc-004/b.txt']);
      rmSync(backupDir(id!), { recursive: true, force: true });
    } finally {
      client.destroy();
    }
  });

  it('[TC-PLATFORM-STACK-003] los datos sobreviven a stack:down + stack:up y el reset con seed minimal deja exactamente la Minimal Seed', async () => {
    await sql(ctx, `INSERT INTO platform.diagnostic_probe (key, job_id) VALUES ('survives-restart', 'n/a')`);
    expect((await pnpm('stack:down', [], processEnv)).code).toBe(0);
    const up = await pnpm('stack:up', [], processEnv);
    expect(up.code, up.stderr).toBe(0);
    timings['deps_warm_up'] = up.ms;
    expect(
      await sql(ctx, `SELECT key FROM platform.diagnostic_probe WHERE key = 'survives-restart'`),
    ).toEqual(['survives-restart']);

    // Datos extra a la seed antes del reset.
    await sql(
      ctx,
      `INSERT INTO platform.diagnostic_probe (key, job_id) VALUES ('extra-before-reset', 'n/a')`,
    );
    const reset = await pnpm('stack:reset', ['--seed=minimal', '--yes'], processEnv);
    expect(reset.code, reset.stderr + reset.stdout).toBe(0);
    timings['reset_minimal'] = reset.ms;

    const files = readdirSync(resolve(ROOT, 'apps/api/db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0]!)
      .sort();
    expect(await sql(ctx, 'SELECT version FROM public.schema_migrations ORDER BY version')).toEqual(files);
    // La versión esperada se lee de la definición del seed para no desincronizarse al evolucionarlo.
    const seedSource = readFileSync(resolve(ROOT, 'apps/api/src/seed/run-seed.ts'), 'utf8');
    const minimalVersion = /minimal:\s*\{\s*datasetVersion:\s*(\d+)/.exec(seedSource)?.[1];
    expect(minimalVersion, 'datasetVersion de la Minimal Seed en run-seed.ts').toBeDefined();
    expect(await sql(ctx, `SELECT profile || ':' || dataset_version FROM platform.seed_run`)).toEqual([
      `minimal:${minimalVersion}`,
    ]);
    expect(await sql(ctx, 'SELECT count(*) FROM platform.diagnostic_probe')).toEqual(['0']);
  });
});
