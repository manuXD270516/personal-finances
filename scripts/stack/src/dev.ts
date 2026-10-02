// pnpm dev — MODO A (docs/19 §0.2): dependencias en contenedores (`pnpm stack:up`) + apps en el host con recarga.
//   1. comprueba que el perfil deps esté healthy
//   2. `migrate` en el host (dbmate npm + rol pf_app + pg-boss + bucket)
//   3. api y worker con `tsx watch` (fuentes TS de apps/api y packages/*), web con `next dev`
// Ctrl+C detiene los tres. El entorno sale del mismo `.env` que usa Compose (valores del modo A).
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from './lib/args.js';
import { log, runMain, UsageError, warn } from './lib/cli.js';
import { composeContext, serviceStates } from './lib/compose.js';
import { CommandError, run } from './lib/compose.js';
import { loadEnvFile } from './lib/dotenv.js';
import { ROOT } from './lib/paths.js';

const require = createRequire(import.meta.url);
const API_DIR = resolve(ROOT, 'apps/api');
const WEB_DIR = resolve(ROOT, 'apps/web');

function prefixed(name: string, child: ChildProcess): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    createInterface({ input: stream }).on('line', (line) => process.stdout.write(`[${name}] ${line}\n`));
  }
}

runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const ctx = composeContext();
  const env = loadEnvFile(ctx.envFile, process.env);
  const states = await serviceStates(ctx);
  const missing = ['postgres', 'object-storage', 'mailpit', 'keycloak'].filter(
    (svc) => !states.some((s) => s.Service === svc && s.State === 'running' && s.Health === 'healthy'),
  );
  if (missing.length > 0) {
    throw new UsageError(`dependencias no healthy (${missing.join(', ')}): ejecuta primero pnpm stack:up`);
  }

  const tsxCli = require.resolve('tsx/cli');
  const nextBin = createRequire(resolve(WEB_DIR, 'package.json')).resolve('next/dist/bin/next');
  const childEnv = { ...process.env, ...env, TSX_TSCONFIG_PATH: 'tsconfig.dev.json' };

  if (!args.flags.has('skip-migrate')) {
    log('migrate (host, desde las fuentes)…');
    const migrate = await run(
      process.execPath,
      [tsxCli, '--conditions=@pf/source', 'src/entrypoint.ts', 'migrate'],
      {
        env: childEnv,
        cwd: API_DIR,
      },
    );
    if (migrate.code !== 0) throw new CommandError(`migrate terminó con código ${migrate.code}`, migrate);
  }
  const tsxWatch = (command: string) => [
    tsxCli,
    'watch',
    '--clear-screen=false',
    '--conditions=@pf/source',
    'src/entrypoint.ts',
    command,
  ];
  const children: [string, ChildProcess][] = [
    [
      'api',
      spawn(process.execPath, tsxWatch('api'), {
        cwd: API_DIR,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ],
    [
      'worker',
      spawn(process.execPath, tsxWatch('worker'), {
        cwd: API_DIR,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ],
    [
      'web',
      spawn(
        process.execPath,
        [
          nextBin,
          'dev',
          '--port',
          env['PF_WEB_PORT'] ?? '23000',
          '--hostname',
          env['PF_BIND_ADDR'] ?? 'localhost',
        ],
        {
          cwd: WEB_DIR,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    ],
  ];
  for (const [name, child] of children) prefixed(name, child);
  log(
    `api http://${env['PF_BIND_ADDR']}:${env['PF_API_PORT']} · worker health :${env['PF_WORKER_HEALTH_PORT']} · web ${env['WEB_PUBLIC_URL']} (Ctrl+C para salir)`,
  );

  return new Promise<number>((resolveExit) => {
    let stopping = false;
    const stop = (code: number) => {
      if (stopping) return;
      stopping = true;
      for (const [, child] of children) if (child.exitCode === null) child.kill('SIGTERM');
      setTimeout(() => resolveExit(code), 1500).unref();
    };
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => stop(0));
    for (const [name, child] of children) {
      child.on('exit', (code) => {
        if (!stopping) {
          warn(`${name} terminó (código ${code ?? 'null'}); deteniendo el resto`);
          stop(code ?? 1);
        }
      });
    }
  });
});
