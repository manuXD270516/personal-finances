import { spawn, type StdioOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { COMPOSE_FILE, composeProject, envFilePath } from './paths.js';

export interface RunOptions {
  /** `inherit` (por defecto) muestra la salida; `capture` la devuelve. */
  readonly mode?: 'inherit' | 'capture';
  /** Flujo para stdin (p. ej. `pg_restore` desde un fichero). */
  readonly input?: Readable;
  /** Destino de stdout (p. ej. `pg_dump` a un fichero). Implica stdout binario sin capturar. */
  readonly output?: Writable;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `docker` con `spawn` y `shell: false`: mismo comportamiento en PowerShell, cmd y Git Bash (sin conversión de
 * rutas MSYS ni comillas del shell, SPIKE-08).
 */
export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const capture = options.mode === 'capture';
  const stdio: StdioOptions = [
    options.input ? 'pipe' : 'inherit',
    options.output || capture ? 'pipe' : 'inherit',
    capture ? 'pipe' : 'inherit',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio,
      env: options.env ?? process.env,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    let stdout = '';
    let stderr = '';
    if (options.input && child.stdin) options.input.pipe(child.stdin);
    if (options.output && child.stdout) child.stdout.pipe(options.output);
    else if (capture) child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    if (capture) child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export interface ComposeContext {
  readonly project: string;
  readonly envFile: string;
}

export function composeContext(env: NodeJS.ProcessEnv = process.env): ComposeContext {
  return { project: composeProject(env), envFile: envFilePath(env) };
}

/** `docker compose -p <proyecto> -f deploy/compose/compose.yaml --env-file <.env> [--profile …]`. */
export function composeArgs(
  ctx: ComposeContext,
  profiles: readonly string[],
  args: readonly string[],
): string[] {
  return [
    'compose',
    '-p',
    ctx.project,
    '-f',
    COMPOSE_FILE,
    '--env-file',
    ctx.envFile,
    ...profiles.flatMap((p) => ['--profile', p]),
    ...args,
  ];
}

export function compose(
  profiles: readonly string[],
  args: readonly string[],
  options: RunOptions = {},
  ctx: ComposeContext = composeContext(),
): Promise<RunResult> {
  // El `.env` en uso también es el `env_file` de los servicios de app (compose.yaml → PF_APP_ENV_FILE).
  const env = { ...(options.env ?? process.env), PF_APP_ENV_FILE: ctx.envFile };
  return run('docker', composeArgs(ctx, profiles, args), { ...options, env });
}

/** Igual que `compose`, pero falla con el código de salida si no es 0. */
export async function composeOrThrow(
  profiles: readonly string[],
  args: readonly string[],
  options: RunOptions = {},
  ctx: ComposeContext = composeContext(),
): Promise<RunResult> {
  const result = await compose(profiles, args, options, ctx);
  if (result.code !== 0) {
    throw new CommandError(`docker compose ${args.join(' ')} terminó con código ${result.code}`, result);
  }
  return result;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface ServiceState {
  readonly Service: string;
  readonly Name: string;
  readonly State: string;
  readonly Health: string;
  readonly ExitCode: number;
}

/** Estado de todos los contenedores del proyecto (incluidos los terminados). */
export async function serviceStates(ctx: ComposeContext = composeContext()): Promise<ServiceState[]> {
  const result = await compose(['*'], ['ps', '--all', '--format', 'json'], { mode: 'capture' }, ctx);
  if (result.code !== 0) throw new CommandError('docker compose ps falló', result);
  const text = result.stdout.trim();
  if (!text) return [];
  // Compose v2 emite una línea JSON por contenedor (versiones antiguas: un array).
  if (text.startsWith('[')) return JSON.parse(text) as ServiceState[];
  return text.split(/\r?\n/).map((l) => JSON.parse(l) as ServiceState);
}
